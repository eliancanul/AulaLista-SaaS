import {describe, test, expect, vi} from 'vitest';
import {IDBFactory, IDBObjectStore} from 'fake-indexeddb';
import {LocalStore} from '../src/storage';
import {Controller} from '../src/controller';
import {initial, start, advance, applyEdits, fields, hasContent, type Plan, type Scenario, type Edits} from '../src/model';

const store = () => new LocalStore(crypto.randomUUID(), new IDBFactory());
function toPartial(p = initial(), scenario: Scenario = 'clear') {
  p = start(p, scenario); p = advance(p, p.operation.id, 'loading'); return advance(p, p.operation.id, 'preparing');
}
async function setup(scenario: Scenario = 'clear') {const s = store(); await s.update(p => toPartial(p, scenario)); return s;}
const edit = (value: string, base: string, generation = 1): Edits => ({'a2.instructions': {value, base, generation}});
async function records(s: LocalStore): Promise<unknown[]> {
  return new Promise((resolve, reject) => {const req = s.factory.open(s.name, 1); req.onsuccess = () => {
    const db = req.result; const tx = db.transaction('records'); const query = tx.objectStore('records').getAll();
    tx.oncomplete = () => {db.close(); resolve(query.result);}; tx.onerror = () => reject(tx.error);
  };});
}

describe('fixture state invariants', () => {
  test('UX01 clear case has useful ordered activities and zero questions', () => {
    const p = toPartial(); expect(p.question).toBeNull(); expect(p.values['a2.instructions'].length).toBeGreaterThan(50);
    expect(advance(p, p.operation.id, 'partial').operation.stage).toBe('ready');
  });
  test('UX03 duplicate starts preserve the same operation', () => {const p = start(initial(), 'clear'); expect(start(p, 'ambiguous')).toBe(p);});
  test('UX04 automatic attempt precedes a single question; independent content remains', () => {
    let p = start(initial(), 'ambiguous'); expect(p.question).toBeNull(); p = advance(p, p.operation.id, 'loading'); expect(p.question).toBeNull();
    p = advance(p, p.operation.id, 'preparing'); expect(p.question?.state).toBe('pending'); expect(p.values['a1.instructions']).not.toBe(''); expect(p.values['a2.group']).toBe('');
  });
  test('UX05 versions, reprocessing and skipped responses never reset question', () => {
    let p = toPartial(initial(), 'multiple'); const id = p.question!.id;
    p.question!.state = 'skipped'; p.operation.stage = 'ready'; p = start(p, 'multiple', true); p = advance(p, p.operation.id, 'loading'); p = advance(p, p.operation.id, 'preparing');
    expect(p.question).toMatchObject({id, state: 'skipped'}); expect(p.sourceVersion).toBe(2);
  });
  test('UX06 empty voluntary response leaves one unresolved question', () => {
    const p = toPartial(initial(), 'multiple'); const result = applyEdits(p, {'a2.group': {value: '', base: '', generation: 1}}).plan;
    expect(result.question).toEqual(p.question); expect(result.values['a2.group']).toBe('');
  });
  test('UX08 edited fields survive later output and retain the generated alternative', () => {
    let p = toPartial(); p = applyEdits(p, {'a1.instructions': {value: 'Mi actividad de ejemplo', base: p.values['a1.instructions'], generation: 1}}).plan;
    p = advance(p, p.operation.id, 'partial'); expect(p.values['a1.instructions']).toBe('Mi actividad de ejemplo'); expect(p.alternatives.some(x => x.field === 'a1.instructions')).toBe(true);
  });
  test('UX08 cancelled or superseded events cannot update content', () => {
    let p = toPartial(); const old = p.operation.id; p.operation.stage = 'cancelled'; expect(advance(p, old, 'partial')).toBe(p);
    p = start(p, 'clear'); expect(advance(p, old, 'partial')).toBe(p);
  });
  test.each(['load-error', 'invalid'] as const)('UX12 %s preserves earlier work', scenario => {
    const p = toPartial(); p.operation.stage = 'ready'; const next = start(p, scenario); const failed = advance(next, next.operation.id, 'loading');
    expect(failed.operation.stage).toBe(scenario); expect(failed.values).toEqual(p.values); expect(failed.question).toEqual(p.question);
  });
});

describe('real IndexedDB adapter with deterministic storage engine', () => {
  test('UX01 confirmed edits survive opening a new store instance', async () => {
    const s = await setup(); const base = await s.read(); await s.save(edit('Texto sintético corregido', base.values['a2.instructions']), 'tab-a');
    const reloaded = await new LocalStore(s.name, s.factory).read(); expect(reloaded.values['a2.instructions']).toBe('Texto sintético corregido');
    expect(await s.record(`revision:${base.revisionId}`)).toEqual(base);
  });
  test('UX03 two simultaneous starts create one operation and revision', async () => {
    const s = store(); const [a,b] = await Promise.all([s.update(p => start(p, 'clear')), s.update(p => start(p, 'clear'))]);
    expect(a.operation.id).toBe(b.operation.id); expect(a.revision).toBe(b.revision);
  });
  test('UX07 concurrent partial publication persists exactly one question identity', async () => {
    const s = store(); let p = await s.update(p => start(p, 'ambiguous')); p = await s.update(p => advance(p, p.operation.id, 'loading'));
    const [a,b] = await Promise.all([s.update(p => advance(p, p.operation.id, 'preparing')), s.update(p => advance(p, p.operation.id, 'preparing'))]);
    expect(a.question?.id).toBe(b.question?.id); expect(a.revision).toBe(b.revision); expect(a.question).not.toBeNull();
  });
  test('UX09 actual QuotaExceededError aborts transaction without false revision', async () => {
    const s = await setup(); const p = await s.read(); const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {throw new DOMException('Quota', 'QuotaExceededError');});
    await expect(s.save(edit('No confirmado', p.values['a2.instructions']), 'a')).rejects.toThrow(); spy.mockRestore(); expect(await s.read()).toEqual(p);
  });
  test('UX09 blocked read is reported and never converted to an empty plan', async () => {
    const s = await setup(); const spy = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(() => {throw new DOMException('Denied', 'SecurityError');});
    await expect(s.read()).rejects.toThrow(); spy.mockRestore(); expect((await s.read()).revision).toBe(1);
  });
  test('UX09 readback failure does not report a successful save', async () => {
    const s = await setup(); const p = await s.read(); const original = s.record.bind(s); const spy = vi.spyOn(s, 'record').mockRejectedValueOnce(new Error('read failed'));
    await expect(s.save(edit('Escrito sin confirmación', p.values['a2.instructions']), 'a')).rejects.toThrow('read failed'); spy.mockRestore();
    expect((await original('head') as Plan).values['a2.instructions']).toBe('Escrito sin confirmación');
  });
  test('UX10 different fields merge within one serializable transaction', async () => {
    const s = await setup(); const p = await s.read(); const a = edit('Versión A', p.values['a2.instructions']);
    const b: Edits = {title: {value: 'Un título nuevo', base: p.values.title, generation: 1}};
    await Promise.all([s.save(a, 'a'), s.save(b, 'b')]); const result = await s.read(); expect(result.values.title).toBe('Un título nuevo'); expect(result.values['a2.instructions']).toBe('Versión A');
  });
  test('UX10 conflict and selected alternative both survive resolution', async () => {
    const s = await setup(); const p = await s.read(); await s.save(edit('Versión A', p.values['a2.instructions']), 'a');
    const conflict = await s.save(edit('Versión B', p.values['a2.instructions']), 'b'); expect(conflict.conflicts['a2.instructions']).toEqual({mine: 'Versión B', theirs: 'Versión A'});
    await s.save(edit('Versión A', 'Versión A', 2), 'b'); const all = JSON.stringify(await records(s)); expect(all).toContain('Versión B'); expect((await s.read()).values['a2.instructions']).toBe('Versión A');
    expect(await s.record('draft:b')).toMatchObject({edits: {}});
  });
  test('UX15 malformed head is rejected without replacement', async () => {
    const s = await setup(); await new Promise<void>(resolve => {const r = s.factory.open(s.name, 1); r.onsuccess = () => {const db = r.result; const tx = db.transaction('records', 'readwrite'); tx.objectStore('records').put({schema: 99, original: 'retained'}, 'head'); tx.oncomplete = () => {db.close(); resolve();};};});
    await expect(s.read()).rejects.toThrow('No pudimos recuperar'); await expect(s.update(p => start(p, 'clear'))).rejects.toThrow('No pudimos recuperar'); expect(await s.record('head')).toEqual({schema: 99, original: 'retained'});
  });
});

describe('controller recovery and user draft', () => {
  test('UX09 failed save retains editable draft and retry confirms it', async () => {
    const s = await setup(); const c = new Controller(s); await c.init(); c.blocked = true; c.edit('a2.instructions', 'Mi cambio'); await c.save();
    expect(c.state.save).toBe('error'); expect(c.text()).toContain('Mi cambio'); expect((await s.read()).values['a2.instructions']).not.toBe('Mi cambio');
    c.blocked = false; await c.save(); expect(c.state.save).toBe('saved'); expect((await s.read()).values['a2.instructions']).toBe('Mi cambio');
  });
  test('UX08 editing while save is in flight cannot acknowledge an older generation', async () => {
    const s = await setup(); const c = new Controller(s); await c.init(); let release!: () => void;
    const original = s.save.bind(s); const spy = vi.spyOn(s, 'save').mockImplementationOnce(async (...args) => {await new Promise<void>(r => {release = r;}); return original(...args);});
    c.edit('a2.instructions', 'Primera edición'); const saving = c.save(); await vi.waitFor(() => expect(release).toBeTypeOf('function')); c.edit('a2.instructions', 'Segunda edición'); release(); await saving;
    expect(c.state.save).toBe('pending'); expect(c.state.edits['a2.instructions']?.value).toBe('Segunda edición'); spy.mockRestore(); await c.save(); expect(c.state.save).toBe('saved'); expect((await s.read()).values['a2.instructions']).toBe('Segunda edición');
  });
  test('UX04 answer saves immediately with no extra acceptance', async () => {
    const c = new Controller(await setup('ambiguous')); await c.init(); await c.answer('Grupo B'); expect(c.state.plan.question?.state).toBe('answered'); expect(c.state.plan.values['a2.group']).toBe('Grupo B'); expect(c.state.save).toBe('saved');
    await c.answer('Grupo A'); expect(c.state.plan.values['a2.group']).toBe('Grupo B');
  });
  test('UX11 lost response checks the same committed operation without duplicate revision', async () => {
    const c = new Controller(await setup('lost-reply')); await c.init(); await c.tick(c.state.plan.operation.id, 'partial'); const revision = c.state.plan.revision;
    expect(c.state.lostReply).toBe(true); await c.check(); await c.check(); expect(c.state.lostReply).toBe(false); expect(c.state.plan.revision).toBe(revision);
  });
  test('UX12 timeout-before checks first and only then confirms failure', async () => {
    const c = new Controller(await setup('timeout-before')); await c.init(); const id = c.state.plan.operation.id; await c.tick(id, 'partial'); expect(c.state.plan.operation.stage).toBe('timeout');
    await c.check(); expect(c.state.plan.operation.stage).toBe('process-error'); expect(c.state.plan.operation.id).toBe(id);
  });
  test('UX13 reload during processing restores operation, question and confirmed edits', async () => {
    const s = await setup('ambiguous'); const c = new Controller(s); await c.init(); c.edit('a2.instructions', 'Edición para recuperar'); await c.save(); const another = new Controller(s); await another.init();
    expect(another.state.plan).toEqual(c.state.plan); expect(another.state.plan.question?.id).toBe('synthetic-garden:group'); expect(another.state.plan.operation.stage).toBe('partial');
  });
  test('no question is exposed when its reservation write fails', async () => {
    const c = new Controller(store()); await c.init(); await c.begin('ambiguous'); await c.tick(c.state.plan.operation.id, 'loading'); c.blocked = true;
    await c.tick(c.state.plan.operation.id, 'preparing'); expect(c.state.plan.question).toBeNull(); expect(c.state.save).toBe('error');
  });
});

// Regression cases from the independent UI review.
describe('review regressions', () => {
  test('a selected group survives a failed write and retry uses that exact answer', async () => {
    const c = new Controller(await setup('ambiguous')); await c.init(); const id = c.state.plan.operation.id; c.blocked = true;
    await c.answer('Grupo B'); expect(c.state.save).toBe('error'); expect(c.state.edits['a2.group']?.value).toBe('Grupo B');
    c.blocked = false; await c.retrySave(); expect(c.state.plan.values['a2.group']).toBe('Grupo B'); expect(c.state.plan.question?.state).toBe('answered'); expect(c.state.plan.operation.id).toBe(id);
  });
  test('skipping survives a failed write without presenting another question', async () => {
    const c = new Controller(await setup('multiple')); await c.init(); c.blocked = true; await c.answer('');
    expect(c.state.pendingSkip).toBe(true); c.blocked = false; await c.retrySave(); expect(c.state.pendingSkip).toBe(false); expect(c.state.plan.question?.state).toBe('skipped');
  });
  test('retrying failed operation metadata does not change fixture or operation identity', async () => {
    const c = new Controller(store()); await c.init(); await c.begin('multiple'); const id = c.state.plan.operation.id; c.blocked = true;
    await c.tick(id, 'loading'); c.blocked = false; await c.retrySave(); expect(c.state.plan.fixture).toBe('multiple'); expect(c.state.plan.operation.id).toBe(id); expect(c.state.plan.operation.stage).toBe('preparing');
  });
});

describe('integration review regressions', () => {
  test('retry recovery preserves the live unsaved draft after a transient read failure', async () => {
    const s = await setup(); const c = new Controller(s); await c.init(); c.blocked = true;
    c.edit('a2.instructions', 'Mi borrador todavía no guardado'); await c.save();
    const spy = vi.spyOn(s, 'read').mockRejectedValueOnce(new Error('transient read blocked'));
    await c.refresh(); expect(c.state.recoveryError).toBe(true); spy.mockRestore(); await c.init();
    expect(c.text()).toContain('Mi borrador todavía no guardado'); expect(c.state.save).toBe('error');
    c.blocked = false; await c.retrySave(); expect(c.state.plan.values['a2.instructions']).toBe('Mi borrador todavía no guardado');
  });
  test('emptying all editable fields never hides the materialized result, including after reload', async () => {
    const s = await setup(); const c = new Controller(s); await c.init(); const id = c.state.plan.id;
    for (const f of fields) c.edit(f, ''); await c.save();
    expect(hasContent(c.state.plan)).toBe(true); const reopened = new Controller(s); await reopened.init();
    expect(hasContent(reopened.state.plan)).toBe(true); expect(reopened.state.plan.id).toBe(id);
    expect(fields.every(f => reopened.state.plan.values[f] === '')).toBe(true);
  });
  test('read recovery also preserves an unconfirmed skip decision', async () => {
    const s = await setup('ambiguous'); const c = new Controller(s); await c.init(); c.blocked = true; await c.answer('');
    const spy = vi.spyOn(s, 'read').mockRejectedValueOnce(new Error('transient read blocked')); await c.refresh(); spy.mockRestore();
    await c.init(); expect(c.state.pendingSkip).toBe(true); expect(c.state.save).toBe('error'); c.blocked = false; await c.retrySave(); expect(c.state.plan.question?.state).toBe('skipped');
  });
});
