import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AcentaController } from "./controller";
import {
  type GuidedPlanningRequest,
  type PlanningDocument,
  knownSourceSample,
  waterSource,
} from "./contracts";
import { Dialog, Logo } from "./ui";
import { PrintPlanningButton } from "./PrintPlanning";
import {
  guidedExample,
  guidedInput,
  isGuided,
  validateGuidedRequest,
} from "./guided-planning";

const asset = (name: string) => (
  <img src={`/acenta/planning/${name}.svg`} alt="" />
);
const lines = (text: string) => (text === "" ? [] : text.split("\n"));
const brief = (text: string) =>
  text.length > 110 ? `${text.slice(0, 110)}…` : text;

export function GuidedForm({ controller }: { controller: AcentaController }) {
  const s = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const q = s.guided;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [options, setOptions] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    void controller.loadGenerationAvailability();
  }, [controller]);
  useEffect(() => {
    if (s.listState === "idle") void controller.loadResources();
  }, [controller, s.listState]);
  const change = <K extends keyof GuidedPlanningRequest>(
    key: K,
    value: GuidedPlanningRequest[K],
  ) => {
    controller.setGuided({ ...q, [key]: value });
    setErrors((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };
  const error = (key: string) =>
    errors[key] && (
      <p className="guided-field-error" id={`guided-${key}-error`}>
        {errors[key]}
      </p>
    );
  const attributes = (key: string) => ({
    id: `guided-${key}`,
    "aria-invalid": !!errors[key],
    "aria-describedby": errors[key] ? `guided-${key}-error` : undefined,
  });
  const pending = !!s.pending;
  const sending = s.submit === "sending";
  const generatingWithAI = s.pending?.payload.contract_version === 3;
  const creationMode = s.generationAvailable ? "ai" : "example";
  const reference = s.sources.find(
    (source) =>
      source.source_id === q.reference?.source_id &&
      source.number === q.reference?.source_version,
  );
  const submit = () => {
    const next = validateGuidedRequest(q);
    setErrors(next);
    if (Object.keys(next).length) {
      if (
        Object.keys(next).some(
          (key) =>
            !["subject", "grade", "topic", "duration_minutes"].includes(key),
        )
      )
        setOptions(true);
      requestAnimationFrame(() =>
        form.current
          ?.querySelector<HTMLElement>("[aria-invalid=true]")
          ?.focus(),
      );
    } else void controller.submitGuided(creationMode);
  };
  return (
    <section className="guided-page">
      <header className="guided-brand">
        <Logo />
        <button className="quiet" onClick={() => controller.navigate("home")}>
          Volver al inicio
        </button>
      </header>
      <div className="guided-intro">
        <h1>Planeación de clase</h1>
        <p>Organiza actividades, tiempos y evaluación para tu grupo.</p>
      </div>
      <div className="guided-mode">
        <span aria-current="page">Clase</span>
        <button className="quiet" onClick={() => controller.navigate("analytic")}>Programa analítico</button>
      </div>
      <form
        className="guided-form"
        ref={form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="guided-example-note">
          <p role="status">
            {s.generationAvailable
              ? "La generación con IA está disponible. Se preparará una planeación con los datos que escribas. Revisa el resultado antes de usarlo."
              : "La generación con IA no está disponible. Puedes crear un ejemplo de software de Ciencias naturales, 3.º de primaria, el cuidado del agua, aprendizaje activo y español. El contexto manual se conserva; no adapta el ejemplo ni acredita alineación NEM."}
          </p>
          <button
            type="button"
            className="text-action"
            disabled={pending}
            onClick={() => {
              controller.setGuided(guidedExample());
              setErrors({});
            }}
          >
            Usar datos del ejemplo
          </button>
        </div>
        {!!Object.keys(errors).length && (
          <p role="alert" className="guided-error-summary">
            Revisa los {Object.keys(errors).length} campos marcados.
          </p>
        )}
        <fieldset disabled={pending}>
          <legend className="sr-only">Datos de la clase</legend>
          <p className="field-hint">Los campos con * son obligatorios.</p>
          <div className="guided-pair">
            <div className="guided-field">
              <label htmlFor="guided-subject">
                Asignatura <span>*</span>
              </label>
              <select
                {...attributes("subject")}
                value={q.subject}
                onChange={(e) => change("subject", e.target.value)}
              >
                <option value="">Selecciona una asignatura</option>
                <option>Ciencias naturales</option>
                <option>Español</option>
                <option>Matemáticas</option>
              </select>
              {error("subject")}
            </div>
            <div className="guided-field">
              <label htmlFor="guided-grade">
                Grado <span>*</span>
              </label>
              <select
                {...attributes("grade")}
                value={q.grade}
                onChange={(e) => change("grade", e.target.value)}
              >
                <option value="">Selecciona un grado</option>
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n}>{n}.º de primaria</option>
                ))}
              </select>
              {error("grade")}
            </div>
          </div>
          <div className="guided-field">
            <label htmlFor="guided-topic">
              Tema <span>*</span>
            </label>
            <input
              {...attributes("topic")}
              value={q.topic}
              placeholder="¿Qué trabajarán en esta clase?"
              onChange={(e) => change("topic", e.target.value)}
              maxLength={200}
            />
            {error("topic")}
          </div>
          <div className="guided-field guided-duration">
            <label htmlFor="guided-duration_minutes">Duración (minutos)</label>
            <input
              {...attributes("duration_minutes")}
              type="number"
              min={15}
              max={180}
              step={1}
              list="guided-durations"
              value={Number.isNaN(q.duration_minutes) ? "" : q.duration_minutes}
              onChange={(e) =>
                change(
                  "duration_minutes",
                  e.target.value === "" ? NaN : Number(e.target.value),
                )
              }
            />
            <datalist id="guided-durations">
              {[30, 50, 100, 120, 150].map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            {error("duration_minutes")}
          </div>
          <div className="guided-options">
            <button
              className="guided-options-toggle quiet"
              type="button"
              aria-expanded={options}
              aria-controls="guided-more"
              onClick={() => setOptions(!options)}
            >
              <strong>Contexto y opciones</strong>
              <span>{options ? "Contraer ⌃" : "Editar opciones ⌄"}</span>
            </button>
            <p className="field-hint">
              Sin fuente curricular oficial. Las aportaciones manuales son
              válidas y se conservan como tales.
            </p>
            {!options && (
              <dl
                className="guided-options-summary"
                aria-label="Resumen de contexto y opciones"
              >
                <div>
                  <dt>Método e idioma</dt>
                  <dd>
                    {(
                      {
                        "active-learning": "Aprendizaje activo",
                        lecture: "Clase expositiva",
                        "5e": "Modelo 5E",
                      } as Record<string, string>
                    )[q.method] ?? q.method}
                    {" · "}
                    {q.language === "es"
                      ? "Español"
                      : q.language === "en"
                        ? "Inglés"
                        : q.language}
                  </dd>
                </div>
                <div>
                  <dt>Contexto manual</dt>
                  <dd>
                    {q.context
                      ? `${q.context.hypothetical ? "Hipotético" : "Aportación manual"}: ${brief(q.context.text) || "Sin descripción"}`
                      : "Sin contexto"}
                  </dd>
                </div>
                <div>
                  <dt>Objetivos manuales</dt>
                  <dd>
                    {brief(q.learning_objectives.join(" · ")) || "No indicados"}
                  </dd>
                </div>
                <div>
                  <dt>Campo manual</dt>
                  <dd>{brief(q.formative_field ?? "") || "No indicado"}</dd>
                </div>
                <div>
                  <dt>Ejes manuales</dt>
                  <dd>
                    {brief(q.articulating_axes.join(" · ")) || "No indicados"}
                  </dd>
                </div>
                <div>
                  <dt>Referencia</dt>
                  <dd>
                    {q.reference
                      ? `${reference ? (knownSourceSample(reference.sha256)?.name ?? "Referencia privada") : "Referencia elegida"} · Versión ${q.reference.source_version}`
                      : "Sin referencia adjunta"}
                  </dd>
                </div>
              </dl>
            )}
            {options && (
              <div id="guided-more" className="guided-options-fields">
                <div className="guided-pair">
                  <div className="guided-field">
                    <label htmlFor="guided-method">Método de enseñanza</label>
                    <select
                      {...attributes("method")}
                      value={q.method}
                      onChange={(e) => change("method", e.target.value)}
                    >
                      <option value="active-learning">
                        Aprendizaje activo
                      </option>
                      <option value="lecture">Clase expositiva</option>
                      <option value="5e">Modelo 5E</option>
                    </select>
                    {error("method")}
                  </div>
                  <div className="guided-field">
                    <label htmlFor="guided-language">Idioma del material</label>
                    <select
                      {...attributes("language")}
                      value={q.language}
                      onChange={(e) => change("language", e.target.value)}
                    >
                      <option value="es">Español</option>
                      <option value="en">Inglés</option>
                    </select>
                    {error("language")}
                  </div>
                </div>
                <div className="guided-field">
                  <label htmlFor="guided-context">
                    Contexto · Aportación manual
                  </label>
                  <textarea
                    {...attributes("context")}
                    value={q.context?.text ?? ""}
                    rows={3}
                    onChange={(e) =>
                      change(
                        "context",
                        e.target.value
                          ? {
                              text: e.target.value,
                              hypothetical: q.context?.hypothetical ?? false,
                            }
                          : null,
                      )
                    }
                    maxLength={1000}
                  />
                  {error("context")}
                  <label className="guided-check">
                    <input
                      type="checkbox"
                      checked={q.context?.hypothetical ?? false}
                      onChange={(e) =>
                        change("context", {
                          text: q.context?.text ?? "",
                          hypothetical: e.target.checked,
                        })
                      }
                    />
                    Situación hipotética
                  </label>
                  <p className="field-hint">
                    Describe la necesidad sin nombres ni datos identificables
                    del alumnado. La condición hipotética se conserva al
                    reabrir.
                  </p>
                </div>
                <div className="guided-field">
                  <label htmlFor="guided-learning_objectives">
                    Objetivos de aprendizaje · Manuales
                  </label>
                  <textarea
                    {...attributes("learning_objectives")}
                    value={q.learning_objectives.join("\n")}
                    rows={2}
                    onChange={(e) =>
                      change("learning_objectives", lines(e.target.value))
                    }
                  />
                  {error("learning_objectives")}
                  <p className="field-hint">
                    Uno por línea. Son objetivos propios; no se identifican como
                    PDA oficiales.
                  </p>
                </div>
                <div className="guided-field">
                  <label htmlFor="guided-formative_field">
                    Campo formativo · Manual
                  </label>
                  <input
                    {...attributes("formative_field")}
                    value={q.formative_field ?? ""}
                    onChange={(e) =>
                      change("formative_field", e.target.value || null)
                    }
                    maxLength={120}
                  />
                  {error("formative_field")}
                </div>
                <div className="guided-field">
                  <label htmlFor="guided-articulating_axes">
                    Ejes articuladores · Manuales
                  </label>
                  <textarea
                    {...attributes("articulating_axes")}
                    value={q.articulating_axes.join("\n")}
                    rows={2}
                    onChange={(e) =>
                      change("articulating_axes", lines(e.target.value))
                    }
                  />
                  {error("articulating_axes")}
                </div>
                <div className="guided-field">
                  <label htmlFor="guided-reference">
                    Referencia guardada · Opcional
                  </label>
                  <select
                    id="guided-reference"
                    value={
                      q.reference
                        ? `${q.reference.source_id}/${q.reference.source_version}`
                        : ""
                    }
                    onChange={(e) => {
                      const [source_id, version] = e.target.value.split("/");
                      change(
                        "reference",
                        source_id
                          ? { source_id, source_version: Number(version) }
                          : null,
                      );
                    }}
                  >
                    <option value="">Sin referencia adjunta</option>
                    {q.reference &&
                      !s.sources.some(
                        (x) =>
                          x.source_id === q.reference!.source_id &&
                          x.number === q.reference!.source_version,
                      ) && (
                        <option
                          value={`${q.reference.source_id}/${q.reference.source_version}`}
                        >
                          Referencia elegida · Versión{" "}
                          {q.reference.source_version}
                        </option>
                      )}
                    {s.sources.map((source) => (
                      <option
                        key={source.source_id}
                        value={`${source.source_id}/${source.number}`}
                      >
                        {knownSourceSample(source.sha256)?.name ??
                          "Referencia privada"}{" "}
                        · Versión {source.number}
                      </option>
                    ))}
                  </select>
                  <p className="field-hint">
                    Sólo referencias ya admitidas. Se conserva la versión
                    elegida y su original, sin interpretarlos.
                  </p>
                  <button
                    type="button"
                    disabled={s.attaching || s.sourcePending}
                    onClick={async () => {
                      if (await controller.attach(waterSource)) {
                        const source = controller.snapshot().source!;
                        controller.setGuided({
                          ...controller.snapshot().guided,
                          reference: {
                            source_id: source.source_id,
                            source_version: source.number,
                          },
                        });
                        await controller.loadResources();
                      }
                    }}
                  >
                    Conservar referencia de ejemplo
                  </button>
                  {s.sourcePending && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (await controller.recoverAttachment()) {
                          const source = controller.snapshot().source!;
                          controller.setGuided({
                            ...controller.snapshot().guided,
                            reference: {
                              source_id: source.source_id,
                              source_version: source.number,
                            },
                          });
                          await controller.loadResources();
                        }
                      }}
                    >
                      Comprobar referencia pendiente
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </fieldset>
        {s.error && (
          <p role="alert" className="guided-error-summary">
            {s.error}
          </p>
        )}
        {pending ? (
          <section
            className={`guided-generation ${sending ? "" : "uncertain"}`}
            aria-label="Estado de creación"
          >
            <h2>
              {sending
                ? generatingWithAI
                  ? "Preparando tu planeación"
                  : "Preparando tu ejemplo"
                : "Resultado sin confirmar"}
            </h2>
            <p>
              {sending
                ? "En cuanto esté lista, podrás revisarla aquí."
                : "El intento podría seguir en curso. Consulta su estado antes de crear otra planeación."}
            </p>
            <button
              type="button"
              className="primary"
              disabled={sending}
              onClick={() => void controller.recoverCreate()}
            >
              {sending
                ? generatingWithAI
                  ? "Preparando planeación…"
                  : "Preparando ejemplo…"
                : "Consultar estado"}
            </button>
          </section>
        ) : (
          <footer className="guided-form-footer">
            <span>Podrás editar el resultado.</span>
            <button
              className="primary"
              type="submit"
              disabled={s.attaching || s.sourcePending}
            >
              {creationMode === "ai" ? "Generar con IA" : "Crear ejemplo de software"}
            </button>
          </footer>
        )}
      </form>
      <p className="guided-session-limit">
        Tras caducar la sesión sólo se recupera lo confirmado en Mis recursos.
        Los cambios sin guardar pueden perderse.
      </p>
    </section>
  );
}

function ContextDetails({
  document,
  onOriginal,
}: {
  document: PlanningDocument;
  onOriginal: () => void;
}) {
  const q = guidedInput(document);
  if (!q) return null;
  return (
    <details className="guided-context">
      <summary>Datos y procedencia de esta planeación</summary>
      <div>
        <p>
          Formulario guardado · {q.subject} · {q.grade} · {q.duration_minutes}{" "}
          minutos solicitados
        </p>
        <p>
          Método:{" "}
          {q.method === "active-learning" ? "Aprendizaje activo" : q.method} ·
          Idioma: {q.language === "es" ? "Español" : q.language}
        </p>
        <p>
          Fuente curricular oficial: ausente. No se acredita alineación NEM.
        </p>
        <p>
          Contexto manual:{" "}
          {q.context
            ? `${q.context.hypothetical ? "Situación hipotética" : "Aportación del docente"}. ${q.context.text}`
            : "No aportado"}
        </p>
        <p>
          Objetivos manuales:{" "}
          {q.learning_objectives.join("; ") || "No aportados"}
        </p>
        <p>Campo formativo manual: {q.formative_field ?? "No aportado"}</p>
        <p>Ejes manuales: {q.articulating_axes.join("; ") || "No aportados"}</p>
        {document.receipt.source_id ? (
          <>
            <p>Referencia exacta · Versión {document.receipt.source_version}</p>
            <p className="original-metadata">
              SHA-256: {document.receipt.source_sha256}
            </p>
            <button onClick={onOriginal}>Abrir original de referencia</button>
          </>
        ) : (
          <p>Sin referencia adjunta</p>
        )}
        <p>{document.result.notice}</p>
        <p>Revisión {document.receipt.revision} · Guardado confirmado</p>
      </div>
    </details>
  );
}
export function GuidedReader({
  document,
  onClose,
  onEdit,
  onOriginal,
}: {
  document: PlanningDocument;
  onClose: () => void;
  onEdit: () => void;
  onOriginal: () => void;
}) {
  const [mobile, setMobile] = useState(
    () => window.matchMedia("(max-width: 700px)").matches,
  );
  const [sections, setSections] = useState(false);
  const [current, setCurrent] = useState("purpose");
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 700px)");
    const update = () => setMobile(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const r = document.result,
    q = guidedInput(document);
  if (!isGuided(r) || !q) return null;
  const provenance =
    r.provenance === "openai-guided-v1"
      ? "Generada con IA"
      : "Ejemplo de software";
  const index = [
    { id: "purpose", label: "Propósito" },
    ...r.activities.map((a) => ({
      id: a.key!,
      label: a.title!.split(" · ")[0],
      minutes: a.minutes,
    })),
    { id: "materials", label: "Materiales" },
    { id: "assessment", label: "Evaluación formativa" },
  ];
  const goTo = (id: string) => {
    setCurrent(id);
    setSections(false);
    requestAnimationFrame(() => {
      const node = content.current?.querySelector<HTMLElement>(
        `[data-section="${id}"]`,
      );
      node?.scrollIntoView({ block: "start" });
      node?.focus({ preventScroll: true });
    });
  };
  return (
    <Dialog
      title={mobile ? "Lectura de planeación" : "Vista previa"}
      className={mobile ? "guided-mobile-reader" : "guided-reader"}
      onClose={onClose}
    >
      {mobile ? (
        <header className="guided-mobile-header">
          <button className="quiet" onClick={onClose}>
            {asset("back")}Mis recursos
          </button>
          <Logo />
        </header>
      ) : (
        <header className="guided-reader-header">
          {asset("document")}
          <h2>Vista previa</h2>
          <button onClick={onEdit}>Editar</button>
          <button
            className="quiet guided-icon-button"
            aria-label="Cerrar vista previa"
            onClick={onClose}
          >
            {asset("close")}
          </button>
        </header>
      )}
      <div className="guided-reading-surface" ref={content}>
        <article className="guided-paper">
          <header className="guided-paper-header">
            <p className="guided-type">
              Planeación de clase <span>{provenance}</span>
            </p>
            <h1>{r.title}</h1>
            <p className="guided-subject">{q.subject}</p>
            <p className="guided-meta">
              {q.grade}
              <span className="desktop-subject"> · {q.subject}</span> ·{" "}
              {r.duration_minutes} minutos
            </p>
            <PrintPlanningButton document={document} />
          </header>
          <section>
            <h2 tabIndex={-1} data-section="purpose">
              Propósito
            </h2>
            <p>{r.purpose}</p>
          </section>
          <section className="guided-activities">
            <h2>Actividades</h2>
            {r.activities.map((a) => (
              <section className="guided-activity" key={a.key}>
                <div className="guided-phase">
                  {!mobile && asset("marker")}
                  <h3 tabIndex={-1} data-section={a.key}>
                    {a.title?.split(" · ")[0]}
                  </h3>
                  <span className="guided-time">{a.minutes} min</span>
                </div>
                <p>{a.statement}</p>
              </section>
            ))}
          </section>
          <div className="guided-reading-pair">
            <section>
              <h2 tabIndex={-1} data-section="materials">
                Materiales
              </h2>
              <ul>
                {r.materials.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </section>
            <section>
              <h2 tabIndex={-1} data-section="assessment">
                Evaluación formativa
              </h2>
              <p>{r.formative_assessment}</p>
            </section>
          </div>
          <ContextDetails document={document} onOriginal={onOriginal} />
        </article>
      </div>
      {mobile ? (
        <footer className="guided-mobile-actions">
          <button
            onClick={() => setSections(true)}
            aria-haspopup="dialog"
            aria-expanded={sections}
          >
            {asset("sections")}Secciones{asset("up")}
          </button>
          <button onClick={onEdit}>{asset("edit")}Editar</button>
        </footer>
      ) : (
        <footer className="guided-reader-footer">
          <p>
            {provenance} · Revisión {document.receipt.revision} guardada
          </p>
          <button onClick={onClose}>Cerrar</button>
        </footer>
      )}
      {sections && (
        <Dialog
          title="Ir a una sección"
          className="guided-section-sheet"
          onClose={() => setSections(false)}
        >
          <div className="guided-sheet-handle" />
          <header>
            <div>
              <h2>Ir a una sección</h2>
              <p>{r.title}</p>
            </div>
            <button
              className="quiet guided-icon-button"
              aria-label="Cerrar secciones"
              onClick={() => setSections(false)}
            >
              {asset("close")}
            </button>
          </header>
          <nav aria-label="Secciones de la planeación">
            {index.map((item) => (
              <button
                key={item.id}
                aria-current={current === item.id ? "location" : undefined}
                onClick={() => goTo(item.id)}
              >
                {current === item.id && asset("selected")}
                <span>{item.label}</span>
                {"minutes" in item && <small>{item.minutes} min</small>}
                {current !== item.id && asset("forward")}
              </button>
            ))}
          </nav>
        </Dialog>
      )}
    </Dialog>
  );
}
