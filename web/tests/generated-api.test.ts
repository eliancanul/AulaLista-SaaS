/** Offline wire-contract checks; synthetic responses do not evaluate a model. */
import { expect, it } from "vitest";
import { AcentaApi, parsePlanning } from "../src/acenta/api";
import { guidedPlanning, guidedRequest } from "./guided-fixtures";
import { json, session } from "./acenta-fixtures";

it("reads availability and creates the explicit generated contract without a fixture marker", async () => {
  const { fixture_context: _fixture, ...manual } = guidedRequest();
  const input = { ...manual, contract_version: 3 as const };
  const key = crypto.randomUUID();
  const doc = guidedPlanning(key);
  const response = { ...doc, request: input, result: { ...doc.result, provenance: "openai-guided-v1" } };
  const calls: { path: string; method: string; body?: string }[] = [];
  const api = new AcentaApi(session, async (url, init) => {
    calls.push({ path: String(url), method: init?.method ?? "GET", body: init?.body as string });
    return json(String(url).endsWith("planning-generation") ? { available: true } : response);
  });
  expect(await api.generationAvailable()).toBe(true);
  expect(await api.create(input, key)).toEqual(response);
  expect(calls.map(c => [c.path.split("/").at(-1), c.method])).toEqual([
    ["planning-generation", "GET"], ["generated-plannings", "POST"],
  ]);
  expect(JSON.parse(calls[1].body!)).toEqual(input);
  expect(JSON.parse(calls[1].body!)).not.toHaveProperty("fixture_context");
});

it("rejects generation provenance on a historical fixture instead of silently relabeling it", () => {
  const doc = guidedPlanning();
  doc.result.provenance = "openai-guided-v1";
  expect(() => parsePlanning(doc)).toThrow("invalid_response");
  const { fixture_context: _fixture, ...manual } = guidedRequest();
  doc.request = { ...manual, contract_version: 3 };
  doc.result.provenance = "synthetic-fixture-v1";
  expect(() => parsePlanning(doc)).toThrow("invalid_response");
});
