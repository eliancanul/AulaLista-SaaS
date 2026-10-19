import { describe, expect, it } from "vitest";
import { validateAnalyticForm } from "../src/acenta/analytic-form";
import type { AnalyticSectionData } from "../src/acenta/analytic-sections";

const valid = (): AnalyticSectionData => ({
  contract_version: 1, name: " El cuidado del agua ", grade: "3.º de primaria",
  period: "Octubre · 2026", situation: " Observar usos cotidianos. ",
  context: { text: " Comunidad imaginaria. ", hypothetical: true },
  entries: [{ content: " Uso del agua. ", pda: " Proponer acciones. " }],
  formative_field: null, articulating_axes: [], language: "es", reference: null,
});

describe("analytic form validation", () => {
  it("accepts manual data without changing whitespace or hypothetical provenance", () => {
    const data = valid(), before = structuredClone(data);
    expect(validateAnalyticForm(data)).toEqual({});
    expect(data).toEqual(before);
  });
  it("identifies missing required fields including content and PDA separately", () => {
    const errors = validateAnalyticForm({ ...valid(), name: " ", grade: "", period: "",
      situation: "", entries: [{ content: "", pda: "" }] });
    expect(Object.keys(errors)).toEqual(["name", "grade", "period", "situation", "content-0", "pda-0"]);
  });
  it("rejects a total payload that exceeds the admitted size even when each field fits", () => {
    const data = valid();
    data.entries = Array.from({ length: 8 }, () => ({ content: "á".repeat(400), pda: "agua" }));
    data.context = { text: "c".repeat(1000), hypothetical: false };
    data.situation = "s".repeat(1000);
    expect(validateAnalyticForm(data).form).toMatch(/8000/);
  });
  it("locates malformed optional text without silently removing it", () => {
    const errors = validateAnalyticForm({ ...valid(), context: { text: " ", hypothetical: true },
      articulating_axes: ["Eje", ""], formative_field: "\u0000" });
    expect(Object.keys(errors)).toEqual(["context", "formative_field", "articulating_axes"]);
  });
});
