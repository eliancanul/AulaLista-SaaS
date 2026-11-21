import { useEffect, useMemo, useState } from "react";
import type { AcentaController } from "./controller";
import {
  AnnexPrintClient,
  annexErrorMessage,
  cleanHeaderFieldLabel,
  humanizePrintError,
  needsDrawingBox,
  stripLeadingNumber,
  type AnnexCapability,
  type AnnexDocument,
  type AnnexItem,
  type AnnexItemKind,
  type AnnexSection,
  type PrintSettings,
} from "./annex-api";
import { Logo, UiIcon } from "./ui";
import "./annexes.css";

interface QuickTopicPreset {
  label: string;
  subject: string;
  grade: string;
  annexType: string;
  topic: string;
}

const QUICK_TOPIC_PRESETS: readonly QuickTopicPreset[] = [
  {
    label: "Fracciones 4.º",
    subject: "Matemáticas",
    grade: "4.º de primaria",
    annexType: "ejercicios-de-practica",
    topic: "Fracciones equivalentes en la vida diaria",
  },
  {
    label: "El ciclo del agua",
    subject: "Ciencias naturales",
    grade: "3.º de primaria",
    annexType: "hoja-de-trabajo",
    topic: "El ciclo del agua y cómo cuidarla",
  },
  {
    label: "Comprensión lectora",
    subject: "Español",
    grade: "5.º de primaria",
    annexType: "lectura-con-preguntas",
    topic: "Lectura breve con preguntas de comprensión",
  },
];

const COPY_PRESETS = [1, 15, 25, 30] as const;

const DEFAULT_HEADER_FIELDS = ["Nombre", "Fecha", "Grupo"];

type StatusFilter = "all" | "draft" | "approved";
type StudioMode = "edit" | "preview";

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function quickScheduleDate(dayOffset: number, hour: number, minute: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return toLocalInputValue(d);
}

function quickScheduleInHours(hours: number): string {
  const d = new Date(Date.now() + hours * 60 * 60 * 1000);
  d.setSeconds(0, 0);
  return toLocalInputValue(d);
}

function LetterSheetPreview({ draft }: { draft: AnnexDocument }) {
  const headerFields =
    draft.content.student_header_fields.length > 0
      ? draft.content.student_header_fields
      : DEFAULT_HEADER_FIELDS;

  return (
    <div className="letter-stage">
      <article className="letter-sheet" aria-label="Vista previa tamaño Carta">
        <header>
          <p className="letter-kicker">
            {draft.subject} · {draft.grade}
          </p>
          <h2 className="letter-title">{draft.title}</h2>
          {draft.content.subtitle.trim() && (
            <p className="letter-subtitle">{draft.content.subtitle}</p>
          )}
          <div className="letter-student-grid">
            {headerFields.map((rawField, idx) => {
              const isWide = headerFields.length % 2 === 1 && idx === 0;
              return (
                <div
                  key={`${rawField}-${idx}`}
                  className={`letter-student-field${isWide ? " is-wide" : ""}`}
                >
                  <strong>{cleanHeaderFieldLabel(rawField)}:</strong>
                  <span className="letter-field-line" />
                </div>
              );
            })}
          </div>
        </header>

        <div className="letter-double-rule" aria-hidden="true" />

        {draft.instructions.trim() && (
          <p className="letter-instructions">
            <strong>Instrucciones:</strong> {draft.instructions}
          </p>
        )}

        {draft.content.sections.map((section, sIdx) => {
          let questionIdx = 0;
          return (
            <section key={sIdx} className="letter-section">
              {section.heading.trim() && (
                <h3 className="letter-section-banner">{section.heading}</h3>
              )}
              {section.prompt.trim() && (
                <p className="letter-section-prompt">{section.prompt}</p>
              )}
              {section.items.map((item, iIdx) => {
                if (item.kind === "reading") {
                  return (
                    <div key={iIdx} className="letter-reading-box">
                      {item.text}
                    </div>
                  );
                }
                if (item.kind === "checklist") {
                  return (
                    <div key={iIdx} className="letter-checklist-item">
                      <span className="letter-checkbox" aria-hidden="true" />
                      <span>{item.text}</span>
                    </div>
                  );
                }
                questionIdx += 1;
                const hasDrawing = needsDrawingBox(item.text);
                const lineCount = hasDrawing
                  ? Math.min(item.answer_lines, 3)
                  : item.answer_lines;
                return (
                  <div key={iIdx} className="letter-question">
                    <p>
                      <strong>{questionIdx}.</strong>{" "}
                      {stripLeadingNumber(item.text)}
                    </p>
                    {hasDrawing && (
                      <div className="letter-drawing-box">
                        <span className="letter-drawing-label">
                          Espacio para dibujar / esquematizar
                        </span>
                      </div>
                    )}
                    {lineCount > 0 && (
                      <div className="letter-writing-lines" aria-hidden="true">
                        {Array.from({ length: lineCount }, (_, lIdx) => (
                          <div key={lIdx} className="letter-writing-line" />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}

        <footer className="letter-footer">
          <span>{draft.content.footer_note.trim() || "AulaLista · Acenta"}</span>
          <span className="ac-num">Página 1</span>
        </footer>
      </article>

      <p className="letter-stage-caption">
        Vista aproximada en blanco y negro (Carta 8.5 × 11 in). Para ver los saltos de página exactos, abre el PDF.
      </p>
    </div>
  );
}

export function AnnexesView({ controller }: { controller: AcentaController }) {
  const client = useMemo(() => new AnnexPrintClient(controller.api), [controller.api]);
  const [capability, setCapability] = useState<AnnexCapability | null>(null);
  const [settings, setSettings] = useState<PrintSettings | null>(null);
  const [annexes, setAnnexes] = useState<AnnexDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AnnexDocument | null>(null);
  const [dirty, setDirty] = useState(false);

  // Studio navigation & list filters
  const [studioMode, setStudioMode] = useState<StudioMode>("edit");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Generation form
  const [subject, setSubject] = useState("Ciencias naturales");
  const [grade, setGrade] = useState("3.º de primaria");
  const [topic, setTopic] = useState("");
  const [annexType, setAnnexType] = useState("hoja-de-trabajo");
  const [extraInstructions, setExtraInstructions] = useState("");

  // Print controls
  const [copies, setCopies] = useState(25);
  const [printMode, setPrintMode] = useState<"now" | "scheduled">("now");
  const [scheduledLocal, setScheduledLocal] = useState(() =>
    quickScheduleDate(1, 6, 30),
  );

  // Busy & feedback
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadAll = async (selectId?: string | null) => {
    try {
      const [cap, list, printSettings] = await Promise.all([
        client.capability(),
        client.listAnnexes(),
        client.getPrintSettings(),
      ]);
      setCapability(cap);
      setAnnexes(list);
      setSettings(printSettings);
      setCopies(printSettings.default_copies);
      const targetId = selectId ?? selectedId ?? list[0]?.id ?? null;
      const found = list.find((item) => item.id === targetId) ?? list[0] ?? null;
      setSelectedId(found?.id ?? null);
      setDraft(found ? structuredClone(found) : null);
      setDirty(false);
      setConfirmDelete(false);
    } catch (err) {
      setError(annexErrorMessage(err));
    }
  };

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const draftCount = useMemo(
    () => annexes.filter((item) => item.status === "draft").length,
    [annexes],
  );
  const approvedCount = useMemo(
    () => annexes.filter((item) => item.status === "approved").length,
    [annexes],
  );
  const filteredAnnexes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return annexes.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.subject.toLowerCase().includes(q) ||
        item.grade.toLowerCase().includes(q) ||
        item.topic.toLowerCase().includes(q)
      );
    });
  }, [annexes, searchQuery, statusFilter]);

  const selectAnnex = (doc: AnnexDocument) => {
    setSelectedId(doc.id);
    setDraft(structuredClone(doc));
    setDirty(false);
    setConfirmDelete(false);
    setError("");
    setNotice("");
  };

  const applyTopicPreset = (preset: QuickTopicPreset) => {
    setSubject(preset.subject);
    setGrade(preset.grade);
    setAnnexType(preset.annexType);
    setTopic(preset.topic);
    setError("");
  };

  const handleGenerate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!topic.trim()) {
      setError("Escribe el tema del anexo antes de generar.");
      return;
    }
    setBusy("generating");
    setError("");
    setNotice("");
    try {
      const created = await client.generateAnnex({
        subject,
        grade,
        topic: topic.trim(),
        annex_type: annexType,
        language: "es",
        extra_instructions: extraInstructions.trim(),
      });
      setAnnexes((prev) => [created, ...prev]);
      selectAnnex(created);
      setStudioMode("edit");
      setTopic("");
      setExtraInstructions("");
      setNotice(
        "Anexo generado con IA. Revísalo, haz los ajustes que necesites y apruébalo para imprimir.",
      );
    } catch (err) {
      setError(annexErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const updateDraft = (updater: (current: AnnexDocument) => AnnexDocument) => {
    setDraft((prev) => (prev ? updater(prev) : prev));
    setDirty(true);
    setNotice("");
  };

  const handleSave = async (): Promise<AnnexDocument | null> => {
    if (!draft) return null;
    setBusy("saving");
    setError("");
    setNotice("");
    try {
      const saved = await client.updateAnnex(draft.id, {
        title: draft.title,
        subject: draft.subject,
        grade: draft.grade,
        topic: draft.topic,
        instructions: draft.instructions,
        content: draft.content,
      });
      setAnnexes((prev) => prev.map((a) => (a.id === saved.id ? saved : a)));
      setDraft(structuredClone(saved));
      setDirty(false);
      setNotice("Cambios guardados. Ahora aprueba el anexo para poder imprimirlo.");
      return saved;
    } catch (err) {
      setError(annexErrorMessage(err));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const handleApprove = async () => {
    if (!draft) return;
    setError("");
    setNotice("");
    let target = draft;
    if (dirty) {
      const saved = await handleSave();
      if (!saved) return;
      target = saved;
    }
    setBusy("approving");
    try {
      const approved = await client.approveAnnex(target.id);
      setAnnexes((prev) => prev.map((a) => (a.id === approved.id ? approved : a)));
      setDraft(structuredClone(approved));
      setDirty(false);
      setNotice("Anexo aprobado. Ya puedes imprimirlo ahora o programarlo.");
    } catch (err) {
      setError(annexErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (!draft) return;
    setBusy("deleting");
    setError("");
    setNotice("");
    const deletedId = draft.id;
    try {
      await client.deleteAnnex(deletedId);
      const remaining = annexes.filter((item) => item.id !== deletedId);
      setAnnexes(remaining);
      const next = remaining[0] ?? null;
      setSelectedId(next?.id ?? null);
      setDraft(next ? structuredClone(next) : null);
      setDirty(false);
      setConfirmDelete(false);
      setStudioMode("edit");
      setNotice("Anexo eliminado permanentemente.");
    } catch (err) {
      setError(annexErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const handlePrint = async () => {
    if (!draft || draft.status !== "approved" || dirty) return;
    setBusy("printing");
    setError("");
    setNotice("");
    try {
      let scheduledIso: string | null = null;
      if (printMode === "scheduled") {
        const parsed = new Date(scheduledLocal);
        if (Number.isNaN(parsed.getTime())) {
          setError("Elige una fecha y hora válidas.");
          setBusy(null);
          return;
        }
        scheduledIso = parsed.toISOString();
      }
      const job = await client.printAnnex(draft.id, {
        mode: printMode,
        copies,
        scheduled_for: scheduledIso,
        idempotency_key: `ui-${draft.id}-${crypto.randomUUID()}`,
      });
      if (job.status === "sent") {
        setNotice(
          `Enviado a ${job.printer_email} (${job.copies} ${job.copies === 1 ? "copia" : "copias"}).`,
        );
      } else if (job.status === "pending") {
        setNotice(
          `Impresión programada para ${new Date(job.scheduled_for).toLocaleString("es-MX")} (${job.copies} ${job.copies === 1 ? "copia" : "copias"}) en ${job.printer_email}.`,
        );
      } else if (job.status === "failed") {
        setError(
          `El envío falló: ${humanizePrintError(job.last_error)} Puedes reintentarlo en Impresora.`,
        );
      }
    } catch (err) {
      setError(annexErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const updateSection = (sIdx: number, updater: (sec: AnnexSection) => AnnexSection) => {
    updateDraft((cur) => ({
      ...cur,
      content: {
        ...cur.content,
        sections: cur.content.sections.map((sec, idx) =>
          idx === sIdx ? updater(sec) : sec,
        ),
      },
    }));
  };

  const updateItem = (
    sIdx: number,
    iIdx: number,
    patch: Partial<AnnexItem>,
  ) => {
    updateSection(sIdx, (sec) => ({
      ...sec,
      items: sec.items.map((item, idx) =>
        idx === iIdx ? { ...item, ...patch } : item,
      ),
    }));
  };

  const addItem = (sIdx: number) => {
    updateSection(sIdx, (sec) => ({
      ...sec,
      items: [
        ...sec.items,
        { kind: "question", text: "Nueva pregunta o ejercicio", answer_lines: 3 },
      ],
    }));
  };

  const removeItem = (sIdx: number, iIdx: number) => {
    updateSection(sIdx, (sec) => ({
      ...sec,
      items: sec.items.length > 1 ? sec.items.filter((_, idx) => idx !== iIdx) : sec.items,
    }));
  };

  const addSection = () => {
    updateDraft((cur) => ({
      ...cur,
      content: {
        ...cur.content,
        sections: [
          ...cur.content.sections,
          {
            heading: `${cur.content.sections.length + 1}. Nueva sección`,
            prompt: "",
            items: [{ kind: "question", text: "Escribe la pregunta aquí.", answer_lines: 3 }],
          },
        ],
      },
    }));
  };

  const isReadyToPrint = Boolean(draft && draft.status === "approved" && !dirty);
  const step1Done = Boolean(draft);
  const step1Active = !draft;
  const step2Done = isReadyToPrint;
  const step2Active = Boolean(draft && !isReadyToPrint);
  const step3Active = isReadyToPrint;

  return (
    <section className="annexes-page">
      <header className="studio-header">
        <div className="studio-header-title">
          <Logo />
          <h1>Anexos imprimibles</h1>
          <p className="field-hint">
            Genera con IA, edita, previsualiza en tamaño Carta y envía directo a tu Epson L3250.
          </p>
        </div>
        <div className="studio-header-actions">
          <button type="button" onClick={() => controller.navigate("printer")}>
            <UiIcon name="printer" size={18} />
            Impresora y cola
          </button>
          <button type="button" onClick={() => controller.navigate("home")}>
            Volver al inicio
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" className="ac-banner is-error">
          <UiIcon name="alert" size={18} />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div role="status" className="ac-banner is-success">
          <UiIcon name="check" size={18} />
          <span>{notice}</span>
        </div>
      )}

      <ol className="workflow-steps" aria-label="Pasos para imprimir">
        <li
          className={`workflow-step ${step1Done ? "is-done" : step1Active ? "is-active" : ""}`}
        >
          <span className="workflow-step-num" aria-hidden="true">
            {step1Done ? <UiIcon name="check" size={14} /> : "1"}
          </span>
          <span>Generar o elegir</span>
        </li>
        <li className="workflow-step-connector" aria-hidden="true" />
        <li
          className={`workflow-step ${step2Done ? "is-done" : step2Active ? "is-active" : ""}`}
        >
          <span className="workflow-step-num" aria-hidden="true">
            {step2Done ? <UiIcon name="check" size={14} /> : "2"}
          </span>
          <span>Revisar y editar</span>
        </li>
        <li className="workflow-step-connector" aria-hidden="true" />
        <li className={`workflow-step ${step3Active ? "is-active" : ""}`}>
          <span className="workflow-step-num" aria-hidden="true">
            3
          </span>
          <span>Aprobar e imprimir</span>
        </li>
      </ol>

      <div className="annexes-grid">
        <div className="annexes-rail">
          <form className="annex-card" onSubmit={(e) => void handleGenerate(e)}>
            <div className="annex-card-header">
              <h2 className="annex-card-title">
                <UiIcon name="sparkles" size={18} />
                Nuevo anexo con IA
              </h2>
              {capability && (
                <span
                  className={`ac-badge ${capability.available ? "ready" : "pending"}`}
                >
                  {capability.available ? capability.model : "IA inactiva"}
                </span>
              )}
            </div>

            {capability && !capability.available && (
              <p className="field-hint">
                IA inactiva: define <code>OPENAI_API_KEY</code> en el servidor para generar con{" "}
                <code>{capability.model}</code>.
              </p>
            )}

            <div className="quick-chips-block">
              <span className="quick-chips-label">Ideas rápidas</span>
              <div className="quick-chips">
                {QUICK_TOPIC_PRESETS.map((preset) => {
                  const isActive =
                    topic === preset.topic &&
                    subject === preset.subject &&
                    grade === preset.grade;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      className={`annex-chip ${isActive ? "is-active" : ""}`}
                      onClick={() => applyTopicPreset(preset)}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="annex-pair">
              <div className="annex-field">
                <label htmlFor="annex-subject">Asignatura</label>
                <input
                  id="annex-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  required
                />
              </div>
              <div className="annex-field">
                <label htmlFor="annex-grade">Grado</label>
                <input
                  id="annex-grade"
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="annex-field">
              <label htmlFor="annex-type">Tipo de anexo</label>
              <select
                id="annex-type"
                value={annexType}
                onChange={(e) => setAnnexType(e.target.value)}
              >
                <option value="hoja-de-trabajo">Hoja de trabajo</option>
                <option value="lectura-con-preguntas">Lectura con preguntas</option>
                <option value="ejercicios-de-practica">Ejercicios de práctica</option>
                <option value="evaluacion-corta">Evaluación breve</option>
                <option value="lista-de-cotejo">Lista de cotejo</option>
              </select>
            </div>

            <div className="annex-field">
              <label htmlFor="annex-topic">Tema *</label>
              <input
                id="annex-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Ej. Fracciones equivalentes o El ciclo del agua"
                required
              />
            </div>

            <div className="annex-field">
              <label htmlFor="annex-extra">Indicaciones adicionales (opcional)</label>
              <textarea
                id="annex-extra"
                rows={2}
                value={extraInstructions}
                onChange={(e) => setExtraInstructions(e.target.value)}
                placeholder="Ej. 5 preguntas sencillas y un cuadro de autoevaluación"
              />
            </div>

            <button
              className="primary"
              type="submit"
              disabled={busy !== null || capability?.available === false}
            >
              <UiIcon name="sparkles" size={18} />
              {busy === "generating" ? "Generando anexo…" : "Generar anexo con IA"}
            </button>
          </form>

          <section className="annex-card">
            <div className="annex-card-header">
              <h2 className="annex-card-title">
                <UiIcon name="worksheet" size={18} />
                Mis anexos (<span className="ac-num">{annexes.length}</span>)
              </h2>
            </div>

            {annexes.length === 0 ? (
              <p className="field-hint">
                Todavía no hay anexos. Genera el primero arriba o elige una idea rápida.
              </p>
            ) : (
              <>
                <div className="annex-search">
                  <UiIcon name="search" size={16} className="annex-search-icon" />
                  <input
                    type="search"
                    aria-label="Buscar anexos"
                    placeholder="Buscar por título o materia…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                <div
                  className="filter-pills"
                  role="tablist"
                  aria-label="Filtrar anexos por estado"
                >
                  {(
                    [
                      { id: "all", label: "Todos", count: annexes.length },
                      { id: "draft", label: "Borradores", count: draftCount },
                      { id: "approved", label: "Aprobados", count: approvedCount },
                    ] as const
                  ).map((pill) => (
                    <button
                      key={pill.id}
                      type="button"
                      role="tab"
                      aria-selected={statusFilter === pill.id}
                      className={`filter-pill ${statusFilter === pill.id ? "is-active" : ""}`}
                      onClick={() => setStatusFilter(pill.id)}
                    >
                      <span>{pill.label}</span>
                      <span className="filter-pill-count ac-num">{pill.count}</span>
                    </button>
                  ))}
                </div>

                {filteredAnnexes.length === 0 ? (
                  <div className="annex-list-empty">
                    <p className="field-hint">
                      Ningún anexo coincide con tu búsqueda o filtro actual.
                    </p>
                    <button
                      type="button"
                      className="btn-sm btn-ghost"
                      onClick={() => {
                        setSearchQuery("");
                        setStatusFilter("all");
                      }}
                    >
                      Mostrar todos
                    </button>
                  </div>
                ) : (
                  <div className="annex-list">
                    {filteredAnnexes.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`annex-list-item ${item.id === selectedId ? "selected" : ""}`}
                        onClick={() => selectAnnex(item)}
                      >
                        <strong>{item.title}</strong>
                        <span className="annex-list-meta">
                          {item.subject} · {item.grade} · Rev.{" "}
                          <span className="ac-num">{item.revision}</span>
                        </span>
                        <span className={`ac-badge ${item.status}`}>
                          {item.status === "approved"
                            ? "Aprobado para imprimir"
                            : "Borrador"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        <div className="annexes-canvas">
          {!draft ? (
            <section className="annex-card empty-state-card">
              <UiIcon name="worksheet" size={32} />
              <h2>Selecciona o genera un anexo</h2>
              <p className="field-hint">
                1. Genera una hoja con IA o elige una existente · 2. Edita el contenido y revísalo en tamaño Carta · 3. Aprueba y envía directo a tu Epson L3250.
              </p>
            </section>
          ) : (
            <>
              <section className="annex-card">
                <div className="studio-toolbar">
                  <div className="studio-status-group">
                    <span className={`ac-badge ${dirty ? "dirty" : draft.status}`}>
                      {dirty
                        ? "Cambios sin guardar"
                        : draft.status === "approved"
                          ? "Aprobado para imprimir"
                          : "Borrador"}
                    </span>
                    <span className="studio-status-meta">
                      Revisión <span className="ac-num">{draft.revision}</span>
                      {draft.model ? ` · ${draft.model}` : ""}
                    </span>
                  </div>

                  <div
                    className="studio-mode-tabs"
                    role="tablist"
                    aria-label="Modo del estudio"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={studioMode === "edit"}
                      className={`studio-mode-tab ${studioMode === "edit" ? "is-active" : ""}`}
                      onClick={() => setStudioMode("edit")}
                    >
                      <UiIcon name="edit" size={16} />
                      Editar contenido
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={studioMode === "preview"}
                      className={`studio-mode-tab ${studioMode === "preview" ? "is-active" : ""}`}
                      onClick={() => setStudioMode("preview")}
                    >
                      <UiIcon name="eye" size={16} />
                      Vista previa Carta
                    </button>
                  </div>

                  <div className="annex-actions-bar">
                    <a
                      className="annex-link-btn btn-sm"
                      href={client.pdfUrl(draft.id, 1)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <UiIcon name="download" size={16} />
                      PDF
                    </a>
                    <button
                      type="button"
                      className="btn-sm"
                      disabled={busy !== null || !dirty}
                      onClick={() => void handleSave()}
                    >
                      {busy === "saving" ? "Guardando…" : "Guardar cambios"}
                    </button>
                    <button
                      type="button"
                      className="primary btn-sm"
                      disabled={busy !== null || isReadyToPrint}
                      onClick={() => void handleApprove()}
                    >
                      {busy === "approving"
                        ? "Aprobando…"
                        : isReadyToPrint
                          ? "Aprobado ✓"
                          : "Aprobar para imprimir"}
                    </button>
                    <button
                      type="button"
                      className="btn-danger-subtle btn-sm"
                      disabled={busy !== null}
                      onClick={() => setConfirmDelete((prev) => !prev)}
                    >
                      <UiIcon name="trash" size={16} />
                      Eliminar
                    </button>
                  </div>
                </div>

                {confirmDelete && (
                  <div
                    className="inline-confirm-bar"
                    role="alertdialog"
                    aria-label="Confirmar eliminación del anexo"
                  >
                    <span>¿Eliminar este anexo permanentemente?</span>
                    <div className="annex-actions-bar">
                      <button
                        type="button"
                        className="btn-danger-subtle btn-sm"
                        disabled={busy !== null}
                        onClick={() => void handleDelete()}
                      >
                        {busy === "deleting" ? "Eliminando…" : "Sí, eliminar"}
                      </button>
                      <button
                        type="button"
                        className="btn-sm"
                        disabled={busy !== null}
                        onClick={() => setConfirmDelete(false)}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}

                {studioMode === "edit" ? (
                  <>
                    <div className="annex-field">
                      <label htmlFor="edit-title">Título del anexo</label>
                      <input
                        id="edit-title"
                        value={draft.title}
                        onChange={(e) =>
                          updateDraft((cur) => ({ ...cur, title: e.target.value }))
                        }
                      />
                    </div>

                    <div className="annex-pair">
                      <div className="annex-field">
                        <label htmlFor="edit-subject">Asignatura</label>
                        <input
                          id="edit-subject"
                          value={draft.subject}
                          onChange={(e) =>
                            updateDraft((cur) => ({ ...cur, subject: e.target.value }))
                          }
                        />
                      </div>
                      <div className="annex-field">
                        <label htmlFor="edit-grade">Grado</label>
                        <input
                          id="edit-grade"
                          value={draft.grade}
                          onChange={(e) =>
                            updateDraft((cur) => ({ ...cur, grade: e.target.value }))
                          }
                        />
                      </div>
                    </div>

                    <div className="annex-field">
                      <label htmlFor="edit-instructions">
                        Instrucciones para el alumnado
                      </label>
                      <textarea
                        id="edit-instructions"
                        rows={2}
                        value={draft.instructions}
                        onChange={(e) =>
                          updateDraft((cur) => ({
                            ...cur,
                            instructions: e.target.value,
                          }))
                        }
                      />
                    </div>

                    {draft.content.sections.map((section, sIdx) => (
                      <div key={sIdx} className="annex-section-box">
                        <div className="annex-section-top">
                          <span className="annex-section-label">
                            Sección {sIdx + 1}
                          </span>
                          {draft.content.sections.length > 1 && (
                            <button
                              type="button"
                              className="btn-sm btn-ghost"
                              onClick={() =>
                                updateDraft((cur) => ({
                                  ...cur,
                                  content: {
                                    ...cur.content,
                                    sections: cur.content.sections.filter(
                                      (_, i) => i !== sIdx,
                                    ),
                                  },
                                }))
                              }
                            >
                              Quitar sección
                            </button>
                          )}
                        </div>
                        <input
                          aria-label={`Título sección ${sIdx + 1}`}
                          value={section.heading}
                          onChange={(e) =>
                            updateSection(sIdx, (sec) => ({
                              ...sec,
                              heading: e.target.value,
                            }))
                          }
                        />
                        <input
                          aria-label={`Indicación sección ${sIdx + 1}`}
                          placeholder="Indicación breve (opcional)"
                          value={section.prompt}
                          onChange={(e) =>
                            updateSection(sIdx, (sec) => ({
                              ...sec,
                              prompt: e.target.value,
                            }))
                          }
                        />

                        {section.items.map((item, iIdx) => {
                          const showDrawingHint =
                            (item.kind === "question" || item.kind === "exercise") &&
                            needsDrawingBox(item.text);

                          return (
                            <div key={iIdx} className="annex-item-row">
                              <div className="annex-item-controls">
                                <select
                                  aria-label="Tipo de elemento"
                                  value={item.kind}
                                  onChange={(e) =>
                                    updateItem(sIdx, iIdx, {
                                      kind: e.target.value as AnnexItemKind,
                                    })
                                  }
                                >
                                  <option value="question">Pregunta</option>
                                  <option value="exercise">Ejercicio</option>
                                  <option value="reading">Lectura</option>
                                  <option value="checklist">Lista de cotejo</option>
                                </select>

                                <div
                                  className="lines-stepper"
                                  role="group"
                                  aria-label="Líneas para responder"
                                >
                                  <span>Líneas</span>
                                  <div className="lines-stepper-controls">
                                    <button
                                      type="button"
                                      aria-label="Menos líneas"
                                      disabled={item.answer_lines <= 0}
                                      onClick={() =>
                                        updateItem(sIdx, iIdx, {
                                          answer_lines: Math.max(0, item.answer_lines - 1),
                                        })
                                      }
                                    >
                                      <UiIcon name="minus" size={14} />
                                    </button>
                                    <span className="ac-num">{item.answer_lines}</span>
                                    <button
                                      type="button"
                                      aria-label="Más líneas"
                                      disabled={item.answer_lines >= 10}
                                      onClick={() =>
                                        updateItem(sIdx, iIdx, {
                                          answer_lines: Math.min(10, item.answer_lines + 1),
                                        })
                                      }
                                    >
                                      <UiIcon name="plus" size={14} />
                                    </button>
                                  </div>
                                </div>

                                {showDrawingHint && (
                                  <span className="drawing-hint-pill">
                                    Incluye recuadro de dibujo
                                  </span>
                                )}

                                {section.items.length > 1 && (
                                  <button
                                    type="button"
                                    className="btn-sm btn-ghost"
                                    onClick={() => removeItem(sIdx, iIdx)}
                                  >
                                    Quitar
                                  </button>
                                )}
                              </div>
                              <textarea
                                aria-label={`Texto elemento ${iIdx + 1} sección ${sIdx + 1}`}
                                rows={2}
                                value={item.text}
                                onChange={(e) =>
                                  updateItem(sIdx, iIdx, { text: e.target.value })
                                }
                              />
                            </div>
                          );
                        })}

                        <button
                          type="button"
                          className="btn-sm"
                          onClick={() => addItem(sIdx)}
                        >
                          + Agregar actividad o pregunta
                        </button>
                      </div>
                    ))}

                    <div className="annex-actions-bar">
                      <button type="button" className="btn-sm" onClick={addSection}>
                        + Agregar sección
                      </button>
                    </div>
                  </>
                ) : (
                  <LetterSheetPreview draft={draft} />
                )}
              </section>

              {!isReadyToPrint ? (
                <section
                  className="annex-print-studio is-locked"
                  aria-label="Paso 3 · Enviar a impresora Epson"
                >
                  <div className="print-studio-head">
                    <h3 className="annex-card-title">
                      <UiIcon name="printer" size={20} />
                      Paso 3 · Enviar a impresora Epson
                    </h3>
                    <span className={`ac-badge ${dirty ? "dirty" : "draft"}`}>
                      {dirty ? "Cambios sin guardar" : "Pendiente de aprobar"}
                    </span>
                  </div>
                  <p className="field-hint">
                    {dirty
                      ? "Tienes cambios sin guardar en el anexo. Guárdalos y aprueba la hoja para habilitar la impresión."
                      : "Revisa el texto o la vista previa tamaño Carta y aprueba el anexo para enviarlo a tu Epson L3250."}
                  </p>
                  <div className="annex-actions-bar">
                    <button
                      type="button"
                      className="primary"
                      disabled={busy !== null}
                      onClick={() => void handleApprove()}
                    >
                      <UiIcon name="check" size={18} />
                      {busy === "saving" || busy === "approving"
                        ? "Procesando…"
                        : dirty
                          ? "Guardar y aprobar"
                          : "Aprobar para imprimir"}
                    </button>
                  </div>
                </section>
              ) : (
                <section
                  className="annex-print-studio is-ready"
                  aria-label="Paso 3 · Enviar a impresora Epson"
                >
                  <div className="print-studio-head">
                    <h3 className="annex-card-title">
                      <UiIcon name="printer" size={20} />
                      Paso 3 · Enviar a impresora Epson
                    </h3>
                    {settings?.printer_email ? (
                      <span className="print-destination-pill">
                        {settings.printer_email}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="primary btn-sm"
                        onClick={() => controller.navigate("printer")}
                      >
                        Configurar impresora Epson
                      </button>
                    )}
                  </div>

                  {!settings?.printer_email ? (
                    <p className="field-hint">
                      Aún no has guardado el correo de tu impresora Epson (
                      <code>@print.epsonconnect.com</code>).
                    </p>
                  ) : (
                    <>
                      {!settings.smtp_configured && (
                        <div role="status" className="ac-banner is-warning">
                          <UiIcon name="alert" size={18} />
                          <span>
                            Falta configurar el servidor de correo (SMTP) para enviar automáticamente a Epson.
                          </span>
                        </div>
                      )}

                      <div className="annex-field">
                        <label htmlFor="print-copies">Copias para el grupo (1 a 50)</label>
                        <div className="copy-control-row">
                          <div className="copy-stepper">
                            <button
                              type="button"
                              className="btn-icon"
                              aria-label="Menos copias"
                              disabled={copies <= 1}
                              onClick={() => setCopies((c) => Math.max(1, c - 1))}
                            >
                              <UiIcon name="minus" size={16} />
                            </button>
                            <input
                              id="print-copies"
                              type="number"
                              min={1}
                              max={50}
                              value={copies}
                              onChange={(e) =>
                                setCopies(
                                  Math.max(1, Math.min(50, Number(e.target.value) || 1)),
                                )
                              }
                            />
                            <button
                              type="button"
                              className="btn-icon"
                              aria-label="Más copias"
                              disabled={copies >= 50}
                              onClick={() => setCopies((c) => Math.min(50, c + 1))}
                            >
                              <UiIcon name="plus" size={16} />
                            </button>
                          </div>

                          <div
                            className="copy-presets"
                            role="group"
                            aria-label="Cantidades rápidas de copias"
                          >
                            {COPY_PRESETS.map((preset) => (
                              <button
                                key={preset}
                                type="button"
                                className={`copy-preset-btn ac-num ${copies === preset ? "is-active" : ""}`}
                                onClick={() => setCopies(preset)}
                              >
                                {preset}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="annex-field">
                        <span id="print-mode-label" className="field-hint">
                          ¿Cuándo imprimir?
                        </span>
                        <div
                          className="segmented-control"
                          role="radiogroup"
                          aria-labelledby="print-mode-label"
                        >
                          <button
                            type="button"
                            role="radio"
                            aria-checked={printMode === "now"}
                            className={`segmented-option ${printMode === "now" ? "is-active" : ""}`}
                            onClick={() => setPrintMode("now")}
                          >
                            <UiIcon name="send" size={16} />
                            Imprimir ahora
                          </button>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={printMode === "scheduled"}
                            className={`segmented-option ${printMode === "scheduled" ? "is-active" : ""}`}
                            onClick={() => setPrintMode("scheduled")}
                          >
                            <UiIcon name="clock" size={16} />
                            Programar
                          </button>
                        </div>
                      </div>

                      {printMode === "scheduled" && (
                        <div className="annex-field">
                          <label htmlFor="print-schedule">
                            Fecha y hora de impresión
                          </label>
                          <input
                            id="print-schedule"
                            type="datetime-local"
                            value={scheduledLocal}
                            onChange={(e) => setScheduledLocal(e.target.value)}
                          />
                          <div className="annex-quick-times">
                            <button
                              type="button"
                              className="btn-sm"
                              onClick={() => setScheduledLocal(quickScheduleInHours(1))}
                            >
                              En 1 hora
                            </button>
                            <button
                              type="button"
                              className="btn-sm"
                              onClick={() =>
                                setScheduledLocal(quickScheduleDate(0, 20, 30))
                              }
                            >
                              Hoy 8:30 p. m.
                            </button>
                            <button
                              type="button"
                              className="btn-sm"
                              onClick={() =>
                                setScheduledLocal(quickScheduleDate(1, 6, 30))
                              }
                            >
                              Mañana 6:30 a. m.
                            </button>
                            <button
                              type="button"
                              className="btn-sm"
                              onClick={() =>
                                setScheduledLocal(quickScheduleDate(1, 7, 0))
                              }
                            >
                              Mañana 7:00 a. m.
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="annex-actions-bar">
                        <button
                          type="button"
                          className="primary"
                          disabled={busy !== null}
                          onClick={() => void handlePrint()}
                        >
                          <UiIcon
                            name={printMode === "now" ? "send" : "clock"}
                            size={18}
                          />
                          {busy === "printing"
                            ? "Enviando a la impresora…"
                            : printMode === "now"
                              ? `Imprimir ahora (${copies} ${copies === 1 ? "copia" : "copias"})`
                              : `Programar impresión (${copies} ${copies === 1 ? "copia" : "copias"})`}
                        </button>
                        <a
                          className="annex-link-btn"
                          href={client.pdfUrl(draft.id, copies)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <UiIcon name="download" size={16} />
                          Descargar PDF ({copies}x)
                        </a>
                      </div>
                    </>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
