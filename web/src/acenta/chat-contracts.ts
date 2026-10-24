import { ApiError, isUuid } from "./api";

export interface ConversationSummary {
  id: string;
  title: string;
  version: number;
  created_at: string;
  updated_at: string;
}
export interface ChatUsage {
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: string | null;
  reserved_usd: string;
}
export interface ChatTurn {
  operation_id: string;
  number: number;
  user_text: string;
  assistant_text: string | null;
  state: "generating" | "succeeded" | "failed" | "uncertain";
  error_code: string | null;
  usage: ChatUsage;
}
export interface ChatDocument { conversation: ConversationSummary; turns: ChatTurn[] }
export const CHAT_MAX_CHARACTERS = 4096;
export const CHAT_MAX_BYTES = 8192;
const bytes = (text: string) => new TextEncoder().encode(text).length;
const validUnicode = (text: string) => !/[\u0000\uD800-\uDFFF]/u.test(text);
export function chatTextError(text: string): string {
  if (!text.trim()) return "Escribe un mensaje para enviar.";
  if (!validUnicode(text)) return "El mensaje contiene caracteres no admitidos.";
  if ([...text].length > CHAT_MAX_CHARACTERS || bytes(text) > CHAT_MAX_BYTES)
    return "El mensaje admite hasta 4096 caracteres y 8192 bytes. Conservamos tu texto.";
  return "";
}
function assert(value: unknown): asserts value {
  if (!value) throw new ApiError(0, "invalid_response");
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
const count = (value: unknown, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max;
const money = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value));
export function parseConversationSummary(value: unknown): ConversationSummary {
  assert(object(value) && isUuid(value.id) && typeof value.title === "string" &&
    value.title.length <= 4096 && validUnicode(value.title) && count(value.version, 100) &&
    [value.created_at, value.updated_at].every(date => typeof date === "string" && Number.isFinite(Date.parse(date))));
  return value as unknown as ConversationSummary;
}
export function parseChatDocument(value: unknown): ChatDocument {
  assert(object(value) && bytes(JSON.stringify(value)) <= 5 * 1024 * 1024);
  const summary = parseConversationSummary(value.conversation);
  assert(Array.isArray(value.turns) && value.turns.length <= 100 && value.turns.length === summary.version);
  const operations = new Set<string>();
  value.turns.forEach((turn, index) => {
    assert(object(turn) && isUuid(turn.operation_id) && !operations.has(turn.operation_id) &&
      turn.number === index + 1 && typeof turn.user_text === "string" && !chatTextError(turn.user_text) &&
      ["generating", "succeeded", "failed", "uncertain"].includes(String(turn.state)) &&
      (turn.error_code === null || (typeof turn.error_code === "string" && turn.error_code.length <= 200)) &&
      (turn.state === "succeeded"
        ? typeof turn.assistant_text === "string" && !!turn.assistant_text.trim() && validUnicode(turn.assistant_text) && bytes(turn.assistant_text) <= 32768
        : turn.assistant_text === null));
    const usage = turn.usage;
    assert(object(usage) && [usage.input_tokens, usage.output_tokens].every(n => n === null || count(n)) &&
      (usage.estimated_cost_usd === null || money(usage.estimated_cost_usd)) && money(usage.reserved_usd));
    operations.add(turn.operation_id);
  });
  return value as unknown as ChatDocument;
}
export function chatErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "No pudimos confirmar el envío. Conservamos tu texto. Consulta su estado.";
  const messages: Record<string, string> = {
    chat_budget_exhausted: "No se inició el turno: el presupuesto configurado está agotado. Tu texto sigue aquí.",
    generation_budget_exhausted: "No se inició el turno: el presupuesto configurado está agotado. Tu texto sigue aquí.",
    chat_limit_reached: "Esta conversación alcanzó su límite de intentos. Puedes iniciar otra; tu texto sigue aquí.",
    chat_context_too_large: "El historial supera el contexto permitido. Puedes iniciar otra conversación; tu texto sigue aquí.",
    chat_unavailable: "El chat no está disponible. No se inició un turno; tu texto sigue aquí.",
    generation_unavailable: "El chat no está disponible. No se inició un turno; tu texto sigue aquí.",
    chat_busy: "No se inició el turno. Intenta enviar más tarde; tu texto sigue aquí.",
    generation_busy: "No se inició el turno. Intenta enviar más tarde; tu texto sigue aquí.",
    conflict: "La conversación cambió. Actualiza el historial antes de enviar; tu texto sigue aquí.",
    chat_pending: "El turno sigue en proceso. Consulta su estado antes de enviar otro mensaje.",
    chat_uncertain: "El resultado del turno es incierto. Consulta su estado; no se reenviará el mensaje.",
    chat_failed: "El turno falló. Consulta el intento para confirmar su estado; tu texto sigue aquí.",
    not_found: "No encontramos el resultado de este intento. Sigue sin confirmar; no se ha reenviado.",
    invalid_request: "Revisa el mensaje antes de enviarlo. Tu texto sigue aquí.",
    content_too_large: "El mensaje supera el tamaño permitido. Tu texto sigue aquí.",
    request_too_large: "El mensaje supera el tamaño permitido. Tu texto sigue aquí.",
    unauthorized: "La sesión terminó. Vuelve a entrar para recuperar el historial confirmado.",
    csrf_failed: "Comprueba tu sesión antes de continuar.",
  };
  return messages[error.code] ?? "No pudimos confirmar el envío. Conservamos tu texto. Consulta su estado.";
}
/** A rejected admission has no turn; failures after admission require the GET receipt. */
export function chatAdmissionRejected(error: unknown): boolean {
  return error instanceof ApiError && (["chat_budget_exhausted", "generation_budget_exhausted", "chat_limit_reached", "chat_context_too_large", "chat_unavailable", "generation_unavailable", "chat_busy", "generation_busy", "conflict", "invalid_request", "content_too_large", "request_too_large"].includes(error.code));
}
