/** Typed API helpers for printable annexes and Epson Email Print queue. */

import { AcentaApi, ApiError } from "./api";

export type AnnexItemKind = "question" | "exercise" | "reading" | "checklist";

export interface AnnexItem {
  kind: AnnexItemKind;
  text: string;
  answer_lines: number;
}

export interface AnnexSection {
  heading: string;
  prompt: string;
  items: AnnexItem[];
}

export interface AnnexContent {
  subtitle: string;
  student_header_fields: string[];
  sections: AnnexSection[];
  footer_note: string;
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
    printer_email_required:
      "Configura el correo de tu impresora Epson en la sección Impresora antes de imprimir.",
    scheduled_for_required:
      "Elige una fecha y hora para programar la impresión.",
    pdf_exceeds_epson_limit:
      "El PDF con esas copias supera el límite de 20 MB de Epson Email Print. Reduce el número de copias.",
    smtp_not_configured:
      "Falta configurar el servidor SMTP (SMTP_HOST, SMTP_USER, SMTP_PASSWORD) en el servidor.",
    smtp_auth_failed:
      "Error de autenticación SMTP. Revisa tu usuario y contraseña de aplicación.",
    smtp_send_failed:
      "No se pudo enviar el correo a la impresora Epson. Revisa la conexión SMTP.",
    annex_has_pending_print_jobs:
      "Este anexo tiene impresiones pendientes. Cancélalas primero en Impresora.",
  };
  return map[error.code] ?? `Ocurrió un error (${error.code}). Intenta de nuevo.`;
}
