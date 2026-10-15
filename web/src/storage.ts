import {initial, validPlan, type Plan, type Edits, type Conflicts, applyEdits} from './model';

export const databaseName = 'aulalista-synthetic-t3';
export class LocalStore {
  constructor(readonly name = databaseName, readonly factory: IDBFactory = indexedDB) {}
  private async open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.factory.open(this.name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('records');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('El almacenamiento está bloqueado por otra pestaña.'));
    });
  }
  async read(): Promise<Plan> {
    const raw = await this.record('head');
    if (raw === undefined) return initial();
    if (!validPlan(raw)) throw new Error('No pudimos recuperar el borrador local');
    return raw;
  }
  async record(key: string): Promise<unknown> {
    const db = await this.open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('records', 'readonly'); const req = tx.objectStore('records').get(key);
        tx.oncomplete = () => resolve(req.result);
        tx.onabort = () => reject(tx.error ?? new Error('Lectura interrumpida'));
        tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  }
  async update(change: (p: Plan) => Plan, draft?: {key: string; edits: Edits}): Promise<Plan> {
    const db = await this.open();
    let result: Plan;
    try {
      result = await new Promise<Plan>((resolve, reject) => {
        // All tabs serialize their head read, question reservation and write in this transaction.
        const tx = db.transaction('records', 'readwrite'); const records = tx.objectStore('records');
        const request = records.get('head'); let updated: Plan; let failure: unknown;
        request.onsuccess = () => {
          try {
            if (request.result !== undefined && !validPlan(request.result)) throw new Error('No pudimos recuperar el borrador local');
            const current = request.result ?? initial();
            if (draft) records.add({edits: draft.edits, basedOn: current.revisionId}, `draft-history:${crypto.randomUUID()}`);
            updated = change(current);
            if (draft) {
              const pending = Object.fromEntries(Object.entries(draft.edits).filter(([field, edit]) => updated.values[field as keyof typeof updated.values] !== edit?.value));
              records.put({edits: pending, basedOn: current.revisionId}, draft.key);
            }
            if (JSON.stringify(updated) !== JSON.stringify(current)) {
              updated = {...updated, revision: current.revision + 1, revisionId: crypto.randomUUID()};
              records.add(updated, `revision:${updated.revisionId}`);
              records.put(updated, 'head');
            }
          } catch (error) { failure = error; tx.abort(); }
        };
        tx.oncomplete = () => resolve(updated);
        tx.onabort = () => reject(failure ?? tx.error ?? new Error('Escritura interrumpida'));
        tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
    if (result.revisionId) {
      const verified = await this.record(`revision:${result.revisionId}`);
      if (!validPlan(verified) || JSON.stringify(verified) !== JSON.stringify(result)) throw new Error('No se pudo confirmar la revisión guardada');
    }
    return result;
  }
  async save(edits: Edits, tabId: string, skipQuestion = false): Promise<{plan: Plan; conflicts: Conflicts}> {
    let conflicts: Conflicts = {};
    const plan = await this.update(p => {const merged = applyEdits(p, edits); conflicts = merged.conflicts;
      if (skipQuestion && merged.plan.question?.state === 'pending') merged.plan.question = {...merged.plan.question, state: 'skipped'};
      return merged.plan;}, {key: `draft:${tabId}`, edits});
    return {plan, conflicts};
  }
  async reset(): Promise<void> {
    const db = await this.open();
    try { await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite'); tx.objectStore('records').clear();
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); tx.onerror = () => reject(tx.error);
    }); } finally { db.close(); }
  }
}
