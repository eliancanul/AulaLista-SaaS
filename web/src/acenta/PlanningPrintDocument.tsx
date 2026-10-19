import type { PlanningDocument } from "./contracts";
import { guidedInput, isGuided } from "./guided-planning";
import { Logo } from "./ui";
import styles from "./planning-print.css?inline";

export const planningPrintStyles = styles;

/** Only confirmed documents enter this boundary, never editor buffers or latest. */
export function canPrintPlanning(document: PlanningDocument) {
  return (
    document.receipt.namespace === "planning-v1" &&
    !!document.receipt.revision_id &&
    Number.isInteger(document.receipt.revision) &&
    document.receipt.revision > 0 &&
    isGuided(document.result) &&
    guidedInput(document) !== null
  );
}

/** A text-only projection of one saved revision. No account or internal IDs. */
export function PlanningPrintDocument({ document }: { document: PlanningDocument }) {
  if (!canPrintPlanning(document)) return null;
  const r = document.result;
  const q = guidedInput(document)!;
  return (
    <article className="planning-print-document">
      <header className="planning-print-heading">
        <Logo />
        <p>Planeación de clase · Revisión {document.receipt.revision} · Guardado confirmado</p>
        <h1>{r.title}</h1>
        <p>{q.subject} · {q.grade} · {r.duration_minutes} minutos</p>
        <p>{r.provenance === "openai-guided-v1" ? "Generada con IA" : "Ejemplo sintético de software · Fixture conservado"}</p>
      </header>
      <section>
        <h2>Propósito</h2>
        <p>{r.purpose}</p>
      </section>
      <section>
        <h2>Actividades</h2>
        {r.activities.map((activity, index) => (
          <section key={activity.key ?? index} className="planning-print-activity">
            <h3>{activity.title ?? `Actividad ${index + 1}`} · {activity.minutes} min</h3>
            <p>{activity.statement}</p>
          </section>
        ))}
      </section>
      <section>
        <h2>Materiales</h2>
        <ul>{r.materials?.map((material, index) => <li key={index}>{material}</li>)}</ul>
      </section>
      <section>
        <h2>Evaluación formativa</h2>
        <p>{r.formative_assessment}</p>
      </section>
      <section className="planning-print-context">
        <h2>Datos y procedencia conservados</h2>
        <p>{r.notice}</p>
        <p>Fuente curricular oficial: ausente. No se acredita alineación NEM.</p>
        <dl>
          <dt>Tema solicitado</dt><dd>{q.topic}</dd>
          <dt>Duración solicitada</dt><dd>{q.duration_minutes} minutos</dd>
          <dt>Método</dt><dd>{q.method === "active-learning" ? "Aprendizaje activo" : q.method === "lecture" ? "Clase expositiva" : q.method === "5e" ? "Modelo 5E" : q.method}</dd>
          <dt>Idioma</dt><dd>{q.language === "es" ? "Español" : q.language === "en" ? "Inglés" : q.language}</dd>
          <dt>Contexto manual{q.context?.hypothetical ? " · Situación hipotética" : ""}</dt>
          <dd>{q.context?.text ?? "No aportado"}</dd>
          <dt>Objetivos manuales</dt>
          <dd>{q.learning_objectives.length ? <ul>{q.learning_objectives.map((text, index) => <li key={index}>{text}</li>)}</ul> : "No aportados"}</dd>
          <dt>Campo formativo manual</dt><dd>{q.formative_field ?? "No aportado"}</dd>
          <dt>Ejes manuales</dt>
          <dd>{q.articulating_axes.length ? <ul>{q.articulating_axes.map((text, index) => <li key={index}>{text}</li>)}</ul> : "No aportados"}</dd>
        </dl>
        <p>{document.receipt.source_version === null ? "Sin referencia adjunta" : `Referencia adjunta conservada · Versión ${document.receipt.source_version} · Sin interpretar`}</p>
      </section>
    </article>
  );
}
