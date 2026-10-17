// Test-only entrypoint. Production build has only index.html and never exports this session.
import React from "react";
import { createRoot } from "react-dom/client";
import { AcentaApp } from "../src/acenta/App";
import { AcentaApi } from "../src/acenta/api";
import { AcentaController } from "../src/acenta/controller";
import { session } from "./acenta-fixtures";
import "../src/acenta/style.css";
let slot = sessionStorage.getItem("acenta-test-workspace");
if (!slot) {
  slot = crypto.randomUUID();
  sessionStorage.setItem("acenta-test-workspace", slot);
}
createRoot(document.getElementById("root")!).render(
  <AcentaApp
    controller={
      new AcentaController(new AcentaApi(session), localStorage, slot)
    }
  />,
);
