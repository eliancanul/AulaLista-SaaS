// Test-only entrypoint. Production build has only index.html and never exports this session.
import React from "react";
import { createRoot } from "react-dom/client";
import { AcentaApp } from "../src/acenta/App";
import { AcentaApi } from "../src/acenta/api";
import { EditorRecovery } from "../src/acenta/editor-recovery";
import { AcentaController } from "../src/acenta/controller";
import { session } from "./acenta-fixtures";
import "../src/acenta/style.css";
let slot = sessionStorage.getItem("acenta-test-workspace");
if (!slot) {
  slot = crypto.randomUUID();
  sessionStorage.setItem("acenta-test-workspace", slot);
}
const recovery = new URLSearchParams(location.search).has("recovery")
  ? new EditorRecovery(() => sessionStorage) : null;
if (recovery) recovery.admit({
  principal_id: session.actorId,
  scope_id: session.scopeId,
  recovery_context_id: "70000000-0000-4000-8000-000000000007",
});
const controller = new AcentaController(new AcentaApi(session), recovery ? null : localStorage, slot, recovery);
await controller.restoreRecovery();
// This legacy harness exercises the attached-example composer. Production starts
// in chat; chat.connected.ts covers that real entrypoint with authenticated HTTP.
if (controller.snapshot().view === "home" && !new URLSearchParams(location.search).has("chat")) controller.navigate("example");
createRoot(document.getElementById("root")!).render(<AcentaApp controller={controller} />);
