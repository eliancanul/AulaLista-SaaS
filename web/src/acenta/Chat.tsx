import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { AcentaController, PanelView } from "./controller";
import type { ChatUsage } from "./chat-contracts";
import { Icon, Logo } from "./ui";
import "./chat.css";

export function ChatExitGuard({controller, onReview, onExit}: {
  controller: AcentaController; onReview: () => void; onExit: () => void;
}) {
  const pending = controller.chat.hasPending();
  return <section className="exit-guard">
    <h2>¿Salir con mensajes pendientes?</h2>
    <p>El mensaje y los cambios de contexto sin guardar sólo están en esta pestaña. El historial confirmado permanece en tu cuenta.</p>
    {pending && <p>Hay un envío sin confirmar. Al cerrar sesión perderás el texto y el estado local de este intento. Cerrar sesión no cancela el procesamiento ni elimina los registros o reservas del servidor.</p>}
    <div className="actions">
      <button autoFocus onClick={onReview}>Revisar mensajes pendientes</button>
      {pending
        ? <button onClick={onExit}>Continuar cierre de sesión sin confirmar el envío</button>
        : <button onClick={() => { if (controller.chat.discardDrafts()) onExit(); }}>Descartar mensajes sin enviar y continuar salida</button>}
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
export function ChatContextEditor({controller}: {controller: AcentaController}) {
  useSyncExternalStore(controller.chat.subscribe, controller.chat.snapshot);
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
  const thread = controller.chat.current();
  const archive = controller.chat.isArchive();
  const input = useRef<HTMLTextAreaElement>(null);
  const previous = useRef(thread.status);
  useEffect(() => { void controller.chat.loadAvailability(); if (!state.activeId) void controller.chat.openActive(); }, [controller]);
  useEffect(() => {
    // Completion may happen after the teacher moves to a panel or a modal.
    // Return focus only while it still belongs to this composer.
    if (previous.current === "sending" && thread.status !== "sending" && !panelView &&
      input.current?.closest("form")?.contains(document.activeElement) && !document.querySelector("dialog[open]")) input.current.focus();
    previous.current = thread.status;
  }, [thread.status, panelView]);
  const busy = thread.status === "sending" || thread.status === "loading";
  return <section className={`chat-panel conversation-panel ${panel ? "with-panel" : ""}`} aria-labelledby="chat-title">
    <div className="chat-history-area">
    <header className="chat-heading">
      <Logo />
      <h1 id="chat-title">{archive ? thread.document?.conversation.title || "Historial anterior" : "Tu chat con Luna"}</h1>
      <p>{archive ? "Archivo de sólo lectura. Sus mensajes no se incorporan al chat activo." : "Un espacio continuo y privado. El historial confirmado se conserva en tu cuenta."}</p>
    </header>
    <div className="chat-toolbar">
      {state.activeId && <button disabled={busy} onClick={() => void controller.chat.refresh()}>Actualizar historial</button>}
      {archive ? <button onClick={() => controller.navigate("home")}>Volver al chat activo</button> : <>
        <button onClick={() => controller.navigate("conversations")}>Consultar archivo anterior</button>
      </>}
    </div>
    {!archive && thread.document && <p className="chat-note">Contexto activo · revisión {thread.document.context.revision}. Usa {thread.document.context.notes ? "notas manuales y " : ""}los turnos confirmados posteriores al {thread.document.context.through_turn}. El historial anterior permanece guardado.</p>}
    {thread.status === "loading" && <p role="status">Recuperando historial…</p>}
    {thread.document?.next_cursor && <button disabled={busy} onClick={() => void controller.chat.refresh(state.activeId, true)}>Ver mensajes anteriores</button>}
    <ol className="chat-turns" aria-label="Historial de la conversación">
      {thread.document?.turns.map(turn => <li key={turn.operation_id} className="chat-turn">
        <article className="chat-message chat-user" aria-label={`Tu mensaje ${turn.number}`}>
          <h2>Tú</h2><p>{turn.user_text}</p>
        </article>
        <article className="chat-message chat-assistant" aria-label={`Respuesta ${turn.number}`}>
          <h2>Luna</h2>
          {turn.state === "succeeded" ? <p>{turn.assistant_text}</p> :
            <p>{turn.state === "failed" ? "Este intento falló. No hay respuesta confirmada." : turn.state === "generating" ? "Respuesta en proceso; consulta su estado." : "Resultado incierto; consulta su estado antes de enviar otro mensaje."}</p>}
          <p className="chat-note">Contexto usado · revisión {turn.context_revision}</p>
          <ChatUsageDetails usage={turn.usage} />
        </article>
      </li>)}
    </ol>
    <div role="status" aria-live="polite" className="chat-status">
      {thread.status === "sending" ? "Consultando el servidor…" : thread.contextNotice ||
        (thread.document?.turns.at(-1)?.state === "succeeded" ? "Respuesta confirmada. Puedes continuar la conversación." : "")}
    </div>
    {thread.error && <p role="alert" className="chat-error">{thread.error}</p>}
    {!state.activeLoaded && !busy && !archive && <button onClick={() => void controller.chat.openActive()}>Recuperar chat activo</button>}
    {thread.needsRefresh && <p role="status">Actualiza el historial y revisa el contexto antes de continuar.</p>}
    {thread.pending && <button className="primary" disabled={busy} onClick={() => void controller.chat.recover()}>{thread.pending.kind === "context" ? "Consultar estado del cambio de contexto" : "Consultar estado del envío"}</button>}
    </div>
    {panel}
    {!archive && <div className="chat-compose-area">
      <form className="chat-composer" onSubmit={event => { event.preventDefault(); void controller.chat.submit(); }}>
        <label htmlFor="chat-message">Mensaje para Luna</label>
        <textarea id="chat-message" ref={input} value={thread.draft} disabled={!!thread.pending}
          placeholder="Cuéntame qué necesitas para tu clase…" aria-describedby="chat-input-hint"
          onChange={event => controller.chat.setDraft(event.target.value)}
          onKeyDown={event => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault(); void controller.chat.submit();
            }
          }} />
        <div className="chat-composer-actions">
          <p id="chat-input-hint">Hasta 4096 caracteres y 8192 bytes · Ctrl/⌘ + Enter</p>
          <button type="submit" className="primary" disabled={busy || !!thread.pending || thread.needsRefresh || !state.activeLoaded || !thread.draft.trim() || state.availability !== "available"}>
            <Icon name="send" small /> Enviar mensaje
          </button>
        </div>
      </form>
      {state.availability === "unavailable" && <div className="chat-availability">
        <p role="status">El chat no está disponible en este momento. Tu texto permanece en esta pestaña.</p>
        <button onClick={() => void controller.chat.loadAvailability()}>Comprobar disponibilidad</button>
      </div>}
      {state.availability === "loading" && <p role="status">Comprobando disponibilidad del chat…</p>}
      <p className="chat-note">Consultar el historial o guardar contexto no inicia una generación. Los textos sin guardar sólo permanecen en esta pestaña mientras tu sesión siga válida.</p>
      <nav className="chat-shortcuts" aria-label="Accesos del chat">
        <button data-navigation-focus="shortcut-context" aria-controls="workspace-panel" aria-expanded={panelView === "chat-context"} onClick={onContext}>Revisar contexto</button>
        <button data-navigation-focus="shortcut-planning" aria-controls="workspace-panel" aria-expanded={panelView === "tools"} onClick={onPlan}><Icon name="document" small />Planear</button>
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
