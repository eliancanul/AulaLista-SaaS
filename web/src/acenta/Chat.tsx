import { useEffect, useRef, useSyncExternalStore } from "react";
import type { AcentaController } from "./controller";
import type { ChatUsage } from "./chat-contracts";
import { Icon, Logo } from "./ui";
import "./chat.css";

export function ChatExitGuard({controller, onReview, onExit}: {
  controller: AcentaController; onReview: () => void; onExit: () => void;
}) {
  const pending = controller.chat.hasPending();
  return <section className="exit-guard">
    <h2>¿Salir con mensajes pendientes?</h2>
    <p>El texto sin enviar sólo está en esta pestaña. El historial confirmado permanece en tu cuenta.</p>
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
export function Chat({controller, onExample, onTools}: {
  controller: AcentaController; onExample: () => void; onTools: () => void;
}) {
  const state = useSyncExternalStore(controller.chat.subscribe, controller.chat.snapshot);
  const thread = controller.chat.current();
  const input = useRef<HTMLTextAreaElement>(null);
  const previous = useRef(thread.status);
  useEffect(() => { void controller.chat.loadAvailability(); }, [controller]);
  useEffect(() => {
    if (previous.current === "sending" && thread.status !== "sending") input.current?.focus();
    previous.current = thread.status;
  }, [thread.status]);
  const busy = thread.status === "sending" || thread.status === "loading";
  const title = thread.document?.conversation.title || "¿Qué trabajamos hoy?";
  return <section className="chat-panel" aria-labelledby="chat-title">
    <header className="chat-heading">
      {!state.activeId && <Logo />}
      <h1 id="chat-title">{title}</h1>
      <p>Conversación privada · El historial confirmado se conserva en tu cuenta.</p>
    </header>
    <div className="chat-toolbar">
      {state.activeId && <button disabled={busy} onClick={() => void controller.chat.refresh()}>Actualizar historial</button>}
      <button onClick={() => controller.navigate("conversations")}>Ver conversaciones</button>
    </div>
    {thread.status === "loading" && <p role="status">Recuperando historial…</p>}
    <ol className="chat-turns" aria-label="Historial de la conversación">
      {thread.document?.turns.map(turn => <li key={turn.operation_id} className="chat-turn">
        <article className="chat-message chat-user" aria-label={`Tu mensaje ${turn.number}`}>
          <h2>Tú</h2><p>{turn.user_text}</p>
        </article>
        <article className="chat-message chat-assistant" aria-label={`Respuesta ${turn.number}`}>
          <h2>Luna</h2>
          {turn.state === "succeeded" ? <p>{turn.assistant_text}</p> :
            <p>{turn.state === "failed" ? "Este intento falló. No hay respuesta confirmada." : turn.state === "generating" ? "Respuesta en proceso; consulta su estado." : "Resultado incierto; consulta su estado antes de enviar otro mensaje."}</p>}
          <ChatUsageDetails usage={turn.usage} />
        </article>
      </li>)}
    </ol>
    <div role="status" aria-live="polite" className="chat-status">
      {thread.status === "sending" ? "Consultando el servidor…" :
        thread.document?.turns.at(-1)?.state === "succeeded" ? "Respuesta confirmada. Puedes continuar la conversación." : ""}
    </div>
    {thread.error && <p role="alert" className="chat-error">{thread.error}</p>}
    {thread.pending && <button className="primary" disabled={busy} onClick={() => void controller.chat.recover()}>Consultar estado del envío</button>}
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
        <button type="submit" className="primary" disabled={busy || !!thread.pending || thread.needsRefresh || !thread.draft.trim() || state.availability !== "available"}>
          <Icon name="send" small /> Enviar mensaje
        </button>
      </div>
    </form>
    {state.availability === "unavailable" && <div className="chat-availability">
      <p role="status">El chat no está disponible en este momento. Tu texto permanece en esta pestaña.</p>
      <button onClick={() => void controller.chat.loadAvailability()}>Comprobar disponibilidad</button>
    </div>}
    {state.availability === "loading" && <p role="status">Comprobando disponibilidad del chat…</p>}
    <p className="chat-note">El servidor usa los turnos confirmados de esta conversación como contexto. Consultar el historial no inicia una generación. El texto sin enviar sólo permanece en esta pestaña mientras tu sesión siga válida.</p>
    <div className="tool-tray">
      <button onClick={() => controller.navigate("planning")}><Icon name="document" small />Crear planeación</button>
      <button onClick={onExample}>Ajustar planeación</button>
      <button onClick={() => controller.navigate("resources")}><Icon name="folder-small" small />Mis recursos</button>
      <button onClick={onTools}>Más herramientas ⌄</button>
    </div>
  </section>;
}
export function Conversations({controller}: {controller: AcentaController}) {
  const state = useSyncExternalStore(controller.chat.subscribe, controller.chat.snapshot);
  useEffect(() => { void controller.chat.list(); }, [controller]);
  const pending = controller.chat.pendingDrafts();
  return <section className="chat-panel">
    <h1>Conversaciones</h1>
    <p>Historial privado de esta cuenta. Abrir una conversación no genera otro turno.</p>
    <div className="chat-toolbar">
      <button onClick={() => controller.navigate("home")}>Nueva conversación</button>
      <button disabled={state.listStatus === "loading"} onClick={() => void controller.chat.list()}>Actualizar conversaciones</button>
    </div>
    {!!pending.length && <section className="chat-drafts" aria-label="Texto pendiente en esta pestaña">
      <h2>Texto pendiente en esta pestaña</h2>
      {pending.map(item => <button key={item.id ?? "new"} onClick={() => item.id ? controller.openChat(item.id) : controller.navigate("home")}>{item.title} · Retomar</button>)}
    </section>}
    {state.listStatus === "loading" && <p role="status">Recuperando conversaciones…</p>}
    {state.listError && <p role="alert">{state.listError}</p>}
    {state.listStatus === "ready" && !state.items.length && <p>Aún no tienes conversaciones guardadas.</p>}
    <ul className="chat-list">
      {state.items.map(item => <li key={item.id}>
        <h2>{item.title || "Nueva conversación"}</h2>
        <p>{item.version} intentos · <time dateTime={item.updated_at}>{new Date(item.updated_at).toLocaleString("es-MX")}</time></p>
        <button data-navigation-focus={`chat-${item.id}`} onClick={() => controller.openChat(item.id)}>Abrir conversación</button>
      </li>)}
    </ul>
    {state.cursor && <button disabled={state.listStatus === "loading"} onClick={() => void controller.chat.list(true)}>Ver más conversaciones</button>}
  </section>;
}
