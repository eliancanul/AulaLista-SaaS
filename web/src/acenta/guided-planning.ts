import type {
  GuidedPlanningRequest,
  ManualPlanningRequest,
  PlanningDocument,
  Resource,
  Result,
  SourceReference,
} from "./contracts";

export type GuidedResult = Result & {
  kind: "guided-planning-v1";
  purpose: string;
  formative_assessment: string;
  duration_minutes: number;
  materials: string[];
};
export function isGuided(result: Result): result is GuidedResult {
  return result.kind === "guided-planning-v1";
}
export const emptyGuidedRequest = (): GuidedPlanningRequest => ({
  contract_version: 2,
  fixture_context: "guided-water-v1",
  subject: "",
  grade: "",
  topic: "",
  duration_minutes: 50,
  method: "active-learning",
  language: "es",
  context: null,
  learning_objectives: [],
  formative_field: null,
  articulating_axes: [],
  reference: null,
});
export const guidedExample = (): GuidedPlanningRequest => ({
  ...emptyGuidedRequest(),
  subject: "Ciencias naturales",
  grade: "3.º de primaria",
  topic: "El cuidado del agua en la comunidad",
});
export function validateGuidedRequest(
  q: ManualPlanningRequest,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const bounded = (v: string, max: number) =>
    !!v.trim() && [...v].length <= max && !/[\u0000\uD800-\uDFFF]/u.test(v);
  if (!bounded(q.subject, 120)) errors.subject = "Selecciona una asignatura.";
  if (!bounded(q.grade, 80)) errors.grade = "Selecciona un grado.";
  if (!bounded(q.topic, 200))
    errors.topic = "Escribe el tema de la clase (hasta 200 caracteres).";
  if (
    !Number.isInteger(q.duration_minutes) ||
    q.duration_minutes < 15 ||
    q.duration_minutes > 180
  )
    errors.duration_minutes = "Elige entre 15 y 180 minutos enteros.";
  if (!bounded(q.method, 80)) errors.method = "Selecciona un método.";
  if (!bounded(q.language, 40)) errors.language = "Selecciona un idioma.";
  if (q.context && !bounded(q.context.text, 1000))
    errors.context =
      "El contexto admite hasta 1000 caracteres y no puede quedar vacío.";
  if (
    q.learning_objectives.length > 5 ||
    q.learning_objectives.some((v) => !bounded(v, 200))
  )
    errors.learning_objectives =
      "Escribe hasta 5 objetivos de 200 caracteres, uno por línea.";
  if (q.formative_field !== null && !bounded(q.formative_field, 120))
    errors.formative_field = "El campo formativo admite hasta 120 caracteres.";
  if (
    q.articulating_axes.length > 7 ||
    q.articulating_axes.some((v) => !bounded(v, 80))
  )
    errors.articulating_axes =
      "Escribe hasta 7 ejes de 80 caracteres, uno por línea.";
  return errors;
}
/** B3's field editor projects canonical fields; no duplicate editable text is persisted. */
export function guidedResources(result: Result): Resource[] {
  if (!isGuided(result)) return result.resources ?? [];
  const element = (key: string, text: string) => ({
    key,
    text,
    kind: "statement" as const,
    editable: true,
  });
  return [
    {
      key: "planning",
      title: "Planeación de clase",
      audience: "teacher",
      elements: [
        element("purpose", result.purpose),
        element("formative_assessment", result.formative_assessment),
        ...result.materials.map((text, index) =>
          element(`material-${index}`, text),
        ),
      ],
    },
    ...result.activities.map((a) => ({
      key: `activity:${a.key}`,
      title: a.title ?? "Actividad",
      audience: "teacher" as const,
      elements: [
        element("statement", a.statement),
        element("minutes", String(a.minutes)),
      ],
    })),
  ];
}
export function fieldLabel(resource: Resource, key: string) {
  if (resource.key === "planning") {
    if (key === "purpose") return "Propósito";
    if (key === "formative_assessment") return "Evaluación formativa";
    return `Material ${Number(key.slice(9)) + 1}`;
  }
  return key === "minutes"
    ? `Minutos · ${resource.title}`
    : `Actividad · ${resource.title}`;
}
export function guidedInput(
  doc: PlanningDocument,
): ManualPlanningRequest | null {
  const request = doc.initial_request ?? doc.request;
  return request.contract_version === 2 || request.contract_version === 3 ? request : null;
}
export function planningReference(
  doc: PlanningDocument,
): SourceReference | null {
  const r = doc.receipt;
  return r.source_id && r.source_version && r.source_sha256
    ? {
        source_id: r.source_id,
        number: r.source_version,
        sha256: r.source_sha256,
      }
    : null;
}
