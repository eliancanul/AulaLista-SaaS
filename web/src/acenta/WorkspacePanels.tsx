import { useSyncExternalStore, type ReactNode } from "react";
import type { AcentaController, PanelView } from "./controller";
import { knownSourceSample } from "./contracts";
import { isGuided } from "./guided-planning";

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

export const panelTitles: Record<PanelView, string> = {resources: "Mis recursos", tools: "Herramientas", support: "Soporte", "chat-context": "Contexto del chat"};
export function WorkspacePanel({view, onClose, children}: {view: PanelView; onClose: () => void; children: ReactNode}) {
  return <section id="workspace-panel" role="region" aria-labelledby="workspace-panel-title" className="workspace-panel">
    <header className="workspace-panel-heading">
      <h2 id="workspace-panel-title" tabIndex={-1} data-navigation-focus="workspace-panel-title">{panelTitles[view]}</h2>
      <button aria-label="Cerrar panel" data-navigation-focus="workspace-panel-close" onClick={onClose}>Cerrar</button>
    </header>
    <div className="workspace-panel-body">{children}</div>
  </section>;
}
export function ResourceLibrary({controller, onEditor}: {controller: AcentaController; onEditor: () => void}) {
  const s = useSyncExternalStore(controller.subscribe, controller.snapshot);
  return (          <section className="library">

            <button disabled={s.listState === "loading"} onClick={() => void controller.loadResources()}>
              Actualizar listado
            </button>
            {s.editor && <button onClick={() => { controller.resumeEditor(); onEditor(); }}>
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
                {isGuided(doc.result) && <p>{doc.result.provenance === "openai-guided-v1" ? "Generada con IA" : "Ejemplo de software"}</p>}
                <p className="field-hint">
                  {doc.receipt.source_id ? `Original conservado · Fuente versión ${doc.receipt.source_version}` : "Sin referencia adjunta · Contexto manual"}
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
                      onEditor();
                  }}
                >
                  {isGuided(doc.result) ? "Consultar planeación" : "Reabrir copia guardada"}
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
                      onEditor();
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
              onClick={() => controller.navigate("example")}
            >
              Volver a la petición
            </button>
          </section>);
}
const TOOL_LABEL_TO_ID: Record<string, string> = {
  "Proyecto de aula": "proyecto-aula",
  "Hoja de actividades": "hoja-de-trabajo",
  "Preguntas sobre un texto": "comprension-lectora",
  "Adaptar material": "adaptar-material",
  "Tarjetas de repaso": "tarjetas-repaso",
  "Diagnóstico breve": "diagnostico-breve",
  "Rúbrica y lista de cotejo": "rubrica-cotejo",
  "Bingo temático": "bingo-tematico",
  Memorama: "memorama",
  "Sopa de letras": "sopa-de-letras",
  "Adivina con pistas": "adivina-pistas",
  "Quiz para proyectar": "quiz-proyectar",
};

export function ToolsCatalog({
  category,
  onCategory,
  onPlanning,
  onSelectTool,
}: {
  category: string;
  onCategory: (category: string) => void;
  onPlanning: () => void;
  onSelectTool?: (toolId: string) => void;
}) {
  const categories = Object.keys(toolCatalog);
  return <>
    <div className="tool-tabs" role="tablist" aria-label="Categorías">
      {categories.map((name, index) => <button key={name} id={`tool-category-${index}`} role="tab" aria-controls="tool-category-panel" aria-selected={category === name}
        tabIndex={category === name ? 0 : -1} onClick={() => onCategory(name)}
        onKeyDown={event => {
          const next = event.key === "ArrowRight" ? (index + 1) % categories.length : event.key === "ArrowLeft" ? (index + categories.length - 1) % categories.length : event.key === "Home" ? 0 : event.key === "End" ? categories.length - 1 : null;
          if (next === null) return;
          event.preventDefault(); onCategory(categories[next]);
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
        }}>{name}</button>)}
    </div>
    <p className="field-hint">Todas las herramientas están activas y listas para editar, imprimir o proyectar.</p>
    <div className="catalog-items" role="tabpanel" id="tool-category-panel" aria-labelledby={`tool-category-${categories.indexOf(category)}`}>
      {toolCatalog[category].map(name => name === "Planeación de clase"
        ? <button key={name} type="button" onClick={onPlanning}>{name}</button>
        : <button
            key={name}
            type="button"
            onClick={() => onSelectTool?.(TOOL_LABEL_TO_ID[name] ?? "hoja-de-trabajo")}
          >
            {name}
          </button>)}
    </div>
  </>;
}
export function PendingPlanning({controller}: {controller: AcentaController}) {
  const s = useSyncExternalStore(controller.subscribe, controller.snapshot);
  if (!s.pending) return null;
  return <section aria-label="Planeación pendiente" className="pending-planning">
    <h3>Planeación pendiente</h3>
    <p>Hay una planeación pendiente de confirmar. Consulta su estado; esta acción no inicia una nueva generación con IA.</p>
    <button disabled={s.submit === "sending"} onClick={() => void controller.recoverCreate()}>
      {s.submit === "sending" ? "Consultando planeación…" : s.pending.payload.contract_version === 3 ? "Consultar estado de generación" : "Comprobar estado del envío"}
    </button>
  </section>;
}
