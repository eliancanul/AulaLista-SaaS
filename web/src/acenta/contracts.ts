/** HTTP DTOs coordinated with B2/B3. Identity is supplied by verified session, never a UI selector. */
import type { AnalyticSectionDocument } from "./analytic-sections";

export interface Session {
  actorId: string;
  scopeId: string;
}
export interface SourceReceipt {
  source_id: string;
  version_id: string;
  scope_id: string;
  number: number;
  sha256: string;
  size: number;
  actor_id: string;
  operation_id: string;
  created_at: string;
}
export interface PlanningRequest {
  contract_version: 1;
  fixture_context: "timing-example-v1" | "water-observation-v1";
  prompt: string;
  source_id: string;
  expected_source_version: number;
}
/** New creation contract; manual context never claims official curricular authority. */
export interface GuidedPlanningRequest {
  contract_version: 2;
  fixture_context: "guided-water-v1";
  subject: string;
  grade: string;
  topic: string;
  duration_minutes: number;
  method: string;
  language: string;
  context: { text: string; hypothetical: boolean } | null;
  learning_objectives: string[];
  formative_field: string | null;
  articulating_axes: string[];
  reference: { source_id: string; source_version: number } | null;
}
export type CreationRequest = PlanningRequest | GuidedPlanningRequest;
export interface Receipt {
  contract_version: 1;
  namespace: "planning-v1";
  planning_id: string;
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
export interface Element {
  key: string;
  kind: "statement" | "question";
  text: string;
  editable: boolean;
  lines?: number;
}
export interface Resource {
  key: string;
  title: string;
  audience: "students" | "teacher";
  elements: Element[];
}
export interface Result {
  provenance: "synthetic-fixture-v1";
  title: string;
  notice: string;
  kind?: "guided-planning-v1";
  purpose?: string;
  formative_assessment?: string;
  duration_minutes?: number;
  materials?: string[];
  context?: { level: string; group: string; subject: string };
  activities: {
    key?: string;
    title?: string;
    statement: string;
    previous_minutes?: number;
    minutes: number;
  }[];
  resources?: Resource[];
}
export interface PlanningDocument {
  receipt: Receipt;
  request:
    | CreationRequest
    | (EditRequest & { kind: "edit"; origin?: Origin })
    | (CopyRequest & { kind: "copy"; origin?: Origin });
  result: Result;
  origin?: Origin;
  initial_request?: CreationRequest;
  analytic_origin?: AnalyticSectionDocument;
}
export interface EditRequest {
  contract_version: 1;
  expected_revision: number;
  resource_key: string;
  element_key: string;
  text: string;
}
export interface CopyRequest {
  contract_version: 1;
  base_revision: number;
  resource_key: string;
  element_key: string;
  text: string;
}
export interface DraftRequest {
  contract_version: 1;
  base_revision: number;
  expected_draft_revision: number;
  resource_key: string;
  element_key: string;
  text: string;
}
export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}
export const waterPrompt =
  "Hoy tengo 30 minutos. Ajusta los tiempos sin cambiar mis materiales.";
export const waterContext = {
  level: "Primaria",
  group: "4.º A",
  subject: "Ciencias",
};

export interface DraftReceipt {
  contract_version: 1;
  namespace: "planning-draft-v1";
  draft_id: string;
  revision_id: string;
  draft_revision: number;
  planning_id: string;
  base_revision: number;
  base_revision_id: string;
  scope_id: string;
  actor_id: string;
  operation_id: string;
  created_at: string;
}
export interface DraftDocument {
  initial_request?: CreationRequest;
  analytic_origin?: AnalyticSectionDocument;
  receipt: DraftReceipt;
  request: DraftRequest;
  result: Result;
}
export const waterSource =
  "Acenta synthetic water-observation-v1\nAgua que cambia. Primaria. 4.º A. Ciencias.\nActivar 10, Explorar 25, Cerrar 10 minutos.\nMateriales: vaso transparente, agua y ficha de observación.\nObserva el vaso. Describe lo que ves.\n¿Qué observaste? ¿Qué cambió?\n";

export interface Origin {
  planning_id: string;
  revision_id: string;
  revision: number;
}

/** Fixed synthetic selections; family distinguishes a revision from another file. */
export const sourceSamples = [
  {
    id: "water",
    family: "water",
    name: "Planeación de ciencias · ejemplo",
    sha256: "d88a7dcb08c92d925c1e4cc854f83579e5e9b45a2a2bfb8b85a33248a8974e05",
    bytes: waterSource,
  },
  {
    id: "water-revised",
    family: "water",
    name: "Planeación de ciencias · revisión de ejemplo",
    sha256: "86c6a56969da27ccc0457889ec9b61c8c334140f971eb4bebe7a596103f97a33",
    bytes:
      waterSource +
      "Nota sintética de revisión: observar nuevamente al finalizar.\n",
  },
  {
    id: "water-other",
    family: "water-other",
    name: "Otra planeación de ciencias · ejemplo",
    sha256: "e5cbf6c739f24317b3897a1bce904a901382dc35a923d2b41ecb87c3c907a0eb",
    bytes:
      waterSource +
      "Archivo sintético independiente para otra sesión de observación.\n",
  },
] as const;
/** Names are known only for these exact synthetic bytes; no filename/MIME is stored. */
export function knownSourceSample(sha256: string) {
  return sourceSamples.find((sample) => sample.sha256 === sha256);
}
export interface SourceReference {
  source_id: string;
  number: number;
  sha256: string;
  size?: number;
}
export interface OriginalContent {
  text: string;
  size: number;
  sha256: string;
}
