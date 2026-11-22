import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { AcentaController } from "./controller";
import { ApiError } from "./api";
import type { DidacticToolId } from "./annex-api";
import {
  DocumentsClient,
  type CitedWebResult,
  type TeacherDocumentItem,
} from "./documents-api";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(new Error("read_error"));
    reader.readAsDataURL(file);
  });
}

export function DocumentsView({
  controller,
}: {
  controller: AcentaController;
}) {
  const client = useMemo(
    () => new DocumentsClient(controller.api),
    [controller.api],
  );
  useSyncExternalStore(controller.schools.subscribe, controller.schools.snapshot);
  const school = controller.schools.getActiveSchool();
  const subject = controller.schools.getActiveSubject();

  const [docs, setDocs] = useState<TeacherDocumentItem[]>([]);
  const [selected, setSelected] = useState<TeacherDocumentItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [toolId, setToolId] = useState<DidacticToolId>("comprension-lectora");

  // Optional cited web search
  const [query, setQuery] = useState("");
  const [citations, setCitations] = useState<CitedWebResult[]>([]);
  const [searchError, setSearchError] = useState("");

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await client.listDocuments();
      setDocs(list);
      setError("");
    } catch {
      setError("No se pudieron cargar los documentos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError("El archivo supera el límite de 10 MB.");
      return;
    }
    setBusy("uploading");
    setError("");
    setNotice("");
    try {
      const b64 = await fileToBase64(file);
      const uploaded = await client.uploadDocument(file.name, b64);
      setDocs((prev) => [uploaded, ...prev]);
      setSelected(uploaded);
      setNotice(
        `Documento '${uploaded.filename}' validado y procesado (${uploaded.ocr_engine}).`,
      );
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`Archivo rechazado (${err.code}). Solo PDF, DOCX, PNG o JPEG válidos.`);
      } else {
        setError("No se pudo subir el documento.");
      }
    } finally {
      setBusy(null);
    }
  };

  const handleSelect = async (doc: TeacherDocumentItem) => {
    if (doc.status === "revoked") {
      setSelected(doc);
      return;
    }
    setBusy("reading");
    setError("");
    try {
      const full = await client.readDocument(doc.id);
      setSelected(full);
    } catch {
      setError("No se pudo leer el documento.");
    } finally {
      setBusy(null);
    }
  };

  const handleRevoke = async (doc: TeacherDocumentItem) => {
    setBusy("revoking");
    setError("");
    setNotice("");
    try {
      const purged = await client.revokeDocument(doc.id);
      setDocs((prev) => prev.map((d) => (d.id === purged.id ? purged : d)));
      if (selected?.id === purged.id) {
        setSelected(purged);
      }
      setNotice(
        `Acceso revocado y archivo binario purgado permanentemente ('${purged.filename}').`,
      );
    } catch {
      setError("No se pudo revocar el documento.");
    } finally {
      setBusy(null);
    }
  };

  const handleGenerateAnnex = async () => {
    if (!selected || selected.status !== "ready") return;
    setBusy("generating");
    setError("");
    setNotice("");
    try {
      await client.generateAnnexFromDocument(selected.id, {
        tool_id: toolId,
        subject: subject.name,
        grade: school.gradeLong,
      });
      setNotice("Ficha editable creada en Anexos a partir de tu documento.");
      controller.navigate("annexes");
    } catch {
      setError("No se pudo generar una ficha desde este documento.");
    } finally {
      setBusy(null);
    }
  };

  const handleSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setBusy("searching");
    setSearchError("");
    try {
      const res = await client.webSearch(query.trim());
      setCitations(res.citations);
    } catch (err) {
      if (err instanceof ApiError && err.code === "web_search_unavailable") {
        setSearchError(
          "La búsqueda web con citas está desactivada por configuración (AULALISTA_WEB_SEARCH_ENABLED=true).",
        );
      } else {
        setSearchError("No se pudo realizar la búsqueda en este momento.");
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="account-studio" aria-label="Documentos y OCR">
      <header className="studio-topbar">
        <div className="studio-topbar-left">
          <h1 className="studio-title">Documentos</h1>
          <p className="minimal-studio-kicker">
            PDF, DOCX, PNG y JPEG · validación segura, OCR aislado y purga irreversible
          </p>
        </div>
        <div className="topbar-right">
          <button
            type="button"
            className="minimal-ghost-btn"
            onClick={() => controller.navigate("home")}
          >
            Volver al chat
          </button>
        </div>
      </header>

      <div className="account-grid">
        {error && (
          <div role="alert" className="ac-banner is-error">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="ac-banner is-success">
            {notice}
          </div>
        )}

        <article className="glass-card account-card">
          <h2>Subir documento real</h2>
          <p className="field-hint">
            Validación estricta por firma binaria (máx. 10 MB). Extracción en proceso aislado.
          </p>
          <label className="btn-accent-pill" style={{ width: "fit-content" }}>
            {busy === "uploading" ? "Procesando…" : "Elegir PDF, DOCX o imagen"}
            <input
              type="file"
              accept=".pdf,.docx,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
              style={{ display: "none" }}
              disabled={busy !== null}
              onChange={(e) => void handleUpload(e)}
            />
          </label>

          <h3>Tus documentos ({docs.length})</h3>
          {loading ? (
            <p className="field-hint">Cargando…</p>
          ) : docs.length === 0 ? (
            <p className="field-hint">Todavía no has subido documentos reales.</p>
          ) : (
            <ul className="annex-revisions-list">
              {docs.map((doc) => (
                <li key={doc.id} className="annex-revision-row">
                  <div>
                    <strong>{doc.filename}</strong>
                    <span className="annex-revision-meta">
                      {" "}
                      · {doc.status} · {(doc.size_bytes / 1024).toFixed(1)} KB
                    </span>
                  </div>
                  <div className="minimal-canvas-tools">
                    {doc.status !== "revoked" && (
                      <>
                        <button
                          type="button"
                          className="glass-btn-sm"
                          onClick={() => void handleSelect(doc)}
                        >
                          Ver texto
                        </button>
                        <button
                          type="button"
                          className="glass-btn-sm"
                          disabled={busy !== null}
                          onClick={() => void handleRevoke(doc)}
                        >
                          Revocar y purgar
                        </button>
                      </>
                    )}
                    {doc.status === "revoked" && (
                      <span className="annex-revision-meta">Purgado</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="glass-card account-card">
          <h2>Texto extraído y generación</h2>
          {selected && selected.status === "ready" ? (
            <>
              <p className="field-hint">
                <strong>{selected.filename}</strong> · {selected.page_count} pág. ·{" "}
                {selected.ocr_engine} · SHA-256{" "}
                <code>{selected.sha256.slice(0, 12)}…</code>
              </p>
              <textarea
                readOnly
                rows={8}
                aria-label="Texto extraído del documento"
                value={selected.extracted_text ?? ""}
                style={{ width: "100%", padding: 10 }}
              />
              <div className="minimal-canvas-tools">
                <select
                  aria-label="Herramienta destino"
                  value={toolId}
                  onChange={(e) => setToolId(e.target.value as DidacticToolId)}
                >
                  <option value="comprension-lectora">Preguntas sobre el texto</option>
                  <option value="adaptar-material">Adaptar material (lectura fácil)</option>
                  <option value="diagnostico-breve">Diagnóstico breve</option>
                  <option value="tarjetas-repaso">Tarjetas de repaso</option>
                  <option value="quiz-proyectar">Quiz para proyectar</option>
                </select>
                <button
                  type="button"
                  className="btn-accent-pill"
                  disabled={busy !== null}
                  onClick={() => void handleGenerateAnnex()}
                >
                  {busy === "generating"
                    ? "Generando…"
                    : "Crear ficha editable"}
                </button>
              </div>
            </>
          ) : (
            <p className="field-hint">
              Selecciona un documento procesado para revisar su texto extraído y crear una ficha editable.
            </p>
          )}
        </article>

        <article className="glass-card account-card">
          <h2>Búsqueda web con citas (opcional)</h2>
          <p className="field-hint">
            Solo devuelve fuentes verificables con enlace HTTPS y fecha de consulta.
          </p>
          <form
            className="minimal-canvas-tools"
            onSubmit={(e) => void handleSearch(e)}
          >
            <input
              type="search"
              aria-label="Consulta de búsqueda con citas"
              placeholder="Ej. Ciclo del agua primaria México"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ flex: 1, minWidth: 220, padding: "8px 12px" }}
            />
            <button
              type="submit"
              className="glass-btn-sm"
              disabled={busy !== null || !query.trim()}
            >
              {busy === "searching" ? "Buscando…" : "Buscar citas"}
            </button>
          </form>
          {searchError && <p className="field-hint">{searchError}</p>}
          {citations.length > 0 && (
            <ul className="annex-revisions-list">
              {citations.map((c, idx) => (
                <li key={idx} className="annex-revision-row">
                  <div>
                    <a href={c.url} target="_blank" rel="noreferrer">
                      <strong>{c.title}</strong>
                    </a>{" "}
                    <span className="annex-revision-meta">({c.domain})</span>
                    <p style={{ margin: "4px 0 0", fontSize: 12.5 }}>{c.snippet}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
    </section>
  );
}
