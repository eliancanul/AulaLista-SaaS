import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AcentaController } from "./controller";
import type { AnalyticSectionDocument, AnalyticSectionFilters } from "./analytic-sections";
import { validateDerivedClass } from "./analytic-derivation";
import { Dialog, Icon, Logo } from "./ui";
import "./analytic-planning.css";

/** Exact saved text is presented as text, never HTML or a new official source. */
export function AnalyticContent({ document, compact = false }: { document: AnalyticSectionDocument; compact?: boolean }) {
  const { data, receipt } = document;
  return <article className={`analytic-content ${compact ? "compact" : ""}`}>
    {!compact && <header>
      <div className="analytic-provenance"><span>VISTA PREVIA</span><span>Texto propio · Manual</span></div>
      <h2>{data.name}</h2>
      <p>{data.grade}{data.formative_field ? ` · ${data.formative_field}` : " · Campo no indicado"}</p>
      <p>Periodo: {data.period} · Revisión {receipt.revision} confirmada</p>
    </header>}
    {!compact && <section><h3>Situación problemática</h3><p>{data.situation}</p></section>}
    {data.entries.map((entry, index) => <section key={index} className="analytic-content-pair">
      <div><h3>Contenido{data.entries.length > 1 ? ` ${index + 1}` : ""}{compact && " · Sólo lectura"}</h3><p>{entry.content}</p></div>
      <div><h3>PDA{data.entries.length > 1 ? ` ${index + 1}` : ""}{compact && " · Sólo lectura"}</h3><p>{entry.pda}</p></div>
    </section>)}
    <section><h3>Contexto del grupo{data.context?.hypothetical && " · Hipotético"}{compact && " · Sólo lectura"}</h3><p>{data.context?.text ?? "No aportado"}</p></section>
    {!compact && <>
      <section><h3>Ejes articuladores · Manuales</h3>{data.articulating_axes.length ? data.articulating_axes.map((axis, i) => <p key={i}>{axis}</p>) : <p>No aportados</p>}</section>
      <section><h3>Idioma</h3><p>{data.language === "es" ? "Español" : data.language === "en" ? "Inglés" : data.language}</p></section>
      <section><h3>Referencia</h3><p>{receipt.source_id ? `Referencia exacta guardada · Versión ${receipt.source_version}` : "Sin referencia adjunta"}</p><p>Aportación manual. No es una cita del programa curricular oficial.</p></section>
    </>}
  </article>;
}

export function AnalyticExplorer({ controller }: { controller: AcentaController }) {
  const explorer = controller.analyticExplorer;
  const state = useSyncExternalStore(explorer.subscribe, explorer.snapshot);
  const workspace = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const derived = useSyncExternalStore(controller.analyticDerivation.subscribe, controller.analyticDerivation.snapshot);
  if (!state.open) return null;
  const filter = (key: keyof AnalyticSectionFilters, value: string) => {
    const next = { ...state.filters };
    if (value === "") delete next[key]; else next[key] = value;
    void explorer.search(next);
  };
  return <Dialog title="Usar un apartado guardado" className="analytic-explorer" onClose={() => explorer.close()}>
    <header className="guided-reader-header"><Icon name="folder-small" small /><h2>Usar un apartado guardado</h2><button className="quiet guided-icon-button" aria-label="Cerrar explorador" onClick={() => explorer.close()}>×</button></header>
    <div className="analytic-search-fields">
      <div className="analytic-search-name"><Icon name="search-small" small /><label className="sr-only" htmlFor="analytic-search">Buscar por título o tema</label><input autoFocus id="analytic-search" type="search" value={state.filters.q ?? ""} maxLength={400} placeholder="Buscar por título o tema" onChange={event => filter("q", event.target.value)} /></div>
      <div><label className="sr-only" htmlFor="analytic-filter-grade">Filtrar por grado exacto</label><input id="analytic-filter-grade" list="analytic-grade-options" placeholder="Todos los grados" value={state.filters.grade ?? ""} maxLength={160} onChange={event => filter("grade", event.target.value)} /><datalist id="analytic-grade-options">{[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={`${n}.º de primaria`} />)}</datalist></div>
      <div><label className="sr-only" htmlFor="analytic-filter-field">Filtrar por campo formativo exacto</label><input id="analytic-filter-field" placeholder="Todos los campos formativos" value={state.filters.formative_field ?? ""} maxLength={240} onChange={event => filter("formative_field", event.target.value)} /></div>
      <p className="field-hint">Búsqueda literal en el nombre. Grado y campo: escribe el valor exacto o déjalo vacío para ver todos.</p>
    </div>
    <div className="analytic-explorer-panels">
      <section className="analytic-results" aria-label="Tus apartados" aria-busy={state.status === "loading"}>
        <h3>Tus apartados</h3>
        <div className="analytic-result-list">
          {state.status === "loading" && <p role="status">Consultando apartados…</p>}
          {state.status === "error" && <div><p role="alert">{state.error}</p><button onClick={() => void explorer.retry()}>Reintentar consulta</button></div>}
          {state.status === "ready" && !state.items.length && <p role="status">No hay apartados que coincidan con esta consulta.</p>}
          {state.items.map(document => <button key={document.receipt.section_id} className="analytic-result" data-section-id={document.receipt.section_id} aria-pressed={state.selected?.receipt.section_id === document.receipt.section_id} onClick={() => explorer.select(document.receipt.section_id)}>
            <Icon name="document" small /><span><strong>{document.data.name}</strong><span>{document.data.grade}</span><span>{document.data.formative_field ?? "Campo no indicado"}</span></span>
          </button>)}
        </div>
        <nav className="analytic-pagination" aria-label="Páginas de apartados"><span>Página {state.pageIndex + 1}{state.status === "ready" && ` · ${state.items.length} mostrados`}</span><button aria-label="Página anterior" disabled={state.pageIndex === 0 || state.status === "loading"} onClick={() => void explorer.previous()}>‹</button><button aria-label="Página siguiente" disabled={!state.nextCursor || state.status !== "ready"} onClick={() => void explorer.next()}>›</button></nav>
      </section>
      <div className="analytic-preview-panel" aria-label="Vista previa del apartado">
        {state.selected ? <AnalyticContent document={state.selected} /> : <p className="secondary">Selecciona un apartado de la consulta para ver su revisión guardada.</p>}
      </div>
    </div>
    <footer className="guided-reader-footer"><p>Se usarán los datos de esta revisión. El apartado se conserva.</p><div className="actions"><button onClick={() => explorer.close()}>Cancelar</button><button className="primary" disabled={!state.selected || !!workspace.pending || !!derived.pending} onClick={() => { if (state.selected) controller.useAnalyticSection(state.selected); }}>Usar apartado →</button></div></footer>
  </Dialog>;
}

export function AnalyticDerivedForm({ controller }: { controller: AcentaController }) {
  const derivation = controller.analyticDerivation;
  const state = useSyncExternalStore(derivation.subscribe, derivation.snapshot);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showOrigin, setShowOrigin] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => document.getElementById("derived-subject")?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  if (!state.origin) return null;
  const origin = state.origin, data = origin.data, locked = !!state.pending;
  const change = (key: "subject" | "method" | "duration_minutes", value: string | number) => {
    if (derivation.setData({ ...state.data, [key]: value })) setErrors({});
  };
  const submit = () => {
    const next = validateDerivedClass(state.data);
    setErrors(next);
    if (Object.keys(next).length) requestAnimationFrame(() => form.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus());
    else void controller.submitDerived();
  };
  const attributes = (key: string) => ({ id: `derived-${key}`, "aria-invalid": !!errors[key], "aria-describedby": errors[key] ? `derived-${key}-error` : undefined });
  const error = (key: string) => errors[key] && <p className="guided-field-error" id={`derived-${key}-error`}>{errors[key]}</p>;
  return <section className="guided-page analytic-derived-page">
    <header className="guided-brand"><Logo /><button className="quiet" onClick={() => controller.navigate("home")}>Volver al inicio</button></header>
    <div className="guided-intro analytic-derived-intro"><h1>Planeación de clase</h1><button className="quiet text-action" disabled={locked} onClick={() => void controller.analyticExplorer.open()}><Icon name="folder-small" small />Usar un apartado guardado</button><p>Organiza actividades, tiempos y evaluación para tu grupo.</p></div>
    <nav className="guided-mode" aria-label="Modalidad de Planeación"><span aria-current="page">Clase</span><button className="quiet" onClick={() => controller.navigate("analytic")}>Programa analítico</button></nav>
    <form ref={form} className="guided-form" noValidate onSubmit={event => { event.preventDefault(); submit(); }}>
      <fieldset disabled={locked}>
        <legend className="sr-only">Datos de la clase derivada</legend>
        <div className="analytic-class-fields">
          <div className="guided-field"><label htmlFor="derived-subject">Asignatura <span>*</span></label><input {...attributes("subject")} list="derived-subject-options" value={state.data.subject} maxLength={120} onChange={event => change("subject", event.target.value)} /><datalist id="derived-subject-options"><option value="Ciencias naturales" /></datalist>{error("subject")}</div>
          <div className="guided-field"><label htmlFor="derived-method">Método <span>*</span></label><select {...attributes("method")} value={state.data.method} onChange={event => change("method", event.target.value)}><option value="active-learning">Aprendizaje activo</option><option value="lecture">Clase expositiva</option><option value="5e">Modelo 5E</option></select>{error("method")}</div>
          <div className="guided-field"><label htmlFor="derived-duration_minutes">Duración · minutos</label><input {...attributes("duration_minutes")} type="number" min={15} max={180} step={1} value={Number.isFinite(state.data.duration_minutes) ? state.data.duration_minutes : ""} onChange={event => change("duration_minutes", event.target.valueAsNumber)} />{error("duration_minutes")}</div>
        </div>
        <div className="guided-field"><label htmlFor="derived-topic">Tema del apartado <span className="analytic-readonly">Sólo lectura</span></label><input id="derived-topic" readOnly value={data.name} /></div>
      </fieldset>
      <section className="analytic-inherited">
        <header><h2><Icon name="document" small />Desde «{data.name}»</h2><button type="button" className="quiet text-action" onClick={() => setShowOrigin(true)}>Ver apartado</button></header>
        <p className="analytic-origin-meta"><span>Texto propio · Manual</span>{data.grade} · Revisión {origin.receipt.revision} · El apartado se conserva.</p>
        <AnalyticContent document={origin} compact />
        <details><summary>Ver campo y ejes · Sólo lectura</summary><p>Campo: {data.formative_field ?? "No aportado"}</p>{data.articulating_axes.map((axis, i) => <p key={i}>{axis}</p>)}</details>
        <details><summary>Otros datos del apartado · Sólo lectura</summary><p>Periodo: {data.period}</p><p>Situación: {data.situation}</p><p>Idioma: {data.language}</p><p>{origin.receipt.source_id ? `Referencia exacta · Versión ${origin.receipt.source_version}` : "Sin referencia adjunta"}</p></details>
      </section>
      <p className="guided-example-note">Ejemplo de software, sin IA ni validación curricular. Sólo admite Ciencias naturales, 3.º de primaria, el cuidado del agua en la comunidad, aprendizaje activo y español. El contexto manual no adapta el ejemplo.</p>
      {state.error && <p role="alert">{state.error}</p>}
      {state.status === "sending" && <p role="status">Confirmando creación de la clase…</p>}
      {state.status === "saved" && <p role="status">Clase confirmada. Puedes consultarla en Mis recursos.</p>}
      <footer className="guided-form-footer"><span>Aquí sólo cambias asignatura, duración y método. Después podrás editar el resultado.</span><div className="actions"><button type="button" disabled={locked} onClick={() => derivation.hasUnsavedChanges() ? setConfirmCancel(true) : derivation.cancel()}>Cancelar</button>{state.pending ? <button type="button" className="primary" disabled={state.status === "sending"} onClick={() => void controller.submitDerived(true)}>Comprobar creación</button> : state.status === "saved" ? <button type="button" onClick={() => derivation.setData(state.data)}>Preparar otra clase</button> : <button className="primary" type="submit">Crear ejemplo →</button>}</div></footer>
    </form>
    <p className="guided-session-limit">Guarda antes de salir. La preparación sólo permanece en esta pestaña; tras recarga o sesión inválida sólo se recupera lo confirmado.</p>
    {showOrigin && <Dialog title="Apartado de origen" className="analytic-origin-dialog" onClose={() => setShowOrigin(false)}><header className="guided-reader-header"><h2>Apartado de origen · Revisión {origin.receipt.revision}</h2><button onClick={() => setShowOrigin(false)}>Cerrar</button></header><AnalyticContent document={origin} /></Dialog>}
    {confirmCancel && <Dialog title="¿Cancelar esta preparación?" className="menu-dialog" onClose={() => setConfirmCancel(false)}><h2>¿Cancelar esta preparación?</h2><p>Se descartarán los datos de esta clase sin cambiar el apartado guardado. Tu formulario de clase anterior se conserva.</p><button autoFocus onClick={() => setConfirmCancel(false)}>Seguir preparando</button><button onClick={() => { if (derivation.cancel()) setConfirmCancel(false); }}>Descartar preparación</button></Dialog>}
  </section>;
}
