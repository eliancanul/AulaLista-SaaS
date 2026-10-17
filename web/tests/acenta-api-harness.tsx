/** Test-only entrypoint: identity comes from the disposable API test, never a runtime flag. */
import React from "react";
import { createRoot } from "react-dom/client";
import { AcentaApp } from "../src/acenta/App";
import { AcentaApi } from "../src/acenta/api";
import { AcentaController } from "../src/acenta/controller";
import type { Session } from "../src/acenta/contracts";
import "../src/acenta/style.css";

declare const __ACENTA_E2E_SESSION__: Session;
let workspace = sessionStorage.getItem("acenta-api-test-workspace");
if (!workspace) {
  workspace = crypto.randomUUID();
  sessionStorage.setItem("acenta-api-test-workspace", workspace);
}
createRoot(document.getElementById("root")!).render(
  <AcentaApp
    controller={
      new AcentaController(
        new AcentaApi(__ACENTA_E2E_SESSION__),
        localStorage,
        workspace,
      )
    }
  />,
);
