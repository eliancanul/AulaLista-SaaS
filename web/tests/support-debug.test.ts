import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { AcentaApi } from "../src/acenta/api";
import { SupportPanel } from "../src/acenta/SupportPanel";
import {
  collectDebugBundle,
  recordBreadcrumb,
  recordConsoleError,
  recordNetworkEvent,
  resetDebugTelemetryForTests,
} from "../src/acenta/debug-telemetry";
import { json, session } from "./acenta-fixtures";

describe("support debug telemetry and simple support UI", () => {
  beforeEach(() => {
    resetDebugTelemetryForTests();
  });

  it("collects console errors, sanitized network paths, breadcrumbs, and app state", () => {
    recordConsoleError("TypeError: undefined is not a function", "at Chat.tsx:42");
    recordNetworkEvent({
      method: "POST",
      path: "https://acenta.app/scopes/abc/print?token=SUPER_SECRET&foo=bar",
      status: 502,
      durationMs: 310,
      ok: false,
    });
    recordBreadcrumb("view", "annexes", { school: "benito" });

    const bundle = collectDebugBundle({ view: "annexes", activeAgentMode: "orchestrator" });
    expect(bundle.consoleErrors).toHaveLength(1);
    expect(bundle.consoleErrors[0].message).toContain("TypeError");
    expect(bundle.networkLog).toHaveLength(1);
    expect(bundle.networkLog[0].path).toBe("/scopes/abc/print");
    expect(bundle.networkLog[0].path).not.toContain("SUPER_SECRET");
    expect(bundle.breadcrumbs).toHaveLength(1);
    expect(bundle.appState).toMatchObject({ view: "annexes", activeAgentMode: "orchestrator" });
  });

  it("renders only a simple explanation prompt and submit button for users", () => {
    const api = new AcentaApi(session, () => Promise.resolve(json({})));
    const bundle = collectDebugBundle({ view: "documents" });
    const html = renderToStaticMarkup(
      createElement(SupportPanel, {
        api,
        viewName: "documents",
        initialScreenshot: null,
        initialDebugBundle: bundle,
      }),
    );
    expect(html).toContain("¿Qué pasó?");
    expect(html).toContain("Enviar");
    expect(html).toContain("Guardamos automáticamente una captura y datos técnicos");
    expect(html).not.toContain("Backlog de debug");
    expect(html).not.toContain("Recapturar pantalla");
    expect(html).not.toContain("Gravedad");
  });
});
