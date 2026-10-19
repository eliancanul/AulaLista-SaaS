/** Synthetic software data for the pending explorer UI; never a curricular source. */
import type { AnalyticSectionDocument } from "../src/acenta/analytic-sections";
import { session } from "./acenta-fixtures";

export function explorerSection(index: number, name = `Apartado de prueba ${index}`): AnalyticSectionDocument {
  const suffix = String(index).padStart(12, "0");
  return {
    receipt: {
      contract_version: 1, namespace: "analytic-section-v1",
      section_id: `70000000-0000-4000-8000-${suffix}`,
      revision_id: `71000000-0000-4000-8000-${suffix}`,
      operation_id: `72000000-0000-4000-8000-${suffix}`,
      revision: 1, scope_id: session.scopeId, actor_id: session.actorId,
      created_at: "2026-10-19T05:00:00+00:00",
      source_id: null, source_version_id: null, source_version: null, source_sha256: null,
    },
    data: {
      contract_version: 1, name, grade: "3.º de primaria", period: "Octubre",
      situation: " Situación ficticia para una prueba de software. ",
      context: { text: " Contexto hipotético.\nSin datos de alumnado. ", hypothetical: true },
      entries: [
        { content: " Primer contenido manual. ", pda: " Primer PDA manual. " },
        { content: " Segundo contenido manual. ", pda: " Segundo PDA manual. " },
      ],
      formative_field: "Campo manual", articulating_axes: [" Eje manual "],
      language: "es", reference: null,
    },
    provenance: "manual-v1",
  };
}

/** Seven ordinary rows ensure the literal query match is beyond the first six. */
export function explorerCatalog(): AnalyticSectionDocument[] {
  const documents = Array.from({ length: 7 }, (_, index) => explorerSection(index + 1));
  documents[1].data.formative_field = null;
  documents[2].data.grade = " Grado manual ";
  documents.push(explorerSection(8, "El agua & 100%_ \\"));
  documents.push(explorerSection(9, "El agua de otra clase"));
  documents[8].data.grade = "4.º de primaria";
  return documents;
}
