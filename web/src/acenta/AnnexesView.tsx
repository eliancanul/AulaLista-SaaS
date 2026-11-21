import { useEffect, useMemo, useState } from "react";
import type { AcentaController } from "./controller";
import {
  AnnexPrintClient,
  annexErrorMessage,
  type AnnexCapability,
  type AnnexDocument,
  type AnnexItem,
  type AnnexItemKind,
  type AnnexSection,
  type PrintSettings,
} from "./annex-api";
import { Logo } from "./ui";
import "./annexes.css";

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

export function AnnexesView({ controller }: { controller: AcentaController }) {
  const client = useMemo(() => new AnnexPrintClient(controller.api), [controller.api]);
  const [capability, setCapability] = useState<AnnexCapability | null>(null);
  const [settings, setSettings] = useState<PrintSettings | null>(null);
  const [annexes, setAnnexes] = useState<AnnexDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AnnexDocument | null>(null);
  const [dirty, setDirty] = useState(false);

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
    } catch (err) {
      setError(annexErrorMessage(err));
    }
  };

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const selectAnnex = (doc: AnnexDocument) => {
    setSelectedId(doc.id);
    setDraft(structuredClone(doc));
    setDirty(false);
    setError("");
    setNotice("");
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
          `Impresión programada para ${new Date(job.scheduled_for).toLocaleString("es-MX")} (${job.copies} copias) en ${job.printer_email}.`,
        );
      } else if (job.status === "failed") {
        setError(
          `El envío falló (${job.last_error ?? "error_smtp"}). Puedes reintentarlo en Impresora.`,
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

  return (
    <section className="annexes-page">
      <header className="annexes-header">
        <div>
          <Logo />
          <h1>Anexos imprimibles</h1>
          <p className="field-hint">
            Genera con IA, edita, aprueba y envía en PDF tamaño Carta directo a tu Epson L3250.
          </p>
        </div>
        <div className="annexes-header-actions">
          <button type="button" onClick={() => controller.navigate("printer")}>
            Impresora y cola
          </button>
          <button type="button" onClick={() => controller.navigate("home")}>
            Volver al inicio
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="annex-alert">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="annex-status">
          {notice}
        </p>
      )}

      <div className="annexes-grid">
        <div style={{ display: "grid", gap: 18 }}>
          <form className="annex-card" onSubmit={(e) => void handleGenerate(e)}>
            <h3>Nuevo anexo con IA</h3>
            {capability && !capability.available && (
              <p className="field-hint">
                IA inactiva: define <code>OPENAI_API_KEY</code> en el servidor para generar con{" "}
                <code>{capability.model}</code>.
              </p>
            )}
            {capability?.available && (
              <p className="field-hint">
                Modelo activo: <strong>{capability.model}</strong>
              </p>
            )}
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
              {busy === "generating" ? "Generando anexo…" : "Generar anexo con IA"}
            </button>
          </form>

          <section className="annex-card">
            <h3>Mis anexos ({annexes.length})</h3>
            {!annexes.length && (
              <p className="field-hint">
                Todavía no hay anexos. Genera el primero arriba.
              </p>
            )}
            <div className="annex-list">
              {annexes.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`annex-list-item ${item.id === selectedId ? "selected" : ""}`}
                  onClick={() => selectAnnex(item)}
                >
                  <strong>{item.title}</strong>
                  <span className="field-hint">
                    {item.subject} · {item.grade} · Rev. {item.revision}
                  </span>
                  <span className={`annex-badge ${item.status}`}>
                    {item.status === "approved" ? "Aprobado para imprimir" : "Borrador"}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>

        <div>
          {!draft ? (
            <section className="annex-card">
              <h2>Selecciona o genera un anexo</h2>
              <p className="field-hint">
                Aquí podrás editar el texto, ver el PDF tamaño Carta, aprobarlo y mandarlo a imprimir a tu Epson L3250.
              </p>
            </section>
          ) : (
            <div style={{ display: "grid", gap: 18 }}>
              <section className="annex-card">
                <div className="annex-section-top">
                  <div>
                    <span className={`annex-badge ${draft.status}`}>
                      {draft.status === "approved" && !dirty
                        ? "Aprobado para imprimir"
                        : dirty
                          ? "Cambios sin guardar"
                          : "Borrador"}
                    </span>
                    <p className="field-hint" style={{ marginTop: 4 }}>
                      Revisión {draft.revision}
                      {draft.model ? ` · Generado con ${draft.model}` : ""}
                    </p>
                  </div>
                  <div className="annex-actions-bar">
                    <a
                      className="annex-link-btn"
                      href={client.pdfUrl(draft.id, 1)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Ver / Descargar PDF
                    </a>
                    <button
                      type="button"
                      disabled={busy !== null || !dirty}
                      onClick={() => void handleSave()}
                    >
                      {busy === "saving" ? "Guardando…" : "Guardar cambios"}
                    </button>
                    <button
                      type="button"
                      className="primary"
                      disabled={busy !== null || (draft.status === "approved" && !dirty)}
                      onClick={() => void handleApprove()}
                    >
                      {busy === "approving"
                        ? "Aprobando…"
                        : draft.status === "approved" && !dirty
                          ? "Aprobado ✓"
                          : "Aprobar para imprimir"}
                    </button>
                  </div>
                </div>

                {draft.status === "approved" && !dirty && (
                  <section className="annex-print-box" aria-label="Enviar a impresora Epson">
                    <h3>Enviar a impresora Epson</h3>
                    {!settings?.printer_email ? (
                      <div>
                        <p className="field-hint">
                          Aún no has guardado el correo de tu impresora Epson (`@print.epsonconnect.com`).
                        </p>
                        <button
                          type="button"
                          className="primary"
                          style={{ marginTop: 8 }}
                          onClick={() => controller.navigate("printer")}
                        >
                          Configurar impresora Epson
                        </button>
                      </div>
                    ) : (
                      <>
                        <p className="field-hint">
                          Destino: <strong>{settings.printer_email}</strong>
                          {!settings.smtp_configured &&
                            " · Atención: falta configurar SMTP en el servidor."}
                        </p>
                        <div className="annex-pair">
                          <div className="annex-field">
                            <label htmlFor="print-copies">Copias (alumnos, 1 a 50)</label>
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
                          </div>
                          <div className="annex-field">
                            <label htmlFor="print-mode">¿Cuándo imprimir?</label>
                            <select
                              id="print-mode"
                              value={printMode}
                              onChange={(e) =>
                                setPrintMode(e.target.value as "now" | "scheduled")
                              }
                            >
                              <option value="now">Imprimir ahora</option>
                              <option value="scheduled">Programar fecha y hora</option>
                            </select>
                          </div>
                        </div>

                        {printMode === "scheduled" && (
                          <div className="annex-field">
                            <label htmlFor="print-schedule">Fecha y hora de impresión</label>
                            <input
                              id="print-schedule"
                              type="datetime-local"
                              value={scheduledLocal}
                              onChange={(e) => setScheduledLocal(e.target.value)}
                            />
                            <div className="annex-quick-times">
                              <button
                                type="button"
                                onClick={() => setScheduledLocal(quickScheduleDate(0, 20, 30))}
                              >
                                Hoy 8:30 p.m.
                              </button>
                              <button
                                type="button"
                                onClick={() => setScheduledLocal(quickScheduleDate(1, 6, 30))}
                              >
                                Mañana 6:30 a.m.
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
                            Descargar PDF ({copies}x)
                          </a>
                        </div>
                      </>
                    )}
                  </section>
                )}

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
                  <label htmlFor="edit-instructions">Instrucciones para el alumnado</label>
                  <textarea
                    id="edit-instructions"
                    rows={2}
                    value={draft.instructions}
                    onChange={(e) =>
                      updateDraft((cur) => ({ ...cur, instructions: e.target.value }))
                    }
                  />
                </div>

                {draft.content.sections.map((section, sIdx) => (
                  <div key={sIdx} className="annex-section-box">
                    <div className="annex-section-top">
                      <strong>Sección {sIdx + 1}</strong>
                      {draft.content.sections.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            updateDraft((cur) => ({
                              ...cur,
                              content: {
                                ...cur.content,
                                sections: cur.content.sections.filter((_, i) => i !== sIdx),
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
                        updateSection(sIdx, (sec) => ({ ...sec, heading: e.target.value }))
                      }
                    />
                    <input
                      aria-label={`Indicación sección ${sIdx + 1}`}
                      placeholder="Indicación breve (opcional)"
                      value={section.prompt}
                      onChange={(e) =>
                        updateSection(sIdx, (sec) => ({ ...sec, prompt: e.target.value }))
                      }
                    />

                    {section.items.map((item, iIdx) => (
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
                          <label>
                            Líneas:{" "}
                            <input
                              type="number"
                              min={0}
                              max={10}
                              style={{ width: 64 }}
                              value={item.answer_lines}
                              onChange={(e) =>
                                updateItem(sIdx, iIdx, {
                                  answer_lines: Math.max(
                                    0,
                                    Math.min(10, Number(e.target.value) || 0),
                                  ),
                                })
                              }
                            />
                          </label>
                          {section.items.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeItem(sIdx, iIdx)}
                            >
                              Quitar
                            </button>
                          )}
                        </div>
                        <textarea
                          rows={2}
                          value={item.text}
                          onChange={(e) =>
                            updateItem(sIdx, iIdx, { text: e.target.value })
                          }
                        />
                      </div>
                    ))}
                    <button type="button" onClick={() => addItem(sIdx)}>
                      + Agregar actividad o pregunta
                    </button>
                  </div>
                ))}

                <div className="annex-actions-bar">
                  <button type="button" onClick={addSection}>
                    + Agregar sección
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
