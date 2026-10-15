import {LocalStore} from './storage';
import {initial, start, advance, hasContent, fields, type Plan, type Field, type Scenario, type Stage, type Edits, type Conflicts} from './model';

export interface View {
  plan: Plan; edits: Edits; conflicts: Conflicts; loading: boolean;
  save: 'none' | 'pending' | 'saved' | 'error' | 'conflict'; recoveryError: boolean; error: string; lostReply: boolean; pendingSkip: boolean;
}
export class Controller {
  state: View = {plan: initial(), edits: {}, conflicts: {}, loading: true, save: 'none', recoveryError: false, error: '', lostReply: false, pendingSkip: false};
  private listeners = new Set<() => void>();
  private serial: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private failedChange?: (p: Plan) => Plan;
  private debounce?: ReturnType<typeof setTimeout>;
  readonly tabId = (() => {
    const id = crypto.randomUUID();
    try {
      const previous = sessionStorage.getItem('aulalista-t3-tab');
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      if (previous && navigation?.type === 'reload') return previous;
      sessionStorage.setItem('aulalista-t3-tab', id);
    } catch { /* Recovery still guarantees the confirmed shared revision. */ }
    return id;
  })();
  blocked = false;
  private channel?: BroadcastChannel;
  constructor(readonly store = new LocalStore()) {}
  subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  snapshot = () => this.state;
  private emit(patch: Partial<View>) {this.state = {...this.state, ...patch}; this.listeners.forEach(fn => fn());}
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {const next = this.serial.then(fn, fn); this.serial = next.catch(() => {}); return next;}
  private broadcast() {this.channel?.postMessage('changed');}
  async init() {
    try {
      const plan = await this.store.read();
      const draft = await this.store.record(`draft:${this.tabId}`) as {edits: Edits} | undefined;
      const edits: Edits = {...draft?.edits, ...this.state.edits}; const conflicts: Conflicts = {};
      for (const field of fields) {
        const e = edits[field];
        if (!e) continue;
        if (typeof e.value !== 'string' || typeof e.base !== 'string' || !Number.isInteger(e.generation)) throw new Error('Borrador ilegible');
        this.generation = Math.max(this.generation, e.generation);
        if (e.value === plan.values[field]) delete edits[field];
        else if (e.base !== plan.values[field]) conflicts[field] = {mine: e.value, theirs: plan.values[field]};
      }
      const pending = Object.keys(edits).length > 0 || this.state.pendingSkip;
      this.emit({plan, edits, conflicts, loading: false, save: Object.keys(conflicts).length ? 'conflict' : pending ? 'error' : hasContent(plan) ? 'saved' : 'none', recoveryError: false, error: pending ? 'No se guardaron los últimos cambios. Mantenlos abiertos' : ''});
    }
    catch {this.emit({loading: false, recoveryError: true, error: 'No pudimos recuperar el borrador local'});}
  }
  connect() {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(`${this.store.name}:changes`);
      this.channel.onmessage = () => {void this.refresh();};
    }
    return () => this.channel?.close();
  }
  async refresh() {
    return this.enqueue(async () => {
      try {
        const plan = await this.store.read(); const conflicts: Conflicts = {};
        for (const field of fields) {
          const e = this.state.edits[field];
          if (e && e.base !== plan.values[field] && e.value !== plan.values[field]) conflicts[field] = {mine: e.value, theirs: plan.values[field]};
        }
        this.emit({plan, conflicts, ...(Object.keys(conflicts).length ? {save: 'conflict' as const} : {})});
      } catch {this.emit({recoveryError: true, error: 'No pudimos recuperar el borrador local'});}
    });
  }
  private async write(change: (p: Plan) => Plan) {
    this.failedChange = change;
    if (this.blocked) throw new Error('Fallo de guardado de prueba');
    const plan = await this.store.update(change);
    this.failedChange = undefined;
    this.emit({plan, error: '', save: Object.keys(this.state.edits).length ? this.state.save : hasContent(plan) ? 'saved' : 'none'});
    this.broadcast(); return plan;
  }
  private failure() {this.emit({save: 'error', error: 'No se guardaron los últimos cambios. Mantenlos abiertos'});}
  async begin(scenario: Scenario, newVersion = false) {
    return this.enqueue(async () => {
      try {await this.write(p => start(p, scenario, newVersion)); this.emit({lostReply: false});} catch {this.failure();}
    });
  }
  async tick(id: string, stage: Stage) {
    return this.enqueue(async () => {
      try {
        const plan = await this.write(p => advance(p, id, stage));
        if (plan.fixture === 'lost-reply' && stage === 'partial' && plan.operation.stage === 'ready') this.emit({lostReply: true});
      } catch {this.failure();}
    });
  }
  async cancel() {
    return this.enqueue(async () => {try {await this.write(p => ({...p, operation: {...p.operation, stage: 'cancelled'}}));} catch {this.failure();}});
  }
  async check() {
    return this.enqueue(async () => {
      try {
        const plan = await this.store.read();
        this.emit({plan, lostReply: false});
        if (plan.operation.stage === 'timeout') await this.write(p => ({...p, operation: {...p.operation, stage: 'process-error'}}));
      } catch {this.failure();}
    });
  }
  edit(field: Field, value: string) {
    const current = this.state.edits[field];
    const edits = {...this.state.edits, [field]: {value, base: current?.base ?? this.state.plan.values[field], generation: ++this.generation}};
    this.emit({edits, save: 'pending'});
    clearTimeout(this.debounce); this.debounce = setTimeout(() => {void this.save();}, 300);
  }
  async save() {
    clearTimeout(this.debounce);
    return this.enqueue(async () => {
      const sent = {...this.state.edits}; const skip = this.state.pendingSkip;
      if (!Object.keys(sent).length && !skip) return;
      try {
        if (this.blocked) throw new Error('Fallo de guardado de prueba');
        const {plan, conflicts} = await this.store.save(sent, this.tabId, skip);
        const edits = {...this.state.edits};
        for (const field of fields) {
          if (sent[field] && edits[field]?.generation === sent[field]?.generation && !conflicts[field]) delete edits[field];
          else if (sent[field] && edits[field] && !conflicts[field]) edits[field] = {...edits[field]!, base: plan.values[field]};
        }
        this.emit({plan, edits, conflicts, pendingSkip: false, save: Object.keys(conflicts).length ? 'conflict' : Object.keys(edits).length ? 'pending' : 'saved', error: ''});
        this.broadcast();
      } catch {this.failure();}
    });
  }
  async resolve(field: Field, mine: boolean) {
    const conflict = this.state.conflicts[field]; if (!conflict) return;
    const edits = {...this.state.edits, [field]: {base: conflict.theirs, value: mine ? this.state.edits[field]?.value ?? conflict.mine : conflict.theirs, generation: ++this.generation}};
    this.emit({edits, save: 'pending'}); await this.save();
  }
  async answer(answer: string) {
    if (this.state.plan.question?.state !== 'pending' || this.state.pendingSkip) return;
    if (!answer) this.emit({pendingSkip: true});
    this.edit('a2.group', answer);
    await this.save();
  }
  async retrySave() {
    if (Object.keys(this.state.edits).length || this.state.pendingSkip) return this.save();
    return this.enqueue(async () => {
      if (!this.failedChange) return;
      try {await this.write(this.failedChange);} catch {this.failure();}
    });
  }
  text() {return fields.map(f => `${f}: ${this.state.edits[f]?.value ?? this.state.plan.values[f]}`).join('\n\n');}
  async reset() {
    clearTimeout(this.debounce);
    return this.enqueue(async () => {try {await this.store.reset(); this.emit({plan: initial(), edits: {}, conflicts: {}, save: 'none', error: '', recoveryError: false, lostReply: false, pendingSkip: false}); this.failedChange = undefined; this.broadcast();} catch {this.failure();}});
  }
}
