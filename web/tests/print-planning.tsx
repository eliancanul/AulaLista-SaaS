import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { PlanningDocument } from "../src/acenta/contracts";
import { PrintPlanningButton } from "../src/acenta/PrintPlanning";
import { guidedPlanning, guidedRequest, guidedRevised } from "./guided-fixtures";

const first = guidedPlanning();
first.result.purpose = "CONTENIDO GUARDADO REVISION UNO.";
const second = guidedRevised(first, "CONTENIDO GUARDADO REVISION DOS.");
const long = structuredClone(second);
long.result.title = "Planeación extensa de prueba de impresión";
const boundedText = (marker: string, limit = 1000) => {
  const end = ` FIN-${marker}.`;
  return `${marker}: ${"Observar el agua y conversar sobre su cuidado en la comunidad. ".repeat(20)}`.slice(0, limit - end.length) + end;
};
long.result.purpose = boundedText("PROPOSITO");
long.result.activities.forEach((activity, index) => { activity.statement = boundedText(`ACTIVIDAD-${index + 1}`); });
long.result.formative_assessment = boundedText("EVALUACION");
long.result.materials = [1, 2, 3].map(index => boundedText(`MATERIAL-${index}`));
long.initial_request = guidedRequest({
  context: { text: boundedText("CONTEXTO"), hypothetical: true },
  learning_objectives: [1, 2, 3, 4, 5].map(index => boundedText(`OBJETIVO-${index}`, 200)),
  articulating_axes: [1, 2, 3, 4, 5, 6, 7].map(index => boundedText(`EJE-${index}`, 80)),
});
// Extra stress case beyond the editing API's 1000-character field limit.
const stress = structuredClone(second);
stress.result.title = "Planeación de estrés multipágina";
stress.result.activities[1].statement = Array.from({ length: 90 }, (_, i) =>
  `Párrafo ${String(i + 1).padStart(3, "0")}: Esta actividad extensa comprueba que todo el contenido confirmado se conserva entre páginas. Observar el agua, conversar sobre su cuidado y escribir una propuesta en el cuaderno. FIN-${String(i + 1).padStart(3, "0")}.`,
).join("\n\n");
stress.result.activities[2].statement += " ULTIMA ACTIVIDAD CONSERVADA.";
stress.result.formative_assessment += " ULTIMA EVALUACION CONSERVADA.";

declare global {
  interface Window {
    printHarness: {
      replace(document: PlanningDocument): void;
      mutateCurrent(): void;
    };
  }
}

function Harness() {
  const [document, setDocument] = useState(first);
  const [showPrint, setShowPrint] = useState(true);
  window.printHarness = {
    replace: setDocument,
    mutateCurrent() {
      document.result.purpose = "MUTACION POSTERIOR AL CLICK.";
      document.result.activities[0].statement = "ACTIVIDAD MUTADA POSTERIOR AL CLICK.";
    },
  };
  return <>
    <nav aria-label="Controles de prueba">NAVEGACION QUE NO DEBE IMPRIMIRSE</nav>
    <p>CUENTA PRIVADA QUE NO DEBE IMPRIMIRSE</p>
    <label>Borrador sin guardar <textarea defaultValue="BORRADOR QUE NO DEBE IMPRIMIRSE" /></label>
    {showPrint && <PrintPlanningButton document={document} />}
    <button onClick={() => setDocument(second)}>Cambiar a revisión dos</button>
    <button onClick={() => setDocument(long)}>Cargar contenido extenso</button>
    <button onClick={() => setDocument(stress)}>Cargar estrés multipágina</button>
    <button onClick={() => setShowPrint(false)}>Retirar control de impresión</button>
  </>;
}

const root = createRoot(document.getElementById("root")!);
root.render(<Harness />);
