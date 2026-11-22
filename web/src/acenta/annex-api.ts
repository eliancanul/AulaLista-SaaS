/** Typed API helpers for printable annexes and Epson Email Print queue. */

import { AcentaApi, ApiError } from "./api";

export type AnnexItemKind = "question" | "exercise" | "reading" | "checklist";

export interface AnnexItem {
  kind: AnnexItemKind;
  text: string;
  answer_lines: number;
}

export interface AnnexTable {
  headers: string[];
  rows: string[][];
}

export interface AnnexSection {
  heading: string;
  prompt: string;
  items: AnnexItem[];
  bullets?: string[];
  table?: AnnexTable | null;
}

export interface AnnexContent {
  subtitle: string;
  student_header_fields: string[];
  sections: AnnexSection[];
  footer_note: string;
  tool_kind?: string;
  curricular_trace?: Record<string, unknown> | null;
  teacher_key?: string[];
  metadata?: Record<string, unknown>;
}

export interface AnnexDocument {
  id: string;
  scope_id: string;
  title: string;
  subject: string;
  grade: string;
  topic: string;
  instructions: string;
  content: AnnexContent;
  status: "draft" | "approved";
  provenance: string;
  model: string | null;
  revision: number;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnnexCapability {
  available: boolean;
  model: string;
}

export interface PrintSettings {
  scope_id: string;
  printer_email: string | null;
  default_copies: number;
  default_print_time: string;
  timezone: string;
  smtp_configured: boolean;
  updated_at: string | null;
}

export interface PrintJob {
  id: string;
  scope_id: string;
  annex_id: string | null;
  job_kind: "annex" | "test_page";
  annex_revision: number | null;
  annex_title: string;
  printer_email: string;
  copies: number;
  scheduled_for: string;
  status: "pending" | "sending" | "sent" | "failed" | "cancelled";
  attempts: number;
  last_error: string | null;
  idempotency_key: string;
  created_at: string;
  sent_at: string | null;
}

export interface AnnexGenerateInput {
  subject: string;
  grade: string;
  topic: string;
  annex_type: string;
  language: "es" | "en";
  extra_instructions: string;
}

export interface AnnexUpdateInput {
  title: string;
  subject: string;
  grade: string;
  topic: string;
  instructions: string;
  content: AnnexContent;
}

export interface PrintAnnexInput {
  mode: "now" | "scheduled";
  copies: number;
  scheduled_for?: string | null;
  printer_email?: string | null;
  idempotency_key?: string;
}

export interface AnnexRevisionSummary {
  id: string;
  annex_id: string;
  revision: number;
  title: string;
  subject: string;
  grade: string;
  topic: string;
  reason: string;
  created_at: string;
}

export class AnnexPrintClient {
  constructor(private readonly api: AcentaApi) {}

  get scopeId(): string {
    return this.api.session.scopeId;
  }

  pdfUrl(annexId: string, copies = 1): string {
    return `/scopes/${this.scopeId}/annexes/${annexId}/pdf?copies=${copies}`;
  }

  async capability(): Promise<AnnexCapability> {
    return (await this.api.scopedJson("annex-capability")) as AnnexCapability;
  }

  async listAnnexes(): Promise<AnnexDocument[]> {
    const res = (await this.api.scopedJson("annexes")) as {
      items: AnnexDocument[];
    };
    return res.items;
  }

  async generateAnnex(input: AnnexGenerateInput): Promise<AnnexDocument> {
    return (await this.api.scopedJson(
      "annexes/generate",
      "POST",
      input,
      60000,
    )) as AnnexDocument;
  }

  async updateAnnex(
    annexId: string,
    input: AnnexUpdateInput,
  ): Promise<AnnexDocument> {
    return (await this.api.scopedJson(
      `annexes/${annexId}`,
      "PUT",
      input,
    )) as AnnexDocument;
  }

  async approveAnnex(annexId: string): Promise<AnnexDocument> {
    return (await this.api.scopedJson(
      `annexes/${annexId}/approve`,
      "POST",
    )) as AnnexDocument;
  }

  async deleteAnnex(annexId: string): Promise<void> {
    await this.api.scopedJson(`annexes/${annexId}`, "DELETE");
  }

  async listAnnexRevisions(annexId: string): Promise<AnnexRevisionSummary[]> {
    const res = (await this.api.scopedJson(
      `annexes/${annexId}/revisions`,
    )) as { items: AnnexRevisionSummary[] };
    return res.items;
  }

  async restoreAnnexRevision(
    annexId: string,
    revision: number,
  ): Promise<AnnexDocument> {
    return (await this.api.scopedJson(
      `annexes/${annexId}/revisions/${revision}/restore`,
      "POST",
    )) as AnnexDocument;
  }

  async getPrintSettings(): Promise<PrintSettings> {
    return (await this.api.scopedJson("print-settings")) as PrintSettings;
  }

  async savePrintSettings(input: {
    printer_email: string | null;
    default_copies: number;
    default_print_time: string;
    timezone: string;
  }): Promise<PrintSettings> {
    return (await this.api.scopedJson(
      "print-settings",
      "PUT",
      input,
    )) as PrintSettings;
  }

  async sendTestPage(printer_email?: string | null): Promise<PrintJob> {
    return (await this.api.scopedJson(
      "print-settings/test-page",
      "POST",
      printer_email ? { printer_email } : {},
      45000,
    )) as PrintJob;
  }

  async printAnnex(annexId: string, input: PrintAnnexInput): Promise<PrintJob> {
    return (await this.api.scopedJson(
      `annexes/${annexId}/print`,
      "POST",
      input,
      45000,
    )) as PrintJob;
  }

  async listPrintJobs(): Promise<PrintJob[]> {
    const res = (await this.api.scopedJson("print-jobs")) as {
      items: PrintJob[];
    };
    return res.items;
  }

  async cancelPrintJob(jobId: string): Promise<PrintJob> {
    return (await this.api.scopedJson(
      `print-jobs/${jobId}/cancel`,
      "POST",
    )) as PrintJob;
  }

  async retryPrintJob(jobId: string): Promise<PrintJob> {
    return (await this.api.scopedJson(
      `print-jobs/${jobId}/retry`,
      "POST",
      undefined,
      45000,
    )) as PrintJob;
  }

  async deletePrintJob(jobId: string): Promise<void> {
    await this.api.scopedJson(`print-jobs/${jobId}`, "DELETE");
  }

  async clearPrintJobs(
    status?: "all" | "failed" | "finished" | "sent" | "cancelled" | "pending",
  ): Promise<{ deleted: number; skipped_sending: number }> {
    const query = status && status !== "all" ? `?status=${encodeURIComponent(status)}` : "";
    return (await this.api.scopedJson(`print-jobs${query}`, "DELETE")) as {
      deleted: number;
      skipped_sending: number;
    };
  }
}

export const PRINT_ERROR_MESSAGES: Record<string, string> = {
  smtp_not_configured:
    "El servidor todavía no tiene configurado el correo de envío (SMTP).",
  smtp_auth_failed:
    "El correo remitente rechazó el acceso. Revisa el usuario y la contraseña de aplicación SMTP.",
  smtp_send_failed:
    "No se pudo entregar el correo a Epson. Verifica tu conexión y que el correo Epson sea correcto.",
  smtp_timeout:
    "El servidor de correo tardó demasiado en responder. Intenta reenviar en un momento.",
  pdf_exceeds_epson_limit:
    "El PDF con tantas copias supera el límite de 20 MB de Epson. Reduce las copias e intenta de nuevo.",
  printer_email_required:
    "Falta guardar el correo @print.epsonconnect.com de tu impresora.",
  annex_not_found: "El anexo asociado ya no existe.",
  print_job_sending:
    "Este trabajo se está enviando en este momento y no se puede modificar todavía.",
};

export function humanizePrintError(code: string | null | undefined): string {
  if (!code) {
    return "No se pudo completar el envío. Puedes intentar reenviarlo o verificar la configuración de la impresora.";
  }
  const normalized = code.trim();
  if (PRINT_ERROR_MESSAGES[normalized]) {
    return PRINT_ERROR_MESSAGES[normalized];
  }
  for (const [key, message] of Object.entries(PRINT_ERROR_MESSAGES)) {
    if (normalized.startsWith(`${key}:`) || normalized.includes(key)) {
      return message;
    }
  }
  return "No se pudo completar el envío. Puedes intentar reenviarlo o verificar la configuración de la impresora.";
}

const DRAWING_HINT_RE =
  /(dibuj|ilustr|esquema|recuadro|traza|colorea|mapa|diagrama|gr[aá]fic)/i;

export function needsDrawingBox(text: string): boolean {
  return DRAWING_HINT_RE.test(text);
}

export function cleanHeaderFieldLabel(raw: string): string {
  const cleaned = raw.replace(/[:_\s]+$/g, "").trim();
  return cleaned || raw.trim();
}

export function stripLeadingNumber(text: string): string {
  return text.replace(/^\s*\d+[.)]\s+/, "");
}

export function annexErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "No se pudo completar la operación. Intenta de nuevo.";
  }
  const map: Record<string, string> = {
    openai_not_configured:
      "Falta configurar OPENAI_API_KEY en el servidor para generar anexos con IA.",
    openai_authentication_error:
      "La clave OPENAI_API_KEY fue rechazada por OpenAI. Revísala en la configuración.",
    openai_rate_limited:
      "OpenAI alcanzó el límite temporal de solicitudes. Espera un momento e intenta de nuevo.",
    openai_timeout:
      "OpenAI tardó demasiado en responder. Intenta de nuevo en unos segundos.",
    annex_not_approved:
      "Primero aprueba el anexo para poder enviarlo a la impresora.",
    printer_email_required: PRINT_ERROR_MESSAGES.printer_email_required,
    scheduled_for_required:
      "Elige una fecha y hora para programar la impresión.",
    pdf_exceeds_epson_limit: PRINT_ERROR_MESSAGES.pdf_exceeds_epson_limit,
    smtp_not_configured: PRINT_ERROR_MESSAGES.smtp_not_configured,
    smtp_auth_failed: PRINT_ERROR_MESSAGES.smtp_auth_failed,
    smtp_send_failed: PRINT_ERROR_MESSAGES.smtp_send_failed,
    smtp_timeout: PRINT_ERROR_MESSAGES.smtp_timeout,
    annex_has_pending_print_jobs:
      "Este anexo tiene impresiones pendientes. Cancélalas primero en Impresora.",
    print_job_sending: PRINT_ERROR_MESSAGES.print_job_sending,
  };
  return map[error.code] ?? `Ocurrió un error (${error.code}). Intenta de nuevo.`;
}
