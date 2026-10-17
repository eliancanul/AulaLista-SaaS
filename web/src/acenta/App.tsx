import { AuthController } from "./auth";
import { AuthAccessView } from "./AuthView";
import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import {
  AcentaController,
  editableResource,
  type EditorState,
} from "./controller";
import {
  waterContext,
  waterSource,
  sourceSamples,
  knownSourceSample,
  type PlanningDocument,
  type Resource,
} from "./contracts";
import { AcentaNavigation, type NavigationPosition } from "./navigation";
import { toolsMenuPosition, toolsMenuScroll } from "./tools-menu";
const asset = (name: string) => `/acenta/${name}`;
function Icon({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <img
      className={small ? "icon small" : "icon"}
      src={asset(`${name}.svg`)}
      alt=""
    />
  );
}
function Logo({ large = false }: { large?: boolean }) {
  return (
    <img
      className={large ? "logo large" : "logo"}
      src={asset("acenta-logo-reconstruido-tinta.svg")}
      alt="Acenta"
    />
  );
}
function Dialog({
  children,
  title,
  onClose,
  className = "",
  anchor,
}: {
  children: ReactNode;
  title: string;
  onClose: () => void;
  className?: string;
  anchor?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    let space: HTMLDivElement | null = null;
    const position = () => {
      if (anchor?.current) {
        const scroll = toolsMenuScroll(
          anchor.current.getBoundingClientRect(),
          window.innerHeight,
        );
        if (scroll > 0 && !space) {
          // Give the page enough scroll range without moving the menu above its trigger.
          space = document.createElement("div");
          space.className = "tools-menu-space";
          space.setAttribute("aria-hidden", "true");
          document.body.append(space);
        }
        if (scroll) window.scrollBy({ top: scroll, behavior: "instant" });
        Object.assign(
          dialog.style,
          toolsMenuPosition(anchor.current.getBoundingClientRect(), {
            width: window.innerWidth,
            height: window.innerHeight,
          }),
        );
      }
    };
    position();
    const observer = anchor ? new ResizeObserver(position) : null;
    if (anchor) {
      window.addEventListener("resize", position);
      window.addEventListener("scroll", position, true);
      if (anchor.current) {
        observer!.observe(anchor.current);
        if (anchor.current.parentElement)
          observer!.observe(anchor.current.parentElement);
        const composer = anchor.current
          .closest(".composer-stack")
          ?.querySelector(".composer");
        if (composer) observer!.observe(composer);
        // The centered composer can move without resizing while the rail animates.
        const panel = anchor.current.closest(".home-panel");
        if (panel) observer!.observe(panel);
      }
    }
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      observer?.disconnect();
      dialog.close();
      space?.remove();
      if (previous?.isConnected) previous.focus();
    };
  }, [anchor]);
  return (
    <dialog
      ref={ref}
      className={className}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const bounds = e.currentTarget.getBoundingClientRect();
        if (
          !anchor ||
          e.clientX < bounds.left ||
          e.clientX > bounds.right ||
          e.clientY < bounds.top ||
          e.clientY > bounds.bottom
        )
          onClose();
      }}
    >
      {children}
    </dialog>
  );
}
export function AccessView() {
  const [auth] = useState(() => new AuthController());
  useEffect(() => { void auth.start(); }, [auth]);
  return <AuthAccessView auth={auth} />;
}
function AccountLinks() {
  return (
    <nav className="account-links" aria-label="Cuenta">
      <span>Mi plan</span>
      <span>Avisos</span>
      <span>Uso</span>
      <span>Mi cuenta</span>
    </nav>
  );
}
const toolCatalog: Record<string, string[]> = {
  Planear: ["Planeación de clase", "Proyecto de aula"],
  Materiales: [
    "Hoja de actividades",
    "Preguntas sobre un texto",
    "Adaptar material",
    "Tarjetas de repaso",
  ],
  Evaluar: ["Diagnóstico breve", "Rúbrica y lista de cotejo"],
  "Juegos y repaso": [
    "Bingo temático",
    "Memorama",
    "Sopa de letras",
    "Adivina con pistas",
    "Quiz para proyectar",
  ],
};
function ResultView({
  document,
  onOpen,
  onOriginal,
}: {
  onOriginal: () => void;
  document: PlanningDocument;
  onOpen: (key: string) => void;
}) {
  const r = document.result;
  const initial =
    document.initial_request ??
    ("prompt" in document.request ? document.request : null);
  const total = r.activities.reduce((n, a) => n + a.minutes, 0);
  const before = r.activities.reduce(
    (n, a) => n + (a.previous_minutes ?? 0),
    0,
  );
  return (
    <>
      <h1>{r.title}</h1>
      {r.context && (
        <p className="context-line">
          Contexto de esta conversación: {r.context.level} · {r.context.group} ·{" "}
          {r.context.subject} · {total} min
        </p>
      )}
      <div className="result-columns">
        <section className="conversation-card">
          {initial && (
            <>
              <p className="secondary">Tú</p>
              <p className="request-text">{initial.prompt}</p>
            </>
          )}
          <p className="response-label">Luna · Respuesta de demostración</p>
          <p>El ejemplo conserva los materiales y ajusta solo la duración.</p>
          <table>
            <thead>
              <tr>
                <th>Momento</th>
                {before > 0 && <th>Antes</th>}
                <th>Ahora</th>
              </tr>
            </thead>
            <tbody>
              {r.activities.map((a, i) => (
                <tr key={a.key ?? i}>
                  <td>{a.title ?? a.statement}</td>
                  {before > 0 && <td>{a.previous_minutes ?? "—"} min</td>}
                  <td>{a.minutes} min</td>
                </tr>
              ))}
              <tr>
                <td>Total</td>
                {before > 0 && <td>{before} min</td>}
                <td>{total} min</td>
              </tr>
            </tbody>
          </table>
          <p className="field-hint">
            Fuente de ejemplo · Versión {document.receipt.source_version}. El
            original no cambia.
          </p>
          <button onClick={onOriginal}>Abrir original del resultado</button>
        </section>
        <div className="resource-cards">
          {r.resources?.map((resource) => (
            <section className="result-card" key={resource.key}>
              <h2>{resource.title}</h2>
              <p className="secondary">Hoja del alumnado · Copia de trabajo</p>
              <p>
                {resource.elements.find((e) => e.kind === "statement")?.text}
              </p>
              <p className="field-hint">
                Revisión {document.receipt.revision} guardada.
              </p>
              <button className="primary" onClick={() => onOpen(resource.key)}>
                Abrir resultado editable
              </button>
            </section>
          ))}
        </div>
      </div>
      <p className="synthetic-notice">{r.notice}</p>
    </>
  );
}
function Preview({
  resource,
  document,
  text,
  elementKey,
}: {
  resource: Resource;
  document: PlanningDocument;
  text: string;
  elementKey: string;
}) {
  return (
    <article className="sheet">
      <h2>{resource.title}</h2>
      <p className="sheet-subtitle">
        {document.result.title} · Hoja del alumnado
      </p>
      <p className="activity-label">ACTIVIDAD 1</p>
      {resource.elements.map((e) => (
        <React.Fragment key={e.key}>
          <p className={e.kind === "statement" ? "sheet-instruction" : ""}>
            {e.key === elementKey ? text : e.text}
          </p>
          {e.kind === "question" && (
            <div
              className="answer-space"
              aria-label={`Espacio para responder, ${e.lines ?? 0} líneas`}
            />
          )}
        </React.Fragment>
      ))}
      <p className="sheet-note">Sin respuestas · El original se conserva</p>
    </article>
  );
}
function Editor({
  controller,
  onDismiss,
}: {
  controller: AcentaController;
  onDismiss: () => void;
}) {
  const s = useSyncExternalStore(controller.subscribe, controller.snapshot),
    e = s.editor!;
  const [guard, setGuard] = useState(false);
  const resource = editableResource(e.document, e.resourceKey)!;
  const guardRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (guard) guardRef.current?.focus();
  }, [guard]);
  const close = () => {
    if (controller.closeEditor()) onDismiss();
    else setGuard(true);
  };
  const saveText: Record<EditorState["save"], string> = {
    clean: e.draftSaved ? "Borrador privado conservado" : "Sin cambios",
    dirty: "Cambios sin guardar",
    saving: "Guardando…",
    saved: "Guardado confirmado",
    error: "Cambios pendientes",
    unknown: "Guardado sin confirmar",
    conflict: "Conflicto de versión",
  };
  return (
    <Dialog title="Editar actividad" className="editor-dialog" onClose={close}>
      {guard ? (
        <section className="exit-guard">
          <h2>¿Salir con cambios?</h2>
          <p>
            Conserva una copia de trabajo privada para recuperar el texto sin
            cambiar la revisión guardada.
          </p>
          {e.error && <p role="alert">{e.error}</p>}
          <div className="actions">
            <button ref={guardRef} onClick={() => setGuard(false)}>
              Seguir editando
            </button>
            <button
              className="primary"
              disabled={e.save === "saving"}
              onClick={async () => {
                await controller.preserveDraft();
                if (controller.closeEditor()) onDismiss();
              }}
            >
              Conservar borrador
            </button>
            {e.pending && (
              <button onClick={() => void controller.recoverEditor()}>
                Comprobar estado
              </button>
            )}
          </div>
          <p className="field-hint">
            Si falla, el texto sigue pendiente en este navegador y esta cuenta.
            No se promete recuperación en otro dispositivo.
          </p>
        </section>
      ) : (
        <>
          <header className="editor-header">
            <h2>Editar actividad</h2>
            <button onClick={close}>Cerrar</button>
          </header>
          <div className="editor-body">
            <section className="preview-column">
              <p className="preview-label">VISTA PREVIA · HOJA DEL ALUMNADO</p>
              <Preview
                resource={resource}
                document={e.document}
                text={e.text}
                elementKey={e.elementKey}
              />
            </section>
            <section className="elements-column">
              <h3>
                Elementos de la actividad · {resource.elements.length} elementos
              </h3>
              {resource.elements.map((element, index) => (
                <div className="element-card" key={element.key}>
                  <p className="field-hint">{index + 1}　Tipo · Solo lectura</p>
                  <div className="readonly-value">
                    {element.kind === "statement"
                      ? "Enunciado"
                      : "Pregunta con líneas"}{" "}
                    ⌄
                  </div>
                  <label htmlFor={`element-${element.key}`}>
                    {element.editable ? "Texto" : "Texto · Solo lectura"}
                  </label>
                  {element.editable ? (
                    <textarea
                      id={`element-${element.key}`}
                      value={e.text}
                      onChange={(event) => controller.edit(event.target.value)}
                      aria-describedby={e.error ? "editor-error" : undefined}
                      rows={2}
                    />
                  ) : (
                    <input
                      id={`element-${element.key}`}
                      readOnly
                      value={element.text}
                    />
                  )}{" "}
                  {element.lines !== undefined && (
                    <>
                      <label
                        htmlFor={`lines-${element.key}`}
                        className="secondary"
                      >
                        Líneas · Solo lectura
                      </label>
                      <input
                        id={`lines-${element.key}`}
                        className="line-count"
                        readOnly
                        value={element.lines}
                      />
                    </>
                  )}
                </div>
              ))}
              {(e.error || e.save === "unknown" || e.save === "conflict") && (
                <section
                  className="editor-recovery"
                  aria-label="Recuperar edición"
                >
                  <p id="editor-error" role="alert">
                    {e.error || "El guardado todavía no está confirmado."}
                  </p>
                  {e.save === "unknown" && (
                    <button onClick={() => void controller.recoverEditor()}>
                      Comprobar estado
                    </button>
                  )}
                  {e.save === "conflict" && (
                    <>
                      {e.latest && (
                        <p>
                          Texto guardado:{" "}
                          {
                            editableResource(
                              e.latest,
                              e.resourceKey,
                            )?.elements.find((x) => x.key === e.elementKey)
                              ?.text
                          }
                        </p>
                      )}
                      <p>
                        Tu texto permanece en el editor. El original y la
                        revisión vigente se conservan.
                      </p>
                      <button onClick={() => void controller.save(true)}>
                        Conservar copia
                      </button>
                    </>
                  )}
                  {e.save === "error" && (
                    <button onClick={() => void controller.save()}>
                      Reintentar guardado
                    </button>
                  )}
                </section>
              )}
            </section>
          </div>
          <footer className="editor-footer">
            <p role="status">{saveText[e.save]}</p>
            <div className="actions">
              <button
                disabled={!!e.pending || e.text === e.baseline}
                onClick={() => controller.undo()}
              >
                Deshacer
              </button>
              <button onClick={close}>Cancelar</button>
              <button
                className="primary"
                disabled={
                  e.save === "saving" ||
                  e.save === "conflict" ||
                  e.text === e.baseline
                }
                onClick={() => void controller.save()}
              >
                Guardar
              </button>
            </div>
          </footer>
        </>
      )}
    </Dialog>
  );
}
export function AcentaApp({
  controller, onLogout,
}: {
  controller: AcentaController | null;
  onLogout?: () => void;
}) {
  return controller ? <Workspace controller={controller} onLogout={onLogout} /> : <AccessView />;
}
function Workspace({ controller, onLogout }: { controller: AcentaController; onLogout?: () => void }) {
  const s = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [expanded, setExpanded] = useState(false);
  const [overlay, setOverlay] = useState<
    "context" | "attachment" | "tools" | null
  >(null);
  const [category, setCategory] = useState("Planear");
  const [showEditor, setShowEditor] = useState(!!s.editor);
  const input = useRef<HTMLTextAreaElement>(null);
  const toolsTrigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ value: NavigationPosition | null } | null>(null);
  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    const navigation = new AcentaNavigation(controller, window.history, () => ({
      x: window.scrollX, y: window.scrollY,
      focus: (document.activeElement as HTMLElement | null)?.dataset.navigationFocus ?? null,
    }), (value) => {
      setOverlay(null);
      setShowEditor(false);
      setPosition({ value });
    });
    const pop = (event: PopStateEvent) => navigation.restore(event.state);
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("popstate", pop);
      window.history.scrollRestoration = previous;
      navigation.dispose();
    };
  }, [controller]);
  useLayoutEffect(() => {
    if (!position) return;
    const frame = requestAnimationFrame(() => {
      const saved = position.value;
      const focus = saved?.focus ? Array.from(document.querySelectorAll<HTMLElement>("[data-navigation-focus]"))
        .find((node) => node.dataset.navigationFocus === saved.focus) : null;
      (focus ?? document.querySelector<HTMLElement>("main"))?.focus({ preventScroll: true });
      window.scrollTo(saved?.x ?? 0, saved?.y ?? 0);
    });
    return () => cancelAnimationFrame(frame);
  }, [position]);

  useEffect(() => {
    void controller.init();
  }, [controller]);
  useEffect(() => {
    const node = input.current;
    if (node) {
      node.style.height = "40px";
      node.style.height = `${Math.min(160, Math.max(40, node.scrollHeight))}px`;
    }
  }, [s.prompt, s.view]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      const state = controller.snapshot();
      if (
        state.pending ||
        state.sourcePending ||
        (state.editor &&
          (state.editor.pending ||
            (state.editor.text !== state.editor.baseline &&
              !state.editor.draftSaved)))
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [controller]);
  if (s.closed) return <AccessView />;
  const openEditor = (key?: string) => {
    controller.openEditor(s.result, key);
    if (controller.snapshot().editor) setShowEditor(true);
  };
  const actionExample = () => {
    controller.useExample();
    setOverlay(null);
    input.current?.focus();
  };
  const dismissAttachment = () => {
    controller.cancelAttachment();
    setOverlay(null);
  };
  return (
    <div className={`workspace ${expanded ? "expanded" : ""}`}>
      <aside className="sidebar">
        <div className="rail-spacer" />
        <button
          aria-label={expanded ? "Contraer menú" : "Expandir menú"}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <Icon name="expand" />
          {expanded && <span>Contraer menú</span>}
        </button>
        <button disabled aria-label="Nueva conversación, pendiente">
          <Icon name="plus" />
          {expanded && <span>Nueva conversación</span>}
        </button>
        <button
          className={s.view === "home" ? "selected" : ""}
          aria-label="Inicio"
          onClick={() => controller.navigate("home")}
        >
          <Icon name="home" />
          {expanded && <span>Inicio</span>}
        </button>
        <button disabled aria-label="Buscar, pendiente">
          <Icon name="search" />
          {expanded && <span>Buscar</span>}
        </button>
        <button
          className={s.view === "resources" ? "selected" : ""}
          aria-label="Mis recursos"
          onClick={() => controller.navigate("resources")}
        >
          <Icon name="folder" />
          {expanded && <span>Mis recursos</span>}
        </button>
        <button disabled aria-label="Conversaciones, pendiente">
          <Icon name="chat" />
          {expanded && <span>Conversaciones</span>}
        </button>
        <div className="rail-flex" />
        <button disabled aria-label="Ajustes, pendiente">
          <Icon name="settings" />
          {expanded && <span>Ajustes</span>}
        </button>
        <button
          aria-label="Cerrar sesión"
          onClick={() => onLogout ? onLogout() : controller.closeSession()}
        >
          <Icon name="chat" />
          {expanded && <span>Cerrar sesión</span>}
        </button>
      </aside>
      <main tabIndex={-1} className={s.view === "home" ? "home-main" : "content-main"}>
        <AccountLinks />
        {s.view === "home" ? (
          <section className="home-panel">
            <header className="home-heading">
              <Logo />
              <p>¡Hola!</p>
              <h1>¿Qué trabajamos hoy?</h1>
            </header>
            <div className="composer-stack">
              <form
                className="composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void controller.submit();
                }}
              >
                <label className="sr-only" htmlFor="request">
                  Petición para tu clase
                </label>
                <textarea
                  ref={input}
                  id="request"
                  value={s.prompt}
                  placeholder="Cuéntame qué necesitas para tu clase…"
                  onChange={(e) => controller.setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      (e.ctrlKey || e.metaKey) &&
                      e.key === "Enter" &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      void controller.submit();
                    }
                  }}
                />
                <div className="composer-controls">
                  <button type="button" onClick={() => setOverlay("context")}>
                    {waterContext.subject} ⌄
                  </button>
                  <button type="button" onClick={() => setOverlay("context")}>
                    {waterContext.level} · {waterContext.group} ⌄
                  </button>
                  <button
                    type="button"
                    onClick={() => setOverlay("attachment")}
                  >
                    {s.source ? "Referencia adjunta" : "Adjuntar referencia"}
                  </button>
                  <button
                    className="mic"
                    type="button"
                    disabled
                    aria-label="Micrófono no disponible"
                  >
                    <Icon name="microphone" small />
                  </button>
                  <button
                    className="send primary"
                    aria-label="Enviar petición"
                    type="submit"
                    disabled={
                      !s.prompt.trim() || !s.source || s.submit === "sending"
                    }
                  >
                    <Icon name="send" />
                  </button>
                </div>
                {s.source && (
                  <div className="attachment-line">
                    <span>
                      {s.sourceName} · Versión {s.source.number} ·{" "}
                      {s.source.size} bytes
                    </span>
                    <button
                      type="button"
                      onClick={() => void controller.openOriginal(s.source!)}
                    >
                      Abrir original
                    </button>
                    <button
                      type="button"
                      onClick={() => controller.removeSource()}
                    >
                      Quitar
                    </button>
                    <button
                      type="button"
                      className="text-action"
                      onClick={() => setOverlay("attachment")}
                    >
                      Reemplazar
                    </button>
                  </div>
                )}
              </form>
              <div className="tool-tray">
                <button onClick={actionExample}>
                  <Icon name="document" small />
                  Ajustar planeación
                </button>
                <button onClick={() => setOverlay("attachment")}>
                  <Icon name="search-small" small />
                  Revisar recurso
                </button>
                <button onClick={() => controller.navigate("resources")}>
                  <Icon name="folder-small" small />
                  Mis recursos
                </button>
                <button
                  ref={toolsTrigger}
                  className="more"
                  aria-haspopup="dialog"
                  aria-expanded={overlay === "tools"}
                  onClick={() => setOverlay("tools")}
                >
                  Más herramientas ⌄
                </button>
              </div>
              {s.submit === "sending" && (
                <p role="status">Enviando petición al servidor…</p>
              )}
              {s.sourcePending && !s.attaching && (
                <div>
                  <p role="status">
                    Referencia sin confirmar. Tu selección anterior se conserva.
                  </p>
                  <button onClick={() => void controller.recoverAttachment()}>
                    Comprobar estado del adjunto
                  </button>
                </div>
              )}
              {s.pending && s.submit !== "sending" && (
                <button onClick={() => void controller.recoverCreate()}>
                  Comprobar estado del envío
                </button>
              )}
            </div>
            <p className="home-footnote">
              Ejemplo sintético · Ctrl/⌘ + Enter para enviar
            </p>
          </section>
        ) : s.view === "result" && s.result ? (
          <ResultView
            document={s.result}
            onOpen={openEditor}
            onOriginal={() =>
              void controller.openOriginal({
                source_id: s.result!.receipt.source_id,
                number: s.result!.receipt.source_version,
                sha256: s.result!.receipt.source_sha256,
              })
            }
          />
        ) : (
          <section className="library">
            <h1>Mis recursos</h1>
            <button disabled={s.listState === "loading"} onClick={() => void controller.loadResources()}>
              Actualizar listado
            </button>
            {s.editor && <button onClick={() => { controller.resumeEditor(); setShowEditor(true); }}>
              Retomar edición abierta
            </button>}
            <p className="secondary">
              Originales, revisiones y copias de trabajo de esta cuenta.
            </p>
            <p className="secondary">
              Abrir un original conserva tu petición y no lo adjunta al próximo envío.
            </p>
            {s.listState === "loading" && (
              <p role="status">Recuperando recursos…</p>
            )}
            {s.listState === "error" && (
              <button onClick={() => void controller.loadResources()}>
                Reintentar listado
              </button>
            )}
            {s.listState === "ready" && !s.sources.length && !s.items.length && !s.drafts.length && (
              <p>No hay recursos todavía. Adjunta un ejemplo para empezar.</p>
            )}
            {s.sources.map((source) => (
              <article key={source.source_id} className="library-card" aria-label={`Recurso original · Versión ${source.number}`}>
                <h2>{knownSourceSample(source.sha256)?.name ?? "Recurso original"}</h2>
                <p>Original conservado · Versión {source.number} · {source.size} bytes</p>
                <p className="field-hint">
                  Conservado el <time dateTime={source.created_at}>{new Date(source.created_at).toLocaleString("es-MX")}</time>
                </p>
                <p className="original-metadata">Fuente: {source.source_id}</p>
                <p className="original-metadata">SHA-256: {source.sha256}</p>
                <button
                  className="primary"
                  data-navigation-focus={`source-${source.source_id}`}
                  onClick={() => void controller.openOriginal(source)}
                >
                  Abrir original
                </button>
              </article>
            ))}
            {s.listState === "ready" && !!s.sources.length && !s.items.length && !s.drafts.length && (
              <p>Aún no hay copias ni borradores guardados.</p>
            )}
            {s.items.map((doc) => (
              <article key={doc.receipt.planning_id} className="library-card">
                <h2>
                  {doc.result.resources?.[0]?.title ?? doc.result.title}
                  {doc.origin ? " · Copia conservada" : ""}
                </h2>
                <p>
                  {doc.result.title} · Revisión {doc.receipt.revision}
                </p>
                <p className="field-hint">
                  Original conservado · Fuente versión{" "}
                  {doc.receipt.source_version}
                </p>
                <button
                  className="primary"
                  data-navigation-focus={`planning-${doc.receipt.planning_id}`}
                  onClick={async () => {
                    await controller.open(doc.receipt.planning_id);
                    const current = controller.snapshot();
                    if (
                      current.view === "result" &&
                      current.editor?.document.receipt.planning_id ===
                        doc.receipt.planning_id
                    )
                      setShowEditor(true);
                  }}
                >
                  Reabrir copia guardada
                </button>
              </article>
            ))}
            {s.drafts.map((d) => (
              <article key={d.receipt.draft_id} className="library-card">
                <h2>
                  {d.result.resources?.[0]?.title ?? d.result.title} · Borrador
                  privado
                </h2>
                <p>
                  Base {d.receipt.base_revision} · Copia de trabajo{" "}
                  {d.receipt.draft_revision}
                </p>
                <button
                  data-navigation-focus={`draft-${d.receipt.draft_id}`}
                  onClick={async () => {
                    await controller.openDraft(d.receipt.draft_id);
                    const current = controller.snapshot();
                    if (
                      current.view === "result" &&
                      current.editor?.draftId === d.receipt.draft_id
                    )
                      setShowEditor(true);
                  }}
                >
                  Recuperar borrador
                </button>
              </article>
            ))}
            {(s.cursor || s.draftCursor || s.sourceCursor) && (
              <button disabled={s.listState === "loading"} onClick={() => void controller.loadResources(true)}>
                Ver más recursos
              </button>
            )}
            <button
              className="text-action"
              onClick={() => controller.navigate("home")}
            >
              Volver a la petición
            </button>
          </section>
        )}
        {s.error && (
          <p className="workspace-error" role="alert">
            {s.error}
          </p>
        )}
        {s.backupError && (
          <p className="workspace-error" role="alert">
            No se pudo guardar el respaldo local. Mantén esta pestaña abierta y
            copia el texto pendiente.
          </p>
        )}
      </main>
      {s.original && (
        <Dialog
          title={knownSourceSample(s.original.reference.sha256) ? "Original de ejemplo" : "Recurso original"}
          className="original-dialog"
          onClose={() => controller.closeOriginal()}
        >
          <header>
            <h2>{knownSourceSample(s.original.reference.sha256) ? "Original de ejemplo" : "Recurso original"}</h2>
            <button onClick={() => controller.closeOriginal()}>Cerrar</button>
          </header>
          <div className="original-body">
            <p className="secondary">
              {knownSourceSample(s.original.reference.sha256) ? "Texto UTF-8 sintético · " : ""}Versión {s.original.reference.number}
            </p>
            <p className="original-metadata">
              Fuente: {s.original.reference.source_id}
            </p>
            {s.original.status === "loading" && (
              <p role="status">Leyendo original…</p>
            )}
            {s.original.status === "ready" && s.original.content && (
              <>
                <p role="status">
                  Original disponible · {s.original.content.size} bytes
                  verificados
                </p>
                <p className="original-metadata">
                  SHA-256: {s.original.content.sha256}
                </p>
                <pre tabIndex={0} aria-label="Contenido original">
                  {s.original.content.text}
                </pre>
              </>
            )}
            {s.original.status === "unavailable" && (
              <p role="status">Original no disponible.</p>
            )}
            {s.original.status === "error" && (
              <p role="alert">
                No se pudo leer el original. Tu trabajo sigue aquí.
              </p>
            )}
            {s.original.status === "viewer-error" && (
              <p role="alert">
                No se pudo verificar o mostrar el original. No mostramos
                contenido sin verificar.
              </p>
            )}
            {["unavailable", "error", "viewer-error"].includes(
              s.original.status,
            ) && (
              <button
                onClick={() =>
                  void controller.openOriginal(s.original!.reference)
                }
              >
                Reintentar lectura
              </button>
            )}
          </div>
        </Dialog>
      )}
      {overlay === "context" && (
        <Dialog
          title="Contexto de clase"
          className="menu-dialog context-menu"
          onClose={() => setOverlay(null)}
        >
          <p className="secondary">Contexto de clase</p>
          <button className="menu-option" onClick={() => setOverlay(null)}>
            <strong>
              {waterContext.level} · {waterContext.group}
            </strong>
            <span>{waterContext.subject} · Agua que cambia</span>
          </button>
          <button className="quiet" onClick={() => setOverlay(null)}>
            Cancelar
          </button>
        </Dialog>
      )}
      {overlay === "attachment" && (
        <Dialog
          title={s.source ? "Cambiar referencia" : "Adjuntar referencia"}
          className="menu-dialog attachment-menu"
          onClose={dismissAttachment}
        >
          <p className="secondary">
            {s.source ? "Cambiar referencia" : "Adjuntar referencia"}
          </p>
          {sourceSamples.map((sample) => (
            <button
              key={sample.id}
              className="menu-option"
              disabled={s.attaching || s.sourcePending}
              onClick={async () => {
                if (await controller.attach(sample.bytes)) setOverlay(null);
              }}
            >
              <strong>{sample.name}</strong>
              <span>
                Selección de ejemplo · texto UTF-8 ·{" "}
                {new TextEncoder().encode(sample.bytes).length} bytes
              </span>
            </button>
          ))}
          <p className="field-hint">
            Una revisión conserva la identidad del archivo. Otro archivo tiene
            su propia fuente. No se admiten documentos reales.
          </p>
          {s.attaching && <p role="status">Conservando referencia…</p>}
          {s.sourcePending && !s.attaching && (
            <div>
              <p role="status">
                Referencia sin confirmar. Comprueba el recibo antes de
                cambiarla.
              </p>
              <button
                onClick={async () => {
                  if (await controller.recoverAttachment()) setOverlay(null);
                }}
              >
                Comprobar estado del adjunto
              </button>
            </div>
          )}
          {s.error && <p role="alert">{s.error}</p>}
          <button className="quiet" onClick={dismissAttachment}>
            Cancelar
          </button>
        </Dialog>
      )}
      {overlay === "tools" && (
        <Dialog
          title="Herramientas"
          className="menu-dialog tools-menu"
          anchor={toolsTrigger}
          onClose={() => setOverlay(null)}
        >
          <header>
            <h2>Herramientas</h2>
            <button className="quiet" onClick={() => setOverlay(null)}>
              Cerrar
            </button>
          </header>
          <div className="tool-tabs" role="tablist" aria-label="Categorías">
            {Object.keys(toolCatalog).map((c) => (
              <button
                key={c}
                role="tab"
                aria-selected={category === c}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <p className="field-hint">
            Catálogo propuesto · herramientas futuras
          </p>
          <div className="catalog-items">
            {toolCatalog[category].map((t) => (
              <p key={t}>
                {t}
                <span className="sr-only">, todavía no disponible</span>
              </p>
            ))}
          </div>
          <footer>
            <button className="quiet" onClick={actionExample}>
              Ajustar planeación ↗
            </button>
            <button className="quiet" onClick={() => setOverlay("attachment")}>
              Revisar recurso ↗
            </button>
          </footer>
        </Dialog>
      )}
      {showEditor && s.view === "result" && s.editor && (
        <Editor
          controller={controller}
          onDismiss={() => setShowEditor(false)}
        />
      )}
    </div>
  );
}
