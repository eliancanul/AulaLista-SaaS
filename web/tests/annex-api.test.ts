import { expect, it } from "vitest";
import { AcentaApi } from "../src/acenta/api";
import {
  AnnexPrintClient,
  cleanHeaderFieldLabel,
  humanizePrintError,
  needsDrawingBox,
  stripLeadingNumber,
} from "../src/acenta/annex-api";
import { json, session } from "./acenta-fixtures";

it("AnnexPrintClient calls annex generation, approval, PDF url, and print queue routes", async () => {
  const calls: { url: string; method: string; body?: string }[] = [];
  const sampleAnnex = {
    id: "11111111-1111-4111-8111-111111111111",
    scope_id: session.scopeId,
    title: "Fracciones",
    subject: "Matemáticas",
    grade: "4.º de primaria",
    topic: "Fracciones",
    instructions: "Responde con claridad.",
    content: {
      subtitle: "Matemáticas · 4.º",
      student_header_fields: ["Nombre", "Fecha", "Grupo"],
      sections: [
        {
          heading: "1. Ejercicios",
          prompt: "",
          items: [{ kind: "question", text: "¿Cuánto es 1/2 + 1/2?", answer_lines: 2 }],
        },
      ],
      footer_note: "AulaLista",
    },
    status: "draft",
    provenance: "fake-annex-v1",
    model: "gpt-6-luna",
    revision: 1,
    approved_at: null,
    created_at: "2026-11-20T12:00:00+00:00",
    updated_at: "2026-11-20T12:00:00+00:00",
  };
  const api = new AcentaApi(session, async (url, init) => {
    const path = String(url);
    const method = init?.method ?? "GET";
    calls.push({ url: path, method, body: init?.body ? String(init.body) : undefined });
    if (path.endsWith("/annex-capability")) return json({ available: true, model: "gpt-6-luna" });
    if (path.endsWith("/annexes/generate")) return json(sampleAnnex, 201);
    if (path.endsWith("/approve")) return json({ ...sampleAnnex, status: "approved" });
    if (path.endsWith("/print")) {
      return json(
        {
          id: "22222222-2222-4222-8222-222222222222",
          scope_id: session.scopeId,
          annex_id: sampleAnnex.id,
          job_kind: "annex",
          annex_revision: 1,
          annex_title: "Fracciones",
          printer_email: "l3250@print.epsonconnect.com",
          copies: 25,
          scheduled_for: "2026-11-20T12:00:00+00:00",
          status: "sent",
          attempts: 1,
          last_error: null,
          idempotency_key: "key-1",
          created_at: "2026-11-20T12:00:00+00:00",
          sent_at: "2026-11-20T12:00:01+00:00",
        },
        201,
      );
    }
    if (path.endsWith("/print-jobs?status=failed") && method === "DELETE") {
      return json({ deleted: 2, skipped_sending: 0 });
    }
    if (path.endsWith("/print-jobs") && method === "DELETE") {
      return json({ deleted: 3, skipped_sending: 0 });
    }
    if (path.includes("/print-jobs/") && method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    return json({ items: [] });
  });

  const client = new AnnexPrintClient(api);
  const cap = await client.capability();
  expect(cap).toEqual({ available: true, model: "gpt-6-luna" });

  const generated = await client.generateAnnex({
    subject: "Matemáticas",
    grade: "4.º de primaria",
    topic: "Fracciones",
    annex_type: "hoja-de-trabajo",
    language: "es",
    extra_instructions: "",
  });
  expect(generated.status).toBe("draft");
  expect(client.pdfUrl(generated.id, 30)).toBe(
    `/scopes/${session.scopeId}/annexes/${generated.id}/pdf?copies=30`,
  );

  const approved = await client.approveAnnex(generated.id);
  expect(approved.status).toBe("approved");

  const job = await client.printAnnex(generated.id, {
    mode: "now",
    copies: 25,
    idempotency_key: "key-1",
  });
  expect(job.status).toBe("sent");

  await client.deletePrintJob(job.id);
  const clearedFailed = await client.clearPrintJobs("failed");
  expect(clearedFailed).toEqual({ deleted: 2, skipped_sending: 0 });
  const clearedAll = await client.clearPrintJobs("all");
  expect(clearedAll).toEqual({ deleted: 3, skipped_sending: 0 });

  expect(calls.map((c) => `${c.method} ${c.url.split("/").slice(-2).join("/")}`)).toEqual([
    `GET ${session.scopeId}/annex-capability`,
    "POST annexes/generate",
    `POST ${sampleAnnex.id}/approve`,
    `POST ${sampleAnnex.id}/print`,
    `DELETE print-jobs/${job.id}`,
    `DELETE ${session.scopeId}/print-jobs?status=failed`,
    `DELETE ${session.scopeId}/print-jobs`,
  ]);
});

it("humanizePrintError maps all backend print error codes and unknown fallbacks to Spanish", () => {
  expect(humanizePrintError("smtp_not_configured")).toContain("SMTP");
  expect(humanizePrintError("smtp_auth_failed")).toContain("contraseña de aplicación");
  expect(humanizePrintError("smtp_send_failed")).toContain("Epson");
  expect(humanizePrintError("smtp_send_failed: connection reset")).toContain("Epson");
  expect(humanizePrintError("smtp_timeout")).toContain("tardó demasiado");
  expect(humanizePrintError("pdf_exceeds_epson_limit")).toContain("20 MB");
  expect(humanizePrintError("printer_email_required")).toContain("@print.epsonconnect.com");
  expect(humanizePrintError("annex_not_found")).toContain("no existe");
  expect(humanizePrintError("print_job_sending")).toContain("enviando");
  expect(humanizePrintError(null)).toContain("No se pudo completar el envío");
  expect(humanizePrintError("unexpected_code")).toContain("No se pudo completar el envío");
});

it("worksheet preview helpers clean student header labels, strip duplicate numbers, and detect drawing boxes", () => {
  expect(cleanHeaderFieldLabel("Nombre: __________")).toBe("Nombre");
  expect(cleanHeaderFieldLabel("Fecha:____")).toBe("Fecha");
  expect(cleanHeaderFieldLabel("Grupo")).toBe("Grupo");

  expect(stripLeadingNumber("1. ¿Qué es el agua?")).toBe("¿Qué es el agua?");
  expect(stripLeadingNumber("2) Resuelve la suma")).toBe("Resuelve la suma");
  expect(stripLeadingNumber("Explica con tus palabras")).toBe("Explica con tus palabras");

  expect(needsDrawingBox("Dibuja el ciclo del agua en el recuadro.")).toBe(true);
  expect(needsDrawingBox("Traza una gráfica de barras.")).toBe(true);
  expect(needsDrawingBox("¿Cuánto es 1/2 + 1/4?")).toBe(false);
});
