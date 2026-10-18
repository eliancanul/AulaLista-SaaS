# Pydantic y preparación de Promptfoo

Corte parcial de [#49](https://github.com/eliancanul/AulaLista-SaaS/issues/49).
Pydantic 2.14.1 ya estaba en el lock; ahora es dependencia directa y valida el
`Result` existente de Acenta antes de devolver el generador fixture. Se conservan
sus campos, omisiones y valores sin coerción. El esquema rechaza campos extra;
no valida veracidad curricular ni habilita resultados de modelos.

## Adaptadores comprobados

`checks.py` prepara la frontera Python de un proveedor y assertions de Promptfoo,
reutilizando el generador fixture, preparador y scorer existentes. Los tests
Python llaman directamente a esas funciones con sockets bloqueados. La
configuración JSON se conserva como preparación; no hay dependencia, launcher
ni job que instale o ejecute Promptfoo en este corte.

Son cinco comprobaciones de software: dos resultados existentes, rechazo de
texto numérico, autocheck del scorer y rechazo de una cita fabricada. El autocheck
usa el constructor de predicción de los tests previos, que deriva la salida de la
referencia **para probar el scorer**. No es una predicción de modelo, evaluación
ciega, nuevo corpus ni evidencia docente. No se modifica el instrumento estándar
ni su manifiesto. No se fabrican contadores de tokens/coste.

Desde la raíz, Python 3.12.14 y uv 0.12.23:

```sh
uv sync --locked --no-editable
uv run --locked --no-editable pytest tests/test_planning_result.py tests/test_promptfoo.py
```

Después de editar el backend, reinstalar la wheel con `uv sync --locked
--no-editable --reinstall-package aulalista-api` antes de probar.

## CLI pendiente: hallazgo de privacidad

La revisión de Promptfoo 0.124.1 el 17-10-2026 detectó que
`PROMPTFOO_DISABLE_TELEMETRY=1` aún provoca una solicitud a
`https://r.promptfoo.app/`. En el [código de esa versión](https://github.com/promptfoo/promptfoo/blob/0.124.1/src/telemetry.ts),
`recordTelemetryDisabled` llama a `sendEvent`, que ejecuta ese POST sin respetar
la desactivación. Una sonda bloqueó la solicitud antes de transmitirla.
Además, una `PROMPTFOO_API_KEY` heredada activa consultas a Cloud aunque el
directorio de configuración sea temporal; se reprodujo con un valor de prueba
y la red bloqueada.

Los cinco casos pasaron en la CLI experimental, pero eso **no acredita ejecución
offline**. Se retiraron del candidato su instalación, lock, launcher y job de CI,
sin parchear dependencias ni añadir una capa propia de aislamiento. No ejecutar
la configuración con `npx` o una instalación global como sustituto.

Para reabrir esta parte de #49 se requiere una solución soportada, versión y lock
revisados, auditoría de dependencias, aislamiento de credenciales heredadas y
regresión del launcher real con red denegada. La instalación experimental también
reveló avisos altos en transitivas; sus ajustes se retiraron junto con el paquete.
No se ha aprobado una versión de Promptfoo para incorporar al repositorio.

Documentos reales, providers o evaluación curricular siguen requiriendo las
puertas de #19/#40 y autorización de datos, destino y presupuesto.

## Referencias

- [Pydantic strict mode](https://docs.pydantic.dev/latest/concepts/strict_mode/).
- [Promptfoo 0.124.1 y licencia MIT](https://github.com/promptfoo/promptfoo/tree/0.124.1).
- [Proveedor Python](https://www.promptfoo.dev/docs/providers/python/) y
  [assertions Python](https://www.promptfoo.dev/docs/configuration/expected-outputs/python/).
- [Telemetría](https://www.promptfoo.dev/docs/configuration/telemetry/),
  [privacidad](https://www.promptfoo.dev/docs/red-team/troubleshooting/data-handling/)
  y [seguridad](https://github.com/promptfoo/promptfoo/security/advisories).
