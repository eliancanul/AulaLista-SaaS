import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AcentaController } from "./controller";
import type { AnalyticSectionData } from "./analytic-sections";
import { validateAnalyticForm } from "./analytic-form";
import { knownSourceSample } from "./contracts";
import { Logo } from "./ui";

export function AnalyticForm({ controller }: { controller: AcentaController }) {
  const section = controller.analytic;
  const state = useSyncExternalStore(section.subscribe, section.snapshot);
  const workspace = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const data = state.data;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [contextOpen, setContextOpen] = useState(!data.situation);
  const [entriesOpen, setEntriesOpen] = useState(true);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const locked = !!state.pending || state.loading;
  useEffect(() => {
    if (optionsOpen && workspace.listState === "idle") void controller.loadResources();
  }, [optionsOpen, workspace.listState, controller]);
  const change = <K extends keyof AnalyticSectionData>(key: K, value: AnalyticSectionData[K]) => {
    if (!section.setData({ ...data, [key]: value })) return;
    setErrors({});
  };
  const attributes = (key: string) => ({
    id: `analytic-${key}`,
    "aria-invalid": !!errors[key],
    "aria-required": ["name", "grade", "period", "situation"].includes(key) || /^(content|pda)-/.test(key),
    "aria-describedby": errors[key] ? `analytic-${key}-error` : undefined,
  });
  const error = (key: string) => errors[key] && (
    <p className="guided-field-error" id={`analytic-${key}-error`}>{errors[key]}</p>
  );
  const submit = async () => {
    const next = validateAnalyticForm(data);
    setErrors(next);
    if (Object.keys(next).length) {
      if (next.context || next.situation) setContextOpen(true);
      if (Object.keys(next).some(key => /^(content|pda|entries)/.test(key))) setEntriesOpen(true);
      if (next.formative_field || next.articulating_axes || next.language) {
        setContextOpen(true);
        setOptionsOpen(true);
      }
      requestAnimationFrame(() => (form.current?.querySelector<HTMLElement>("[aria-invalid=true]") ?? form.current?.querySelector<HTMLElement>(".guided-error-summary"))?.focus());
      return;
    }
    await section.save();
  };
  return (
    <section className="guided-page analytic-page">
      <header className="guided-brand">
        <Logo />
        <button className="quiet" onClick={() => controller.navigate("home")}>Volver al inicio</button>
      </header>
      <div className="guided-intro">
        <h1>Programa analítico</h1>
        <p>Organiza un apartado y úsalo después como base para tus clases.</p>
      </div>
      <nav className="guided-mode" aria-label="Modalidad de Planeación">
        <button className="quiet" onClick={() => controller.navigate("planning")}>Clase</button>
        <span aria-current="page">Programa analítico</span>
      </nav>
      <form className="guided-form" ref={form} noValidate onSubmit={event => { event.preventDefault(); void submit(); }}>
        <div className="guided-example-note">
          Aportación manual. No es una cita del programa curricular oficial.
        </div>
        {!!Object.keys(errors).length && <p role="alert" tabIndex={-1} className="guided-error-summary">
          {errors.form ?? `Revisa los ${Object.keys(errors).length} campos marcados.`}
        </p>}
        <fieldset disabled={locked}>
          <legend className="sr-only">Datos del apartado</legend>
          <div className="guided-field">
            <label htmlFor="analytic-name">Nombre del apartado <span>*</span></label>
            <input {...attributes("name")} value={data.name} maxLength={200} onChange={event => change("name", event.target.value)} />
            {error("name")}
          </div>
          <div className="guided-pair">
            <div className="guided-field">
              <label htmlFor="analytic-grade">Grado <span>*</span></label>
              <select {...attributes("grade")} value={data.grade} onChange={event => change("grade", event.target.value)}>
                <option value="">Selecciona un grado</option>
                {data.grade && ![1, 2, 3, 4, 5, 6].some(n => data.grade === `${n}.º de primaria`) && <option>{data.grade}</option>}
                {[1, 2, 3, 4, 5, 6].map(n => <option key={n}>{n}.º de primaria</option>)}
              </select>
              {error("grade")}
            </div>
            <div className="guided-field">
              <label htmlFor="analytic-period">Periodo <span>*</span></label>
              <input {...attributes("period")} value={data.period} maxLength={80} placeholder="Por ejemplo, octubre · 2026" onChange={event => change("period", event.target.value)} />
              {error("period")}
            </div>
          </div>
          <section className="guided-options">
            <button type="button" className="guided-options-toggle quiet" aria-expanded={contextOpen} aria-controls="analytic-context-fields" onClick={() => setContextOpen(!contextOpen)}>
              <strong>Contexto y situación</strong><span>{contextOpen ? "Contraer ⌃" : "Editar datos ⌄"}</span>
            </button>
            {!contextOpen && <dl className="guided-options-summary" aria-label="Resumen de contexto y situación">
              <div><dt>Contexto del grupo</dt><dd>{data.context?.text || "No indicado"}{data.context?.hypothetical && " · Hipotético"}</dd></div>
              <div><dt>Situación a trabajar</dt><dd>{data.situation || "Por completar"}</dd></div>
            </dl>}
            <div id="analytic-context-fields" className="guided-options-fields" hidden={!contextOpen}>
              <div className="guided-field">
                <label htmlFor="analytic-context">Contexto del grupo</label>
                <textarea {...attributes("context")} rows={3} maxLength={1000} value={data.context?.text ?? ""} onChange={event => change("context", event.target.value ? { text: event.target.value, hypothetical: data.context?.hypothetical ?? false } : null)} />
                {error("context")}
                <label className="guided-check"><input type="checkbox" checked={data.context?.hypothetical ?? false} disabled={!data.context?.text} onChange={event => change("context", { text: data.context?.text ?? "", hypothetical: event.target.checked })} />Situación hipotética</label>
                <p className="field-hint">Describe el contexto sin nombres ni datos identificables del alumnado.</p>
              </div>
              <div className="guided-field">
                <label htmlFor="analytic-situation">Situación a trabajar <span>*</span></label>
                <textarea {...attributes("situation")} rows={3} maxLength={1000} value={data.situation} onChange={event => change("situation", event.target.value)} />
                {error("situation")}
              </div>
              <button type="button" className="text-action analytic-more" aria-expanded={optionsOpen} aria-controls="analytic-options" onClick={() => setOptionsOpen(!optionsOpen)}>{optionsOpen ? "Ocultar opciones" : "Más opciones"}</button>
              <div id="analytic-options" className="guided-options-fields" hidden={!optionsOpen}>
                <div className="guided-field">
                  <label htmlFor="analytic-formative_field">Campo formativo · Manual</label>
                  <input {...attributes("formative_field")} maxLength={120} value={data.formative_field ?? ""} onChange={event => change("formative_field", event.target.value || null)} />
                  {error("formative_field")}
                </div>
                <div className="guided-field">
                  <label htmlFor="analytic-articulating_axes">Ejes articuladores · Manuales</label>
                  <textarea {...attributes("articulating_axes")} rows={2} value={data.articulating_axes.join("\n")} onChange={event => change("articulating_axes", event.target.value === "" ? [] : event.target.value.split("\n"))} />
                  <p className="field-hint">Hasta siete ejes, uno por línea.</p>
                  {error("articulating_axes")}
                </div>
                <div className="guided-field">
                  <label htmlFor="analytic-language">Idioma</label>
                  <select {...attributes("language")} value={data.language} onChange={event => change("language", event.target.value)}>
                    {!["es", "en"].includes(data.language) && <option>{data.language}</option>}
                    <option value="es">Español</option><option value="en">Inglés</option>
                  </select>
                  {error("language")}
                </div>
                <div className="guided-field">
                  <label htmlFor="analytic-reference">Referencia guardada · Opcional</label>
                  <select id="analytic-reference" value={data.reference ? `${data.reference.source_id}/${data.reference.source_version}` : ""} onChange={event => {
                    const [source_id, version] = event.target.value.split("/");
                    change("reference", source_id ? { source_id, source_version: Number(version) } : null);
                  }}>
                    <option value="">Sin referencia adjunta</option>
                    {data.reference && !workspace.sources.some(source => source.source_id === data.reference!.source_id && source.number === data.reference!.source_version) && <option value={`${data.reference.source_id}/${data.reference.source_version}`}>Referencia elegida · Versión {data.reference.source_version}</option>}
                    {workspace.sources.map(source => <option key={`${source.source_id}/${source.number}`} value={`${source.source_id}/${source.number}`}>{knownSourceSample(source.sha256)?.name ?? "Referencia privada"} · Versión {source.number}</option>)}
                  </select>
                  <p className="field-hint">Se conserva la versión elegida sin interpretar su contenido.</p>
                  {workspace.listState === "error" && <><p role="alert">No pudimos cargar las referencias guardadas.</p><button type="button" onClick={() => void controller.loadResources()}>Reintentar referencias</button></>}
                </div>
              </div>
            </div>
          </section>
          <section className="guided-options">
            <button type="button" className="guided-options-toggle quiet" aria-expanded={entriesOpen} aria-controls="analytic-entries" onClick={() => setEntriesOpen(!entriesOpen)}>
              <strong>Contenidos y PDA</strong><span>{entriesOpen ? "Contraer ⌃" : "Editar datos ⌄"}</span>
            </button>
            {!entriesOpen && <dl className="guided-options-summary" aria-label="Resumen de contenidos y PDA">{data.entries.map((entry, index) => <div key={index}><dt>Contenido y PDA {index + 1}</dt><dd>{entry.content || "Contenido por completar"}<br />{entry.pda || "PDA por completar"}</dd></div>)}</dl>}
            <div id="analytic-entries" className="guided-options-fields" hidden={!entriesOpen}>
              {data.entries.map((entry, index) => <div className="analytic-entry" key={index}>
                <div className="guided-field">
                  <label htmlFor={`analytic-content-${index}`}>Contenido{index > 0 ? ` ${index + 1}` : ""} <span>*</span></label>
                  <textarea {...attributes(`content-${index}`)} rows={2} maxLength={500} value={entry.content} onChange={event => change("entries", data.entries.map((item, i) => i === index ? { ...item, content: event.target.value } : item))} />
                  {error(`content-${index}`)}
                </div>
                <div className="guided-field">
                  <label htmlFor={`analytic-pda-${index}`}>Proceso de desarrollo de aprendizaje (PDA){index > 0 ? ` ${index + 1}` : ""} <span>*</span></label>
                  <textarea {...attributes(`pda-${index}`)} rows={2} maxLength={500} value={entry.pda} onChange={event => change("entries", data.entries.map((item, i) => i === index ? { ...item, pda: event.target.value } : item))} />
                  {error(`pda-${index}`)}
                </div>
                {data.entries.length > 1 && <button type="button" className="text-action analytic-more" onClick={() => {
                  change("entries", data.entries.filter((_, i) => i !== index));
                  requestAnimationFrame(() => document.getElementById("analytic-add-entry")?.focus());
                }}>Quitar contenido y PDA {index + 1}</button>}
              </div>)}
              {error("entries")}
              <button id="analytic-add-entry" type="button" className="text-action analytic-more" disabled={data.entries.length >= 8} onClick={() => {
                change("entries", [...data.entries, { content: "", pda: "" }]);
                requestAnimationFrame(() => document.getElementById(`analytic-content-${data.entries.length}`)?.focus());
              }}>+ Añadir contenido y PDA</button>
            </div>
          </section>
        </fieldset>
        <footer className="guided-form-footer">
          <span>{state.document ? `Revisión ${state.document.receipt.revision} confirmada.` : "Podrás editarlo después de guardarlo."}</span>
          <button className="primary" type="submit" disabled={locked || state.status === "saved" || state.status === "conflict"}>
            {state.status === "saving" ? "Guardando…" : state.document ? "Guardar cambios" : "Guardar apartado"}
          </button>
        </footer>
        <div className="analytic-save-status" role="status" aria-live="polite">
          {state.status === "saved" && "Apartado guardado. Puedes seguir editándolo aquí."}
          {state.status === "dirty" && "Cambios sin guardar"}
          {state.status === "saving" && "Guardando apartado…"}
        </div>
        {state.error && <p role="alert" className="guided-error-summary">{state.error}</p>}
        {state.status === "unknown" && <button type="button" onClick={() => void section.recover()}>Comprobar guardado</button>}
        {state.status === "conflict" && state.document && <button type="button" onClick={() => {
          if (window.confirm("¿Descartar tus cambios y cargar la revisión guardada?")) {
            const id = state.document!.receipt.section_id;
            if (section.discardChanges()) void section.open(id);
          }
        }}>Descartar mis cambios y cargar revisión actual</button>}
      </form>
      <p className="guided-session-limit">Los cambios sin guardar se conservan mientras esta pestaña y la sesión sigan abiertas. Guarda antes de recargar o salir.</p>
    </section>
  );
}
