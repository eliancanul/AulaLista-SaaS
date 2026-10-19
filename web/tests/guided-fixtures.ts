/** Test-only fixture captured from generate_guided(GuidedPlanningRequest) for #52.
 * Synthetic software inputs; no classroom data or pedagogical evaluation.
 */
import type { DraftDocument, GuidedPlanningRequest, PlanningDocument, Result } from "../src/acenta/contracts";
import { session, source } from "./acenta-fixtures";

const canonicalRequest: GuidedPlanningRequest = {
  "contract_version": 2,
  "fixture_context": "guided-water-v1",
  "subject": "Ciencias naturales",
  "grade": "3.º de primaria",
  "topic": "El cuidado del agua en la comunidad",
  "duration_minutes": 50,
  "method": "active-learning",
  "language": "es",
  "context": {
    "text": "Situación de ejemplo sin datos de estudiantes.",
    "hypothetical": true
  },
  "learning_objectives": [
    "Proponer acciones cotidianas de cuidado del agua."
  ],
  "formative_field": "Aportación manual de ejemplo",
  "articulating_axes": [
    "Eje escrito por el docente"
  ],
  "reference": null
};

const canonicalResult: Result = {
  "kind": "guided-planning-v1",
  "provenance": "synthetic-fixture-v1",
  "title": "El cuidado del agua en la comunidad",
  "notice": "Ejemplo sintético de software para Ciencias naturales, 3.º de primaria y cuidado del agua; sin generación libre ni validación curricular. El contexto, objetivos, campo y ejes manuales se conservan sin interpretarlos ni adaptar el ejemplo; la referencia adjunta, si existe, se conserva sin interpretar. No describe un diagnóstico de un grupo real.",
  "purpose": "Reconocer usos cotidianos del agua en la comunidad y proponer acciones concretas para cuidarla.",
  "formative_assessment": "Observar si cada propuesta identifica un uso del agua, plantea una acción viable y explica cómo ayuda a cuidarla. Dar retroalimentación con una pregunta y permitir revisar el cartel o la conclusión.",
  "duration_minutes": 50,
  "activities": [
    {
      "key": "introduction",
      "title": "Inicio · Observar usos cotidianos",
      "statement": "Dibujar o nombrar usos del agua en una comunidad imaginaria. Compartir cuáles son necesarios y dónde podría desperdiciarse.",
      "minutes": 10
    },
    {
      "key": "exploration",
      "title": "Desarrollo · Proponer acciones",
      "statement": "En equipos, comparar situaciones hipotéticas de uso del agua. Elegir una y elaborar un cartel con una acción de cuidado y una explicación de por qué ayudaría.",
      "minutes": 30
    },
    {
      "key": "closure",
      "title": "Cierre · Compartir y revisar",
      "statement": "Presentar los carteles, escuchar sugerencias y revisar una acción. Escribir o dibujar una conclusión sobre el cuidado del agua.",
      "minutes": 10
    }
  ],
  "materials": [
    "Hojas reutilizadas o cuaderno",
    "Lápices y colores",
    "Pizarrón"
  ]
};

export function guidedRequest(changes: Partial<GuidedPlanningRequest> = {}): GuidedPlanningRequest {
  return { ...structuredClone(canonicalRequest), ...changes };
}

export function guidedPlanning(
  key: string = crypto.randomUUID(),
  input: GuidedPlanningRequest = guidedRequest(),
): PlanningDocument {
  const result = structuredClone(canonicalResult);
  const end = Math.floor(input.duration_minutes / 5);
  result.duration_minutes = input.duration_minutes;
  result.activities[0].minutes = end;
  result.activities[1].minutes = input.duration_minutes - end * 2;
  result.activities[2].minutes = end;
  return {
    receipt: {
      contract_version: 1,
      namespace: "planning-v1",
      planning_id: crypto.randomUUID(),
      revision_id: crypto.randomUUID(),
      revision: 1,
      scope_id: session.scopeId,
      actor_id: session.actorId,
      operation_id: key,
      created_at: "2026-10-18T13:00:00+00:00",
      source_id: input.reference?.source_id ?? null,
      source_version_id: input.reference ? source.version_id : null,
      source_version: input.reference?.source_version ?? null,
      source_sha256: input.reference ? source.sha256 : null,
    },
    request: structuredClone(input),
    result,
  };
}

function patched(base: PlanningDocument, text: string, resource: string, element: string): Result {
  const result = structuredClone(base.result);
  if (resource === "planning") {
    if (element === "purpose" || element === "formative_assessment") result[element] = text;
    else if (/^material-[0-9]+$/.test(element)) result.materials![Number(element.slice(9))] = text;
    else throw new Error("Unsupported software-fixture target");
  } else {
    const activity = result.activities.find(a => resource === `activity:${a.key}`);
    if (!activity) throw new Error("Unsupported software-fixture activity");
    if (element === "statement") activity.statement = text;
    else if (element === "minutes") {
      activity.minutes = Number(text);
      result.duration_minutes = result.activities.reduce((sum, a) => sum + a.minutes, 0);
    } else throw new Error("Unsupported software-fixture target");
  }
  return result;
}

export function guidedRevised(
  base: PlanningDocument,
  text: string,
  key: string = crypto.randomUUID(),
  copy = false,
  resource_key = "planning",
  element_key = "purpose",
): PlanningDocument {
  const initial = structuredClone(base.initial_request ?? base.request) as GuidedPlanningRequest;
  const origin = copy ? {
    planning_id: base.receipt.planning_id,
    revision_id: base.receipt.revision_id,
    revision: base.receipt.revision,
  } : base.origin;
  const common = {
    contract_version: 1 as const,
    resource_key,
    element_key,
    text,
    initial_request: structuredClone(initial),
    ...(origin ? { origin } : {}),
  };
  return {
    receipt: {
      ...base.receipt,
      planning_id: copy ? crypto.randomUUID() : base.receipt.planning_id,
      revision_id: crypto.randomUUID(),
      operation_id: key,
      revision: copy ? 1 : base.receipt.revision + 1,
    },
    request: copy
      ? { ...common, kind: "copy", base_revision: base.receipt.revision }
      : { ...common, kind: "edit", expected_revision: base.receipt.revision },
    result: patched(base, text, resource_key, element_key),
    ...(base.analytic_origin ? { analytic_origin: structuredClone(base.analytic_origin) } : {}),
    initial_request: initial,
    ...(origin ? { origin } : {}),
  };
}

export function guidedDraft(
  base: PlanningDocument,
  text: string,
  key: string = crypto.randomUUID(),
  draftId: string = crypto.randomUUID(),
  resource_key = "planning",
  element_key = "purpose",
): DraftDocument & { initial_request: GuidedPlanningRequest } {
  return {
    receipt: {
      contract_version: 1,
      namespace: "planning-draft-v1",
      draft_id: draftId,
      revision_id: crypto.randomUUID(),
      draft_revision: 1,
      planning_id: base.receipt.planning_id,
      base_revision: base.receipt.revision,
      base_revision_id: base.receipt.revision_id,
      scope_id: session.scopeId,
      actor_id: session.actorId,
      operation_id: key,
      created_at: base.receipt.created_at,
    },
    request: {
      contract_version: 1,
      base_revision: base.receipt.revision,
      expected_draft_revision: 0,
      resource_key,
      element_key,
      text,
    },
    initial_request: structuredClone(base.initial_request ?? base.request) as GuidedPlanningRequest,
    result: patched(base, text, resource_key, element_key),
    ...(base.analytic_origin ? { analytic_origin: structuredClone(base.analytic_origin) } : {}),
  };
}
