/** Multi-agent chat controller: Orchestrator -> isolated per-subject Luna agents. */

import { AcentaApi, ApiError } from "./api";
import { chatContextError, chatErrorMessage, chatTextError } from "./chat-contracts";

export interface AgentChannelSummary {
  id: string | null;
  channel_key: string;
  agent_kind: "orchestrator" | "subject";
  school_id: string;
  school_name: string;
  grade: string;
  shift: string;
  subject_id: string | null;
  subject_name: string | null;
  version: number;
  context_revision: number;
  through_turn: number;
  context_notes: string;
  summary_topic: string;
  digest: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface AgentChatTurn {
  operation_id: string;
  number: number;
  context_revision: number;
  user_text: string;
  assistant_text: string | null;
  state: "generating" | "succeeded" | "failed";
  error_code: string | null;
  model: string | null;
  delegated_subject_id: string | null;
  usage: {
    input_tokens: number | null;
    output_tokens: number | null;
    estimated_cost_usd: string | null;
  };
  created_at: string;
}

export interface SubjectDigestSummary {
  subject_id: string;
  subject_name: string;
  turn_count: number;
  summary_topic: string;
  digest: string;
}

export interface AgentChannelThread {
  channel: AgentChannelSummary | null;
  turns: AgentChatTurn[];
  subjectDigests: SubjectDigestSummary[];
  orchestratorBrief: string;
  draft: string;
  contextDraft: string | null;
  contextNotice: string;
  status: "idle" | "loading" | "sending" | "error";
  error: string;
  loaded: boolean;
}

export interface ActiveAgentTarget {
  channelKey: string;
  agentKind: "orchestrator" | "subject";
  schoolId: string;
  schoolName: string;
  grade: string;
  shift: string;
  subjectId: string | null;
  subjectName: string | null;
}

export interface AgentChatState {
  availability: "idle" | "loading" | "available" | "unavailable";
  model: string | null;
  channels: Record<string, AgentChannelThread>;
  summaries: Record<string, AgentChannelSummary>;
}

const emptyChannelThread = (): AgentChannelThread => ({
  channel: null,
  turns: [],
  subjectDigests: [],
  orchestratorBrief: "",
  draft: "",
  contextDraft: null,
  contextNotice: "",
  status: "idle",
  error: "",
  loaded: false,
});

const freshState = (): AgentChatState => ({
  availability: "idle",
  model: null,
  channels: {},
  summaries: {},
});

function formatAgentError(error: unknown): string {
  if (error instanceof ApiError) {
    const custom: Record<string, string> = {
      chat_timeout: "Luna tardó demasiado en responder. Tu mensaje sigue aquí; intenta de nuevo.",
      chat_rate_limited: "Demasiadas consultas seguidas. Espera unos segundos e intenta de nuevo.",
      chat_refusal: "Luna no pudo responder esa solicitud. Puedes reformular tu mensaje.",
      chat_authentication_error: "La clave de OpenAI del servidor no fue aceptada.",
      chat_transport_error: "No pudimos conectar con el servidor de IA. Tu texto sigue aquí.",
    };
    if (custom[error.code]) return custom[error.code];
    return chatErrorMessage(error);
  }
  return "No pudimos completar el envío. Tu texto sigue aquí.";
}

export class AgentChatController {
  private state: AgentChatState = freshState();
  private listeners = new Set<() => void>();
  private epoch = 0;
  private readGeneration = new Map<string, number>();
  private capabilityGeneration = 0;
  private closed = false;

  constructor(private readonly api: AcentaApi) {}

  snapshot = (): AgentChatState => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  threadFor(channelKey: string): AgentChannelThread {
    return this.state.channels[channelKey] ?? emptyChannelThread();
  }

  summaryFor(channelKey: string): AgentChannelSummary | null {
    return this.state.summaries[channelKey] ?? this.state.channels[channelKey]?.channel ?? null;
  }

  private emit(patch: Partial<AgentChatState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private patchThread(channelKey: string, patch: Partial<AgentChannelThread>) {
    const prev = this.state.channels[channelKey] ?? emptyChannelThread();
    this.emit({
      channels: {
        ...this.state.channels,
        [channelKey]: { ...prev, ...patch },
      },
    });
  }

  private live(epoch = this.epoch): boolean {
    return !this.closed && epoch === this.epoch;
  }

  hasUnsavedChanges(): boolean {
    return Object.values(this.state.channels).some(
      (th) =>
        Boolean(th.draft.trim()) ||
        th.status === "sending" ||
        (th.contextDraft !== null && th.contextDraft !== (th.channel?.context_notes ?? "")),
    );
  }

  hasPending(): boolean {
    return Object.values(this.state.channels).some((th) => th.status === "sending");
  }

  discardDrafts(): boolean {
    if (!this.live() || this.hasPending()) return false;
    const cleaned = Object.fromEntries(
      Object.entries(this.state.channels).map(([key, th]) => [
        key,
        { ...th, draft: "", contextDraft: null, error: "" },
      ]),
    );
    this.emit({ channels: cleaned });
    return true;
  }

  setDraft(channelKey: string, draft: string): boolean {
    if (!this.live()) return false;
    const current = this.threadFor(channelKey);
    if (current.status === "sending") return false;
    if (
      [...draft].length > 4096 ||
      new TextEncoder().encode(draft).length > 8192 ||
      /[\u0000\uD800-\uDFFF]/u.test(draft)
    ) {
      this.patchThread(channelKey, { error: chatTextError(draft) });
      return false;
    }
    this.patchThread(channelKey, { draft, error: "" });
    return true;
  }

  setContextDraft(channelKey: string, notes: string): boolean {
    if (!this.live()) return false;
    const current = this.threadFor(channelKey);
    if (current.status === "sending") return false;
    if (
      [...notes].length > 4096 ||
      new TextEncoder().encode(notes).length > 8192 ||
      /[\u0000\uD800-\uDFFF]/u.test(notes)
    ) {
      this.patchThread(channelKey, { error: chatContextError(notes) });
      return false;
    }
    this.patchThread(channelKey, { contextDraft: notes, contextNotice: "", error: "" });
    return true;
  }

  discardContextDraft(channelKey: string) {
    if (!this.live()) return;
    this.patchThread(channelKey, { contextDraft: null, error: "" });
  }

  async loadAvailability(): Promise<boolean> {
    if (!this.live()) return false;
    const epoch = this.epoch;
    const generation = ++this.capabilityGeneration;
    this.emit({ availability: "loading" });
    try {
      const res = (await this.api.scopedJson("agent-chat/capability", "GET", undefined, 10000)) as {
        available?: boolean;
        model?: string | null;
      };
      if (!this.live(epoch) || generation !== this.capabilityGeneration) return false;
      const available = res?.available === true;
      this.emit({
        availability: available ? "available" : "unavailable",
        model: typeof res?.model === "string" ? res.model : null,
      });
      if (available) {
        void this.listChannels();
      }
      return available;
    } catch {
      if (this.live(epoch) && generation === this.capabilityGeneration) {
        this.emit({ availability: "unavailable", model: null });
      }
      return false;
    }
  }

  async listChannels(schoolId?: string): Promise<void> {
    if (!this.live()) return;
    const epoch = this.epoch;
    try {
      const qs = schoolId ? `?school_id=${encodeURIComponent(schoolId)}` : "";
      const res = (await this.api.scopedJson(`agent-chat/channels${qs}`, "GET", undefined, 10000)) as {
        items?: AgentChannelSummary[];
      };
      if (!this.live(epoch) || !Array.isArray(res?.items)) return;
      const nextSummaries = { ...this.state.summaries };
      for (const item of res.items) {
        nextSummaries[item.channel_key] = item;
      }
      this.emit({ summaries: nextSummaries });
    } catch {
      // Non-fatal sidebar indicator fetch
    }
  }

  async openChannel(channelKey: string, force = false): Promise<void> {
    if (!this.live()) return;
    const existing = this.threadFor(channelKey);
    if (existing.status === "sending") return;
    if (!force && existing.loaded) return;
    const epoch = this.epoch;
    const generation = (this.readGeneration.get(channelKey) ?? 0) + 1;
    this.readGeneration.set(channelKey, generation);
    this.patchThread(channelKey, { status: "loading", error: "" });
    try {
      const doc = (await this.api.scopedJson(
        `agent-chat/channels/${encodeURIComponent(channelKey)}`,
        "GET",
        undefined,
        15000,
      )) as {
        channel: AgentChannelSummary;
        turns: AgentChatTurn[];
        subject_digests?: SubjectDigestSummary[];
        orchestrator_brief?: string;
      };
      if (!this.live(epoch) || this.readGeneration.get(channelKey) !== generation) return;
      const nextSummaries = { ...this.state.summaries };
      if (doc.channel?.id) {
        nextSummaries[channelKey] = doc.channel;
      }
      this.emit({ summaries: nextSummaries });
      this.patchThread(channelKey, {
        channel: doc.channel,
        turns: Array.isArray(doc.turns) ? doc.turns : [],
        subjectDigests: Array.isArray(doc.subject_digests) ? doc.subject_digests : [],
        orchestratorBrief: typeof doc.orchestrator_brief === "string" ? doc.orchestrator_brief : "",
        status: "idle",
        error: "",
        loaded: true,
      });
    } catch (error) {
      if (!this.live(epoch) || this.readGeneration.get(channelKey) !== generation) return;
      this.patchThread(channelKey, {
        status: "error",
        error: formatAgentError(error),
      });
    }
  }

  async submit(target: ActiveAgentTarget): Promise<boolean> {
    if (!this.live() || this.state.availability !== "available") return false;
    const { channelKey } = target;
    const current = this.threadFor(channelKey);
    if (current.status === "sending" || current.status === "loading") return false;
    const validation = chatTextError(current.draft);
    if (validation) {
      this.patchThread(channelKey, { error: validation, status: "error" });
      return false;
    }
    const text = current.draft;
    const expectedVersion = current.channel?.version ?? 0;
    const epoch = this.epoch;
    const operationId = crypto.randomUUID();
    this.patchThread(channelKey, { status: "sending", error: "", contextNotice: "" });
    try {
      const res = (await this.api.scopedJson(
        `agent-chat/channels/${encodeURIComponent(channelKey)}/turns`,
        "POST",
        {
          text,
          expected_version: expectedVersion,
          agent_kind: target.agentKind,
          school_id: target.schoolId,
          school_name: target.schoolName,
          grade: target.grade,
          shift: target.shift,
          subject_id: target.subjectId,
          subject_name: target.subjectName,
        },
        55000,
        operationId,
      )) as {
        channel: AgentChannelSummary;
        turn: AgentChatTurn;
      };
      if (!this.live(epoch)) return false;
      const latest = this.threadFor(channelKey);
      const turnsByNum = new Map(latest.turns.map((t) => [t.number, t]));
      turnsByNum.set(res.turn.number, res.turn);
      const ordered = [...turnsByNum.values()].sort((a, b) => a.number - b.number);
      const nextSummaries = { ...this.state.summaries, [channelKey]: res.channel };
      this.emit({ summaries: nextSummaries });
      this.patchThread(channelKey, {
        channel: res.channel,
        turns: ordered,
        draft: latest.draft === text ? "" : latest.draft,
        status: "idle",
        error: "",
        loaded: true,
      });
      // Invalidate orchestrator's cached subject digests so switching back shows fresh summary.
      if (target.agentKind === "subject") {
        const orchKey = `orchestrator:${target.schoolId}`;
        if (this.state.channels[orchKey]) {
          this.patchThread(orchKey, { loaded: false });
        }
      }
      return true;
    } catch (error) {
      if (!this.live(epoch)) return false;
      this.patchThread(channelKey, {
        status: "error",
        error: formatAgentError(error),
      });
      if (error instanceof ApiError && error.code === "conflict") {
        void this.openChannel(channelKey, true);
      }
      return false;
    }
  }

  async updateContext(target: ActiveAgentTarget, reset = false): Promise<boolean> {
    if (!this.live()) return false;
    const { channelKey } = target;
    const current = this.threadFor(channelKey);
    if (current.status === "sending" || current.status === "loading") return false;
    const notes = reset ? "" : (current.contextDraft ?? current.channel?.context_notes ?? "");
    const validation = chatContextError(notes);
    if (validation) {
      this.patchThread(channelKey, { error: validation });
      return false;
    }
    const epoch = this.epoch;
    this.patchThread(channelKey, { status: "sending", error: "", contextNotice: "" });
    try {
      const res = (await this.api.scopedJson(
        `agent-chat/channels/${encodeURIComponent(channelKey)}/context`,
        "POST",
        {
          notes,
          reset,
          agent_kind: target.agentKind,
          school_id: target.schoolId,
          school_name: target.schoolName,
          grade: target.grade,
          shift: target.shift,
          subject_id: target.subjectId,
          subject_name: target.subjectName,
        },
        15000,
        crypto.randomUUID(),
      )) as { channel: AgentChannelSummary };
      if (!this.live(epoch)) return false;
      const nextSummaries = { ...this.state.summaries, [channelKey]: res.channel };
      this.emit({ summaries: nextSummaries });
      this.patchThread(channelKey, {
        channel: res.channel,
        contextDraft: null,
        contextNotice: reset
          ? "Chat reiniciado para este agente. El historial anterior queda archivado aquí."
          : `Contexto guardado (revisión ${res.channel.context_revision}) para este agente.`,
        status: "idle",
        error: "",
        loaded: true,
      });
      // If orchestrator notes changed, subject channels should refresh their brief on next open.
      if (target.agentKind === "orchestrator") {
        const updated = { ...this.state.channels };
        for (const key of Object.keys(updated)) {
          if (key.startsWith(`subject:${target.schoolId}:`)) {
            updated[key] = { ...updated[key], loaded: false };
          }
        }
        this.emit({ channels: updated });
      }
      return true;
    } catch (error) {
      if (!this.live(epoch)) return false;
      this.patchThread(channelKey, {
        status: "error",
        error: formatAgentError(error),
      });
      return false;
    }
  }

  close() {
    this.closed = true;
    this.epoch++;
    this.readGeneration.clear();
    this.emit(freshState());
  }
}
