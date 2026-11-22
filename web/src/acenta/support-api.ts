/** Typed API clients for Support Debug Backlog and Account Management. */

import type { AcentaApi } from "./api";
import type { DebugBundle } from "./debug-telemetry";

export type SupportCategory = "bug" | "ui" | "impresion" | "ia" | "cuenta" | "sugerencia";
export type SupportSeverity = "low" | "medium" | "high" | "critical";
export type SupportStatus = "open" | "investigating" | "resolved" | "wontfix";

export interface SupportTicketSummary {
  id: string;
  scope_id: string;
  category: SupportCategory;
  severity: SupportSeverity;
  status: SupportStatus;
  summary: string;
  description: string;
  view_name: string | null;
  route_url: string | null;
  has_screenshot: boolean;
  screenshot_bytes: number;
  screenshot_sha256: string | null;
  screenshot_url: string | null;
  triage_notes: string;
  console_error_count: number;
  failed_request_count: number;
  created_at: string;
  updated_at: string;
  debug_bundle?: DebugBundle & Record<string, unknown>;
  server_diagnostics?: Record<string, unknown>;
}

export interface SupportBacklogList {
  scope_id: string;
  total: number;
  counts_by_status: Record<SupportStatus, number>;
  counts_by_severity: Record<SupportSeverity, number>;
  items: SupportTicketSummary[];
}

export interface AccountIdentityItem {
  id: string;
  provider: string;
  email: string;
  email_verified: boolean;
}

export interface AccountDocument {
  principal_id: string;
  scope_id: string;
  identities: AccountIdentityItem[];
  promotional_consent: boolean;
  promotional_consent_updated_at: string | null;
  consent_history: Array<{ promotional_consent: boolean; at: string; source: string }>;
  capabilities: {
    email_otp_available: boolean;
    google_available: boolean;
  };
}

export async function createSupportTicket(
  api: AcentaApi,
  payload: {
    category: SupportCategory;
    severity: SupportSeverity;
    summary: string;
    description: string;
    view_name?: string | null;
    route_url?: string | null;
    screenshot_data_url?: string | null;
    debug_bundle: DebugBundle;
  },
): Promise<SupportTicketSummary> {
  return (await api.scopedJson("support/tickets", "POST", payload, 30000)) as SupportTicketSummary;
}

export async function listSupportTickets(
  api: AcentaApi,
  filters?: { status?: SupportStatus | ""; severity?: SupportSeverity | "" },
): Promise<SupportBacklogList> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.severity) params.set("severity", filters.severity);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return (await api.scopedJson(`support/tickets${qs}`)) as SupportBacklogList;
}

export async function getSupportTicket(
  api: AcentaApi,
  ticketId: string,
): Promise<SupportTicketSummary> {
  return (await api.scopedJson(`support/tickets/${ticketId}`)) as SupportTicketSummary;
}

export async function updateSupportTicket(
  api: AcentaApi,
  ticketId: string,
  payload: { status?: SupportStatus; severity?: SupportSeverity; triage_notes?: string },
): Promise<SupportTicketSummary> {
  return (await api.scopedJson(`support/tickets/${ticketId}`, "PATCH", payload)) as SupportTicketSummary;
}

export function supportBacklogDownloadUrl(api: AcentaApi): string {
  return `/scopes/${api.session.scopeId}/support/backlog.json`;
}

export async function getAccount(api: AcentaApi): Promise<AccountDocument> {
  return (await api.scopedJson("account")) as AccountDocument;
}

export async function updateAccountPreferences(
  api: AcentaApi,
  promotionalConsent: boolean,
): Promise<AccountDocument> {
  return (await api.scopedJson("account/preferences", "PUT", {
    promotional_consent: promotionalConsent,
    source: "account_settings",
  })) as AccountDocument;
}

export async function requestEmailLink(
  api: AcentaApi,
  email: string,
): Promise<{ challenge_id: string; email: string; expires_at: string; message: string }> {
  return (await api.scopedJson("account/link/email/request", "POST", { email })) as {
    challenge_id: string;
    email: string;
    expires_at: string;
    message: string;
  };
}

export async function verifyEmailLink(
  api: AcentaApi,
  challengeId: string,
  code: string,
): Promise<AccountDocument> {
  return (await api.scopedJson("account/link/email/verify", "POST", {
    challenge_id: challengeId,
    code,
  })) as AccountDocument;
}
