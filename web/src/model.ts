export const fields = ['title', 'a1.title', 'a1.purpose', 'a1.instructions', 'a2.title', 'a2.purpose', 'a2.instructions', 'a2.group'] as const;
export type Field = typeof fields[number];
export type Values = Record<Field, string>;
export type Scenario = 'clear' | 'ambiguous' | 'multiple' | 'load-error' | 'invalid' | 'process-error' | 'timeout-before' | 'lost-reply' | 'access';
export type Stage = 'idle' | 'loading' | 'preparing' | 'partial' | 'ready' | 'cancelled' | 'load-error' | 'invalid' | 'process-error' | 'timeout' | 'access';
export interface Plan {
  schema: 1; id: 'synthetic-garden'; revision: number; revisionId: string;
  sourceVersion: number; fixture: Scenario; values: Values; original: Values;
  edited: Field[]; alternatives: {field: Field; value: string; attempt: string; sourceVersion: number}[];
  operation: {id: string; stage: Stage};
  question: null | {id: string; state: 'pending' | 'answered' | 'skipped'; answer: string};
}
export type Edits = Partial<Record<Field, {value: string; base: string; generation: number}>>;
export type Conflicts = Partial<Record<Field, {mine: string; theirs: string}>>;
export const source = `EJEMPLO SINTÉTICO · Un pequeño huerto para el aula\nSesión 1. Observar y acordar: reconocer qué necesita una planta. En equipos, observar las semillas, dibujar cómo imaginan la planta y compartir una pregunta. Dejen los dibujos juntos para retomarlos al sembrar. Materiales: semillas, hojas y lápices. Duración: 20 minutos.\nSesión 2. Organizar los materiales: preparar un espacio para sembrar. Clasificar recipientes, tierra y semillas; acordar quién se encarga de cada material. Materiales: recipientes reutilizables, tierra y semillas. En el caso claro, la actividad es para Grupo A. En la variante ambigua, dos notas indican Grupo A y Grupo B sin distinguir cuál corresponde. No se especifica duración.`;
export const fixtureValues: Values = {
  title: 'Un pequeño huerto para el aula',
  'a1.title': 'Observar y acordar', 'a1.purpose': 'Reconocer lo que necesita una planta para crecer.',
  'a1.instructions': 'En equipos, observen las semillas y dibujen cómo imaginan la planta. Compartan una pregunta que les gustaría investigar.',
  'a2.title': 'Organizar los materiales', 'a2.purpose': 'Preparar juntos el espacio y los materiales para sembrar.',
  'a2.instructions': 'Clasifiquen los recipientes, la tierra y las semillas. Acuerden quién se encargará de cada material y dejen listo el espacio de siembra.',
  'a2.group': 'Grupo A',
};
export const emptyValues = (): Values => Object.fromEntries(fields.map(f => [f, ''])) as Values;
export function initial(): Plan {
  return {schema: 1, id: 'synthetic-garden', revision: 0, revisionId: '', sourceVersion: 1, fixture: 'clear', values: emptyValues(), original: emptyValues(), edited: [], alternatives: [], operation: {id: '', stage: 'idle'}, question: null};
}
export function validPlan(value: unknown): value is Plan {
  if (!value || typeof value !== 'object') return false;
  const p = value as Plan;
  return p.schema === 1 && p.id === 'synthetic-garden' && Number.isInteger(p.revision) && p.revision >= 0 && typeof p.revisionId === 'string'
    && Number.isInteger(p.sourceVersion) && p.sourceVersion > 0 && scenarios.includes(p.fixture)
    && !!p.operation && typeof p.operation.id === 'string' && stages.includes(p.operation.stage)
    && fields.every(f => typeof p.values?.[f] === 'string' && typeof p.original?.[f] === 'string')
    && Array.isArray(p.edited) && p.edited.every(f => fields.includes(f)) && Array.isArray(p.alternatives)
    && (p.question === null || (!!p.question && typeof p.question.id === 'string' && ['pending', 'answered', 'skipped'].includes(p.question.state) && typeof p.question.answer === 'string'));
}
export const scenarios: Scenario[] = ['clear', 'ambiguous', 'multiple', 'load-error', 'invalid', 'process-error', 'timeout-before', 'lost-reply', 'access'];
const stages: Stage[] = ['idle', 'loading', 'preparing', 'partial', 'ready', 'cancelled', 'load-error', 'invalid', 'process-error', 'timeout', 'access'];
export const active = (p: Plan) => ['loading', 'preparing', 'partial'].includes(p.operation.stage);
// Result existence comes from the immutable fixture, never from an editable field.
export const hasContent = (p: Plan) => fields.some(field => p.original[field] !== '');
export function start(p: Plan, scenario: Scenario, newVersion = false): Plan {
  if (active(p)) return p;
  return {...p, fixture: scenario, sourceVersion: p.sourceVersion + Number(newVersion), operation: {id: crypto.randomUUID(), stage: 'loading'}};
}
export function advance(p: Plan, operationId: string, expected: Stage): Plan {
  if (p.operation.id !== operationId || p.operation.stage !== expected || !active(p)) return p;
  const next = structuredClone(p);
  if (expected === 'loading') {
    next.operation.stage = p.fixture === 'load-error' ? 'load-error' : p.fixture === 'invalid' ? 'invalid' : 'preparing';
  } else if (expected === 'preparing') {
    next.operation.stage = 'partial';
    const ambiguous = ['ambiguous', 'multiple'].includes(p.fixture);
    const values = {...fixtureValues, 'a2.group': ambiguous ? '' : 'Grupo A'};
    for (const field of fields) {
      next.original[field] = values[field];
      if (!next.edited.includes(field)) next.values[field] = values[field];
      else if (next.values[field] !== values[field]) next.alternatives.push({field, value: values[field], attempt: p.operation.id, sourceVersion: p.sourceVersion});
    }
    // Reserve the one question inside the same transaction, before any UI can display it.
    if (ambiguous && !next.question && !next.values['a2.group']) next.question = {id: 'synthetic-garden:group', state: 'pending', answer: ''};
  } else {
    next.operation.stage = p.fixture === 'process-error' ? 'process-error' : p.fixture === 'timeout-before' ? 'timeout' : p.fixture === 'access' ? 'access' : 'ready';
    const field: Field = 'a1.instructions';
    const value = fixtureValues[field] + ' Dejen los dibujos juntos para retomarlos al sembrar.';
    next.original[field] = value;
    if (!next.edited.includes(field)) next.values[field] = value;
    else if (next.values[field] !== value) next.alternatives.push({field, value, attempt: p.operation.id, sourceVersion: p.sourceVersion});
  }
  return next;
}
export function applyEdits(p: Plan, edits: Edits): {plan: Plan; conflicts: Conflicts} {
  const plan = structuredClone(p); const conflicts: Conflicts = {};
  for (const field of fields) {
    const edit = edits[field];
    if (!edit) continue;
    if (p.values[field] !== edit.base && p.values[field] !== edit.value) conflicts[field] = {mine: edit.value, theirs: p.values[field]};
    else {
      plan.values[field] = edit.value;
      if (!plan.edited.includes(field)) plan.edited.push(field);
      if (field === 'a2.group' && edit.value.trim() && plan.question?.state === 'pending') plan.question = {...plan.question, state: 'answered', answer: edit.value};
    }
  }
  return {plan, conflicts};
}
export function processText(p: Plan): string {
  const map: Record<Stage, string> = {
    idle: 'Prueba con una planeación de ejemplo', loading: 'Cargando ejemplo… · Simulación', preparing: 'Preparando resultado de ejemplo… · Simulación',
    partial: 'Resultado parcial de ejemplo. Puedes editarlo · Simulación', ready: 'Resultado de ejemplo listo para editar',
    cancelled: `Procesamiento detenido.${hasContent(p) ? ' Puedes conservar lo disponible' : ' Aún no hay resultado'}`,
    'load-error': 'No se pudo cargar el ejemplo · Simulación', invalid: 'Este ejemplo no se puede cargar. Usa otro ejemplo de prueba · Simulación',
    'process-error': 'No pudimos completar este ejemplo · Simulación', timeout: `No se pudo confirmar el resultado.${hasContent(p) ? ' Tu borrador sigue disponible' : ''} · Simulación`, access: 'Acceso interrumpido · Simulación',
  }; return map[p.operation.stage];
}
