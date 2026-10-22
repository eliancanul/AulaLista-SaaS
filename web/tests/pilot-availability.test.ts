/** #68 copy/controller regression tests. Synthetic HTTP only, not an E2E gate. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { AcentaApi, ApiError, errorMessage } from "../src/acenta/api";
import { AcentaController, type BackupStore } from "../src/acenta/controller";
import { GuidedForm } from "../src/acenta/GuidedPlanning";
import { GuidedServer } from "./guided-server";
import { guidedRequest } from "./guided-fixtures";
import { json, session, workspaceId, type Call } from "./acenta-fixtures";

// GuidedForm is client-only. Supply its current controller snapshot to the
// static renderer; this checks rendered copy, not subscription/browser behavior.
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react, useSyncExternalStore: <T,>(_subscribe: unknown, snapshot: () => T) => snapshot() };
});

class RejectedPilot extends GuidedServer {
  rejection = "generation_busy";
  status = 409;
  protected override handle(call: Call): Response {
    if (call.path === "planning-generation") return json({ available: true });
    if (call.path === "generated-plannings") return json({ detail: this.rejection }, this.status);
    return super.handle(call);
  }
}
function setup() {
  const saved = new Map<string, string>();
  const storage: BackupStore = {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => { saved.set(key, value); },
    removeItem: key => { saved.delete(key); },
  };
  const server = new RejectedPilot();
  const controller = new AcentaController(new AcentaApi(session, server.transport), storage, workspaceId);
  controller.navigate("planning");
  controller.setGuided({ ...guidedRequest(), topic: "Tema manual sintético independiente" });
  return { controller, server, storage };
}

it("availability copy never promises admission, a reserved budget or unrestricted inputs", async () => {
  const { controller } = setup();
  await controller.loadGenerationAvailability();
  const html = renderToStaticMarkup(createElement(GuidedForm, { controller }));
  const status = html.match(/<p role="status">([^<]+)<\/p>/)?.[1] ?? "";
  expect(status).toMatch(/IA.*(?:configurada|habilitada|disponible)/);
  expect(status).toMatch(/no (?:garantiza|asegura).*admi|admi.*no.*garantiza/i);
  expect(status).toMatch(/no.*reserva.*presupuesto|presupuesto.*no.*reserv/i);
  expect(status).not.toContain("Se preparará una planeación con los datos que escribas");
  expect(status).not.toMatch(/cualquier (?:dato|entrada)|todos los datos|calidad (?:curricular|pedagógica) garantizada/i);
});

it("global busy copy neither attributes another operation nor asks to recover an unowned one", () => {
  const message = errorMessage(new ApiError(409, "generation_busy"));
  expect(message).toMatch(/no se inició/i);
  expect(message).toMatch(/tus datos.*(?:aquí|conserv)/i);
  expect(message).not.toMatch(/otra generación|en curso|cuenta|usuario|anterior|consult[ae].*estado|recuper/i);
});

it("oversized manual input is not presented as an example-only limit", () => {
  const message = errorMessage(new ApiError(413, "request_too_large"));
  expect(message).toContain("límite permitido para esta petición");
  expect(message).toContain("Tus datos siguen aquí");
  expect(message).not.toContain("ejemplo");
});

it.each([
  ["generation_input_not_approved", 422],
  ["generation_budget_exhausted", 429],
  ["generation_busy", 409],
  ["generation_unavailable", 503],
] as const)("%s after availability preserves the whole form and leaves no invented recovery", async (rejection, status) => {
  const { controller: c, server, storage } = setup();
  const form = structuredClone(c.snapshot().guided);
  server.rejection = rejection;
  server.status = status;
  await c.loadGenerationAvailability();
  expect(c.snapshot().generationAvailable).toBe(true);
  await c.submitGuided("ai");
  expect(c.snapshot().guided).toEqual(form);
  expect(c.snapshot().pending).toBeNull();
  expect(c.snapshot().result).toBeNull();
  expect(c.snapshot().submit).toBe("error");
  expect(server.calls.map(call => [call.method, call.path])).toEqual([
    ["GET", "planning-generation"], ["POST", "generated-plannings"],
  ]);
  await c.recoverCreate();
  const restored = new AcentaController(new AcentaApi(session, server.transport), storage, workspaceId);
  expect(restored.snapshot().pending).toBeNull();
  await restored.recoverCreate();
  expect(server.calls).toHaveLength(2);
});
