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
  type AdaptationMode,
  type AnnexCapability,
  type AnnexDocument,
  type AnnexItem,
  type AnnexItemKind,
  type AnnexRevisionSummary,
  type AnnexSection,
  type AnnexTable,
  type DidacticToolId,
  type PrintSettings,
} from "./annex-api";
import { QuizProjector, type QuizSlide } from "./QuizProjector";
import { UiIcon } from "./ui";
import "./annexes.css";

const DIDACTIC_TOOL_IDS = new Set<DidacticToolId>([
  "comprension-lectora",
  "adaptar-material",
  "tarjetas-repaso",
  "bingo-tematico",
  "proyecto-aula",
  "diagnostico-breve",
  "rubrica-cotejo",
  "memorama",
  "sopa-de-letras",
  "adivina-pistas",
  "quiz-proyectar",
]);

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

interface LetterSheetEditHandlers {
  onUpdateDraft: (updater: (current: AnnexDocument) => AnnexDocument) => void;
  onUpdateSection: (
    sIdx: number,
    updater: (sec: AnnexSection) => AnnexSection,
  ) => void;
  onUpdateItem: (
    sIdx: number,
    iIdx: number,
    patch: Partial<AnnexItem>,
  ) => void;
  onAddItem: (sIdx: number) => void;
  onRemoveItem: (sIdx: number, iIdx: number) => void;
  onAddSection: () => void;
}

export function LetterSheetPreview({
  draft,
  editing = false,
  handlers,
}: {
  draft: AnnexDocument;
  editing?: boolean;
  handlers?: LetterSheetEditHandlers;
}) {
  const headerFields =
    draft.content.student_header_fields.length > 0
      ? draft.content.student_header_fields
      : DEFAULT_HEADER_FIELDS;

  return (
    <div className="letter-stage minimal-letter-stage">
      <article
        className={`letter-sheet${editing ? " is-editing" : ""}`}
        aria-label={
          editing
            ? "Edición directa en hoja tamaño Carta"
            : "Vista previa tamaño Carta"
        }
      >
        <header>
          {editing && handlers ? (
            <div className="letter-inline-kicker">
              <input
                aria-label="Asignatura de la ficha"
                value={draft.subject}
                onChange={(e) =>
                  handlers.onUpdateDraft((cur) => ({
                    ...cur,
                    subject: e.target.value,
                  }))
                }
              />
              <span aria-hidden="true">·</span>
              <input
                aria-label="Grado de la ficha"
                value={draft.grade}
                onChange={(e) =>
                  handlers.onUpdateDraft((cur) => ({
                    ...cur,
                    grade: e.target.value,
                  }))
                }
              />
            </div>
          ) : (
            <p className="letter-kicker">
              {draft.subject} · {draft.grade}
            </p>
          )}

          {editing && handlers ? (
            <>
              <input
                className="letter-inline-title"
                aria-label="Título de la ficha"
                value={draft.title}
                onChange={(e) =>
                  handlers.onUpdateDraft((cur) => ({
                    ...cur,
                    title: e.target.value,
                  }))
                }
              />
              <input
                className="letter-inline-subtitle"
                aria-label="Subtítulo de la ficha"
                placeholder="Subtítulo opcional…"
                value={draft.content.subtitle}
                onChange={(e) =>
                  handlers.onUpdateDraft((cur) => ({
                    ...cur,
                    content: { ...cur.content, subtitle: e.target.value },
                  }))
                }
              />
            </>
          ) : (
            <>
              <h2 className="letter-title">{draft.title}</h2>
              {draft.content.subtitle.trim() && (
                <p className="letter-subtitle">{draft.content.subtitle}</p>
              )}
            </>
          )}

          {draft.content.curricular_trace &&
            Object.keys(draft.content.curricular_trace).length > 0 && (
              <p className="letter-curricular-trace">
                {[
                  draft.content.curricular_trace.phase,
                  draft.content.curricular_trace.campo_formativo,
                  draft.content.curricular_trace.pda,
                ]
                  .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
                  .join(" · ")}
              </p>
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

        {editing && handlers ? (
          <div className="letter-instructions letter-inline-instructions">
            <strong>Instrucciones:</strong>
            <textarea
              aria-label="Instrucciones de la ficha"
              rows={2}
              placeholder="Escribe las instrucciones para el alumnado…"
              value={draft.instructions}
              onChange={(e) =>
                handlers.onUpdateDraft((cur) => ({
                  ...cur,
                  instructions: e.target.value,
                }))
              }
            />
          </div>
        ) : (
          draft.instructions.trim() && (
            <p className="letter-instructions">
              <strong>Instrucciones:</strong> {draft.instructions}
            </p>
          )
        )}

        {draft.content.sections.map((section, sIdx) => {
          let questionIdx = 0;
          return (
            <section key={sIdx} className="letter-section">
              {editing && handlers ? (
                <div className="letter-inline-section-head">
                  <input
                    className="letter-inline-banner-input"
                    aria-label={`Título sección ${sIdx + 1}`}
                    value={section.heading}
                    onChange={(e) =>
                      handlers.onUpdateSection(sIdx, (sec) => ({
                        ...sec,
                        heading: e.target.value,
                      }))
                    }
                  />
                  {draft.content.sections.length > 1 && (
                    <button
                      type="button"
                      className="letter-inline-chip"
                      onClick={() =>
                        handlers.onUpdateDraft((cur) => ({
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
              ) : (
                section.heading.trim() && (
                  <h3 className="letter-section-banner">{section.heading}</h3>
                )
              )}

              {editing && handlers ? (
                <input
                  className="letter-inline-prompt"
                  aria-label={`Indicación sección ${sIdx + 1}`}
                  placeholder="Indicación breve (opcional)…"
                  value={section.prompt}
                  onChange={(e) =>
                    handlers.onUpdateSection(sIdx, (sec) => ({
                      ...sec,
                      prompt: e.target.value,
                    }))
                  }
                />
              ) : (
                section.prompt.trim() && (
                  <p className="letter-section-prompt">{section.prompt}</p>
                )
              )}

              {section.items.map((item, iIdx) => {
                if (editing && handlers) {
                  if (item.kind !== "reading" && item.kind !== "checklist") {
                    questionIdx += 1;
                  }
                  const hasDrawing =
                    (item.kind === "question" || item.kind === "exercise") &&
                    needsDrawingBox(item.text);
                  const lineCount = hasDrawing
                    ? Math.min(item.answer_lines, 3)
                    : item.answer_lines;
                  return (
                    <div key={iIdx} className="letter-inline-item">
                      <div className="letter-inline-item-bar">
                        {item.kind !== "reading" &&
                          item.kind !== "checklist" && (
                            <strong className="letter-inline-num">
                              {questionIdx}.
                            </strong>
                          )}
                        <select
                          aria-label="Tipo de elemento"
                          value={item.kind}
                          onChange={(e) =>
                            handlers.onUpdateItem(sIdx, iIdx, {
                              kind: e.target.value as AnnexItemKind,
                            })
                          }
                        >
                          <option value="question">Pregunta</option>
                          <option value="exercise">Ejercicio</option>
                          <option value="reading">Lectura</option>
                          <option value="checklist">Lista de cotejo</option>
                        </select>
                        {(item.kind === "question" ||
                          item.kind === "exercise") && (
                          <div
                            className="letter-inline-lines"
                            role="group"
                            aria-label="Líneas para responder"
                          >
                            <span>Líneas</span>
                            <button
                              type="button"
                              aria-label="Menos líneas"
                              disabled={item.answer_lines <= 0}
                              onClick={() =>
                                handlers.onUpdateItem(sIdx, iIdx, {
                                  answer_lines: Math.max(
                                    0,
                                    item.answer_lines - 1,
                                  ),
                                })
                              }
                            >
                              <UiIcon name="minus" size={12} />
                            </button>
                            <span className="ac-num">{item.answer_lines}</span>
                            <button
                              type="button"
                              aria-label="Más líneas"
                              disabled={item.answer_lines >= 10}
                              onClick={() =>
                                handlers.onUpdateItem(sIdx, iIdx, {
                                  answer_lines: Math.min(
                                    10,
                                    item.answer_lines + 1,
                                  ),
                                })
                              }
                            >
                              <UiIcon name="plus" size={12} />
                            </button>
                          </div>
                        )}
                        {section.items.length > 1 && (
                          <button
                            type="button"
                            className="letter-inline-chip"
                            onClick={() => handlers.onRemoveItem(sIdx, iIdx)}
                          >
                            Quitar
                          </button>
                        )}
                      </div>
                      <textarea
                        className={`letter-inline-item-text${item.kind === "reading" ? " is-reading" : ""}`}
                        aria-label={`Texto elemento ${iIdx + 1} sección ${sIdx + 1}`}
                        rows={item.kind === "reading" ? 3 : 2}
                        value={item.text}
                        onChange={(e) =>
                          handlers.onUpdateItem(sIdx, iIdx, {
                            text: e.target.value,
                          })
                        }
                      />
                      {hasDrawing && (
                        <div className="letter-drawing-box">
                          <span className="letter-drawing-label">
                            Espacio para dibujar / esquematizar
                          </span>
                        </div>
                      )}
                      {(item.kind === "question" ||
                        item.kind === "exercise") &&
                        lineCount > 0 && (
                          <div
                            className="letter-writing-lines"
                            aria-hidden="true"
                          >
                            {Array.from({ length: lineCount }, (_, lIdx) => (
                              <div key={lIdx} className="letter-writing-line" />
                            ))}
                          </div>
                        )}
                    </div>
                  );
                }

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

              {section.bullets && section.bullets.length > 0 && (
                <ul className="letter-bullets">
                  {section.bullets.map((bullet, bIdx) => (
                    <li key={bIdx}>{bullet}</li>
                  ))}
                </ul>
              )}

              {section.table && section.table.headers.length > 0 && (
                <div className="letter-table-wrap">
                  {editing && handlers ? (
                    <div className="letter-table-editor">
                      <table className="letter-table">
                        <thead>
                          <tr>
                            {section.table.headers.map((header, cIdx) => (
                              <th key={cIdx}>
                                <input
                                  aria-label={`Encabezado columna ${cIdx + 1}`}
                                  value={header}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    handlers.onUpdateSection(sIdx, (sec) => {
                                      if (!sec.table) return sec;
                                      const headers = sec.table.headers.map(
                                        (h, i) => (i === cIdx ? value : h),
                                      );
                                      return {
                                        ...sec,
                                        table: { ...sec.table, headers },
                                      };
                                    });
                                  }}
                                />
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {section.table.rows.map((row, rIdx) => (
                            <tr key={rIdx}>
                              {section.table!.headers.map((_, cIdx) => (
                                <td key={cIdx}>
                                  <input
                                    aria-label={`Celda fila ${rIdx + 1} columna ${cIdx + 1}`}
                                    value={row[cIdx] ?? ""}
                                    onChange={(e) => {
                                      const value = e.target.value;
                                      handlers.onUpdateSection(sIdx, (sec) => {
                                        if (!sec.table) return sec;
                                        const rows = sec.table.rows.map(
                                          (r, ri) => {
                                            if (ri !== rIdx) return r;
                                            const copy = [
                                              ...r,
                                              ...Array(
                                                Math.max(
                                                  0,
                                                  sec.table!.headers.length -
                                                    r.length,
                                                ),
                                              ).fill(""),
                                            ];
                                            copy[cIdx] = value;
                                            return copy;
                                          },
                                        );
                                        return {
                                          ...sec,
                                          table: { ...sec.table, rows },
                                        };
                                      });
                                    }}
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="letter-table-toolbar">
                        <button
                          type="button"
                          className="letter-inline-chip"
                          onClick={() =>
                            handlers.onUpdateSection(sIdx, (sec) => {
                              if (!sec.table) return sec;
                              return {
                                ...sec,
                                table: {
                                  ...sec.table,
                                  rows: [
                                    ...sec.table.rows,
                                    sec.table.headers.map(() => ""),
                                  ],
                                },
                              };
                            })
                          }
                        >
                          + Fila
                        </button>
                        <button
                          type="button"
                          className="letter-inline-chip"
                          onClick={() =>
                            handlers.onUpdateSection(sIdx, (sec) => {
                              if (!sec.table || sec.table.headers.length >= 6) {
                                return sec;
                              }
                              return {
                                ...sec,
                                table: {
                                  headers: [
                                    ...sec.table.headers,
                                    `Columna ${sec.table.headers.length + 1}`,
                                  ],
                                  rows: sec.table.rows.map((r) => [...r, ""]),
                                },
                              };
                            })
                          }
                        >
                          + Columna
                        </button>
                        <button
                          type="button"
                          className="letter-inline-chip"
                          onClick={() =>
                            handlers.onUpdateSection(sIdx, (sec) => ({
                              ...sec,
                              table: null,
                            }))
                          }
                        >
                          Quitar tabla
                        </button>
                      </div>
                    </div>
                  ) : (
                    <table className="letter-table">
                      <thead>
                        <tr>
                          {section.table.headers.map((header, cIdx) => (
                            <th key={cIdx}>{header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {section.table.rows.map((row, rIdx) => (
                          <tr key={rIdx}>
                            {section.table!.headers.map((_, cIdx) => (
                              <td key={cIdx}>{row[cIdx] ?? ""}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {editing && handlers && (
                <div className="letter-inline-actions-row">
                  <button
                    type="button"
                    className="letter-inline-add"
                    onClick={() => handlers.onAddItem(sIdx)}
                  >
                    + Agregar actividad
                  </button>
                  {!section.table && (
                    <button
                      type="button"
                      className="letter-inline-add"
                      onClick={() =>
                        handlers.onUpdateSection(sIdx, (sec) => ({
                          ...sec,
                          table: {
                            headers: ["Criterio", "Nivel / Detalle", "Observaciones"],
                            rows: [
                              ["", "", ""],
                              ["", "", ""],
                            ],
                          } as AnnexTable,
                        }))
                      }
                    >
                      + Agregar tabla
                    </button>
                  )}
                </div>
              )}
            </section>
          );
        })}

        {editing && handlers && (
          <button
            type="button"
            className="letter-inline-add is-section"
            onClick={handlers.onAddSection}
          >
            + Agregar sección
          </button>
        )}

        {(() => {
          const meta = draft.content.metadata as Record<string, unknown> | undefined;
          const ws = meta?.wordsearch as
            | { grid?: string[][]; seed?: number }
            | undefined;
          const bingo = meta?.bingo as
            | {
                seed?: number;
                boards?: Array<{ board_number: number; cells: string[][] }>;
              }
            | undefined;
          const cutCards = meta?.cut_cards as
            | Array<{ front: string; back: string }>
            | undefined;
          return (
            <>
              {ws?.grid && ws.grid.length > 0 && (
                <div className="letter-wordsearch" aria-label="Cuadrícula de sopa de letras">
                  <table className="letter-ws-grid">
                    <tbody>
                      {ws.grid.map((row, rIdx) => (
                        <tr key={rIdx}>
                          {row.map((cell, cIdx) => (
                            <td key={cIdx}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {bingo?.boards && bingo.boards.length > 0 && (
                <div className="letter-bingo-grid" aria-label="Tableros de bingo">
                  {bingo.boards.slice(0, 4).map((b) => (
                    <div key={b.board_number} className="letter-bingo-card">
                      <strong>Tablero #{b.board_number}</strong>
                      <table className="letter-table">
                        <tbody>
                          {b.cells.map((row, rIdx) => (
                            <tr key={rIdx}>
                              {row.map((cell, cIdx) => (
                                <td key={cIdx} className={cell === "LIBRE" ? "is-free" : ""}>
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                  {bingo.boards.length > 4 && (
                    <p className="field-hint">
                      +{bingo.boards.length - 4} tableros únicos adicionales incluidos en el PDF.
                    </p>
                  )}
                </div>
              )}

              {cutCards && cutCards.length > 0 && (
                <div className="letter-cut-cards" aria-label="Tarjetas recortables">
                  {cutCards.slice(0, 8).map((card, idx) => (
                    <div key={idx} className="letter-cut-card">
                      <strong>{card.front}</strong>
                      <p>{card.back}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          );
        })()}

        {draft.content.teacher_key && draft.content.teacher_key.length > 0 && (
          <details className="letter-teacher-key">
            <summary>
              Clave docente ({draft.content.teacher_key.length} entradas · se imprime en hoja separada)
            </summary>
            <ol>
              {draft.content.teacher_key.map((entry, idx) => (
                <li key={idx}>{entry}</li>
              ))}
            </ol>
          </details>
        )}

        <footer className="letter-footer">
          {editing && handlers ? (
            <input
              className="letter-inline-footer"
              aria-label="Pie de página de la ficha"
              placeholder="Pie de página (opcional)"
              value={draft.content.footer_note}
              onChange={(e) =>
                handlers.onUpdateDraft((cur) => ({
                  ...cur,
                  content: { ...cur.content, footer_note: e.target.value },
                }))
              }
            />
          ) : (
            <span>
              {draft.content.footer_note.trim() || "AulaLista · Acenta"}
            </span>
          )}
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
  initialEditing = false,
}: {
  controller: AcentaController;
  initialAnnexes?: AnnexDocument[];
  initialSettings?: PrintSettings | null;
  initialEditing?: boolean;
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
  const [undoStack, setUndoStack] = useState<AnnexDocument[]>([]);
  const [redoStack, setRedoStack] = useState<AnnexDocument[]>([]);
  const [showRevisions, setShowRevisions] = useState(false);
  const [revisions, setRevisions] = useState<AnnexRevisionSummary[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [projecting, setProjecting] = useState(false);
  const [showAdapt, setShowAdapt] = useState(false);
  const [adaptMode, setAdaptMode] = useState<AdaptationMode>("lectura_facil");

  // Minimalist studio defaults to live US Letter preview
  const [studioMode, setStudioMode] = useState<StudioMode>(
    initialEditing ? "edit" : "preview",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Contextual generator form synced with active school/subject
  const [subject, setSubject] = useState(activeSubject.name);
  const [grade, setGrade] = useState(activeSchool.gradeLong);
  const [topic, setTopic] = useState("");
  const [annexType, setAnnexType] = useState(() => {
    try {
      const picked = window.sessionStorage.getItem("acenta:selected-tool");
      if (picked) {
        window.sessionStorage.removeItem("acenta:selected-tool");
        return picked;
      }
    } catch {
      // ignore storage restrictions
    }
    return "hoja-de-trabajo";
  });
  const [extraInstructions, setExtraInstructions] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Minimal print dock controls
  const [copies, setCopies] = useState(initialSettings?.default_copies ?? 25);
  const [printMode, setPrintMode] = useState<"now" | "scheduled">("now");
  const [scheduledLocal, setScheduledLocal] = useState(() =>
    quickScheduleDate(1, 6, 30),
  );

  // Busy & feedback
  const [initialLoading, setInitialLoading] = useState(
    initialAnnexes === undefined,
  );
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
      setError("");
    } catch (err) {
      setError(annexErrorMessage(err));
    } finally {
      setInitialLoading(false);
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
    setUndoStack([]);
    setRedoStack([]);
    setShowRevisions(false);
    setRevisions([]);
    setShowAdapt(false);
    setProjecting(false);
    setDirty(false);
    setSaveState("idle");
    setConfirmDelete(false);
    setStudioMode("preview");
    setError("");
    setNotice("");
  };

  const isDidacticTool = DIDACTIC_TOOL_IDS.has(annexType as DidacticToolId);

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
      const created = isDidacticTool
        ? await client.generateDidacticTool({
            tool_id: annexType as DidacticToolId,
            subject,
            grade,
            topic: topic.trim(),
            source_text: extraInstructions.trim(),
            terms: extraInstructions
              .split(",")
              .map((t) => t.trim())
              .filter((t) => t.length >= 2)
              .slice(0, 16),
            school_id: activeSchool.id,
            subject_id: activeSubject.id,
          })
        : await client.generateAnnex({
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
      setNotice("Recurso generado y listo en tamaño Carta.");
    } catch (err) {
      setError(annexErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const handleAdapt = async () => {
    if (!draft || busy !== null) return;
    setBusy("adapting");
    setError("");
    setNotice("");
    try {
      const adapted = await client.adaptAnnex(draft.id, {
        adaptation_mode: adaptMode,
      });
      setAnnexes((prev) => [adapted, ...prev]);
      selectAnnex(adapted);
      setNotice("Copia adaptada creada (el recurso original quedó intacto).");
    } catch (err) {
      setError(annexErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const updateDraft = (updater: (current: AnnexDocument) => AnnexDocument) => {
    draftVersionRef.current += 1;
    setDraft((prev) => {
      if (!prev) return prev;
      setUndoStack((stack) => [...stack.slice(-39), structuredClone(prev)]);
      setRedoStack([]);
      return updater(prev);
    });
    setDirty(true);
    setSaveState("idle");
    setNotice("");
  };

  const handleUndo = () => {
    if (!draft || undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    draftVersionRef.current += 1;
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack.slice(-39), structuredClone(draft)]);
    setDraft(structuredClone(previous));
    setDirty(true);
    setSaveState("idle");
    setNotice("Cambio deshecho.");
  };

  const handleRedo = () => {
    if (!draft || redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    draftVersionRef.current += 1;
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack.slice(-39), structuredClone(draft)]);
    setDraft(structuredClone(next));
    setDirty(true);
    setSaveState("idle");
    setNotice("Cambio rehecho.");
  };

  useEffect(() => {
    if (studioMode !== "edit" || !draft) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        if (undoStack.length > 0) {
          event.preventDefault();
          handleUndo();
        }
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        if (redoStack.length > 0) {
          event.preventDefault();
          handleRedo();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioMode, draft, undoStack, redoStack]);

  const toggleRevisions = async () => {
    if (!draft) return;
    if (showRevisions) {
      setShowRevisions(false);
      return;
    }
    setShowRevisions(true);
    setRevisionsLoading(true);
    try {
      const list = await client.listAnnexRevisions(draft.id);
      setRevisions(list);
    } catch (err) {
      setError(annexErrorMessage(err));
    } finally {
      setRevisionsLoading(false);
    }
  };

  const handleRestoreRevision = async (revisionNumber: number) => {
    if (!draft || busy !== null) return;
    setBusy("restoring");
    setError("");
    setNotice("");
    try {
      const restored = await client.restoreAnnexRevision(
        draft.id,
        revisionNumber,
      );
      draftVersionRef.current += 1;
      setAnnexes((prev) =>
        prev.map((a) => (a.id === restored.id ? restored : a)),
      );
      setDraft(structuredClone(restored));
      setUndoStack([]);
      setRedoStack([]);
      setDirty(false);
      setSaveState("saved");
      setNotice(
        `Versión Rev. ${revisionNumber} restaurada como Rev. ${restored.revision}.`,
      );
      const list = await client.listAnnexRevisions(restored.id);
      setRevisions(list);
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
    <section className="anexos-studio">
      <header className="studio-topbar">
        <div className="studio-topbar-left">
          <h1 className="studio-title">Anexos</h1>
          <p className="minimal-studio-kicker">
            {activeSchool.shortName} · {activeSchool.grade} · {activeSubject.name}
          </p>
        </div>

        <div className="studio-topbar-center">
          {draft && (
            <div className="segmented-glass" role="group" aria-label="Modo de ficha">
              <button
                type="button"
                className={studioMode === "edit" ? "active" : ""}
                aria-label="Editar ficha"
                aria-pressed={studioMode === "edit"}
                onClick={() => setStudioMode("edit")}
              >
                Editar
              </button>
              <button
                type="button"
                className={studioMode === "preview" ? "active" : ""}
                aria-label="Volver a vista Carta"
                aria-pressed={studioMode === "preview"}
                onClick={() => setStudioMode("preview")}
              >
                Vista previa
              </button>
            </div>
          )}
        </div>

        <div className="topbar-right">
          {draft && (
            <>
              <a
                className="glass-btn-sm"
                href={client.pdfUrl(draft.id, 1)}
                target="_blank"
                rel="noreferrer"
                aria-label="Descargar PDF"
                title="Abrir PDF"
              >
                <UiIcon name="download" size={14} />
                <span>PDF</span>
              </a>
              <button
                type="button"
                className="minimal-icon-btn is-danger"
                disabled={busy !== null}
                aria-label="Eliminar ficha"
                title="Eliminar ficha"
                onClick={() => setConfirmDelete((prev) => !prev)}
              >
                <UiIcon name="trash" size={15} />
              </button>
            </>
          )}
          <button
            type="button"
            className="glass-btn-sm"
            onClick={() => controller.navigate("printer")}
          >
            <UiIcon name="printer" size={14} />
            <span>Impresora</span>
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

      <div className="anexos-body">
        <aside className="anexos-drawer" aria-label="Generar y elegir fichas">
          <form
            className="anexos-mini-form"
            onSubmit={(e) => void handleGenerate(e)}
          >
            <label htmlFor="annex-topic" className="drawer-section-label">
              Nueva ficha para {activeSubject.name}
            </label>
            <div className="mini-composer">
              <input
                id="annex-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder={`Tema para ${activeSchool.grade}…`}
                required
              />
              <button
                className="mini-send"
                type="submit"
                aria-label={busy === "generating" ? "Generando…" : "Generar ficha"}
                title="Generar ficha"
                disabled={
                  busy !== null || (!isDidacticTool && capability?.available === false)
                }
              >
                <UiIcon name="arrow-up" size={15} />
              </button>
            </div>

            <div className="minimal-gen-row">
              <select
                id="annex-type"
                aria-label="Tipo de anexo"
                value={annexType}
                onChange={(e) => setAnnexType(e.target.value)}
              >
                <optgroup label="Herramientas didácticas">
                  <option value="comprension-lectora">Preguntas sobre un texto</option>
                  <option value="rubrica-cotejo">Rúbrica y lista de cotejo</option>
                  <option value="diagnostico-breve">Diagnóstico breve</option>
                  <option value="proyecto-aula">Proyecto de aula (NEM)</option>
                  <option value="tarjetas-repaso">Tarjetas de repaso</option>
                  <option value="memorama">Memorama recortable</option>
                  <option value="sopa-de-letras">Sopa de letras</option>
                  <option value="bingo-tematico">Bingo temático</option>
                  <option value="adivina-pistas">Adivina con pistas</option>
                  <option value="quiz-proyectar">Quiz para proyectar</option>
                  <option value="adaptar-material">Adaptar material</option>
                </optgroup>
                <optgroup label="Generador abierto con IA">
                  <option value="hoja-de-trabajo">Hoja de trabajo</option>
                  <option value="lectura-con-preguntas">Lectura con preguntas</option>
                  <option value="ejercicios-de-practica">Ejercicios de práctica</option>
                  <option value="evaluacion-corta">Evaluación breve</option>
                  <option value="lista-de-cotejo">Lista de cotejo</option>
                </optgroup>
              </select>
              <button
                type="button"
                className="minimal-ghost-btn minimal-adjust-toggle"
                aria-expanded={showAdvanced}
                onClick={() => setShowAdvanced((prev) => !prev)}
              >
                {showAdvanced ? "Ocultar" : "Ajustar"}
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
          </form>

          <section className="minimal-library-section" aria-label="Fichas guardadas">
            <div className="minimal-library-head">
              <h2 className="drawer-section-label">Fichas</h2>
              {annexes.length > 0 && (
                <div className="search-glass">
                  <UiIcon name="search" size={14} />
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

            {initialLoading ? (
              <p role="status" className="minimal-empty-hint">
                Cargando fichas…
              </p>
            ) : annexes.length === 0 ? (
              <p className="minimal-empty-hint">
                Aún no tienes fichas. Escribe un tema arriba para crear la primera.
              </p>
            ) : filteredAnnexes.length === 0 ? (
              <p className="minimal-empty-hint">Sin coincidencias.</p>
            ) : (
              <div className="minimal-annex-list">
                {filteredAnnexes.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`minimal-annex-row${item.id === selectedId ? " selected" : ""}`}
                    aria-current={item.id === selectedId ? "true" : undefined}
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

        <div className="studio-desk">
          <div className="studio-desk-inner">
            {error && (
              <div role="alert" className="ac-banner is-error">
                <UiIcon name="alert" size={18} />
                <span>{error}</span>
                {!annexes.length && !initialLoading && (
                  <button
                    type="button"
                    className="minimal-ghost-btn"
                    disabled={busy !== null}
                    onClick={() => {
                      setInitialLoading(true);
                      void loadAll();
                    }}
                  >
                    Reintentar
                  </button>
                )}
              </div>
            )}
            {notice && (
              <div role="status" className="ac-banner is-success">
                <UiIcon name="check" size={18} />
                <span>{notice}</span>
              </div>
            )}

            {initialLoading ? (
              <section
                className="glass-card empty-state-card minimal-empty-canvas"
                role="status"
                aria-live="polite"
              >
                <UiIcon name="worksheet" size={28} />
                <h2>Cargando estudio de anexos…</h2>
                <p className="field-hint">
                  Recuperando tus fichas guardadas y configuración de impresora.
                </p>
              </section>
            ) : !draft ? (
              <section className="glass-card empty-state-card minimal-empty-canvas">
                <UiIcon name="worksheet" size={28} />
                <h2>Elige o genera una ficha</h2>
                <p className="field-hint">
                  Se mostrará lista en formato Carta para revisar, editar o imprimir directo en tu Epson.
                </p>
              </section>
            ) : (
              <div className="minimal-canvas-shell">
                <div className="minimal-canvas-meta">
                  <span className="minimal-canvas-title">{draft.title}</span>
                  <div className="minimal-canvas-tools">
                    {studioMode === "edit" && (
                      <>
                        <button
                          type="button"
                          className="glass-btn-sm"
                          disabled={undoStack.length === 0}
                          aria-label="Deshacer cambio"
                          title="Deshacer (Ctrl/⌘+Z)"
                          onClick={handleUndo}
                        >
                          Deshacer
                        </button>
                        <button
                          type="button"
                          className="glass-btn-sm"
                          disabled={redoStack.length === 0}
                          aria-label="Rehacer cambio"
                          title="Rehacer (Ctrl/⌘+Shift+Z)"
                          onClick={handleRedo}
                        >
                          Rehacer
                        </button>
                      </>
                    )}
                    {Array.isArray(
                      (draft.content.metadata as Record<string, unknown> | undefined)
                        ?.quiz_slides,
                    ) && (
                      <button
                        type="button"
                        className="btn-accent-pill"
                        onClick={() => setProjecting(true)}
                      >
                        Proyectar Quiz
                      </button>
                    )}
                    <button
                      type="button"
                      className={`glass-btn-sm${showAdapt ? " is-active" : ""}`}
                      aria-expanded={showAdapt}
                      onClick={() => setShowAdapt((prev) => !prev)}
                    >
                      Adaptar
                    </button>
                    <button
                      type="button"
                      className={`glass-btn-sm${showRevisions ? " is-active" : ""}`}
                      aria-expanded={showRevisions}
                      onClick={() => void toggleRevisions()}
                    >
                      Historial
                    </button>
                    <span className="minimal-save-whisper" role="status">
                      {saveWhisper}
                    </span>
                  </div>
                </div>

                {showAdapt && (
                  <section
                    className="annex-revisions-panel"
                    aria-label="Adaptar ficha sin alterar original"
                  >
                    <div className="annex-revisions-head">
                      <strong>Crear copia adaptada (original intacto)</strong>
                      <button
                        type="button"
                        className="minimal-ghost-btn"
                        onClick={() => setShowAdapt(false)}
                      >
                        Cerrar
                      </button>
                    </div>
                    <div className="minimal-canvas-tools">
                      <select
                        aria-label="Modo de adaptación"
                        value={adaptMode}
                        onChange={(e) =>
                          setAdaptMode(e.target.value as AdaptationMode)
                        }
                      >
                        <option value="lectura_facil">Lectura fácil</option>
                        <option value="bajar_nivel">Bajar nivel / andamiaje</option>
                        <option value="subir_reto">Subir reto / ampliación</option>
                        <option value="apoyo_visual">Apoyo visual / dibujar</option>
                        <option value="resumen_esquema">Resumen en esquema</option>
                      </select>
                      <button
                        type="button"
                        className="btn-accent-pill"
                        disabled={busy !== null}
                        onClick={() => void handleAdapt()}
                      >
                        {busy === "adapting" ? "Adaptando…" : "Crear adaptación"}
                      </button>
                    </div>
                  </section>
                )}

                {projecting &&
                  Array.isArray(
                    (draft.content.metadata as Record<string, unknown> | undefined)
                      ?.quiz_slides,
                  ) && (
                    <QuizProjector
                      title={draft.title}
                      slides={
                        (draft.content.metadata as Record<string, unknown>)
                          .quiz_slides as QuizSlide[]
                      }
                      onClose={() => setProjecting(false)}
                    />
                  )}

                {showRevisions && (
                  <section
                    className="annex-revisions-panel"
                    aria-label="Historial de revisiones"
                  >
                    <div className="annex-revisions-head">
                      <strong>Historial de revisiones</strong>
                      <button
                        type="button"
                        className="minimal-ghost-btn"
                        onClick={() => setShowRevisions(false)}
                      >
                        Cerrar
                      </button>
                    </div>
                    {revisionsLoading ? (
                      <p className="field-hint">Cargando historial…</p>
                    ) : revisions.length === 0 ? (
                      <p className="field-hint">
                        Aún no hay revisiones guardadas para esta ficha.
                      </p>
                    ) : (
                      <ul className="annex-revisions-list">
                        {revisions.map((rev) => (
                          <li key={rev.id} className="annex-revision-row">
                            <div>
                              <strong>Rev. {rev.revision}</strong> · {rev.title}
                              <span className="annex-revision-meta">
                                {" "}
                                ({rev.reason}) ·{" "}
                                {new Date(rev.created_at).toLocaleString("es-MX")}
                              </span>
                            </div>
                            <button
                              type="button"
                              className="glass-btn-sm"
                              disabled={busy !== null || rev.revision === draft.revision}
                              onClick={() => void handleRestoreRevision(rev.revision)}
                            >
                              {rev.revision === draft.revision
                                ? "Actual"
                                : "Restaurar"}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}

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

                <LetterSheetPreview
                  draft={draft}
                  editing={studioMode === "edit"}
                  handlers={{
                    onUpdateDraft: updateDraft,
                    onUpdateSection: updateSection,
                    onUpdateItem: updateItem,
                    onAddItem: addItem,
                    onRemoveItem: removeItem,
                    onAddSection: addSection,
                  }}
                />

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
                        className="btn-accent-pill"
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

                        <span className="dock-sep" aria-hidden="true" />

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

                        <span className="dock-sep" aria-hidden="true" />

                        <button
                          type="button"
                          className="btn-accent-pill"
                          disabled={busy !== null}
                          onClick={() => void handlePrint()}
                        >
                          <UiIcon name="printer" size={15} />
                          <span>
                            {busy === "printing"
                              ? "Enviando…"
                              : printMode === "now"
                                ? "Imprimir"
                                : "Programar"}
                          </span>
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
      </div>
    </section>
  );
}
