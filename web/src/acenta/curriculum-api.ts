/** Typed API helpers for traceable SEP/NEM curricular profiles and annex revisions. */

import type { AcentaApi } from "./api";
import type { AnnexDocument } from "./annex-api";

export interface PdaItem {
  id: string;
  code: string;
  title: string;
  description: string;
  phase?: string;
  campo_formativo?: string;
}

export interface CurriculumCatalog {
  phases: Array<{ id: string; grades: string[] }>;
  campos_formativos: Array<{ id: string; name: string; subjects: string[] }>;
  ejes_articuladores: string[];
  pdas: PdaItem[];
}

export interface CurricularProfile {
  id: string;
  scope_id: string;
  school_id: string;
  subject_id: string;
  grade: string;
  phase: string;
  campo_formativo: string;
  pdas: PdaItem[];
  ejes_articuladores: string[];
  notes: string;
  updated_at: string;
}

export interface AnnexRevisionSummary {
  id: string;
  annex_id: string;
  scope_id: string;
  revision: number;
  title: string;
  subject: string;
  grade: string;
  topic: string;
  instructions: string;
  content: Record<string, unknown>;
  change_summary: string;
  curricular_trace: Record<string, unknown> | null;
  created_at: string;
}

export async function getCurriculumCatalog(api: AcentaApi): Promise<CurriculumCatalog> {
  return (await api.scopedJson("curriculum/catalog")) as CurriculumCatalog;
}

export async function listCurricularProfiles(api: AcentaApi): Promise<CurricularProfile[]> {
  const res = (await api.scopedJson("curriculum/profiles")) as { items: CurricularProfile[] };
  return res.items;
}

export async function saveCurricularProfile(
  api: AcentaApi,
  schoolId: string,
  subjectId: string,
  payload: {
    grade: string;
    phase: string;
    campo_formativo: string;
    pdas: PdaItem[];
    ejes_articuladores: string[];
    notes: string;
  },
): Promise<CurricularProfile> {
  return (await api.scopedJson(
    `curriculum/profiles/${encodeURIComponent(schoolId)}/${encodeURIComponent(subjectId)}`,
    "PUT",
    payload,
  )) as CurricularProfile;
}

export async function listAnnexRevisions(
  api: AcentaApi,
  annexId: string,
): Promise<{ annex_id: string; current_revision: number; items: AnnexRevisionSummary[] }> {
  return (await api.scopedJson(`annexes/${annexId}/revisions`)) as {
    annex_id: string;
    current_revision: number;
    items: AnnexRevisionSummary[];
  };
}

export async function restoreAnnexRevision(
  api: AcentaApi,
  annexId: string,
  revision: number,
): Promise<AnnexDocument> {
  return (await api.scopedJson(
    `annexes/${annexId}/revisions/${revision}/restore`,
    "POST",
  )) as AnnexDocument;
}
