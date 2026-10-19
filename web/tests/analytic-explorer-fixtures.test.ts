import { describe, expect, it } from "vitest";
import { AcentaApi } from "../src/acenta/api";
import { isAnalyticSectionData } from "../src/acenta/analytic-sections";
import { AnalyticServer } from "./analytic-server";
import { session } from "./acenta-fixtures";
import { explorerCatalog } from "./analytic-explorer-fixtures";

function setup() {
  const server = new AnalyticServer();
  const catalog = explorerCatalog();
  for (const doc of catalog) server.putSection(doc);
  return { server, catalog, api: new AcentaApi(session, server.transport) };
}

describe("explorer test fixtures, without replacing PostgreSQL contract coverage", () => {
  it("uses valid independent manual documents and exact ordered content/PDA pairs", () => {
    const catalog = explorerCatalog();
    expect(catalog.every(doc => isAnalyticSectionData(doc.data))).toBe(true);
    expect(new Set(catalog.map(doc => doc.receipt.section_id)).size).toBe(9);
    expect(catalog.every(doc => doc.provenance === "manual-v1" && doc.data.reference === null)).toBe(true);
    expect(catalog[0].data.context?.hypothetical).toBe(true);
    expect(catalog[0].data.entries).toHaveLength(2);
    catalog[0].data.entries[0].content = "Changed only here";
    expect(catalog[1].data.entries[0].content).toBe(" Primer contenido manual. ");
  });

  it("paginates six rows without fabricating totals", async () => {
    const { api, catalog } = setup();
    const first = await api.listAnalyticSections(undefined, 6);
    const next = await api.listAnalyticSections(first.next_cursor!, 6);
    expect(first).toEqual({ items: catalog.slice(0, 6), next_cursor: catalog[5].receipt.section_id });
    expect(next).toEqual({ items: catalog.slice(6), next_cursor: null });
  });

  it("finds a literal name beyond the first page, without treating punctuation as wildcards", async () => {
    const { api, catalog } = setup();
    expect(await api.listAnalyticSections(undefined, 6, { q: "  AGUA & 100%_ \\  " }))
      .toEqual({ items: [catalog[7]], next_cursor: null });
  });

  it("combines exact grade and field criteria with name matching before pagination", async () => {
    const { api, catalog } = setup();
    expect(await api.listAnalyticSections(undefined, 1, {
      q: "AGUA", grade: "3.º de primaria", formative_field: "Campo manual",
    })).toEqual({ items: [catalog[7]], next_cursor: null });
  });

  it("does not normalize manual grade or field values", async () => {
    const { api, catalog } = setup();
    expect((await api.listAnalyticSections(undefined, 6, { grade: " Grado manual " })).items).toEqual([catalog[2]]);
    expect((await api.listAnalyticSections(undefined, 6, { grade: "Grado manual" })).items).toEqual([]);
    expect((await api.listAnalyticSections(undefined, 6, { formative_field: "campo manual" })).items).toEqual([]);
  });

  it("does not match context or old revisions", async () => {
    const { api, server, catalog } = setup();
    const revised = structuredClone(catalog[7]);
    revised.receipt.revision = 2;
    revised.receipt.revision_id = "81000000-0000-4000-8000-000000000008";
    revised.receipt.operation_id = "82000000-0000-4000-8000-000000000008";
    revised.data.name = "Nombre nuevo";
    server.putSection(revised);
    expect((await api.listAnalyticSections(undefined, 6, { q: "100%_" })).items).toEqual([]);
    expect((await api.listAnalyticSections(undefined, 6, { q: "Contexto hipotético" })).items).toEqual([]);
    expect(await api.readAnalyticSection(revised.receipt.section_id, 1)).toEqual(catalog[7]);
  });

  it("returns an explicit empty page for no matches", async () => {
    const { api } = setup();
    expect(await api.listAnalyticSections(undefined, 6, { q: "No existe este título" }))
      .toEqual({ items: [], next_cursor: null });
  });

  it("allows whitespace-only name search to leave the catalog unfiltered", async () => {
    const { api, catalog } = setup();
    expect((await api.listAnalyticSections(undefined, 6, { q: " \t " })).items).toEqual(catalog.slice(0, 6));
  });
});
