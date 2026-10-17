import { describe, expect, it, vi } from "vitest";
import { AuthApi, AuthController } from "../src/acenta/auth";
import { EditorRecovery, RECOVERY_KEY, RECOVERY_TTL } from "../src/acenta/editor-recovery";
import { FixtureServer, planning, revised, session, json } from "./acenta-fixtures";
import type { Transport } from "../src/acenta/api";

function harness() {
  let time=1_000_000;
  let active:any={principal_id:session.actorId,scope_id:session.scopeId,csrf_token:"CSRF-MUST-NOT-PERSIST",recovery_context_id:crypto.randomUUID()};
  const server=new FixtureServer(), doc=server.put(planning());
  let raw:string|null=null, failRead=false, failWrite=false, failDelete=false, reads=0, writes=0;
  const store={getItem:(key:string)=>{expect(key).toBe(RECOVERY_KEY);reads++;if(failRead)throw Error("read");return raw;},
    setItem:(key:string,value:string)=>{expect(key).toBe(RECOVERY_KEY);writes++;if(failWrite)throw Error("quota");raw=value;},
    removeItem:(key:string)=>{expect(key).toBe(RECOVERY_KEY);if(failDelete)throw Error("delete");raw=null;}};
  const transport=vi.fn<Transport>(async(input,init)=>{
    if (input==="/auth/session") return active?json(active):json({detail:"unauthorized"},401);
    if (input==="/auth/bootstrap") return json({csrf_token:"pre",google_nonce:"nonce",google_client_id:null,email_available:true});
    if (input==="/auth/logout") {active=null;return new Response(null,{status:204});}
    return server.transport(input,init);
  });
  const fresh=()=>new AuthController(new AuthApi(transport),new EditorRecovery(()=>store,()=>time));
  return {server,doc,transport,fresh,store,get raw(){return raw},set raw(v){raw=v},get reads(){return reads},get writes(){return writes},get active(){return active},set active(v){active=v},set time(v:number){time=v},get time(){return time},fail(read=false,write=false,remove=false){failRead=read;failWrite=write;failDelete=remove;}};
}
async function editing(h:ReturnType<typeof harness>) {
 const auth=h.fresh(); await auth.start();const c=auth.snapshot().controller!;c.openEditor(h.doc);c.edit("Edición exacta 😀");return {auth,c};
}
describe("same-session reload through authenticated runtime",()=>{
 it("persists only the editor projection, adopts workspace, fixed TTL and exact authenticated base",async()=>{
  const h=harness();const {c}=await editing(h);
  c.setPrompt("PROMPT-NOT-PERMITTED");
  const raw=h.raw!,e=JSON.parse(raw);
  expect(raw).not.toContain("PROMPT-NOT-PERMITTED");expect(raw).not.toContain("CSRF-MUST-NOT-PERSIST");
  expect(Object.keys(e)).toEqual(["schema","principal_id","scope_id","recovery_context_id","workspace_id","created_at_ms","expires_at_ms","base","buffer","pending"]);
  h.time+=100;const reload=h.fresh();await reload.start();const restored=reload.snapshot().controller!;
  expect(restored.snapshot().editor).toMatchObject({text:"Edición exacta 😀",document:h.doc,pending:null,save:"dirty"});
  expect(h.server.calls.some(c=>c.path.endsWith(`/revisions/1`))).toBe(true);
  expect(h.server.calls.every(c=>c.method==="GET")).toBe(true);
  restored.edit("Posterior");expect(JSON.parse(h.raw!).expires_at_ms).toBe(e.expires_at_ms);
  expect(JSON.parse(h.raw!).workspace_id).toBe(e.workspace_id);
 });
 for(const kind of ["edit","copy","draft"] as const) it(`recovers committed ${kind} with exact namespace and preserves text written later`,async()=>{
  const h=harness();const {c}=await editing(h);
  h.server.after=async(call,response)=>{if(call.method!=="GET")throw Error("lost");return response};
  if(kind==="draft")await c.preserveDraft();else await c.save(kind==="copy");
  const pending=structuredClone(c.snapshot().editor!.pending);expect(pending).not.toBeNull();
  c.edit("Texto posterior B");const before=JSON.parse(h.raw!);
  h.server.after=null;h.server.calls=[];
  const reload=h.fresh();await reload.start();const restored=reload.snapshot().controller!;
  expect(restored.snapshot().editor!.pending).toEqual(pending);
  expect(h.server.calls.every(c=>c.method==="GET")).toBe(true);
  await restored.recoverEditor();
  expect(restored.snapshot().editor).toMatchObject({pending:null,text:"Texto posterior B",save:"dirty"});
  expect(h.server.calls.some(c=>c.path===`${kind==="draft"?"planning-draft-operations":"planning-operations"}/${pending!.key}`)).toBe(true);
  expect(h.server.calls.every(c=>c.method==="GET")).toBe(true);
  expect(JSON.parse(h.raw!).buffer.text).toBe("Texto posterior B");
  expect(JSON.parse(h.raw!).expires_at_ms).toBe(before.expires_at_ms);
 });
 for(const kind of ["edit","copy","draft"] as const) it(`replays missing ${kind} with the identical key, body and destination only on request`,async()=>{
  const h=harness();const {c}=await editing(h);h.server.before=async(call)=>{if(call.method!=="GET")throw Error("offline")};
  if(kind==="draft")await c.preserveDraft();else await c.save(kind==="copy");
  const write=h.server.calls.find(c=>c.method!=="GET")!;h.server.before=null;h.server.calls=[];
  const reload=h.fresh();await reload.start();expect(h.server.calls.every(c=>c.method==="GET")).toBe(true);
  await reload.snapshot().controller!.recoverEditor();
  expect(h.server.calls.find(c=>c.method!=="GET")).toEqual(write);expect(h.raw).toBeNull();
 });
 it("cloned tabs preserve the same pending and a single durable operation",async()=>{
  const h=harness();const {c}=await editing(h);h.server.before=async(call)=>{if(call.method!=="GET")throw Error("offline")};await c.save();h.server.before=null;
  const clone=h.raw;const a=h.fresh();await a.start();h.raw=clone;const b=h.fresh();await b.start();
  await a.snapshot().controller!.recoverEditor();await b.snapshot().controller!.recoverEditor();
  expect(h.server.docs.size).toBe(1);expect(h.server.docs.get(h.doc.receipt.planning_id)!.receipt.revision).toBe(2);
 });
 it("reconciles residue without durable intent after commit and both cleanup paths fail",async()=>{
  const h=harness();const {c}=await editing(h);const old=h.raw;h.fail(false,true,true);
  await c.save();expect(c.snapshot().editor!.save).toBe("saved");expect(h.raw).toBe(old);expect(c.snapshot().recoveryWarning).toContain("limpieza");
  h.fail();h.server.calls=[];const reload=h.fresh();await reload.start();const e=reload.snapshot().controller!.snapshot().editor!;
  expect(e).toMatchObject({pending:null,save:"conflict"});expect(e.error).toContain("residuo");
  expect(h.server.calls.every(c=>c.method==="GET")).toBe(true);expect(JSON.parse(h.raw!).pending).toBeNull();
 });
 it("reconciles a draft residue without changing its CAS or inventing a retry",async()=>{
  const h=harness();const {c}=await editing(h);h.fail(false,true,true);await c.preserveDraft();h.fail();h.server.calls=[];
  const reload=h.fresh();await reload.start();const e=reload.snapshot().controller!.snapshot().editor!;
  expect(e).toMatchObject({pending:null,save:"conflict",draftRevision:0});expect(h.server.calls.every(c=>c.method==="GET")).toBe(true);
 });
 it("uses a content-free tombstone if remove fails and reports physical cleanup honestly",async()=>{
  const h=harness();const {c}=await editing(h);h.fail(false,false,true);await c.save();
  expect(h.raw).toBe('{"schema":1,"cleared":true}');expect(c.snapshot().recoveryWarning).toContain("Puede quedar");
  h.fail();const reload=h.fresh();await reload.start();expect(reload.snapshot().controller!.snapshot().editor).toBeNull();expect(h.raw).toBeNull();
 });
 it("does not loop writes on quota failure and keeps the in-memory text",async()=>{
  const h=harness();const {c}=await editing(h);h.fail(false,true);c.edit("A");const n=h.writes;c.edit("B");c.edit("C");
  expect(h.writes).toBe(n);expect(c.snapshot().editor!.text).toBe("C");expect(c.snapshot().recoveryWarning).toContain("no está disponible");
 });
 for(const failure of ["503","401","403","context","scope","legacy"] as const) it(`${failure} never exposes the old slot without same-session authority`,async()=>{
  const h=harness();await editing(h);const old=h.raw,reads=h.reads;
  if(failure==="context")h.active={...h.active,recovery_context_id:crypto.randomUUID()};
  else if(failure==="scope")h.active={...h.active,scope_id:crypto.randomUUID()};
  else if(failure==="legacy")h.active={...h.active,recovery_context_id:null};
  else h.transport.mockResolvedValueOnce(json({detail:"unavailable"},Number(failure)));
  const reload=h.fresh();await reload.start();
  expect(reload.snapshot().controller?.snapshot().editor??null).toBeNull();
  if(failure==="503"){expect(h.reads).toBe(reads);expect(h.raw).toBe(old);}else expect(h.raw).toBeNull();
 });
 it("retains an unreadable or malformed slot visibly without silently overwriting it",async()=>{
  const h=harness();await editing(h);h.raw='{"unknown":"private"}';const reload=h.fresh();await reload.start();
  const c=reload.snapshot().controller!;expect(c.snapshot().recoveryWarning).toContain("No pudimos utilizar");c.openEditor(h.doc);c.edit("Different");expect(h.raw).toBe('{"unknown":"private"}');
  c.discardRecovery();expect(h.raw).toBeNull();
 });
 it("base failure preserves envelope and retry requires fresh successful exact reads",async()=>{
  const h=harness();await editing(h);const old=h.raw;h.server.before=async()=>json({detail:"unavailable"},503);
  const reload=h.fresh();await reload.start();const c=reload.snapshot().controller!;expect(c.snapshot().editor).toBeNull();expect(c.snapshot().recoveryAvailable).toBe(true);expect(h.raw).toBe(old);
  h.server.before=null;await c.restoreRecovery();expect(c.snapshot().editor!.text).toBe("Edición exacta 😀");
 });
 it("rejects wrong revision identity even when planning/revision number match",async()=>{
  const h=harness();await editing(h);const e=JSON.parse(h.raw!);e.base.revision_id=crypto.randomUUID();h.raw=JSON.stringify(e);
  const reload=h.fresh();await reload.start();expect(reload.snapshot().controller!.snapshot().editor).toBeNull();
 });
 it("checks TTL again immediately before adopting delayed reads",async()=>{
  const h=harness();await editing(h);h.server.before=async()=>{h.time+=RECOVERY_TTL};
  const reload=h.fresh();await reload.start();expect(reload.snapshot().controller!.snapshot().editor).toBeNull();expect(h.raw).toBeNull();
 });
 it("local clock rollback or expiry cannot extend the admission window",async()=>{
  for(const delta of [-1,RECOVERY_TTL]){const h=harness();await editing(h);h.time+=delta;const reload=h.fresh();await reload.start();expect(reload.snapshot().controller!.snapshot().editor).toBeNull();expect(h.raw).toBeNull();}
 });
 it("a pre-hide receipt cannot apply or clear the newer buffer after resume",async()=>{
  const h=harness();const {auth,c}=await editing(h);let release!:(v:Response)=>void;
  h.server.after=async(call,response)=>call.method!=="GET"?new Promise(r=>release=()=>r(response)):response;
  const saving=c.save();await vi.waitFor(()=>expect(release).toBeDefined());c.edit("B after A");auth.suspend();h.server.after=null;await auth.revalidate();const before=h.raw;
  release(json({}));await saving;expect(c.snapshot().editor!.text).toBe("B after A");expect(h.raw).toBe(before);expect(c.snapshot().editor!.pending).not.toBeNull();
  await c.recoverEditor();expect(c.snapshot().editor).toMatchObject({text:"B after A",pending:null,save:"dirty"});
 });
 it("hidden invalidates delayed restoration; pageshow admission deduplicates while retrying",async()=>{
  const h=harness();await editing(h);let release!:()=>void;let once=true;
  h.server.before=async()=>{if(once){once=false;await new Promise<void>(r=>release=r)}};
  const reload=h.fresh(),starting=reload.start();await vi.waitFor(()=>expect(release).toBeDefined());reload.suspend();
  expect(reload.snapshot().phase).toBe("suspended");h.server.before=null;await reload.revalidate();const current=reload.snapshot().controller!.snapshot().editor;
  release();await starting;expect(reload.snapshot().phase).toBe("ready");expect(reload.snapshot().controller!.snapshot().editor).toBe(current);
 });
 it("failed logout plus impossible cleanup is visibly unconfirmed; reload may see the still-live session",async()=>{
  const h=harness();const {auth}=await editing(h);const old=h.raw;h.fail(false,true,true);h.transport.mockResolvedValueOnce(json({detail:"unavailable"},503));await auth.logout();
  expect(auth.snapshot().phase).toBe("logout-error");expect(auth.snapshot().recoveryWarning).toContain("limpieza");expect(h.raw).toBe(old);
  h.fail();const reload=h.fresh();await reload.start();expect(reload.snapshot().controller!.snapshot().editor!.text).toBe("Edición exacta 😀");
 });
 it("server expiry wins even with a backwards local clock",async()=>{
  const h=harness();await editing(h);h.active=null;h.time-=100;const reload=h.fresh();await reload.start();expect(h.raw).toBeNull();expect(reload.snapshot().controller).toBeNull();
 });
});


it("discard while an exact-base retry is delayed cannot resurrect the old editor",async()=>{
 const h=harness();await editing(h);h.server.before=async()=>json({detail:"unavailable"},503);
 const auth=h.fresh();await auth.start();const c=auth.snapshot().controller!;
 let release!:()=>void;let once=true;
 h.server.before=async()=>{if(once){once=false;await new Promise<void>(r=>release=r)}};
 const restoring=c.restoreRecovery();await vi.waitFor(()=>expect(release).toBeDefined());
 c.discardRecovery();expect(h.raw).toBeNull();release();await restoring;
 expect(c.snapshot().editor).toBeNull();expect(c.snapshot().recoveryAvailable).toBe(false);expect(h.raw).toBeNull();
});


it("periodic auth observation preserves an in-flight save and its exact callback",async()=>{
 const h=harness();const {auth,c}=await editing(h);let release!:()=>void;
 h.server.after=async(call,response)=>{if(call.method!=="GET")await new Promise<void>(r=>release=r);return response};
 const saving=c.save();await vi.waitFor(()=>expect(release).toBeDefined());
 const pending=c.snapshot().editor!.pending;await auth.revalidate();
 expect(auth.snapshot().phase).toBe("ready");expect(c.snapshot().editor!.pending).toBe(pending);
 release();await saving;expect(c.snapshot().editor).toMatchObject({pending:null,save:"saved"});expect(h.raw).toBeNull();
});
it("activation supersedes an in-flight periodic check and waits for a new authority response",async()=>{
 const h=harness();const {auth}=await editing(h);let old!:(r:Response)=>void,current!:(r:Response)=>void;
 h.transport.mockImplementationOnce(()=>new Promise(r=>old=r));const poll=auth.revalidate();
 h.transport.mockImplementationOnce(()=>new Promise(r=>current=r));const activation=auth.revalidate(true);
 expect(auth.snapshot().phase).toBe("suspended");old(json(h.active));await poll;expect(auth.snapshot().phase).toBe("suspended");
 current(json(h.active));await activation;expect(auth.snapshot().phase).toBe("ready");
});

for (const phase of ["admit", "restore", "edit"] as const) it(`expiry during ${phase} keeps both the expiry and failed-cleanup warnings visible`,async()=>{
 const h=harness();const {c}=await editing(h);const old=h.raw;h.fail(false,true,true);
 let current=c;
 if(phase==="admit") {h.time+=RECOVERY_TTL;const auth=h.fresh();await auth.start();current=auth.snapshot().controller!;}
 if(phase==="restore") {h.server.before=async()=>{h.time+=RECOVERY_TTL};const auth=h.fresh();await auth.start();current=auth.snapshot().controller!;}
 if(phase==="edit") {h.time+=RECOVERY_TTL;c.edit("El texto sigue aquí");}
 expect(h.raw).toBe(old);expect(current.snapshot().recoveryWarning).toMatch(/caduc/);
 expect(current.snapshot().recoveryWarning).toContain("limpieza");
 if(phase!=="edit")expect(current.snapshot().editor).toBeNull();
});

for(const boundary of ["401", "context", "logout"] as const) it(`purging an uncertain intent at ${boundary} warns before a new action without retaining its key`,async()=>{
 const h=harness();const {auth,c}=await editing(h);h.server.after=async(call,response)=>{if(call.method!=="GET")throw Error("lost");return response};await c.save();
 const reads=h.reads;expect(c.snapshot().editor!.pending).not.toBeNull();
 if(boundary==="401"){h.active=null;await auth.revalidate();}
 if(boundary==="context"){h.active={...h.active,recovery_context_id:crypto.randomUUID()};await auth.revalidate();}
 if(boundary==="logout"){auth.suspend();await auth.logout();}
 expect(h.raw).toBeNull();expect(c.snapshot().closed).toBe(true);
 const current=auth.snapshot().controller;
 expect((current?.snapshot().recoveryWarning??auth.snapshot().recoveryWarning)+" "+auth.snapshot().error).toContain("biblioteca");
 expect(current?.snapshot().editor??null).toBeNull();expect(h.reads).toBe(reads);
});
it("reload401 warns conditionally about a possible commit without reading unauthorized storage",async()=>{
 const h=harness();await editing(h);const reads=h.reads;h.active=null;const auth=h.fresh();await auth.start();
 expect(h.reads).toBe(reads);expect(h.raw).toBeNull();expect(auth.snapshot().error+" "+auth.snapshot().recoveryWarning).toContain("biblioteca");
});
