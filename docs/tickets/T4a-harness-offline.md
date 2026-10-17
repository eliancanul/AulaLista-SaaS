# T4a: incorporar el instrumento offline genérico

Referencia técnica e historial del corte. Consulta [Issues y fuentes de verdad](README.md) para elegir trabajo y consultar su estado actual.

Integración histórica: [PR #6](https://github.com/eliancanul/AulaLista-SaaS/pull/6), integrado el 2026-10-15 a las 13:51:47 UTC en `862f1d4e3a46ceb3de4253356c0ca0dd8993d40e`.
La [revisión registrada](https://github.com/eliancanul/AulaLista-SaaS/pull/6#pullrequestreview-5529869076) identifica el candidato y su evidencia premerge. Este registro no atribuye CI postmerge no enlazada ni certifica candidatos posteriores.
Depende de [T4](T4-preparar-evaluacion.md) y [spec 0002](../specs/0002-flujo-automatico-material.md).
No cierra T4 ni habilita T5.

## Resultado y alcance

Incorporar `evaluation/` como herramienta de desarrollo autocontenida con biblioteca
estándar de Python, sin dependencias de runtime de la API ni conexión al producto.
El corte conserva los 58 tests del instrumento previamente revisado y añade su
workflow reproducible; su revisión de incorporación se enlaza arriba.

Escritor: `integrar_harness_evaluacion`, rama `feat/t4a-offline-evaluation`.
Archivos: `evaluation/**`, `.github/workflows/evaluation.yml`, este ticket y enlaces
en T4/índice. El integrador mantiene la publicación e integración como escritor único.

## Aceptación

- Sólo scripts/contratos genéricos, fixtures sintéticas propias y estructura JSONL
  saneada: sin corpus real, referencias privadas, recibos originales, identificadores
  privados, rutas personales ni informes internos.
- Preparación full/dedup/segmented y reparación apareada; fuentes/referencias separadas,
  denominadores conservados y un máximo auditado de una solicitud por planeación/trial.
- Score discreto sintético intacto; matcher semántico y métricas adjudicadas fuera
  de alcance hasta revisión independiente. No adaptar referencias al candidato.
- Recibos sintéticos ligados a bytes/hash y metadatos; fallos/ausencias no son cero.
  Parser JSONL provisional separado: modelo efectivo, cobertura y total global no
  verificados; comparación deshabilitada, score ponderado null y ningún ahorro real.
- Manifiesto verificable, 58 pruebas normales y optimizadas, Ruff del árbol sin
  exclusiones y CI propia con Python 3.12.14. Sin llamadas a modelos/proveedores.
- Revisión adversarial del candidato exacto y checks remotos antes de integración.

## Repetición y evidencia

[README del instrumento](../../evaluation/README.md) contiene los comandos exactos.
Los tests validan el instrumento y sus límites, no comprensión, OCR, utilidad docente,
seguridad del producto ni persistencia de las preguntas. No se modifican runtime,
base de datos, migraciones, identidad ni UI.

El instrumento no resuelve corpus/splits privados, referencias revisables, contrato
semántico, denominadores y protocolo de ensayo, capacidad y permisos de ejecución,
modelo efectivo y cobertura de consumo. No hay elección de ganador ni presupuesto
aprobado por añadir este instrumento.

## Recuperación

Es aditivo y offline: revertir el incremento retira la herramienta y su workflow;
no hay migración ni datos de aplicación que recuperar. Los resultados locales y
materiales privados deben guardarse fuera del árbol versionado. Registrar revisión,
SHA final, checks y omisiones en el PR de cualquier nuevo cambio.
