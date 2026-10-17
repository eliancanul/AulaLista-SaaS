import React, {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {Controller} from './controller';
import {active, hasContent, processText, source, type Field, type Scenario} from './model';
import './style.css';

const controller = new Controller();
const names: Record<Scenario, string> = {clear: 'Caso claro', ambiguous: 'Una duda material', multiple: 'Varias dudas', 'load-error': 'Fallo de carga', invalid: 'Entrada incompatible', 'process-error': 'Fallo de procesamiento', 'timeout-before': 'Timeout antes de completar', 'lost-reply': 'Respuesta perdida después de guardar', access: 'Acceso interrumpido'};
function App() {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const {plan, edits, conflicts} = state;
  const [scenario, setScenario] = useState<Scenario>('clear');
  const [blocked, setBlocked] = useState(false);
  const [copy, setCopy] = useState('');
  const [showCopy, setShowCopy] = useState(false);
  const [saveAnnouncement, setSaveAnnouncement] = useState('');
  const lastAnnouncement = useRef(0);
  const result = useRef<HTMLHeadingElement>(null);
  const content = hasContent(plan); const busy = active(plan);
  const value = (field: Field) => edits[field]?.value ?? plan.values[field];
  useEffect(() => {void controller.init(); return controller.connect();}, []);
  useEffect(() => {if (!state.loading) setScenario(plan.fixture);}, [state.loading]);
  useEffect(() => {
    if (!busy || state.save === 'error' || state.recoveryError) return;
    const {id, stage} = plan.operation;
    const timer = setTimeout(() => {void controller.tick(id, stage);}, stage === 'partial' ? 2400 : 800);
    return () => clearTimeout(timer);
  }, [plan.operation.id, plan.operation.stage, busy, state.save, state.recoveryError]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {if (Object.keys(controller.state.edits).length || controller.state.save === 'error') {event.preventDefault(); event.returnValue = '';}};
    const refresh = () => {void controller.refresh();};
    window.addEventListener('beforeunload', unload); window.addEventListener('pageshow', refresh);
    return () => {window.removeEventListener('beforeunload', unload); window.removeEventListener('pageshow', refresh);};
  }, []);
  useEffect(() => {
    if (state.save !== 'saved') {setSaveAnnouncement(''); return;}
    const timer = setTimeout(() => {
      if (Date.now() - lastAnnouncement.current > 10000) {setSaveAnnouncement('Cambios guardados en este navegador'); lastAnnouncement.current = Date.now();}
    }, 1200);
    return () => clearTimeout(timer);
  }, [state.save]);
  function focusOperation() {document.getElementById('load-example')?.focus();}
  function focusResult() {(document.getElementById('result-title') ?? document.getElementById('load-example'))?.focus();}
  async function recover() {await controller.init(); requestAnimationFrame(focusOperation);}
  async function answer(value: string) {
    document.getElementById('a2-group')?.focus();
    await controller.answer(value);
  }
  const saveText = {none: '', pending: 'Guardando en este navegador…', saved: 'Guardado en este navegador', error: 'No se guardaron los últimos cambios. Mantenlos abiertos', conflict: 'Hay cambios de otra pestaña. Conservamos tu borrador'}[state.save];
  async function copyText() {
    try {await navigator.clipboard.writeText(controller.text()); setCopy('Texto copiado');}
    catch {setShowCopy(true); setCopy('Selecciona y copia tu texto en el campo de recuperación.');}
  }
  function field(field: Field, label: string, multiline = false, hint?: string) {
    const conflict = conflicts[field]; const id = field.replace('.', '-');
    return <div className="field" key={field}>
      <label htmlFor={id}>{label}</label>
      {multiline ? <textarea id={id} rows={4} value={value(field)} onChange={e => controller.edit(field, e.target.value)} aria-describedby={hint || conflict ? `${id}-help` : undefined}/>
        : <input id={id} value={value(field)} onChange={e => controller.edit(field, e.target.value)} aria-describedby={hint || conflict ? `${id}-help` : undefined}/>}
      {(hint || conflict) && <div id={`${id}-help`}>{hint && <p className="field-hint">{hint}</p>}{conflict && <div className="conflict">
        <p><strong>Hay dos versiones de este campo</strong></p><p>Tu texto: {value(field)}</p><p>Texto guardado: {conflict.theirs}</p>
        <div className="actions"><button onClick={() => {document.getElementById(id)?.focus(); void controller.resolve(field, true);}}>Usar mi texto</button><button onClick={() => {document.getElementById(id)?.focus(); void controller.resolve(field, false);}}>Usar texto guardado</button></div>
      </div>}</div>}
    </div>;
  }
  return <>
    <header className="brand"><span className="brand-mark" aria-hidden="true">a.</span><span>AulaLista</span><span className="prototype-label">Prototipo</span></header>
    <main>
      <aside className="notice" aria-label="Límites del prototipo"><strong>Un espacio de prueba, con ejemplos sintéticos.</strong> No interpreta archivos reales. Usa solo contenido de ejemplo. Los cambios se guardan solo en este navegador.</aside>
      <div className="intro"><p className="eyebrow">TU ESPACIO DE PLANEACIÓN</p><h1>{content ? 'Tu planeación, abierta para trabajar' : 'Del material a las actividades'}</h1><p>{content ? 'Revisa las actividades y cambia lo que necesites. Se guarda mientras editas.' : 'Carga un ejemplo y empieza a editar en esta misma vista.'}</p></div>
      {state.loading ? <p role="status">Recuperando el ejemplo de este navegador…</p> : state.recoveryError ? <section className="error" role="alert"><h2>No pudimos recuperar el borrador local</h2><p>No hemos reemplazado los datos existentes. Puedes reintentar la lectura o copiar el texto que siga abierto.</p><div className="actions"><button onClick={() => void recover()}>Reintentar recuperación</button><button onClick={() => void copyText()}>Copiar mi texto</button></div></section> : <>
        <section className="operation" aria-label="Estado del ejemplo">
          <div><p className="process" role="status">{state.lostReply ? 'No se pudo confirmar el resultado. Tu borrador sigue disponible · Simulación' : processText(plan)}</p><p className="muted">La carga y la interpretación son simuladas; el guardado local sí funciona.</p></div>
          <div className="actions">
            <button id="load-example" className="primary" aria-disabled={busy || content} onClick={() => {if (!busy && !content) void controller.begin(plan.operation.stage === 'idle' ? scenario : plan.fixture);}}>{busy ? 'Cargando ejemplo…' : content ? 'Ejemplo cargado' : 'Cargar ejemplo'}</button>
            {busy && <button onClick={() => {focusOperation(); void controller.cancel();}}>Cancelar</button>}
            {(state.lostReply || plan.operation.stage === 'timeout') ? <button onClick={() => {focusOperation(); void controller.check();}}>Comprobar estado</button> : !busy && plan.operation.stage !== 'idle' && plan.operation.stage !== 'ready' && <button onClick={() => {focusOperation(); void controller.begin(plan.fixture);}}>{plan.operation.stage === 'load-error' ? 'Reintentar carga' : 'Reintentar'}</button>}
            {content && <button className="text-button" onClick={() => result.current?.focus()}>Ir al resultado ↓</button>}
          </div>
        </section>
        {content && <section className="result" aria-labelledby="result-title">
          <div className="result-header"><div><p className="eyebrow">PLANEACIÓN DE EJEMPLO</p><h2 ref={result} tabIndex={-1} id="result-title">Dos momentos para aprender</h2></div><span className="count">2 actividades</span></div>
          <div className={`save-state ${state.save === 'error' || state.save === 'conflict' ? 'warning' : ''}`}><strong>{saveText}</strong><p>No está en una cuenta ni se sincroniza. Borrar los datos del navegador elimina este ejemplo.</p></div>
          <div className="plan-title">{field('title', 'Título de la planeación')}</div>
          {[1, 2].map(n => <section className="activity" key={n} aria-labelledby={`activity-${n}`}>
            <div className="activity-heading"><span className="number" aria-hidden="true">0{n}</span><div><p className="eyebrow">SESIÓN {n}</p><h3 id={`activity-${n}`}>{value(`a${n}.title` as Field) || `Actividad ${n}`}</h3></div></div>
            {field(`a${n}.title` as Field, `Título de la actividad ${n}`)}
            {field(`a${n}.purpose` as Field, `Propósito de la actividad ${n}`)}
            {field(`a${n}.instructions` as Field, `Instrucciones de la actividad ${n}`, true)}
            <p className="materials"><strong>Materiales</strong> {n === 1 ? 'Semillas, hojas y lápices.' : 'Recipientes reutilizables, tierra y semillas.'}</p>
            <p className="materials"><strong>Duración</strong> {n === 1 ? '20 minutos.' : 'No aparece en el ejemplo.'}</p>
            {n === 2 && <>
              {field('a2.group', 'Grupo de la actividad 2', false, !value('a2.group') ? 'Grupo pendiente. Esta actividad necesita un grupo antes de usarla; puedes seguir editando las demás.' : undefined)}
              {plan.question?.state === 'pending' && !state.pendingSkip && !value('a2.group') && <fieldset className="question"><legend>En “Organizar los materiales”, ¿la actividad es para Grupo A o Grupo B?</legend><p>El ejemplo contiene dos notas distintas. La resolución automática simulada no pudo elegir un grupo.</p><div className="actions"><button onClick={() => void answer('Grupo A')}>Grupo A</button><button onClick={() => void answer('Grupo B')}>Grupo B</button><button className="text-button" onClick={() => void answer('')}>Dejar pendiente</button></div></fieldset>}
              {plan.fixture === 'multiple' && <p className="pending">Fecha pendiente: no aparece una fecha inequívoca en el ejemplo. No cambia las actividades independientes.</p>}
            </>}
          </section>)}
        </section>}
      </>}
      {(state.save === 'error' || state.save === 'conflict') && <section className="recovery" aria-label="Recuperar cambios"><p role="alert">{saveText}</p><div className="actions"><button onClick={() => {focusResult(); void controller.retrySave();}}>Reintentar guardado</button><button onClick={() => void copyText()}>Copiar mi texto</button></div><p>Si cierras ahora, sólo se garantiza la última revisión confirmada. Mantén esta pestaña abierta para conservar lo pendiente.</p></section>}
      <p className="sr-only" role="status">{saveAnnouncement}</p><p role="status">{copy}</p>{showCopy && <div className="field"><label htmlFor="copy-recovery">Texto para copiar</label><textarea id="copy-recovery" readOnly rows={8} value={controller.text()} onFocus={e => e.target.select()}/></div>}
      <details className="source"><summary>Ver material de ejemplo</summary><p className="muted">Fuente sintética incorporada. La interpretación no usa un servicio de IA.</p><pre>{source}</pre></details>
      <details className="testing"><summary>Escenarios de prueba</summary><p>Controles para evaluar este prototipo. Reintentar o añadir una versión conserva la misma planeación y su única aclaración.</p>
        <label htmlFor="scenario">Ejemplo o fallo simulado</label><select id="scenario" value={scenario} onChange={e => setScenario(e.target.value as Scenario)}>{Object.entries(names).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select>
        <div className="actions"><button disabled={busy || state.recoveryError} onClick={() => {focusOperation(); void controller.begin(scenario, true);}}>Simular otra versión</button></div>
        <label className="check"><input type="checkbox" checked={blocked} onChange={e => {setBlocked(e.target.checked); controller.blocked = e.target.checked;}}/> Forzar fallo de guardado (simulación)</label>
        <p>Al cerrar la página se pausa el simulador. Al volver, continúa desde el estado confirmado. No sigue trabajando en segundo plano.</p>
        <button className="danger" onClick={() => {if (window.confirm('Esto borra sólo el ejemplo local y sus revisiones para iniciar una prueba aislada. ¿Restablecer las pruebas?')) {controller.blocked = false; setBlocked(false); void controller.reset();}}}>Restablecer pruebas</button>
        <p className="muted">Restablecer borra el ejemplo en todas las pestañas de este origen. No es una recuperación del borrador.</p>
      </details>
      <footer>Hecho para probar el recorrido. Interpretación real y pruebas con docentes pendientes.</footer>
    </main>
  </>;
}
createRoot(document.getElementById('root')!).render(<App/>);
