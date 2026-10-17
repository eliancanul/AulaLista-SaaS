import { describe, expect, it } from "vitest";
import { parseRecovery, RECOVERY_TTL, RECOVERY_KEY, EditorRecovery } from "../src/acenta/editor-recovery";
import { planning, session, workspaceId } from "./acenta-fixtures";
const context = crypto.randomUUID();
const now = 1000000;
export function envelope() {
 const d = planning();
 return {schema: 1, principal_id: session.actorId, scope_id: session.scopeId,
 recovery_context_id: context, workspace_id: workspaceId, created_at_ms: now, expires_at_ms: now + 86400000,
 base: {planning_id: d.receipt.planning_id, revision: 1, revision_id: d.receipt.revision_id, resource_key: "observation-sheet", element_key: "instruction"},
 buffer: {text: "Texto nuevo", generation: 1, draft_id: crypto.randomUUID(), draft_revision: 0}, pending: null as any};
}
describe("bounded editor recovery codec", () => {
 it("accepts blank buffers and fixed 24h only", () => {
  const e = envelope(); e.buffer.text = "";
  expect(parseRecovery(JSON.stringify(e), now)).toEqual(e);
  expect(() => parseRecovery(JSON.stringify(e), e.expires_at_ms)).toThrow();
  expect(() => parseRecovery(JSON.stringify(e), now-1)).toThrow();
  e.expires_at_ms++; expect(() => parseRecovery(JSON.stringify(e), now)).toThrow();
  expect(RECOVERY_TTL).toBe(86400000);
 });
 it("rejects extras, invalid unicode, oversized JSON and unsafe generations", () => {
  for (const alter of [(e:any)=>e.prompt="private", (e:any)=>e.buffer.extra=1,
  (e:any)=>e.buffer.text="x".repeat(1001), (e:any)=>e.buffer.text="\ud800",
  (e:any)=>e.buffer.generation=Number.MAX_SAFE_INTEGER+1,
  (e:any)=>e.base.revision=0, (e:any)=>e.recovery_context_id="csrf"]) {
   const e = envelope(); alter(e); expect(() => parseRecovery(JSON.stringify(e), now)).toThrow();
  }
  expect(() => parseRecovery(" ".repeat(16385), now)).toThrow();
 });
 it("keeps exact pending text/CAS and rejects inconsistent generations or keys", () => {
  const e = envelope(); e.pending = {kind:"edit", key:crypto.randomUUID(), planningId:e.base.planning_id,
  generation:1, payload:{contract_version:1, resource_key:e.base.resource_key, element_key:e.base.element_key,
  text:e.buffer.text, expected_revision:1}};
  expect(parseRecovery(JSON.stringify(e),now)).toEqual(e);
  e.buffer.text="Posterior"; expect(() => parseRecovery(JSON.stringify(e),now)).toThrow();
  e.buffer.generation=2; expect(parseRecovery(JSON.stringify(e),now)).toEqual(e);
  e.pending.payload.expected_revision=2; expect(() => parseRecovery(JSON.stringify(e),now)).toThrow();
 });
 it("recognizes only the constant empty tombstone", () => {
  expect(parseRecovery('{"schema":1,"cleared":true}',now)).toBeNull();
  expect(() => parseRecovery('{"schema":1,"cleared":true,"text":"residue"}',now)).toThrow();
 });
 it("does not read before explicit admission and isolates session identity", () => {
  const e=envelope(); let reads=0; const storage={getItem:()=>{reads++;return JSON.stringify(e)},setItem:()=>{},removeItem:()=>{}};
  const r=new EditorRecovery(()=>storage,()=>now); expect(reads).toBe(0);
  expect(r.admit({...e,recovery_context_id:crypto.randomUUID()})).toBeNull();
  expect(reads).toBe(1); expect(RECOVERY_KEY).toBe("acenta:editor-recovery:v1");
 });
});


it("validates copy and draft exact payloads, CAS, UUID and generations as strict unions", () => {
 for(const kind of ["copy","draft"] as const) {
  const e=envelope();e.pending={kind,key:crypto.randomUUID(),planningId:e.base.planning_id,generation:1,
   ...(kind==="draft"?{draftId:e.buffer.draft_id}:{}),payload:{contract_version:1,base_revision:1,
   resource_key:e.base.resource_key,element_key:e.base.element_key,text:e.buffer.text,
   ...(kind==="draft"?{expected_draft_revision:0}:{})}};
  expect(parseRecovery(JSON.stringify(e),now)).toEqual(e);
  for(const alter of [(v:any)=>v.pending.key="invalid",(v:any)=>v.pending.generation=2,
   (v:any)=>v.pending.payload.text=" ", (v:any)=>v.pending.payload.base_revision=2,
   (v:any)=>v.pending.payload.extra=true,(v:any)=>v.pending.planningId=crypto.randomUUID(),
   (v:any)=>v.pending.payload.resource_key="other"]) {
   const v=structuredClone(e);alter(v);expect(()=>parseRecovery(JSON.stringify(v),now)).toThrow();
  }
  if(kind==="draft")for(const alter of [(v:any)=>v.pending.draftId=crypto.randomUUID(),(v:any)=>v.pending.payload.expected_draft_revision=1]) {
   const v=structuredClone(e);alter(v);expect(()=>parseRecovery(JSON.stringify(v),now)).toThrow();
  }
 }
});
it("accepts 1000 astral codepoints and rejects NUL or control-envelope overflow",()=>{
 const e=envelope();e.buffer.text="😀".repeat(1000);expect(parseRecovery(JSON.stringify(e),now)).toEqual(e);
 e.buffer.text="\u0000";expect(()=>parseRecovery(JSON.stringify(e),now)).toThrow();
 for(const alter of [(v:any)=>v.buffer.draft_revision=-1,(v:any)=>v.base.element_key="x".repeat(65),
  (v:any)=>v.created_at_ms=1.5,(v:any)=>v.expires_at_ms=null,(v:any)=>v.schema=2]) {
   const v=envelope();alter(v);expect(()=>parseRecovery(JSON.stringify(v),now)).toThrow();
 }
});
