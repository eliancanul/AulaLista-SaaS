import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { AcentaController, PanelView } from "./controller";
import type { ChatUsage } from "./chat-contracts";
import type { ActiveAgentTarget, AgentChatTurn } from "./agent-chat-controller";
import type { SchoolSpace } from "./school-context";
import { UiIcon } from "./ui";
import { CurricularContextPanel } from "./CurricularContextPanel";
import "./chat.css";

const STANDARD_SUBJECT_SLUGS: Record<string, string> = {
  mat: "Matemáticas",
  esp: "Español",
  cie: "Ciencias Naturales",
  his: "Historia",
  geo: "Geografía",
  fce: "Formación Cívica y Ética",
  art: "Artes",
  ing: "Inglés",
  con: "Conocimiento del Medio",
};

function resolveDetectedSubjectLabel(
  subjectId: string | null,
  school: SchoolSpace,
): string | null {
  if (!subjectId) return null;
  const configured = school.subjects.find((sub) => sub.id === subjectId);
  if (configured) return configured.name;
  const slug = subjectId.split("-").pop()?.toLowerCase() ?? "";
  return STANDARD_SUBJECT_SLUGS[slug] ?? null;
}

function buildSchoolChatTarget(school: SchoolSpace): ActiveAgentTarget {
  return {
    channelKey: `orchestrator:${school.id}`,
    agentKind: "orchestrator",
    schoolId: school.id,
    schoolName: school.shortName,
    grade: school.grade,
    shift: school.shift,
    subjectId: null,
    subjectName: null,
  };
}

export function ChatExitGuard({controller, onReview, onExit}: {
  controller: AcentaController; onReview: () => void; onExit: () => void;
}) {
  const pending = controller.chat.hasPending() || controller.agentChat.hasPending();
  return <section className="exit-guard">
    <h2>¿Salir con mensajes pendientes?</h2>
    <p>El mensaje y los cambios de contexto sin guardar sólo están en esta pestaña. El historial confirmado permanece en tu cuenta.</p>
    {pending && <p>Hay un envío sin confirmar. Al cerrar sesión perderás el texto y el estado local de este intento. Cerrar sesión no cancela el procesamiento ni elimina los registros o reservas del servidor.</p>}
    <div className="actions">
      <button autoFocus onClick={onReview}>Revisar mensajes pendientes</button>
      {pending
        ? <button onClick={onExit}>Continuar cierre de sesión sin confirmar el envío</button>
        : <button onClick={() => {
          const okLegacy = !controller.chat.hasUnsavedChanges() || controller.chat.discardDrafts();
          const okAgent = !controller.agentChat.hasUnsavedChanges() || controller.agentChat.discardDrafts();
          if (okLegacy && okAgent) onExit();
        }}>Descartar mensajes sin enviar y continuar salida</button>}
    </div>
  </section>;
}

export function ChatUsageDetails({usage}: {usage: ChatUsage}) {
  return <details className="chat-usage">
    <summary>Consumo de este turno</summary>
    <dl>
      <dt>Tokens de entrada observados</dt><dd>{usage.input_tokens ?? "Desconocidos"}</dd>
      <dt>Tokens de salida observados</dt><dd>{usage.output_tokens ?? "Desconocidos"}</dd>
      <dt>Costo estimado</dt><dd>{usage.estimated_cost_usd === null ? "Desconocido" : `${usage.estimated_cost_usd} USD`}</dd>
      <dt>Reserva del intento</dt><dd>{usage.reserved_usd} USD</dd>
    </dl>
    <p>La reserva limita el intento; no es consumo observado ni una factura. El saldo disponible no está informado.</p>
  </details>;
}

function AgentUsageDetails({turn}: {turn: AgentChatTurn}) {
  const { usage } = turn;
  if (usage.input_tokens === null && usage.output_tokens === null && usage.estimated_cost_usd === null) {
    return null;
  }
  return <details className="chat-usage">
    <summary>Consumo de este turno</summary>
    <dl>
      <dt>Tokens de entrada</dt><dd>{usage.input_tokens ?? "—"}</dd>
      <dt>Tokens de salida</dt><dd>{usage.output_tokens ?? "—"}</dd>
      <dt>Costo estimado</dt><dd>{usage.estimated_cost_usd === null ? "—" : `${usage.estimated_cost_usd} USD`}</dd>
      {turn.model && <><dt>Modelo</dt><dd>{turn.model}</dd></>}
    </dl>
  </details>;
}

export function ChatContextEditor({controller}: {controller: AcentaController}) {
  useSyncExternalStore(controller.chat.subscribe, controller.chat.snapshot);
  const agentState = useSyncExternalStore(controller.agentChat.subscribe, controller.agentChat.snapshot);
  useSyncExternalStore(controller.schools.subscribe, controller.schools.snapshot);

  if (agentState.availability === "available") {
    const activeSchool = controller.schools.getActiveSchool();
    const target = buildSchoolChatTarget(activeSchool);
    const agentThread = controller.agentChat.threadFor(target.channelKey);
    const channel = agentThread.channel;
    const savedNotes = channel?.context_notes ?? "";
    const busy = agentThread.status === "sending" || agentThread.status === "loading";
    const dirty = agentThread.contextDraft !== null && agentThread.contextDraft !== savedNotes;
    const activeDigests = agentThread.subjectDigests.filter(
      (item) => item.turn_count > 0 || Boolean(item.summary_topic || item.digest),
    );

    return <div className="chat-context-editor">
      <p className="agent-context-scope">
        <strong>{activeSchool.shortName} · {activeSchool.grade}</strong>
      </p>
      <p>
        Luna adapta sus respuestas a tu grupo y separa automáticamente el contexto de cada materia conforme conversan.
      </p>
      {activeDigests.length > 0 && (
        <div className="agent-context-brief">
          <span className="agent-context-brief-label">Materias con contexto activo</span>
          <ul className="agent-digest-list">
            {activeDigests.map((item) => (
              <li key={item.subject_id}>
                <strong>{item.subject_name}</strong>: {item.summary_topic || item.digest}
              </li>
            ))}
          </ul>
        </div>
      )}
      {channel && (
        <p className="field-hint">
          Revisión guardada {channel.context_revision} · Turnos anteriores al {channel.through_turn} archivados.
        </p>
      )}
      <label htmlFor="chat-context-notes">
        Notas generales del grupo ({activeSchool.grade})
      </label>
      <textarea
        id="chat-context-notes"
        value={agentThread.contextDraft ?? savedNotes}
        disabled={busy}
        placeholder="Ej.: Grupo de 28 alumnos, proyecto escolar de la semana, evaluaciones los viernes…"
        onChange={event => controller.agentChat.setContextDraft(target.channelKey, event.target.value)}
      />
      <p className="field-hint">
        Hasta 4096 caracteres. Al guardar o reiniciar, los mensajes anteriores quedan archivados sin borrar tus documentos ni anexos.
      </p>
      {dirty && <p role="status">Cambios de contexto sin guardar en esta pestaña.</p>}
      {agentThread.error && <p role="alert">{agentThread.error}</p>}
      {agentThread.contextNotice && <p role="status">{agentThread.contextNotice}</p>}
      <div className="actions">
        <button disabled={busy || !dirty} onClick={() => controller.agentChat.discardContextDraft(target.channelKey)}>
          Descartar cambios
        </button>
        <button disabled={busy} onClick={() => void controller.agentChat.updateContext(target, true)}>
          Reiniciar chat
        </button>
        <button
          className="primary"
          disabled={busy || agentThread.contextDraft === null || !agentThread.contextDraft.trim()}
          onClick={() => void controller.agentChat.updateContext(target, false)}
        >
          Guardar notas
        </button>
      </div>
      <CurricularContextPanel
        api={controller.api}
        schoolId={activeSchool.id}
        schoolName={activeSchool.shortName}
        grade={activeSchool.gradeLong}
        subjectId="__school__"
        subjectName="Toda la escuela"
      />
    </div>;
  }

  const thread = controller.chat.current(), doc = thread.document;
  if (!doc) return <p role="status">El contexto estará disponible después de recuperar o iniciar tu chat. Puedes seguir preparando tu mensaje.</p>;
  const busy = thread.status === "sending" || thread.status === "loading";
  const disabled = busy || !!thread.pending || thread.needsRefresh;
  return <div className="chat-context-editor">
    <p>Revisión guardada {doc.context.revision} · Historial anterior hasta el turno {doc.context.through_turn} excluido del contexto activo.</p>
    <p>Al guardar, el siguiente mensaje usará estas notas y los turnos posteriores al {doc.conversation.version}. Los mensajes anteriores seguirán visibles, pero dejarán de enviarse al modelo. No se genera un resumen automático.</p>
    <p>Reiniciar aplica notas vacías con el mismo corte. Ambas acciones conservan historial, recursos y reservas; no cancelan operaciones.</p>
    <label htmlFor="chat-context-notes">Notas para el próximo contexto</label>
    <textarea id="chat-context-notes" value={thread.contextDraft ?? doc.context.notes} disabled={!!thread.pending}
      onChange={event => controller.chat.setContextDraft(event.target.value)} />
    <p className="field-hint">Texto manual · hasta 4096 caracteres y 8192 bytes. Se enviará sólo cuando decidas enviar otro mensaje. Las notas no modifican tus recursos.</p>
    {thread.contextDraft !== null && thread.contextDraft !== doc.context.notes && <p role="status">Cambios de contexto sin guardar en esta pestaña.</p>}
    {thread.error && <p role="alert">{thread.error}</p>}
    {thread.contextNotice && <p role="status">{thread.contextNotice}</p>}
    {thread.needsRefresh && <button disabled={busy} onClick={() => void controller.chat.refresh()}>Actualizar historial y contexto</button>}
    {thread.pending?.kind === "context" && <button disabled={busy} onClick={() => void controller.chat.recover()}>Consultar estado del cambio de contexto</button>}
    <div className="actions">
      <button disabled={disabled} onClick={() => controller.chat.discardContextDraft()}>Descartar cambios de notas</button>
      <button disabled={disabled} onClick={() => void controller.chat.updateContext(true)}>Reiniciar contexto sin borrar historial</button>
      <button className="primary" disabled={disabled || thread.contextDraft === null || !thread.contextDraft.trim()}
        onClick={() => void controller.chat.updateContext()}>Guardar notas y comenzar contexto</button>
    </div>
  </div>;
}

export function Chat({controller, onPlan, onContext, panel, panelView = null}: {
  controller: AcentaController; onPlan: () => void; onContext: () => void; panel?: ReactNode; panelView?: PanelView | null;
}) {
  const state = useSyncExternalStore(controller.chat.subscribe, controller.chat.snapshot);
  const agentState = useSyncExternalStore(controller.agentChat.subscribe, controller.agentChat.snapshot);
  useSyncExternalStore(controller.schools.subscribe, controller.schools.snapshot);
  const activeSchool = controller.schools.getActiveSchool();
  const thread = controller.chat.current();
  const archive = controller.chat.isArchive();
  const useAgentChat = !archive && agentState.availability === "available";
  const activeTarget = buildSchoolChatTarget(activeSchool);
  const agentThread = controller.agentChat.threadFor(activeTarget.channelKey);

  const input = useRef<HTMLTextAreaElement>(null);
  const activeStatus = useAgentChat ? agentThread.status : thread.status;
  const activeDraft = useAgentChat ? agentThread.draft : thread.draft;
  const previous = useRef(activeStatus);
  const overflowRef = useRef<HTMLDivElement>(null);
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);
  const plusRef = useRef<HTMLDivElement>(null);
  const plusTriggerRef = useRef<HTMLButtonElement>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [isMultiline, setIsMultiline] = useState(false);

  useEffect(() => {
    void controller.chat.loadAvailability();
    void controller.agentChat.loadAvailability();
    if (!state.activeId) void controller.chat.openActive();
  }, [controller]);

  useEffect(() => {
    if (useAgentChat) {
      void controller.agentChat.openChannel(activeTarget.channelKey);
    }
  }, [controller, useAgentChat, activeTarget.channelKey]);

  useEffect(() => {
    // Completion may happen after the teacher moves to a panel or a modal.
    // Return focus only while it still belongs to this composer.
    if (previous.current === "sending" && activeStatus !== "sending" && !panelView &&
      input.current?.closest("form")?.contains(document.activeElement) && !document.querySelector("dialog[open]")) input.current.focus();
    previous.current = activeStatus;
  }, [activeStatus, panelView]);

  // Rock-solid prototype caret & pill-to-multiline auto-grow math (24px line-height, max 6 lines = 144px)
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const raw = activeDraft;
    if (!raw.length) {
      el.style.height = "24px";
      el.style.overflowY = "hidden";
      setIsMultiline(false);
      return;
    }
    el.style.height = "24px";
    const natural = el.scrollHeight;
    const nextMultiline = raw.includes("\n") || natural > 30;
    setIsMultiline(nextMultiline);
    const clamped = Math.max(24, Math.min(144, natural));
    el.style.height = `${clamped}px`;
    el.style.overflowY = natural > 144 ? "auto" : "hidden";
  }, [activeDraft, isMultiline]);

  useEffect(() => {
    if (!overflowOpen && !plusOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (overflowOpen && overflowRef.current && !overflowRef.current.contains(target)) {
        setOverflowOpen(false);
      }
      if (plusOpen && plusRef.current && !plusRef.current.contains(target)) {
        setPlusOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (overflowOpen) {
          setOverflowOpen(false);
          overflowTriggerRef.current?.focus();
        }
        if (plusOpen) {
          setPlusOpen(false);
          plusTriggerRef.current?.focus();
        }
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [overflowOpen, plusOpen]);

  const busy = activeStatus === "sending" || activeStatus === "loading";
  const canClearContext = useAgentChat
    ? !busy && ((agentThread.channel?.version ?? 0) > 0 || Boolean(agentThread.channel?.context_notes))
    : !archive && !!thread.document && !busy && !thread.pending && !thread.needsRefresh;

  const throughTurn = useAgentChat
    ? (agentThread.channel?.through_turn ?? 0)
    : (!archive && thread.document ? thread.document.context.through_turn : 0);

  const legacyTurns = thread.document?.turns ?? [];
  const agentTurns = agentThread.turns;
  const hasMessages = useAgentChat ? agentTurns.length > 0 : legacyTurns.length > 0;

  const lastArchivedIdx = throughTurn > 0
    ? (useAgentChat ? agentTurns : legacyTurns).reduce(
        (acc, turn, idx) => (turn.number <= throughTurn ? idx : acc),
        -1,
      )
    : -1;

  const canSubmit = useAgentChat
    ? !busy && !!agentThread.draft.trim()
    : !busy && !thread.pending && !thread.needsRefresh && state.activeLoaded && !!thread.draft.trim() && state.availability === "available";

  const showLegacyContextRevision = !useAgentChat && !archive && !!thread.document && thread.document.context.revision > 0;
  const showAgentContextRevision = useAgentChat && !!agentThread.channel && agentThread.channel.context_revision > 0;

  const submitMessage = () => {
    if (useAgentChat) {
      void controller.agentChat.submit(activeTarget);
    } else {
      void controller.chat.submit();
    }
  };

  const placeholderText = `Pide una planeación, actividad o material para ${activeSchool.grade}…`;

  return <section
    className={`chat-panel conversation-panel${panel ? " with-panel" : ""}${hasMessages ? " has-messages" : " is-empty"}${archive ? " is-archive" : ""}`}
    aria-labelledby="chat-title"
  >
    <div className="chat-history-area">
      <header className="chat-topbar">
        <div className="chat-heading">
          {archive ? (
            <>
              <h1 id="chat-title" className="chat-archive-title">
                {thread.document?.conversation.title || "Historial anterior"}
              </h1>
              <p className="chat-archive-subtitle">
                Archivo de sólo lectura. Sus mensajes no se incorporan al chat activo.
              </p>
            </>
          ) : hasMessages ? (
            <h1 id="chat-title" className="chat-context-label">
              <span className="chat-school-dot" style={{ background: activeSchool.color }} aria-hidden="true" />
              <span>{activeSchool.shortName} · {activeSchool.grade}</span>
            </h1>
          ) : (
            <span className="chat-topbar-spacer" aria-hidden="true" />
          )}
        </div>
        <div className="chat-toolbar">
          {archive ? (
            <button type="button" className="chat-ghost-btn" onClick={() => controller.navigate("home")}>
              Volver al chat activo
            </button>
          ) : (
            <>
              {!useAgentChat && (
                <button type="button" className="chat-ghost-btn" onClick={() => controller.navigate("conversations")}>
                  Consultar archivo anterior
                </button>
              )}
              <div className="chat-overflow" ref={overflowRef}>
                <button
                  ref={overflowTriggerRef}
                  type="button"
                  className={`chat-overflow-trigger${overflowOpen ? " open" : ""}`}
                  aria-label="Opciones del chat"
                  aria-haspopup="menu"
                  aria-expanded={overflowOpen}
                  onClick={() => setOverflowOpen((prev) => !prev)}
                >
                  <UiIcon name="more-horizontal" size={17} />
                </button>
                {overflowOpen && (
                  <div className="chat-overflow-menu" role="menu" aria-label="Opciones del chat">
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!canClearContext}
                      onClick={() => {
                        setOverflowOpen(false);
                        if (useAgentChat) {
                          void controller.agentChat.updateContext(activeTarget, true);
                        } else {
                          void controller.chat.updateContext(true);
                        }
                      }}
                    >
                      <UiIcon name="trash" size={15} />
                      <span>Limpiar chat</span>
                    </button>
                    {(useAgentChat || state.activeId) && (
                      <button
                        type="button"
                        role="menuitem"
                        disabled={busy}
                        onClick={() => {
                          setOverflowOpen(false);
                          if (useAgentChat) {
                            void controller.agentChat.openChannel(activeTarget.channelKey, true);
                          } else {
                            void controller.chat.refresh();
                          }
                        }}
                      >
                        <UiIcon name="refresh" size={15} />
                        <span>Actualizar historial</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </header>

      {!archive && !hasMessages && (
        <div className="chat-greeting-block">
          <p className="chat-greeting-context">
            {activeSchool.shortName} · {activeSchool.grade}
          </p>
          <h1 id="chat-title" className="chat-greeting-title">
            ¿Qué preparamos hoy?
          </h1>
        </div>
      )}

      {showAgentContextRevision && agentThread.channel && (
        <p className="chat-note chat-context-meta">
          Contexto de {activeSchool.shortName} · revisión {agentThread.channel.context_revision}.
          {agentThread.channel.context_notes ? " Usa tus notas guardadas y " : " Usa "}
          los turnos posteriores al {agentThread.channel.through_turn}.
        </p>
      )}
      {showLegacyContextRevision && thread.document && (
        <p className="chat-note chat-context-meta">
          Contexto activo · revisión {thread.document.context.revision}. Usa {thread.document.context.notes ? "notas manuales y " : ""}los turnos confirmados posteriores al {thread.document.context.through_turn}. El historial anterior permanece guardado.
        </p>
      )}
      {activeStatus === "loading" && <p role="status" className="chat-whisper-status">Recuperando historial…</p>}
      {!useAgentChat && thread.document?.next_cursor && (
        <button type="button" className="chat-ghost-btn chat-load-more" disabled={busy} onClick={() => void controller.chat.refresh(state.activeId, true)}>
          Ver mensajes anteriores
        </button>
      )}

      <ol className="chat-turns" aria-label="Historial de la conversación">
        {useAgentChat
          ? agentTurns.map((turn, idx) => {
              const isArchivedTurn = throughTurn > 0 && turn.number <= throughTurn;
              const detectedSubjectLabel = resolveDetectedSubjectLabel(
                turn.delegated_subject_id,
                activeSchool,
              );
              return <Fragment key={turn.operation_id}>
                <li className={`chat-turn${isArchivedTurn ? " is-archived" : ""}`}>
                  <article className="chat-message chat-user" aria-label={`Tu mensaje ${turn.number}`}>
                    <h2 className="sr-only">Tú</h2>
                    <p>{turn.user_text}</p>
                  </article>
                  <article className="chat-message chat-assistant" aria-label={`Respuesta ${turn.number}`}>
                    <h2 className="chat-assistant-head">
                      <span className="luna-dot" aria-hidden="true" />
                      <span>Luna</span>
                      {detectedSubjectLabel && (
                        <span className="chat-subject-pill">{detectedSubjectLabel}</span>
                      )}
                    </h2>
                    {turn.state === "succeeded" ? (
                      <p>{turn.assistant_text}</p>
                    ) : (
                      <p>Este intento no pudo completarse. Puedes volver a intentarlo.</p>
                    )}
                    <div className="chat-turn-meta">
                      <p className="chat-note">Contexto · revisión {turn.context_revision}</p>
                      <AgentUsageDetails turn={turn} />
                    </div>
                  </article>
                </li>
                {idx === lastArchivedIdx && (
                  <li className="chat-archive-divider" role="separator" aria-label="Conversación anterior archivada">
                    <span>Conversación anterior · archivada</span>
                  </li>
                )}
              </Fragment>;
            })
          : legacyTurns.map((turn, idx) => {
              const isArchivedTurn = throughTurn > 0 && turn.number <= throughTurn;
              return <Fragment key={turn.operation_id}>
                <li className={`chat-turn${isArchivedTurn ? " is-archived" : ""}`}>
                  <article className="chat-message chat-user" aria-label={`Tu mensaje ${turn.number}`}>
                    <h2 className="sr-only">Tú</h2>
                    <p>{turn.user_text}</p>
                  </article>
                  <article className="chat-message chat-assistant" aria-label={`Respuesta ${turn.number}`}>
                    <h2 className="chat-assistant-head">
                      <span className="luna-dot" aria-hidden="true" />
                      <span>Luna</span>
                    </h2>
                    {turn.state === "succeeded" ? <p>{turn.assistant_text}</p> :
                      <p>{turn.state === "failed" ? "Este intento falló. No hay respuesta confirmada." : turn.state === "generating" ? "Respuesta en proceso; consulta su estado." : "Resultado incierto; consulta su estado antes de enviar otro mensaje."}</p>}
                    <div className="chat-turn-meta">
                      <p className="chat-note">Contexto usado · revisión {turn.context_revision}</p>
                      <ChatUsageDetails usage={turn.usage} />
                    </div>
                  </article>
                </li>
                {idx === lastArchivedIdx && (
                  <li className="chat-archive-divider" role="separator" aria-label="Conversación anterior archivada">
                    <span>Conversación anterior · archivada</span>
                  </li>
                )}
              </Fragment>;
            })}
      </ol>

      <div role="status" aria-live="polite" className="chat-status">
        {activeStatus === "sending"
          ? "Luna está respondiendo…"
          : useAgentChat
            ? agentThread.contextNotice
            : (thread.contextNotice ||
              (thread.document?.turns.at(-1)?.state === "succeeded" ? "Respuesta confirmada. Puedes continuar la conversación." : ""))}
      </div>
      {(useAgentChat ? agentThread.error : thread.error) && (
        <p role="alert" className="chat-error">{useAgentChat ? agentThread.error : thread.error}</p>
      )}
      {!useAgentChat && !state.activeLoaded && !busy && !archive && (
        <button type="button" className="chat-ghost-btn" onClick={() => void controller.chat.openActive()}>
          Recuperar chat activo
        </button>
      )}
      {!useAgentChat && thread.needsRefresh && <p role="status" className="chat-whisper-status">Actualiza el historial y revisa el contexto antes de continuar.</p>}
      {!useAgentChat && thread.pending && (
        <button type="button" className="primary chat-recover-btn" disabled={busy} onClick={() => void controller.chat.recover()}>
          {thread.pending.kind === "context" ? "Consultar estado del cambio de contexto" : "Consultar estado del envío"}
        </button>
      )}
    </div>
    {panel}
    {!archive && <div className="chat-compose-area">
      <div className="chat-composer-shell" ref={plusRef}>
        {plusOpen && (
          <div className="chat-plus-popover" role="menu" aria-label="Acciones rápidas">
            <div className="chat-popover-title">Acciones del espacio</div>
            <button
              type="button"
              role="menuitem"
              className="chat-popover-item"
              onClick={() => {
                setPlusOpen(false);
                onContext();
              }}
            >
              <UiIcon name="users" size={16} />
              <span>Contexto de mi grupo</span>
              <span className="chat-popover-hint">{activeSchool.grade}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="chat-popover-item"
              onClick={() => {
                setPlusOpen(false);
                onPlan();
              }}
            >
              <UiIcon name="document" size={16} />
              <span>Planear clase</span>
              <span className="chat-popover-hint">NEM</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="chat-popover-item"
              onClick={() => {
                setPlusOpen(false);
                controller.navigate("annexes");
              }}
            >
              <UiIcon name="worksheet" size={16} />
              <span>Ir a Anexos</span>
              <span className="chat-popover-hint">Carta</span>
            </button>
          </div>
        )}
        <form
          className={`chat-composer${isMultiline ? " is-multiline" : ""}`}
          onSubmit={event => { event.preventDefault(); submitMessage(); }}
        >
          <label className="sr-only" htmlFor="chat-message">Mensaje para Luna</label>
          <textarea
            id="chat-message"
            className="chat-composer-input"
            ref={input}
            rows={1}
            value={activeDraft}
            disabled={useAgentChat ? agentThread.status === "sending" : !!thread.pending}
            placeholder={placeholderText}
            aria-describedby="chat-input-hint"
            onChange={event => {
              if (useAgentChat) {
                controller.agentChat.setDraft(activeTarget.channelKey, event.target.value);
              } else {
                controller.chat.setDraft(event.target.value);
              }
            }}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (canSubmit) submitMessage();
              }
            }}
          />
          <p id="chat-input-hint" className="sr-only">
            Hasta 4096 caracteres y 8192 bytes · Enter o Ctrl/⌘ + Enter para enviar
          </p>
          <div className="chat-composer-left">
            <button
              ref={plusTriggerRef}
              type="button"
              className={`chat-composer-icon-btn${plusOpen ? " open" : ""}`}
              aria-label="Más opciones"
              aria-haspopup="menu"
              aria-expanded={plusOpen}
              title="Más opciones"
              onClick={() => setPlusOpen((prev) => !prev)}
            >
              <UiIcon name="plus" size={17} />
            </button>
          </div>
          <div className="chat-composer-right">
            <button
              type="submit"
              className="chat-send-btn"
              aria-label="Enviar mensaje"
              title="Enviar mensaje"
              disabled={!canSubmit}
            >
              <UiIcon name="arrow-up" size={17} />
              <span className="sr-only">Enviar mensaje</span>
            </button>
          </div>
        </form>
      </div>
      {!useAgentChat && agentState.availability !== "loading" && state.availability === "unavailable" && <div className="chat-availability">
        <p role="status">El chat no está disponible en este momento. Tu texto permanece en esta pestaña.</p>
        <button type="button" className="chat-ghost-btn" onClick={() => { void controller.chat.loadAvailability(); void controller.agentChat.loadAvailability(); }}>Comprobar disponibilidad</button>
      </div>}
      {!useAgentChat && (state.availability === "loading" || agentState.availability === "loading") && <p role="status" className="chat-whisper-status">Comprobando disponibilidad del chat…</p>}
      <nav className="chat-shortcuts" aria-label="Accesos del chat">
        <button
          type="button"
          className="chat-shortcut-pill"
          data-navigation-focus="shortcut-context"
          aria-controls="workspace-panel"
          aria-expanded={panelView === "chat-context"}
          onClick={onContext}
        >
          Revisar contexto
        </button>
        <button
          type="button"
          className="chat-shortcut-pill"
          data-navigation-focus="shortcut-planning"
          aria-controls="workspace-panel"
          aria-expanded={panelView === "tools"}
          onClick={onPlan}
        >
          <UiIcon name="document" size={14} />
          <span>Planear</span>
        </button>
      </nav>
    </div>}
  </section>;
}

export function Conversations({controller}: {controller: AcentaController}) {
  const state = useSyncExternalStore(controller.chat.subscribe, controller.chat.snapshot);
  useEffect(() => { void controller.chat.list(); }, [controller]);
  const archived = state.items.filter(item => !item.active);
  return <section className="chat-panel">
    <h1>Archivo anterior</h1>
    <p>Se continúa el chat más recientemente actualizado al habilitar el chat único; en caso de empate, se usa su identificador. Las demás conversaciones se conservan aquí, sin mezclar su contenido y sólo para consulta.</p>
    <div className="chat-toolbar">
      <button onClick={() => controller.navigate("home")}>Volver al chat activo</button>
      <button disabled={state.listStatus === "loading"} onClick={() => void controller.chat.list()}>Actualizar archivo</button>
    </div>
    {state.listStatus === "loading" && <p role="status">Recuperando archivo…</p>}
    {state.listError && <p role="alert">{state.listError}</p>}
    {state.listStatus === "ready" && !archived.length && <p>{state.cursor ? "No hay historiales anteriores en esta página." : "No hay historiales anteriores guardados."}</p>}
    <ul className="chat-list">
      {archived.map(item => <li key={item.id}>
        <h2>{item.title || "Historial anterior"}</h2>
        <p>{item.version} intentos · <time dateTime={item.updated_at}>{new Date(item.updated_at).toLocaleString("es-MX")}</time></p>
        <button data-navigation-focus={`chat-${item.id}`} onClick={() => controller.openChat(item.id)}>Consultar historial anterior</button>
      </li>)}
    </ul>
    {state.cursor && <button disabled={state.listStatus === "loading"} onClick={() => void controller.chat.list(true)}>Ver más del archivo</button>}
  </section>;
}
