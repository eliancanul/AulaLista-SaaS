import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { AcentaController } from "./controller";
import { ApiError } from "./api";
import type { DidacticToolId } from "./annex-api";
import {
  DocumentsClient,
  type CitedWebResult,
  type TeacherDocumentItem,
} from "./documents-api";
import {
  ArrowRightIcon,
  BookOpenIcon,
  CalendarPlanIcon,
  CameraBookIcon,
  ClipboardGuideIcon,
  CompassNemIcon,
  DocumentToWorksheetIllustration,
  EmptyLibraryIllustration,
  FolderStackIcon,
  GlobeVerifiedIcon,
  PlaneacionDropIllustration,
  ScanDocIcon,
  ShieldLockIcon,
  SparklesIcon,
  UploadArrowIcon,
} from "./StudioVisuals";

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function mimeBadge(mime: string, filename: string): string {
  if (mime === "application/pdf" || filename.toLowerCase().endsWith(".pdf")) {
    return "PDF";
  }
  if (
    mime.includes("wordprocessingml") ||
    filename.toLowerCase().endsWith(".docx")
  ) {
    return "DOCX";
  }
  if (mime.startsWith("image/")) {
    return "IMG";
  }
  return "DOC";
}

function statusLabel(status: TeacherDocumentItem["status"]): string {
  switch (status) {
    case "ready":
      return "Listo";
    case "failed":
      return "Sin texto";
    case "revoked":
      return "Purgado";
    default:
      return "Procesando";
  }
}

const TOOL_OPTIONS: { id: DidacticToolId; label: string }[] = [
  { id: "comprension-lectora", label: "Preguntas de comprensión lectora" },
  { id: "adaptar-material", label: "Adaptar material (lectura fácil)" },
  { id: "diagnostico-breve", label: "Diagnóstico breve" },
  { id: "tarjetas-repaso", label: "Tarjetas de repaso recortables" },
  { id: "quiz-proyectar", label: "Quiz interactivo para proyectar" },
  { id: "sopa-de-letras", label: "Sopa de letras" },
  { id: "rubrica-cotejo", label: "Rúbrica y lista de cotejo" },
  { id: "proyecto-aula", label: "Proyecto de aula" },
];

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

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [docs, setDocs] = useState<TeacherDocumentItem[]>([]);
  const [selected, setSelected] = useState<TeacherDocumentItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [showRevoked, setShowRevoked] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Annex derivation options
  const [toolId, setToolId] = useState<DidacticToolId>("comprension-lectora");
  const [customTopic, setCustomTopic] = useState("");

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

  const uploadFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      setError("El archivo supera el límite de 10 MB.");
      return;
    }
    setBusy("uploading");
    setError("");
    setNotice("");
    setConfirmRevokeId(null);
    try {
      const b64 = await fileToBase64(file);
      const uploaded = await client.uploadDocument(file.name, b64);
      setDocs((prev) => [uploaded, ...prev]);
      setSelected(uploaded);
      setCustomTopic("");
      setNotice(
        uploaded.status === "ready"
          ? `Documento «${uploaded.filename}» procesado correctamente (${uploaded.page_count || 1} pág.).`
          : `Archivo «${uploaded.filename}» guardado, pero no se pudo extraer texto legible (${uploaded.error_code ?? "sin texto"}).`,
      );
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          `Archivo rechazado (${err.code}). Verifica que sea un PDF, DOCX, PNG o JPEG válido.`,
        );
      } else {
        setError("No se pudo subir el documento.");
      }
    } finally {
      setBusy(null);
    }
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) {
      await uploadFile(file);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (busy !== null) return;
    const file = event.dataTransfer.files?.[0];
    if (file) {
      void uploadFile(file);
    }
  };

  const handleSelect = async (doc: TeacherDocumentItem) => {
    setConfirmRevokeId(null);
    setCustomTopic("");
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
      setError("No se pudo leer el contenido extraído del documento.");
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
      setConfirmRevokeId(null);
      setNotice(
        `Acceso revocado y archivo binario purgado permanentemente («${purged.filename}»).`,
      );
    } catch {
      setError("No se pudo revocar y purgar el documento.");
    } finally {
      setBusy(null);
    }
  };

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(key);
      window.setTimeout(() => {
        setCopiedId((cur) => (cur === key ? null : cur));
      }, 1800);
    } catch {
      setError("No se pudo copiar al portapapeles.");
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
        topic: customTopic.trim() || undefined,
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
      if (res.citations.length === 0) {
        setSearchError("No se encontraron fuentes verificables para esa consulta.");
      }
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

  const visibleDocs = docs.filter((d) => {
    if (!showRevoked && d.status === "revoked") return false;
    if (
      filterText.trim() &&
      !d.filename.toLowerCase().includes(filterText.trim().toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const activeCount = docs.filter((d) => d.status !== "revoked").length;
  const revokedCount = docs.length - activeCount;
  const extractedText = selected?.extracted_text ?? "";
  const wordCount = extractedText.trim()
    ? extractedText.trim().split(/\s+/).length
    : 0;

  return (
    <section className="account-studio-view docs-studio" aria-label="Planeaciones y documentos">
      <header className="account-studio-header">
        <div>
          <h1>Planeaciones y documentos</h1>
          <p className="support-muted">
            Sube tus planeaciones, programas analíticos, lecturas o fotos de libro para
            que Acenta trabaje con tu material real y genere fichas listas para tu grupo.
          </p>
        </div>
        <div className="docs-header-actions">
          <button
            type="button"
            className="support-btn-secondary"
            onClick={() => void refresh()}
            disabled={loading || busy !== null}
          >
            Actualizar
          </button>
          <button
            type="button"
            className="support-btn-secondary"
            onClick={() => controller.navigate("home")}
          >
            Volver al chat
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="support-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="support-success">
          {notice}
        </p>
      )}

      {/* Large, obvious hero drag & drop upload zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Arrastra aquí tus planeaciones o haz clic para elegir un archivo"
        className={`docs-dropzone${dragging ? " is-dragging" : ""}${busy === "uploading" ? " is-busy" : ""}`}
        onClick={() => {
          if (busy === null) fileInputRef.current?.click();
        }}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && busy === null) {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setDragging(false);
          }
        }}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
          style={{ display: "none" }}
          disabled={busy !== null}
          onChange={(e) => void handleFileChange(e)}
        />

        <PlaneacionDropIllustration />

        <div className="docs-dropzone-copy">
          <span className="docs-dropzone-kicker">
            <SparklesIcon size={13} />
            {dragging
              ? "Suelta para subir ahora"
              : "Arrastra y suelta aquí tus archivos"}
          </span>
          <strong>
            {busy === "uploading"
              ? "Validando y extrayendo texto de tu documento…"
              : dragging
                ? "¡Suelta aquí tu planeación o documento!"
                : "Arrastra aquí tus planeaciones, programas analíticos o lecturas"}
          </strong>
          <p className="docs-dropzone-sub">
            También puedes hacer clic en cualquier parte de este recuadro para buscarlos
            en tu computadora. Extraemos el texto en un proceso aislado y puedes purgarlos
            cuando quieras.
          </p>

          <div className="docs-examples-row" aria-label="Ejemplos de archivos recomendados">
            <span className="docs-example-chip">
              <CalendarPlanIcon size={14} className="docs-chip-icon is-sage" />
              Planeación semanal
            </span>
            <span className="docs-example-chip">
              <CompassNemIcon size={14} className="docs-chip-icon is-clay" />
              Programa analítico (NEM)
            </span>
            <span className="docs-example-chip">
              <ClipboardGuideIcon size={14} className="docs-chip-icon is-sage" />
              Dosificación / Guía docente
            </span>
            <span className="docs-example-chip">
              <BookOpenIcon size={14} className="docs-chip-icon is-ochre" />
              Lecturas y cuadernillos
            </span>
            <span className="docs-example-chip">
              <CameraBookIcon size={14} className="docs-chip-icon is-clay" />
              Fotos del libro de texto
            </span>
          </div>
        </div>

        <div className="docs-dropzone-cta">
          <button
            type="button"
            className="support-btn-primary docs-dropzone-btn"
            disabled={busy !== null}
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
          >
            <UploadArrowIcon size={16} />
            <span>
              {busy === "uploading" ? "Procesando archivo…" : "Elegir planeación o archivo"}
            </span>
          </button>
          <div className="docs-format-pills" aria-label="Formatos permitidos">
            <span className="docs-format-pill">PDF</span>
            <span className="docs-format-pill">Word (DOCX)</span>
            <span className="docs-format-pill">PNG / JPG</span>
            <span className="docs-format-meta docs-privacy-note">
              <ShieldLockIcon size={13} />
              Máx. 10 MB · Purga irreversible
            </span>
          </div>
        </div>
      </div>

      {/* 3-step visual flow guide */}
      <ol className="docs-steps-strip" aria-label="Cómo funciona en tres pasos">
        <li className="docs-step-card">
          <span className="docs-step-medallion is-clay">
            <UploadArrowIcon size={17} />
          </span>
          <div className="docs-step-copy">
            <span className="docs-step-num">Paso 1</span>
            <strong>Sube tu planeación</strong>
            <span>PDF, Word o foto nítida de tu libro</span>
          </div>
        </li>
        <li className="docs-step-arrow" aria-hidden="true">
          <ArrowRightIcon size={16} />
        </li>
        <li className="docs-step-card">
          <span className="docs-step-medallion is-sage">
            <ScanDocIcon size={17} />
          </span>
          <div className="docs-step-copy">
            <span className="docs-step-num">Paso 2</span>
            <strong>Extraemos el texto</strong>
            <span>OCR seguro en proceso aislado</span>
          </div>
        </li>
        <li className="docs-step-arrow" aria-hidden="true">
          <ArrowRightIcon size={16} />
        </li>
        <li className="docs-step-card">
          <span className="docs-step-medallion is-ochre">
            <SparklesIcon size={17} />
          </span>
          <div className="docs-step-copy">
            <span className="docs-step-num">Paso 3</span>
            <strong>Crea fichas listas</strong>
            <span>Actividades editables para {subject.name}</span>
          </div>
        </li>
      </ol>

      {/* Main 2-column studio workspace */}
      <div className="docs-workspace">
        <article className="docs-card docs-list-panel">
          <div className="docs-card-head">
            <div className="docs-card-title-row">
              <span className="docs-section-medallion is-clay">
                <FolderStackIcon size={16} />
              </span>
              <h2>
                Tus planeaciones y archivos{" "}
                <span className="docs-count-badge">{activeCount}</span>
              </h2>
            </div>
            {revokedCount > 0 && (
              <label className="docs-toggle-revoked">
                <input
                  type="checkbox"
                  checked={showRevoked}
                  onChange={(e) => setShowRevoked(e.target.checked)}
                />
                <span>Ver purgados ({revokedCount})</span>
              </label>
            )}
          </div>

          {docs.length > 0 && (
            <input
              type="search"
              className="docs-filter-input"
              aria-label="Filtrar documentos"
              placeholder="Buscar por nombre de planeación o archivo…"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
          )}

          {loading ? (
            <p className="support-muted">Cargando documentos…</p>
          ) : visibleDocs.length === 0 ? (
            <div className="docs-empty-state">
              <EmptyLibraryIllustration />
              <strong className="docs-empty-title">
                {docs.length === 0
                  ? "Tu biblioteca está lista"
                  : "Sin coincidencias"}
              </strong>
              <p className="support-muted">
                {docs.length === 0
                  ? "Arrastra una planeación, dosificación o lectura al recuadro de arriba para empezar."
                  : "No hay documentos que coincidan con tu filtro."}
              </p>
              {docs.length === 0 && (
                <button
                  type="button"
                  className="support-btn-secondary docs-inline-upload-btn"
                  disabled={busy !== null}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <UploadArrowIcon size={14} />
                  Subir mi primera planeación
                </button>
              )}
            </div>
          ) : (
            <ul className="docs-list">
              {visibleDocs.map((doc) => {
                const isSelected = selected?.id === doc.id;
                const badge = mimeBadge(doc.detected_mime, doc.filename);
                return (
                  <li key={doc.id}>
                    <button
                      type="button"
                      className={`docs-list-item${isSelected ? " is-selected" : ""}${doc.status === "revoked" ? " is-revoked" : ""}`}
                      onClick={() => void handleSelect(doc)}
                    >
                      <span className={`docs-type-tag is-${badge.toLowerCase()}`}>
                        {badge}
                      </span>
                      <span className="docs-item-body">
                        <strong className="docs-item-name">{doc.filename}</strong>
                        <span className="docs-item-meta">
                          {formatBytes(doc.size_bytes)}
                          {doc.page_count > 0 ? ` · ${doc.page_count} pág.` : ""}
                        </span>
                      </span>
                      <span className={`docs-status-pill is-${doc.status}`}>
                        {statusLabel(doc.status)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </article>

        <article className="docs-card docs-detail-panel">
          {!selected ? (
            <div className="docs-empty-detail">
              <DocumentToWorksheetIllustration />
              <h2>Texto extraído y creación de fichas</h2>
              <p className="support-muted">
                Selecciona una planeación de tu biblioteca (o sube una nueva) para
                revisar su texto extraído, copiarlo o transformarlo en una actividad
                editable para <strong>{subject.name}</strong> ({school.grade}).
              </p>
              <div className="docs-preview-outputs" aria-label="Materiales que puedes generar">
                <span className="docs-output-pill">Comprensión lectora</span>
                <span className="docs-output-pill">Lectura fácil</span>
                <span className="docs-output-pill">Sopa de letras</span>
                <span className="docs-output-pill">Rúbrica y cotejo</span>
              </div>
            </div>
          ) : selected.status === "revoked" ? (
            <div className="docs-empty-detail">
              <h2>{selected.filename}</h2>
              <span className="docs-status-pill is-revoked">Purgado permanentemente</span>
              <p className="support-muted" style={{ marginTop: 10 }}>
                El archivo binario y su texto extraído fueron eliminados de forma
                irreversible y bloqueados contra restauración.
              </p>
            </div>
          ) : (
            <>
              <div className="docs-detail-head">
                <div>
                  <h2 style={{ margin: "0 0 4px" }}>{selected.filename}</h2>
                  <p className="support-muted" style={{ margin: 0, fontSize: 12 }}>
                    {formatBytes(selected.size_bytes)}
                    {selected.page_count > 0 ? ` · ${selected.page_count} pág.` : ""}
                    {selected.ocr_engine ? ` · ${selected.ocr_engine}` : ""} · SHA-256{" "}
                    <code>{selected.sha256.slice(0, 12)}…</code>
                  </p>
                </div>
                <div className="docs-detail-actions">
                  {extractedText && (
                    <button
                      type="button"
                      className="support-btn-secondary"
                      onClick={() => void handleCopy(extractedText, selected.id)}
                    >
                      {copiedId === selected.id ? "Texto copiado ✓" : "Copiar texto"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="docs-btn-danger-ghost"
                    disabled={busy !== null}
                    onClick={() =>
                      setConfirmRevokeId(
                        confirmRevokeId === selected.id ? null : selected.id,
                      )
                    }
                  >
                    Revocar y purgar
                  </button>
                </div>
              </div>

              {confirmRevokeId === selected.id && (
                <div className="docs-revoke-confirm" role="alert">
                  <p>
                    <strong>¿Purgar permanentemente «{selected.filename}»?</strong>{" "}
                    Se borrará el archivo binario y el texto extraído sin posibilidad de
                    recuperarlo.
                  </p>
                  <div className="docs-revoke-actions">
                    <button
                      type="button"
                      className="docs-btn-danger"
                      disabled={busy !== null}
                      onClick={() => void handleRevoke(selected)}
                    >
                      {busy === "revoking" ? "Purgando…" : "Sí, purgar ahora"}
                    </button>
                    <button
                      type="button"
                      className="support-btn-secondary"
                      onClick={() => setConfirmRevokeId(null)}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {selected.status === "ready" ? (
                <>
                  <div className="docs-text-meta">
                    <span>Texto extraído</span>
                    <span>
                      {wordCount} palabras · {extractedText.length} caracteres
                    </span>
                  </div>
                  <textarea
                    className="docs-text-preview"
                    readOnly
                    rows={9}
                    aria-label="Texto extraído del documento"
                    value={extractedText}
                  />

                  <div className="docs-derive-box">
                    <div className="docs-derive-head">
                      <strong>
                        <SparklesIcon size={15} className="docs-inline-icon" />
                        Convertir en material editable
                      </strong>
                      <span className="docs-context-pill">
                        {school.shortName} · {school.grade} · {subject.name}
                      </span>
                    </div>
                    <div className="docs-derive-grid">
                      <label className="docs-field">
                        <span>Herramienta didáctica</span>
                        <select
                          aria-label="Herramienta destino"
                          value={toolId}
                          onChange={(e) =>
                            setToolId(e.target.value as DidacticToolId)
                          }
                        >
                          {TOOL_OPTIONS.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="docs-field">
                        <span>Tema o título (opcional)</span>
                        <input
                          type="text"
                          placeholder={selected.filename.replace(/\.[^.]+$/, "")}
                          value={customTopic}
                          onChange={(e) => setCustomTopic(e.target.value)}
                        />
                      </label>
                    </div>
                    <button
                      type="button"
                      className="support-btn-primary docs-dropzone-btn"
                      disabled={busy !== null}
                      onClick={() => void handleGenerateAnnex()}
                    >
                      <SparklesIcon size={15} />
                      <span>
                        {busy === "generating"
                          ? "Creando ficha en Anexos…"
                          : "Crear ficha editable en Anexos"}
                      </span>
                    </button>
                  </div>
                </>
              ) : (
                <p className="support-muted" style={{ marginTop: 12 }}>
                  No se detectó texto extraíble en este archivo ({selected.error_code ?? "sin texto"}).
                  Puedes subir un PDF con texto seleccionable o un archivo DOCX.
                </p>
              )}
            </>
          )}
        </article>
      </div>

      {/* Cited web search */}
      <article className="docs-card docs-search-card">
        <div className="docs-card-head">
          <div className="docs-card-title-row">
            <span className="docs-section-medallion is-sage">
              <GlobeVerifiedIcon size={17} />
            </span>
            <div>
              <h2>Búsqueda web con citas verificables</h2>
              <p className="support-muted" style={{ margin: "2px 0 0", fontSize: 12.5 }}>
                Devuelve únicamente enlaces HTTPS verificables con fecha de consulta para
                respaldar tus planeaciones.
              </p>
            </div>
          </div>
          <span className="docs-verified-pill">
            <ShieldLockIcon size={13} />
            Solo fuentes HTTPS
          </span>
        </div>
        <form
          className="docs-search-form"
          onSubmit={(e) => void handleSearch(e)}
        >
          <input
            type="search"
            aria-label="Consulta de búsqueda con citas"
            placeholder="Ej. Ciclo del agua primaria México SEP"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="submit"
            className="support-btn-secondary"
            disabled={busy !== null || !query.trim()}
          >
            {busy === "searching" ? "Buscando…" : "Buscar citas"}
          </button>
        </form>
        <div className="docs-search-suggestions" aria-label="Ejemplos rápidos de búsqueda">
          <span className="docs-suggestions-label">Prueba con:</span>
          {[
            "Ciclo del agua primaria SEP",
            "Fracciones equivalentes 4° primaria NEM",
            "Revolución Mexicana lectura primaria",
          ].map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="docs-suggestion-chip"
              onClick={() => setQuery(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
        {searchError && (
          <p className="support-muted" style={{ margin: "8px 0 0", fontSize: 12.5 }}>
            {searchError}
          </p>
        )}
        {citations.length > 0 && (
          <ul className="docs-citations-list">
            {citations.map((c, idx) => {
              const citeKey = `cite-${idx}`;
              const formattedCitation = `${c.title} (${c.domain}) — ${c.url}`;
              return (
                <li key={idx} className="docs-citation-row">
                  <div className="docs-citation-body">
                    <div className="docs-citation-title-line">
                      <a href={c.url} target="_blank" rel="noreferrer">
                        <strong>{c.title}</strong>
                      </a>
                      <span className="docs-format-pill">{c.domain}</span>
                    </div>
                    <p>{c.snippet}</p>
                  </div>
                  <button
                    type="button"
                    className="support-btn-secondary"
                    onClick={() => void handleCopy(formattedCitation, citeKey)}
                  >
                    {copiedId === citeKey ? "Copiada ✓" : "Copiar cita"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </article>
    </section>
  );
}
