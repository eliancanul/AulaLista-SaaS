import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlanningDocument } from "../src/acenta/contracts";
import { PlanningPrintDocument } from "../src/acenta/PlanningPrintDocument";
import { guidedDraft, guidedPlanning, guidedRequest, guidedRevised } from "./guided-fixtures";

const render = (document: PlanningDocument) => renderToStaticMarkup(createElement(PlanningPrintDocument, { document }));

describe("confirmed planning print document", () => {
  it("prints the selected confirmed revision, its full result and original manual context", () => {
    const base = guidedPlanning(undefined, guidedRequest({
      context: { text: "CONTEXTO MANUAL CONSERVADO", hypothetical: true },
      learning_objectives: ["OBJETIVO MANUAL CONSERVADO"],
      formative_field: "CAMPO MANUAL CONSERVADO",
      articulating_axes: ["EJE MANUAL CONSERVADO"],
    }));
    base.result.purpose = "PROPOSITO ANTERIOR EXCLUIDO";
    const document = guidedRevised(base, "PROPOSITO DE LA REVISION ELEGIDA");
    const before = structuredClone(document);
    const html = render(document);
    for (const text of [
      document.result.title, document.result.notice, document.result.purpose!,
      document.result.formative_assessment!, ...document.result.materials!,
      ...document.result.activities.flatMap(activity => [activity.title!, activity.statement]),
      "CONTEXTO MANUAL CONSERVADO", "OBJETIVO MANUAL CONSERVADO",
      "CAMPO MANUAL CONSERVADO", "EJE MANUAL CONSERVADO",
    ]) expect(html).toContain(text);
    expect(html).toMatch(/Revisión(?: confirmada)?[^<]*2|Revisión(?: confirmada)?[\s\S]{0,80}>2</);
    expect(html).toContain("Acenta");
    expect(html).toMatch(/hipotétic/i);
    expect(html).toMatch(/manual/i);
    expect(html).not.toContain("PROPOSITO ANTERIOR EXCLUIDO");
    expect(document).toEqual(before);
  });

  it("omits account, receipt identifiers, navigation and editing controls", () => {
    const document = guidedPlanning();
    const html = render(document);
    for (const field of ["actor_id", "scope_id", "operation_id", "planning_id", "revision_id"] as const)
      expect(html).not.toContain(document.receipt[field]);
    expect(html).not.toMatch(/<(?:button|nav|input|textarea|select)\b/);
    expect(html).not.toMatch(/clave docente|respuesta correcta|descarga automática/i);
  });

  it("escapes user content without interpreting HTML or changing literal text", () => {
    const document = guidedPlanning();
    document.result.purpose = '<img src=x onerror="window.stolen=true"> & texto literal';
    document.result.activities[0].statement = "Primera línea\nSegunda línea <script>alert(1)</script>";
    const html = render(document);
    expect(html).toContain("&lt;img src=x onerror=&quot;window.stolen=true&quot;&gt; &amp; texto literal");
    expect(html).toContain("Primera línea\nSegunda línea &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toMatch(/<img[^>]*src=["']?x(?:[\s"'>])|<script\b/);
  });

  it("rejects an unconfirmed draft at the printable-document boundary", () => {
    const draft = guidedDraft(guidedPlanning(), "BORRADOR NUNCA IMPRIMIBLE");
    expect(render(draft as unknown as PlanningDocument)).toBe("");
  });
});
