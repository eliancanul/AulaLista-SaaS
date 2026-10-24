import type { Transport } from "../src/acenta/api";
import type { ChatDocument, ChatTurn } from "../src/acenta/chat-contracts";
import { json, session } from "./acenta-fixtures";
export const chatId = "71000000-0000-4000-8000-000000000001";
export const otherChatId = "71000000-0000-4000-8000-000000000002";
export const chatDocument = (id = chatId): ChatDocument => ({conversation: {
  id, title: "Conversación sintética", version: 0,
  created_at: "2026-10-24T10:00:00Z", updated_at: "2026-10-24T10:00:00Z",
}, turns: []});
export function appendTurn(doc: ChatDocument, key: string, text: string, state: ChatTurn["state"] = "succeeded") {
  doc.conversation.version++;
  doc.turns.push({operation_id: key, number: doc.conversation.version, user_text: text,
    assistant_text: state === "succeeded" ? `Respuesta sintética ${doc.conversation.version}: ${doc.turns[0]?.user_text ?? text}` : null,
    state, error_code: state === "failed" ? "chat_failed" : null,
    usage: {input_tokens: 23, output_tokens: 10, estimated_cost_usd: "0.000120", reserved_usd: "0.020000"}});
  return doc;
}
export interface ChatCall {path: string; method: string; key: string | null; body: unknown; init: RequestInit}
export class ChatServer {
  calls: ChatCall[] = [];
  documents = new Map<string, ChatDocument>();
  creates = new Map<string, string>();
  available = true;
  intercept?: (call: ChatCall) => Response | Promise<Response> | undefined;
  transport: Transport = async (url, init = {}) => {
    const call: ChatCall = {path: String(url).split(`/scopes/${session.scopeId}/`)[1], method: init.method ?? "GET",
      key: new Headers(init.headers).get("Idempotency-Key"), body: init.body ? JSON.parse(String(init.body)) : null, init};
    this.calls.push(call);
    const intercepted = this.intercept?.(call);
    return intercepted === undefined ? this.handle(call) : intercepted;
  };
  handle(call: ChatCall): Response {
    if (call.path === "chat-capability") return json({available: this.available});
    if (call.path === "conversations" && call.method === "POST") {
      const id = crypto.randomUUID(), doc = chatDocument(id);
      this.documents.set(id, doc); this.creates.set(call.key!, id);
      return json(doc, 201);
    }
    if (call.path.startsWith("conversation-operations/")) {
      const id = this.creates.get(call.path.split("/")[1]);
      return id ? json(this.documents.get(id)) : json({detail: "not_found"}, 404);
    }
    if (call.path.startsWith("conversations?")) {
      const query = new URLSearchParams(call.path.split("?")[1]);
      const items = [...this.documents.values()].map(doc => doc.conversation).filter(item => item.id > (query.get("cursor") ?? "")).sort((a, b) => a.id.localeCompare(b.id));
      const limit = Number(query.get("limit")), page = items.slice(0, limit);
      return json({items: page, next_cursor: items.length > limit ? page.at(-1)!.id : null});
    }
    const parts = call.path.split("/"), doc = this.documents.get(parts[1]);
    if (!doc) return json({detail: "not_found"}, 404);
    if (call.method === "GET") return json(doc);
    const body = call.body as {text: string; expected_version: number};
    if (body.expected_version !== doc.conversation.version) return json({detail: "conflict"}, 409);
    return json(appendTurn(doc, call.key!, body.text), 201);
  }
}
export function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return {promise, resolve};
}
