import { beforeEach, describe, expect, it } from "vitest";
import {
  collectDebugBundle,
  recordBreadcrumb,
  recordConsoleError,
  recordNetworkEvent,
  resetDebugTelemetryForTests,
} from "../src/acenta/debug-telemetry";

describe("support debug telemetry", () => {
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

    const bundle = collectDebugBundle({ view: "annexes", activeAgentMode: "subject" });
    expect(bundle.consoleErrors).toHaveLength(1);
    expect(bundle.consoleErrors[0].message).toContain("TypeError");
    expect(bundle.networkLog).toHaveLength(1);
    expect(bundle.networkLog[0].path).toBe("/scopes/abc/print");
    expect(bundle.networkLog[0].path).not.toContain("SUPER_SECRET");
    expect(bundle.breadcrumbs).toHaveLength(1);
    expect(bundle.appState).toMatchObject({ view: "annexes", activeAgentMode: "subject" });
  });
});
