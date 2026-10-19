import type { GuidedPlanningRequest } from "./contracts";

/** Reserve space for the revision envelope inside the 8192-byte HTTP limit. */
export const MAX_ANALYTIC_DATA_BYTES = 8000;

/** Manual section data has its own history; it is not a planning result. */
export interface AnalyticSectionData {
  contract_version: 1;
  name: string;
  grade: string;
  period: string;
  context: { text: string; hypothetical: boolean } | null;
  situation: string;
  entries: { content: string; pda: string }[];
  formative_field: string | null;
  articulating_axes: string[];
  language: string;
  reference: { source_id: string; source_version: number } | null;
}

export interface AnalyticSectionReceipt {
  contract_version: 1;
  namespace: "analytic-section-v1";
  section_id: string;
  revision_id: string;
  revision: number;
  scope_id: string;
  actor_id: string;
  operation_id: string;
  created_at: string;
  source_id: string | null;
  source_version_id: string | null;
  source_version: number | null;
  source_sha256: string | null;
}

export interface AnalyticSectionDocument {
  receipt: AnalyticSectionReceipt;
  data: AnalyticSectionData;
  provenance: "manual-v1";
}

export interface DeriveAnalyticPlanningRequest {
  contract_version: 1;
  subject: string;
  duration_minutes: number;
  method: string;
}

/** Applied to all current revisions by the server, before cursor pagination. */
export interface AnalyticSectionFilters {
  q?: string;
  grade?: string;
  formative_field?: string;
}

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const bounded = (v: unknown, max: number): v is string =>
  typeof v === "string" && !!v.trim() && [...v].length <= max &&
  !/[\u0000\uD800-\uDFFF]/u.test(v);
const exactKeys = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const uuid = (v: unknown): v is string => typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Validate wire data before it can become an editable buffer or saved origin. */
export function isAnalyticSectionData(v: unknown): v is AnalyticSectionData {
  if (!object(v) || !exactKeys(v, ["contract_version", "name", "grade", "period", "context", "situation", "entries", "formative_field", "articulating_axes", "language", "reference"])) return false;
  return v.contract_version === 1 && bounded(v.name, 200) && bounded(v.grade, 80) &&
    bounded(v.period, 80) && bounded(v.situation, 1000) && bounded(v.language, 40) &&
    (v.context === null || (object(v.context) && exactKeys(v.context, ["text", "hypothetical"]) &&
      bounded(v.context.text, 1000) && typeof v.context.hypothetical === "boolean")) &&
    Array.isArray(v.entries) && v.entries.length >= 1 && v.entries.length <= 8 &&
    v.entries.every(entry => object(entry) && exactKeys(entry, ["content", "pda"]) && bounded(entry.content, 500) && bounded(entry.pda, 500)) &&
    (v.formative_field === null || bounded(v.formative_field, 120)) &&
    Array.isArray(v.articulating_axes) && v.articulating_axes.length <= 7 && v.articulating_axes.every(axis => bounded(axis, 80)) &&
    (v.reference === null || (object(v.reference) && exactKeys(v.reference, ["source_id", "source_version"]) &&
      uuid(v.reference.source_id) && Number.isInteger(v.reference.source_version) &&
      Number(v.reference.source_version) >= 1 && Number(v.reference.source_version) <= 2147483646));
}

/** Copy only reusable fields. Content/PDA pairs remain distinct in the exact origin. */
export function prefillAnalyticPlanning(section: AnalyticSectionDocument): GuidedPlanningRequest {
  const data = structuredClone(section.data);
  return {
    contract_version: 2,
    fixture_context: "guided-water-v1",
    subject: "",
    grade: data.grade,
    topic: data.name,
    duration_minutes: 50,
    method: "active-learning",
    language: data.language,
    context: data.context,
    learning_objectives: [],
    formative_field: data.formative_field,
    articulating_axes: data.articulating_axes,
    reference: data.reference,
  };
}
