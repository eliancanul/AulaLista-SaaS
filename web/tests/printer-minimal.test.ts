import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { PrintJob, PrintSettings } from "../src/acenta/annex-api";
import { AcentaApi } from "../src/acenta/api";
import { AcentaController } from "../src/acenta/controller";
import { PrintSettingsView } from "../src/acenta/PrintSettingsView";
import { json, session } from "./acenta-fixtures";

vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return {
    ...react,
    useSyncExternalStore: <T,>(_subscribe: unknown, snapshot: () => T) =>
      snapshot(),
  };
});

function sampleSettings(
  overrides: Partial<PrintSettings> = {},
): PrintSettings {
  return {
    scope_id: session.scopeId,
    printer_email: "salon4a@print.epsonconnect.com",
    default_copies: 25,
    default_print_time: "06:30",
    timezone: "America/Mexico_City",
    smtp_configured: true,
    updated_at: "2026-11-20T10:00:00Z",
    ...overrides,
  };
}

function sampleJob(overrides: Partial<PrintJob> = {}): PrintJob {
  return {
    id: "job-1",
    scope_id: session.scopeId,
    job_kind: "annex",
    annex_id: "annex-1",
    annex_revision: 1,
    annex_title: "Fracciones equivalentes",
    printer_email: "salon4a@print.epsonconnect.com",
    copies: 25,
    scheduled_for: "2026-11-21T12:30:00Z",
    status: "pending",
    attempts: 0,
    last_error: null,
    idempotency_key: "idem-job-1",
    sent_at: null,
    created_at: "2026-11-20T10:00:00Z",
    ...overrides,
  };
}

function makeController() {
  return new AcentaController(
    new AcentaApi(session, () => Promise.resolve(json({}))),
  );
}

it("renders minimalist printer page without hero metric boxes and with clean hairline queue rows", () => {
  const controller = makeController();
  const html = renderToStaticMarkup(
    createElement(PrintSettingsView, {
      controller,
      initialSettings: sampleSettings(),
      initialJobs: [
        sampleJob(),
        sampleJob({
          id: "job-2",
          annex_title: "Hoja de prueba",
          status: "sent",
          copies: 1,
          sent_at: "2026-11-20T12:00:00Z",
        }),
      ],
    }),
  );

  // Clean header with school context and status dot
  expect(html).toContain("Benito Juárez · 4.º A");
  expect(html).toContain("Epson conectada");
  expect(html).toContain("minimal-status-dot is-ready");

  // Legacy bloated hero & metric boxes are removed
  expect(html).not.toContain("printer-hero");
  expect(html).not.toContain("printer-metrics");
  expect(html).not.toContain("printer-metric-label");

  // Hairline queue rows & quiet actions
  expect(html).toContain("minimal-queue-row");
  expect(html).toContain("Fracciones equivalentes");
  expect(html).toContain("25 copias");
  expect(html).toContain("Hoja de prueba");
  expect(html).toContain("1 copia");
  expect(html).toContain("Cancelar");
});

it("shows empty queue state and pending status dot when printer email is missing", () => {
  const controller = makeController();
  const html = renderToStaticMarkup(
    createElement(PrintSettingsView, {
      controller,
      initialSettings: sampleSettings({ printer_email: null }),
      initialJobs: [],
    }),
  );

  expect(html).toContain("Falta correo Epson");
  expect(html).toContain("minimal-status-dot is-pending");
  expect(html).toContain("Sin envíos todavía");
});

it("shows initial loading status instead of flashing empty or SMTP-pending states", () => {
  const controller = makeController();
  const html = renderToStaticMarkup(
    createElement(PrintSettingsView, { controller }),
  );

  expect(html).toContain("Cargando estado…");
  expect(html).toContain("Cargando cola de impresión…");
  expect(html).toContain('role="status"');
  expect(html).not.toContain("Sin envíos todavía");
  expect(html).not.toContain("SMTP pendiente en servidor");
});

it("shows SMTP pending status and retry/clear actions when failed jobs exist", () => {
  const controller = makeController();
  const html = renderToStaticMarkup(
    createElement(PrintSettingsView, {
      controller,
      initialSettings: sampleSettings({ smtp_configured: false }),
      initialJobs: [
        sampleJob({
          id: "job-err",
          status: "failed",
          last_error: "smtp_auth_failed",
        }),
      ],
    }),
  );

  expect(html).toContain("SMTP pendiente en servidor");
  expect(html).toContain("Limpiar errores");
  expect(html).toContain("Reintentar");
});

