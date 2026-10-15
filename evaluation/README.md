# Evaluación offline: instrumento sintético

Este paquete prepara solicitudes y comprueba contratos con datos sintéticos.
No ejecuta modelos, llama proveedores, procesa PDFs ni acredita calidad curricular,
ahorro real, utilidad docente o un ganador. Es el corte [T4a](../docs/tickets/T4a-harness-offline.md)
de [T4](../docs/tickets/T4-preparar-evaluacion.md), que sigue abierto.

## Repetir las comprobaciones

Desde la raíz del repositorio, con Python 3.12.14 y sin dependencias adicionales:

```sh
python3 -B evaluation/scripts/freeze.py verify --root evaluation --input evaluation/manifests/input.manifest.json
python3 -B -m unittest discover -s evaluation/tests -v
python3 -B -O -m unittest discover -s evaluation/tests -v
```

La suite conserva 58 pruebas. El workflow `evaluation-offline` ejecuta esos mismos
pasos con Python fijado; la preparación de herramientas de CI puede descargar
Python, pero el instrumento y sus pruebas no usan red ni credenciales. El lint y
formato de todo el árbol siguen en el workflow backend, sin exclusiones nuevas.

Preparar un ejemplo no ejecuta sus solicitudes. Usar un destino nuevo: la creación
exclusiva impide pisar una salida anterior.

```sh
python3 -B evaluation/scripts/benchmark.py prepare evaluation/data/development/dev01.source.json --variant full --out /tmp/aulalista-synthetic-full.json
```

`benchmark.py score FUENTE REFERENCIA PREDICCION` puntúa únicamente el contrato
sintético. `benchmark.py receipts RUN` verifica recibos sintéticos relativos a la
carpeta del run. Todos los comandos del runner verifican primero el manifiesto.
Las funciones importadas permiten pruebas unitarias; no convierten un recibo o
fuente real en una entrada autorizada o validada.

## Contenido y procedencia

- Seis casos IA sintéticos: cuatro de desarrollo y dos de validación técnica,
  todos expuestos al autor. Contienen 56 hechos esperados y tres ambigüedades.
- JSON con páginas lógicas, no PDFs: cabeceras repetidas, grupos distintos,
  tablas continuadas, dependencias entre unidades, ambigüedades y texto hostil.
- Fuentes y referencias sintéticas con hash independiente; las referencias nunca
  entran en las solicitudes. No son gold humano ni evidencia docente.
- Fixtures JSONL propias y dos fixtures saneadas de estructura de eventos. Los
  identificadores y contenidos del stream saneado son sustitutos sintéticos;
  el fragmento de usage sólo contiene contadores. No se distribuyen recibos
  originales, identificadores privados, corpus reales ni informes internos.
- `contract.json`, prompts, plantillas vacías y manifiesto explícito. El hash
  detecta cambios; no demuestra fecha, autoría, custodia ni verdad curricular.

No hay holdout ciego. [Custodia](protocol/holdout.md) describe la frontera; el
runner rechaza `split=holdout` y cualquier fuente sin `synthetic: true`.

## Qué se comprueba

`full`, `dedup` y `segmented` preparan la misma tarea discreta. Deduplicar sólo
elimina cabeceras/pies exactos preanotados como seguros y conserva sus aliases;
segmentar mantiene contexto global y dependencias transitivas. La reparación
localizada y el reintento completo conservan la misma tarea de reparación.
Estas anotaciones disponibles no prueban que un parser/selector real las obtenga.

El scorer usa valores exactos y evidencia requerida. Conserva denominadores ante
faltantes, duplicados, extras, vacíos y JSON inválido. Un sinónimo puede fallar el
smoke y seguir siendo correcto semánticamente: no hay matcher semántico integrado.
La revisión semántica permanece separada y `teacher_evidence` es siempre false.
El registro de preguntas audita como máximo una solicitud presentada por
planeación/trial; no implementa persistencia ni impide identidades falsificadas.

## Consumo y límites

El agregador sólo admite sobres `aulalista-synthetic-receipt.v1` explícitamente
sintéticos: verifica hash, identidad y coincidencia exacta de usage/coste; rechaza
requests o archivos duplicados. Los intentos fallidos permanecen en el registro.
Un consumo desconocido es null, no cero. Sus totales son valores de fixtures;
`real_provider_usage_verified` siempre es false. No demuestra que no se omitió
algún intento del registro aportado.

[El normalizador Codex JSONL](protocol/codex-jsonl-adapter.md) es provisional y
separado del agregador. Mantiene componentes por turno, modelo efectivo y total
nativo global desconocidos, cobertura no verificada y comparación deshabilitada.
No deriva input + output, no suma caché/razonamiento de nuevo y no estima tokens
a partir de bytes, caracteres o palabras. Un aviso de contexto puede coexistir
con éxito terminal sin acreditar contextos comparables.

El peso del ahorro de tokens del 20 % está definido en spec 0002; fórmula, demás
pesos y umbrales siguen pendientes. No se calcula score ponderado ni ahorro real.
Tokens, coste y latencia de pared son medidas distintas. PDFs visuales, OCR,
híbridos, identidad efectiva, cobertura de herramientas/subllamadas y validación
docente requieren contratos, permisos y evidencia independientes.

## Cambiar el contrato

Revisar conjuntamente fuente, referencia, prompts, código, tests y límites antes
de regenerar el manifiesto. Conservar el manifiesto anterior en el historial y
someter el candidato nuevo a revisión independiente. Desde la raíz:

```sh
python3 -B evaluation/scripts/freeze.py freeze --root evaluation --input evaluation/manifests/input.spec.json > evaluation/manifests/input.manifest.json
```

El manifiesto cubre los archivos enumerados, no el intérprete, SO, proveedores,
workflows ni dependencias de la aplicación. Los outputs nuevos y cualquier
material privado deben permanecer fuera del árbol versionado.
