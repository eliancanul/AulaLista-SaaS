/** HTTP DTOs coordinated with B2/B3. Identity is supplied by verified session, never a UI selector. */
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
  source_id: string;
  source_version_id: string;
  source_version: number;
  source_sha256: string;
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
  audience: "students";
  elements: Element[];
}
export interface Result {
  provenance: "synthetic-fixture-v1";
  title: string;
  notice: string;
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
    | PlanningRequest
    | (EditRequest & { kind: "edit"; origin?: Origin })
    | (CopyRequest & { kind: "copy"; origin?: Origin });
  result: Result;
  origin?: Origin;
  initial_request?: PlanningRequest;
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
