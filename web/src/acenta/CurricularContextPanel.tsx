import { useEffect, useState } from "react";
import type { AcentaApi } from "./api";
import {
  getCurriculumCatalog,
  listCurricularProfiles,
  saveCurricularProfile,
  type CurricularProfile,
  type CurriculumCatalog,
  type PdaItem,
} from "./curriculum-api";

export function CurricularContextPanel({
  api,
  schoolId,
  schoolName,
  grade,
  subjectId,
  subjectName,
  onSaved,
}: {
  api: AcentaApi;
  schoolId: string;
  schoolName: string;
  grade: string;
  subjectId: string;
  subjectName: string;
  onSaved?: (profile: CurricularProfile) => void;
}) {
  const [catalog, setCatalog] = useState<CurriculumCatalog | null>(null);
  const [phase, setPhase] = useState("Fase 4");
  const [campo, setCampo] = useState("Saberes y Pensamiento Científico");
  const [selectedEjes, setSelectedEjes] = useState<string[]>([]);
  const [selectedPdas, setSelectedPdas] = useState<PdaItem[]>([]);
  const [customPdaTitle, setCustomPdaTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [cat, profiles] = await Promise.all([
          getCurriculumCatalog(api),
          listCurricularProfiles(api),
        ]);
        if (!active) return;
        setCatalog(cat);
        const match =
          profiles.find((p) => p.school_id === schoolId && p.subject_id === subjectId) ??
          profiles.find((p) => p.school_id === schoolId && p.subject_id === "__school__");
        if (match) {
          setPhase(match.phase || "Fase 4");
          setCampo(match.campo_formativo || "");
          setSelectedEjes(match.ejes_articuladores || []);
          setSelectedPdas(match.pdas || []);
          setNotes(match.notes || "");
        } else {
          setSelectedEjes([]);
          setSelectedPdas([]);
          setNotes("");
        }
      } catch {
        // leave graceful fallback when offline or in legacy chat mock tests
      }
    })();
    return () => {
      active = false;
    };
  }, [api, schoolId, subjectId]);

  function toggleEje(eje: string) {
    setSelectedEjes((prev) =>
      prev.includes(eje) ? prev.filter((item) => item !== eje) : [...prev, eje],
    );
  }

  function togglePda(pda: PdaItem) {
    setSelectedPdas((prev) =>
      prev.some((p) => p.id === pda.id)
        ? prev.filter((p) => p.id !== pda.id)
        : [
            ...prev,
            {
              id: pda.id,
              code: pda.code,
              title: pda.title,
              description: pda.description,
            },
          ],
    );
  }

  function addCustomPda() {
    const title = customPdaTitle.trim();
    if (!title) return;
    setSelectedPdas((prev) => [
      ...prev,
      {
        id: `custom-${Date.now()}`,
        code: "PDA-PROPIO",
        title,
        description: "",
      },
    ]);
    setCustomPdaTitle("");
  }

  async function handleSave() {
    setSaving(true);
    setNotice(null);
    try {
      const saved = await saveCurricularProfile(api, schoolId, subjectId, {
        grade,
        phase,
        campo_formativo: campo,
        pdas: selectedPdas.map((p) => ({
          id: p.id,
          code: p.code,
          title: p.title,
          description: p.description,
        })),
        ejes_articuladores: selectedEjes,
        notes,
      });
      setNotice("Contexto curricular SEP/NEM guardado y activo para chat y anexos.");
      onSaved?.(saved);
    } catch {
      setNotice("No se pudo guardar el contexto curricular.");
    } finally {
      setSaving(false);
    }
  }

  const visibleCatalogPdas = (catalog?.pdas ?? []).filter(
    (p) => (!phase || p.phase === phase) && (!campo || p.campo_formativo === campo),
  );

  return (
    <section className="curricular-nem-panel" aria-label="Contexto curricular SEP/NEM">
      <div className="curricular-nem-header">
        <strong>Contexto curricular trazable (SEP / NEM)</strong>
        <span className="support-muted">
          {schoolName} · {subjectName} ({grade})
        </span>
      </div>

      <div className="support-row-2">
        <label className="curricular-field">
          <span>Fase NEM</span>
          <select value={phase} onChange={(e) => setPhase(e.target.value)}>
            {(catalog?.phases ?? [
              { id: "Fase 3", grades: [] },
              { id: "Fase 4", grades: [] },
              { id: "Fase 5", grades: [] },
              { id: "Fase 6", grades: [] },
            ]).map((ph) => (
              <option key={ph.id} value={ph.id}>
                {ph.id}
              </option>
            ))}
          </select>
        </label>

        <label className="curricular-field">
          <span>Campo formativo</span>
          <select value={campo} onChange={(e) => setCampo(e.target.value)}>
            {(catalog?.campos_formativos ?? [
              { id: "lenguajes", name: "Lenguajes", subjects: [] },
              { id: "saberes", name: "Saberes y Pensamiento Científico", subjects: [] },
              { id: "etica", name: "Ética, Naturaleza y Sociedades", subjects: [] },
              { id: "humano", name: "De lo Humano y lo Comunitario", subjects: [] },
            ]).map((cf) => (
              <option key={cf.id} value={cf.name}>
                {cf.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="curricular-block">
        <span className="curricular-label">Ejes articuladores</span>
        <div className="curricular-chips">
          {(catalog?.ejes_articuladores ?? []).map((eje) => {
            const active = selectedEjes.includes(eje);
            return (
              <button
                key={eje}
                type="button"
                className={`support-pill${active ? " is-active" : ""}`}
                onClick={() => toggleEje(eje)}
              >
                {active ? "✓ " : ""}
                {eje}
              </button>
            );
          })}
        </div>
      </div>

      <div className="curricular-block">
        <span className="curricular-label">
          PDA sugeridos ({visibleCatalogPdas.length}) · Seleccionados ({selectedPdas.length})
        </span>
        <div className="curricular-pda-list">
          {visibleCatalogPdas.map((pda) => {
            const checked = selectedPdas.some((p) => p.id === pda.id);
            return (
              <label key={pda.id} className="curricular-pda-item">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => togglePda(pda)}
                />
                <span>
                  <strong>[{pda.code}]</strong> {pda.title}
                </span>
              </label>
            );
          })}
        </div>
        <div className="account-inline-form">
          <input
            type="text"
            placeholder="Agregar PDA propio o aprendizaje esperado…"
            value={customPdaTitle}
            onChange={(e) => setCustomPdaTitle(e.target.value)}
          />
          <button
            type="button"
            className="support-btn-secondary"
            onClick={addCustomPda}
          >
            Añadir PDA
          </button>
        </div>
      </div>

      <button
        type="button"
        className="support-btn-primary"
        disabled={saving}
        onClick={() => void handleSave()}
      >
        {saving ? "Guardando currículo…" : "Guardar contexto SEP/NEM"}
      </button>
      {notice && (
        <p className="support-muted" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
