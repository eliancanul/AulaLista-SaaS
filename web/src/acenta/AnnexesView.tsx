import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
import { UiIcon } from "./ui";
import "./annexes.css";

const DEFAULT_HEADER_FIELDS = ["Nombre", "Fecha", "Grupo"];

type StudioMode = "preview" | "edit";
type SaveState = "idle" | "saving" | "saved";

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

export function LetterSheetPreview({ draft }: { draft: AnnexDocument }) {
  const headerFields =
    draft.content.student_header_fields.length > 0
      ? draft.content.student_header_fields
      : DEFAULT_HEADER_FIELDS;

  return (
    <div className="letter-stage minimal-letter-stage">
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
    </div>
  );
}

export function AnnexesView({
  controller,
  initialAnnexes,
  initialSettings,
}: {
  controller: AcentaController;
  initialAnnexes?: AnnexDocument[];
  initialSettings?: PrintSettings | null;
}) {
  const client = useMemo(
    () => new AnnexPrintClient(controller.api),
    [controller.api],
  );
  useSyncExternalStore(controller.schools.subscribe, controller.schools.snapshot);
  const activeSchool = controller.schools.getActiveSchool();
  const activeSubject = controller.schools.getActiveSubject();

  const [capability, setCapability] = useState<AnnexCapability | null>(null);
  const [settings, setSettings] = useState<PrintSettings | null>(
    initialSettings ?? null,
  );
  const [annexes, setAnnexes] = useState<AnnexDocument[]>(initialAnnexes ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialAnnexes?.[0]?.id ?? null,
  );
  const [draft, setDraft] = useState<AnnexDocument | null>(
    initialAnnexes?.[0] ? structuredClone(initialAnnexes[0]) : null,
  );
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const draftVersionRef = useRef(0);

  // Minimalist studio defaults to live US Letter preview
  const [studioMode, setStudioMode] = useState<StudioMode>("preview");
  const [searchQuery, setSearchQuery] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Contextual generator form synced with active school/subject
  const [subject, setSubject] = useState(activeSubject.name);
  const [grade, setGrade] = useState(activeSchool.gradeLong);
  const [topic, setTopic] = useState("");
  const [annexType, setAnnexType] = useState("hoja-de-trabajo");
  const [extraInstructions, setExtraInstructions] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Minimal print dock controls
  const [copies, setCopies] = useState(initialSettings?.default_copies ?? 25);
  const [printMode, setPrintMode] = useState<"now" | "scheduled">("now");
  const [scheduledLocal, setScheduledLocal] = useState(() =>
    quickScheduleDate(1, 6, 30),
  );

  // Busy & feedback
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setSubject(activeSubject.name);
    setGrade(activeSchool.gradeLong);
  }, [activeSchool.id, activeSchool.gradeLong, activeSubject.id, activeSubject.name]);

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
      setSaveState("idle");
      setConfirmDelete(false);
    } catch (err) {
      setError(annexErrorMessage(err));
    }
  };

  useEffect(() => {
    if (initialAnnexes !== undefined) return;
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  // Silent debounced auto-save when teacher edits in-place
  useEffect(() => {
    if (!dirty || !draft || busy !== null) return;
    const versionAtSchedule = draftVersionRef.current;
    const snapshot = structuredClone(draft);
    const timer = window.setTimeout(() => {
      setSaveState("saving");
      void client
        .updateAnnex(snapshot.id, {
          title: snapshot.title,
          subject: snapshot.subject,
          grade: snapshot.grade,
          topic: snapshot.topic,
          instructions: snapshot.instructions,
          content: snapshot.content,
        })
        .then((saved) => {
          setAnnexes((prev) => prev.map((a) => (a.id === saved.id ? saved : a)));
          if (draftVersionRef.current === versionAtSchedule) {
            setDraft(structuredClone(saved));
            setDirty(false);
            setSaveState("saved");
          }
        })
        .catch((err) => {
          setSaveState("idle");
          setError(annexErrorMessage(err));
        });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [dirty, draft, busy, client]);

  const filteredAnnexes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return annexes;
    return annexes.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.subject.toLowerCase().includes(q) ||
        item.grade.toLowerCase().includes(q) ||
        item.topic.toLowerCase().includes(q),
    );
  }, [annexes, searchQuery]);

  const selectAnnex = (doc: AnnexDocument) => {
    draftVersionRef.current += 1;
    setSelectedId(doc.id);
    setDraft(structuredClone(doc));
    setDirty(false);
    setSaveState("idle");
    setConfirmDelete(false);
    setStudioMode("preview");
    setError("");
    setNotice("");
  };

  const handleGenerate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!topic.trim()) {
      setError("Escribe el tema de la ficha antes de generar.");
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
      setTopic("");
      setExtraInstructions("");
      setNotice("Ficha generada y lista en tamaño Carta.");
    } catch (err) {
      setError(annexErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const updateDraft = (updater: (current: AnnexDocument) => AnnexDocument) => {
    draftVersionRef.current += 1;
    setDraft((prev) => (prev ? updater(prev) : prev));
    setDirty(true);
    setSaveState("idle");
    setNotice("");
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
      draftVersionRef.current += 1;
      setSelectedId(next?.id ?? null);
      setDraft(next ? structuredClone(next) : null);
      setDirty(false);
      setSaveState("idle");
      setConfirmDelete(false);
      setStudioMode("preview");
      setNotice("Ficha eliminada.");
    } catch (err) {
      setError(annexErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const handlePrint = async () => {
    if (!draft || busy !== null) return;
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

      // Transparently flush unsaved edits and approve draft before printing
      let target = draft;
      if (dirty) {
        setSaveState("saving");
        const saved = await client.updateAnnex(target.id, {
          title: target.title,
          subject: target.subject,
          grade: target.grade,
          topic: target.topic,
          instructions: target.instructions,
          content: target.content,
        });
        target = saved;
        setAnnexes((prev) => prev.map((a) => (a.id === saved.id ? saved : a)));
        setDraft(structuredClone(saved));
        setDirty(false);
        setSaveState("saved");
      }

      if (target.status !== "approved") {
        const approved = await client.approveAnnex(target.id);
        target = approved;
        setAnnexes((prev) =>
          prev.map((a) => (a.id === approved.id ? approved : a)),
        );
        setDraft(structuredClone(approved));
      }

      const job = await client.printAnnex(target.id, {
        mode: printMode,
        copies,
        scheduled_for: scheduledIso,
        idempotency_key: `ui-${target.id}-${crypto.randomUUID()}`,
      });
      if (job.status === "sent") {
        setNotice(
          `Enviado a ${job.printer_email} (${job.copies} ${job.copies === 1 ? "copia" : "copias"}).`,
        );
      } else if (job.status === "pending") {
        controller.schools.setHasScheduledPrint(true);
        setNotice(
          `Impresión programada para ${new Date(job.scheduled_for).toLocaleString("es-MX")} (${job.copies} ${job.copies === 1 ? "copia" : "copias"}).`,
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

  const updateSection = (
    sIdx: number,
    updater: (sec: AnnexSection) => AnnexSection,
  ) => {
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
      items:
        sec.items.length > 1
          ? sec.items.filter((_, idx) => idx !== iIdx)
          : sec.items,
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
            items: [
              {
                kind: "question",
                text: "Escribe la pregunta aquí.",
                answer_lines: 3,
              },
            ],
          },
        ],
      },
    }));
  };

  const saveWhisper =
    saveState === "saving"
      ? "Guardando…"
      : dirty
        ? "Sin guardar"
        : saveState === "saved"
          ? "Guardado"
          : `Rev. ${draft?.revision ?? 1}`;

  return (
    <section className="annexes-page minimal-annexes-page">
      <header className="studio-header minimal-studio-header">
        <div className="studio-header-title">
          <p className="minimal-studio-kicker">
            {activeSchool.shortName} · {activeSchool.grade} · {activeSubject.name}
          </p>
          <h1>Anexos</h1>
        </div>
        <div className="studio-header-actions">
          <button
            type="button"
            className="minimal-ghost-btn"
            onClick={() => controller.navigate("printer")}
          >
            <UiIcon name="printer" size={16} />
            Impresora
          </button>
          <button
            type="button"
            className="minimal-ghost-btn"
            onClick={() => controller.navigate("home")}
          >
            Volver al chat
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

      <div className="annexes-grid minimal-annexes-grid">
        <aside className="annexes-rail minimal-annexes-rail" aria-label="Generar y elegir fichas">
          <form
            className="annex-card minimal-gen-card"
            onSubmit={(e) => void handleGenerate(e)}
          >
            <div className="annex-field">
              <label htmlFor="annex-topic">Nueva ficha para {activeSubject.name}</label>
              <input
                id="annex-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder={`Tema para ${activeSchool.grade}…`}
                required
              />
            </div>

            <div className="minimal-gen-row">
              <select
                id="annex-type"
                aria-label="Tipo de anexo"
                value={annexType}
                onChange={(e) => setAnnexType(e.target.value)}
              >
                <option value="hoja-de-trabajo">Hoja de trabajo</option>
                <option value="lectura-con-preguntas">Lectura con preguntas</option>
                <option value="ejercicios-de-practica">Ejercicios de práctica</option>
                <option value="evaluacion-corta">Evaluación breve</option>
                <option value="lista-de-cotejo">Lista de cotejo</option>
              </select>
              <button
                type="button"
                className="minimal-ghost-btn minimal-adjust-toggle"
                aria-expanded={showAdvanced}
                onClick={() => setShowAdvanced((prev) => !prev)}
              >
                {showAdvanced ? "Ocultar ajustes" : "Ajustar"}
              </button>
            </div>

            {showAdvanced && (
              <div className="minimal-advanced-fields">
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
                  <label htmlFor="annex-extra">Indicaciones adicionales</label>
                  <textarea
                    id="annex-extra"
                    rows={2}
                    value={extraInstructions}
                    onChange={(e) => setExtraInstructions(e.target.value)}
                    placeholder="Ej. 5 ejercicios breves y espacio para dibujar"
                  />
                </div>
              </div>
            )}

            {capability && !capability.available && (
              <p className="field-hint">
                IA inactiva: define <code>OPENAI_API_KEY</code> en el servidor.
              </p>
            )}

            <button
              className="primary minimal-gen-submit"
              type="submit"
              disabled={busy !== null || capability?.available === false}
            >
              <UiIcon name="sparkles" size={16} />
              {busy === "generating" ? "Generando…" : "Generar ficha"}
            </button>
          </form>

          <section className="minimal-library-section" aria-label="Fichas guardadas">
            <div className="minimal-library-head">
              <h2>Fichas</h2>
              {annexes.length > 0 && (
                <div className="annex-search minimal-search">
                  <UiIcon name="search" size={14} className="annex-search-icon" />
                  <input
                    type="search"
                    aria-label="Buscar anexos"
                    placeholder="Buscar…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              )}
            </div>

            {annexes.length === 0 ? (
              <p className="minimal-empty-hint">
                Aún no tienes fichas. Escribe un tema arriba para crear la primera.
              </p>
            ) : filteredAnnexes.length === 0 ? (
              <p className="minimal-empty-hint">Sin coincidencias.</p>
            ) : (
              <div className="annex-list minimal-annex-list">
                {filteredAnnexes.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`minimal-annex-row ${item.id === selectedId ? "selected" : ""}`}
                    onClick={() => selectAnnex(item)}
                  >
                    <span className="minimal-annex-row-title">{item.title}</span>
                    <span className="minimal-annex-row-meta">
                      {item.subject} · {item.grade}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>

        <div className="annexes-canvas minimal-annexes-canvas">
          {!draft ? (
            <section className="annex-card empty-state-card minimal-empty-canvas">
              <UiIcon name="worksheet" size={28} />
              <h2>Elige o genera una ficha</h2>
              <p className="field-hint">
                Se mostrará lista en formato Carta para revisar, editar o imprimir directo en tu Epson.
              </p>
            </section>
          ) : (
            <div className="minimal-canvas-shell">
              <div className="minimal-canvas-topbar">
                <div className="minimal-canvas-meta">
                  <span className="minimal-canvas-title">{draft.title}</span>
                  <span className="minimal-save-whisper" role="status">
                    {saveWhisper}
                  </span>
                </div>
                <div className="minimal-canvas-icons">
                  <button
                    type="button"
                    className={`minimal-icon-btn ${studioMode === "edit" ? "is-active" : ""}`}
                    aria-label={
                      studioMode === "edit"
                        ? "Volver a vista Carta"
                        : "Editar ficha"
                    }
                    aria-pressed={studioMode === "edit"}
                    title={
                      studioMode === "edit"
                        ? "Volver a vista Carta"
                        : "Editar ficha"
                    }
                    onClick={() =>
                      setStudioMode((prev) =>
                        prev === "preview" ? "edit" : "preview",
                      )
                    }
                  >
                    <UiIcon name="edit" size={16} />
                  </button>
                  <a
                    className="minimal-icon-btn"
                    href={client.pdfUrl(draft.id, 1)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Descargar PDF"
                    title="Abrir PDF"
                  >
                    <UiIcon name="download" size={16} />
                  </a>
                  <button
                    type="button"
                    className="minimal-icon-btn is-danger"
                    disabled={busy !== null}
                    aria-label="Eliminar ficha"
                    title="Eliminar ficha"
                    onClick={() => setConfirmDelete((prev) => !prev)}
                  >
                    <UiIcon name="trash" size={16} />
                  </button>
                </div>
              </div>

              {confirmDelete && (
                <div
                  className="inline-confirm-bar"
                  role="alertdialog"
                  aria-label="Confirmar eliminación del anexo"
                >
                  <span>¿Eliminar esta ficha permanentemente?</span>
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

              {studioMode === "preview" ? (
                <LetterSheetPreview draft={draft} />
              ) : (
                <section
                  className="annex-card minimal-editor-panel"
                  aria-label="Editor de ficha"
                >
                  <div className="annex-field">
                    <label htmlFor="edit-title">Título</label>
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
                          updateDraft((cur) => ({
                            ...cur,
                            subject: e.target.value,
                          }))
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
                    <label htmlFor="edit-instructions">Instrucciones</label>
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
                          (item.kind === "question" ||
                            item.kind === "exercise") &&
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
                                        answer_lines: Math.max(
                                          0,
                                          item.answer_lines - 1,
                                        ),
                                      })
                                    }
                                  >
                                    <UiIcon name="minus" size={14} />
                                  </button>
                                  <span className="ac-num">
                                    {item.answer_lines}
                                  </span>
                                  <button
                                    type="button"
                                    aria-label="Más líneas"
                                    disabled={item.answer_lines >= 10}
                                    onClick={() =>
                                      updateItem(sIdx, iIdx, {
                                        answer_lines: Math.min(
                                          10,
                                          item.answer_lines + 1,
                                        ),
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
                        + Agregar actividad
                      </button>
                    </div>
                  ))}

                  <div className="annex-actions-bar">
                    <button
                      type="button"
                      className="btn-sm"
                      onClick={addSection}
                    >
                      + Agregar sección
                    </button>
                  </div>
                </section>
              )}

              <footer
                className="minimal-print-dock"
                aria-label="Barra de impresión"
              >
                {!settings?.printer_email ? (
                  <div className="minimal-print-unconfigured">
                    <span>
                      Configura el correo de tu impresora Epson para imprimir desde aquí.
                    </span>
                    <button
                      type="button"
                      className="primary btn-sm"
                      onClick={() => controller.navigate("printer")}
                    >
                      Configurar impresora
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="minimal-print-dock-row">
                      <div
                        className="minimal-copies-pill"
                        role="group"
                        aria-label="Copias"
                      >
                        <button
                          type="button"
                          aria-label="Menos copias"
                          disabled={copies <= 1 || busy !== null}
                          onClick={() => setCopies((c) => Math.max(1, c - 1))}
                        >
                          <UiIcon name="minus" size={14} />
                        </button>
                        <input
                          id="print-copies"
                          type="number"
                          aria-label="Número de copias"
                          min={1}
                          max={50}
                          value={copies}
                          onChange={(e) =>
                            setCopies(
                              Math.max(
                                1,
                                Math.min(50, Number(e.target.value) || 1),
                              ),
                            )
                          }
                        />
                        <button
                          type="button"
                          aria-label="Más copias"
                          disabled={copies >= 50 || busy !== null}
                          onClick={() => setCopies((c) => Math.min(50, c + 1))}
                        >
                          <UiIcon name="plus" size={14} />
                        </button>
                      </div>

                      <button
                        type="button"
                        className={`minimal-schedule-toggle ${printMode === "scheduled" ? "is-scheduled" : ""}`}
                        aria-pressed={printMode === "scheduled"}
                        onClick={() => {
                          if (printMode === "now") {
                            setScheduledLocal(quickScheduleDate(1, 6, 30));
                            setPrintMode("scheduled");
                          } else {
                            setPrintMode("now");
                          }
                        }}
                      >
                        <span>
                          {printMode === "now" ? "Ahora" : "Mañana 6:30"}
                        </span>
                        <UiIcon name="chevron-down" size={13} />
                      </button>

                      {printMode === "scheduled" && (
                        <input
                          id="print-schedule"
                          type="datetime-local"
                          className="minimal-schedule-input"
                          aria-label="Fecha y hora de impresión"
                          value={scheduledLocal}
                          onChange={(e) => setScheduledLocal(e.target.value)}
                        />
                      )}

                      <button
                        type="button"
                        className="primary minimal-print-submit"
                        disabled={busy !== null}
                        onClick={() => void handlePrint()}
                      >
                        <UiIcon name="printer" size={16} />
                        {busy === "printing"
                          ? "Enviando…"
                          : printMode === "now"
                            ? "Imprimir"
                            : "Programar"}
                      </button>
                    </div>
                    {!settings.smtp_configured && (
                      <p className="minimal-print-whisper" role="status">
                        SMTP sin configurar en el servidor ({settings.printer_email}).
                      </p>
                    )}
                  </>
                )}
              </footer>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
