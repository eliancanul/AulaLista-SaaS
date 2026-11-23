import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { AcentaApi, type Transport } from "../src/acenta/api";
import { Chat, ChatContextEditor } from "../src/acenta/Chat";
import { AcentaController } from "../src/acenta/controller";
import { session } from "./acenta-fixtures";

vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return {
    ...react,
    useSyncExternalStore: <T,>(_subscribe: unknown, snapshot: () => T) =>
      snapshot(),
  };
});

class FakeAgentChatServer {
  available = true;
  model = "gpt-6-luna";
  channels = new Map<
    string,
    {
      channel: Record<string, unknown>;
      turns: Array<Record<string, unknown>>;
    }
  >();

  transport: Transport = async (url, init) => {
    const method = init?.method ?? "GET";
    const parsed = new URL(typeof url === "string" || url instanceof URL ? url : url.url, "https://acenta.test");
    const path = parsed.pathname;

    if (path.endsWith("/agent-chat/capability") && method === "GET") {
      return new Response(
        JSON.stringify({ available: this.available, model: this.available ? this.model : null }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (path.endsWith("/agent-chat/channels") && method === "GET") {
      const items = [...this.channels.values()].map((entry) => entry.channel);
      return new Response(JSON.stringify({ items }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    const turnsMatch = path.match(/\/agent-chat\/channels\/([^/]+)\/turns$/);
    if (turnsMatch && method === "POST") {
      const channelKey = decodeURIComponent(turnsMatch[1]);
      const body = JSON.parse(String(init?.body ?? "{}"));
      const existing = this.channels.get(channelKey);
      const version = existing ? Number(existing.channel.version) + 1 : 1;
      const contextRevision = existing ? Number(existing.channel.context_revision) : 0;
      const throughTurn = existing ? Number(existing.channel.through_turn) : 0;
      const contextNotes = existing ? String(existing.channel.context_notes) : "";
      const delegatedSubjectId =
        body.agent_kind === "orchestrator" && /matem[aá]ticas/i.test(body.text)
          ? "benito-mat"
          : null;
      const channel = {
        id: existing ? existing.channel.id : `ch-${channelKey}`,
        channel_key: channelKey,
        agent_kind: body.agent_kind,
        school_id: body.school_id,
        school_name: body.school_name,
        grade: body.grade,
        shift: body.shift,
        subject_id: body.subject_id,
        subject_name: body.subject_name,
        version,
        context_revision: contextRevision,
        through_turn: throughTurn,
        context_notes: contextNotes,
        summary_topic: String(body.text).slice(0, 60),
        digest: `${body.subject_name ?? "General"}: ${String(body.text).slice(0, 80)}`,
        created_at: "2026-11-22T03:00:00Z",
        updated_at: "2026-11-22T03:01:00Z",
      };
      const turn = {
        operation_id: init?.headers ? new Headers(init.headers).get("Idempotency-Key") ?? crypto.randomUUID() : crypto.randomUUID(),
        number: version,
        context_revision: contextRevision,
        user_text: body.text,
        assistant_text:
          body.agent_kind === "orchestrator"
            ? "Coordinación general lista. Te sugiero detallar esto en el agente de Matemáticas."
            : `Propuesta especializada para ${body.subject_name}: ${body.text}`,
        state: "succeeded",
        error_code: null,
        model: this.model,
        delegated_subject_id: delegatedSubjectId,
        usage: {
          input_tokens: 120,
          output_tokens: 90,
          estimated_cost_usd: "0.001200",
        },
        created_at: "2026-11-22T03:01:00Z",
      };
      const turns = [...(existing?.turns ?? []), turn];
      this.channels.set(channelKey, { channel, turns });
      return new Response(JSON.stringify({ channel, turn }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }

    const contextMatch = path.match(/\/agent-chat\/channels\/([^/]+)\/context$/);
    if (contextMatch && method === "POST") {
      const channelKey = decodeURIComponent(contextMatch[1]);
      const body = JSON.parse(String(init?.body ?? "{}"));
      const existing = this.channels.get(channelKey);
      const version = existing ? Number(existing.channel.version) : 0;
      const channel = {
        id: existing ? existing.channel.id : `ch-${channelKey}`,
        channel_key: channelKey,
        agent_kind: body.agent_kind,
        school_id: body.school_id,
        school_name: body.school_name,
        grade: body.grade,
        shift: body.shift,
        subject_id: body.subject_id,
        subject_name: body.subject_name,
        version,
        context_revision: (existing ? Number(existing.channel.context_revision) : 0) + 1,
        through_turn: version,
        context_notes: body.reset ? "" : body.notes,
        summary_topic: existing ? existing.channel.summary_topic : "",
        digest: existing ? existing.channel.digest : "",
        created_at: "2026-11-22T03:00:00Z",
        updated_at: "2026-11-22T03:02:00Z",
      };
      this.channels.set(channelKey, { channel, turns: existing?.turns ?? [] });
      return new Response(JSON.stringify({ channel }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    const channelMatch = path.match(/\/agent-chat\/channels\/([^/]+)$/);
    if (channelMatch && method === "GET") {
      const channelKey = decodeURIComponent(channelMatch[1]);
      const existing = this.channels.get(channelKey);
      const isOrchestrator = channelKey.startsWith("orchestrator:");
      const schoolId = channelKey.split(":")[1] ?? "benito";
      const subjectDigests = isOrchestrator
        ? [...this.channels.values()]
            .filter(
              (entry) =>
                entry.channel.agent_kind === "subject" &&
                entry.channel.school_id === schoolId &&
                Number(entry.channel.version) > 0,
            )
            .map((entry) => ({
              subject_id: String(entry.channel.subject_id),
              subject_name: String(entry.channel.subject_name),
              turn_count: Number(entry.channel.version),
              summary_topic: String(entry.channel.summary_topic),
              digest: String(entry.channel.digest),
            }))
        : [];
      const orch = this.channels.get(`orchestrator:${schoolId}`);
      const orchestratorBrief = !isOrchestrator && orch
        ? String(orch.channel.context_notes || orch.channel.digest || "")
        : "";
      return new Response(
        JSON.stringify({
          channel: existing?.channel ?? {
            id: null,
            channel_key: channelKey,
            agent_kind: isOrchestrator ? "orchestrator" : "subject",
            school_id: schoolId,
            school_name: "Benito Juárez",
            grade: "4.º A",
            shift: "Matutino",
            subject_id: isOrchestrator ? null : channelKey.split(":")[2] ?? null,
            subject_name: isOrchestrator ? null : "Matemáticas",
            version: 0,
            context_revision: 0,
            through_turn: 0,
            context_notes: "",
            summary_topic: "",
            digest: "",
            created_at: null,
            updated_at: null,
          },
          turns: existing?.turns ?? [],
          subject_digests: subjectDigests,
          orchestrator_brief: orchestratorBrief,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ detail: "not_found" }), { status: 404 });
  };
}

const renderChat = (controller: AcentaController) =>
  renderToStaticMarkup(
    createElement(Chat, { controller, onPlan() {}, onContext() {} }),
  );

const renderContextEditor = (controller: AcentaController) =>
  renderToStaticMarkup(createElement(ChatContextEditor, { controller }));

it("renders unified school chat without 'Orquestador' labels and displays auto-detected subject pills", async () => {
  const server = new FakeAgentChatServer();
  const c = new AcentaController(new AcentaApi(session, server.transport));

  expect(await c.agentChat.loadAvailability()).toBe(true);
  expect(c.schools.getActiveChannelKey()).toBe("orchestrator:benito");

  // 1. Empty state shows clean school greeting without "Orquestador" or manual subject switches
  await c.agentChat.openChannel("orchestrator:benito");
  let html = renderChat(c);
  expect(html).toContain("Benito Juárez · 4.º A");
  expect(html).toContain("¿Qué preparamos hoy?");
  expect(html.toLowerCase()).not.toContain("orquestador");
  expect(html).not.toContain("Agentes de materia");

  // 2. Sending a message mentioning Matemáticas renders Luna + subtle subject pill, no manual switch CTA
  const schoolTarget = {
    channelKey: "orchestrator:benito",
    agentKind: "orchestrator" as const,
    schoolId: "benito",
    schoolName: "Benito Juárez",
    grade: "4.º A",
    shift: "Matutino",
    subjectId: null,
    subjectName: null,
  };
  c.agentChat.setDraft(
    schoolTarget.channelKey,
    "Necesito ejercicios de Matemáticas sobre fracciones",
  );
  expect(await c.agentChat.submit(schoolTarget)).toBe(true);

  html = renderChat(c);
  expect(html).toContain("Benito Juárez · 4.º A");
  expect(html).toContain("<span>Luna</span>");
  expect(html).toContain("chat-subject-pill");
  expect(html).toContain("Matemáticas");
  expect(html.toLowerCase()).not.toContain("orquestador");
  expect(html).not.toContain("Continuar en agente");

  // 3. Switching to another school isolates that school's thread cleanly
  c.schools.switchSchool("hidalgo");
  await c.agentChat.openChannel("orchestrator:hidalgo");
  html = renderChat(c);
  expect(html).toContain("Miguel Hidalgo · 3.º B");
  expect(html).not.toContain("fracciones");

  // 4. Context editor shows clean school heading and saves group notes without mentioning 'Orquestador'
  c.schools.switchSchool("benito");
  c.agentChat.setContextDraft(
    "orchestrator:benito",
    "Semana del agua y evaluación el viernes",
  );
  expect(await c.agentChat.updateContext(schoolTarget, false)).toBe(true);
  const ctxHtml = renderContextEditor(c);
  expect(ctxHtml).toContain("Benito Juárez · 4.º A");
  expect(ctxHtml).toContain("Notas generales del grupo (4.º A)");
  expect(ctxHtml.toLowerCase()).not.toContain("orquestador");

  // 5. Logout purges memory-only state
  c.closeSession();
  expect(c.agentChat.snapshot().availability).toBe("idle");
  expect(Object.keys(c.agentChat.snapshot().channels)).toHaveLength(0);
});
