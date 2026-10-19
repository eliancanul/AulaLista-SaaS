import { useEffect, useId, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { PlanningDocument } from "./contracts";
import { canPrintPlanning, PlanningPrintDocument, planningPrintStyles } from "./PlanningPrintDocument";
import "./planning-print-action.css";

export function PrintPlanningButton({ document: saved }: { document: PlanningDocument }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const active = useRef<(() => void) | null>(null);
  const hint = useId();

  useEffect(() => {
    if (focusRequest) button.current?.focus({ preventScroll: true });
  }, [focusRequest]);

  useEffect(() => {
    setBusy(false);
    setError(false);
    return () => active.current?.();
  }, [saved.receipt.revision_id]);

  const print = async () => {
    if (active.current || !canPrintPlanning(saved)) return;
    const snapshot = structuredClone(saved);
    setBusy(true);
    setError(false);
    const frame = window.document.createElement("iframe");
    frame.dataset.acentaPrint = "";
    frame.title = "Documento de impresión de Acenta";
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    // Keep a laid-out document for the browser's print engine, outside the reader.
    frame.style.cssText = "position:fixed;left:-10000px;top:0;width:8.5in;height:11in;border:0;";
    window.document.body.append(frame);
    const target = frame.contentDocument!;
    const printWindow = frame.contentWindow!;
    const root = createRoot(target.body);
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      printWindow.removeEventListener("afterprint", finish);
      frame.remove();
      // A revision change may dispose this root during the reader's own commit.
      queueMicrotask(() => root.unmount());
      if (active.current === dispose) active.current = null;
    };
    const finish = () => {
      if (disposed) return;
      dispose();
      setBusy(false);
      // Restore focus after React has committed the enabled button.
      setFocusRequest((request) => request + 1);
    };
    active.current = dispose;
    try {
      target.documentElement.lang = "es";
      target.title = `Acenta · Planeación · Revisión ${snapshot.receipt.revision}`;
      const style = target.createElement("style");
      style.textContent = planningPrintStyles;
      target.head.append(style);
      flushSync(() => root.render(<PlanningPrintDocument document={snapshot} />));
      await Promise.all([
        target.fonts.ready,
        ...Array.from(target.images, (image) => image.decode()),
      ]);
      if (disposed) return;
      printWindow.addEventListener("afterprint", finish);
      printWindow.focus();
      printWindow.print();
      // The browser snapshots the document when print() is invoked. Also clean up
      // if it returns without afterprint; neither event proves that anything printed.
      finish();
    } catch {
      if (disposed) return;
      finish();
      setError(true);
    }
  };

  if (!canPrintPlanning(saved)) return null;
  return (
    <div className="planning-print-action">
      <button ref={button} type="button" disabled={busy} aria-describedby={hint} onClick={() => void print()}>
        {busy ? "Preparando impresión…" : "Imprimir"}
      </button>
      <p id={hint}>Abre el diálogo de impresión. Puedes guardar como PDF si tu navegador lo permite.</p>
      {error && <p role="alert">No se pudo abrir la impresión. La revisión guardada sigue disponible; vuelve a intentarlo.</p>}
    </div>
  );
}
