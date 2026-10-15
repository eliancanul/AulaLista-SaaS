# T0: arrancar FastAPI y sus comprobaciones propias

Estado: integrado mediante [PR #1](https://github.com/eliancanul/AulaLista-SaaS/pull/1) tras revisión independiente y CI correctas. Main `11c8d4d3e41295dbf5d49023f36b78f4eff1d1e0`; [CI postmerge success](https://github.com/eliancanul/AulaLista-SaaS/actions/runs/38686682062), con 21 tests y comprobaciones propias de T0. Escritor: `implementar_base_fastapi`. Dependencia: entorno y directorio del código confirmados. Spec: [0001](../specs/0001-fundacion.md).

## Resultado

Un checkout limpio instala dependencias fijadas, inicia FastAPI y verifica la vida del proceso mediante HTTP. Una CI específica ejecuta sus pruebas reales. Este bootstrap todavía no acredita base de datos ni disponibilidad del producto.

## Alcance

- Paquete backend nuevo mínimo, configuración explícita y lock reproducible.
- Paquete `src/aulalista_api`, factory `aulalista_api.app:create_app` y `GET /health/live` → 200 con `{"status":"ok"}`. Sólo vida del proceso, sin readiness simulada.
- `AULALISTA_DOCS_ENABLED=false` por defecto; `true` habilita `/docs` y `/openapi.json`. Un valor inválido falla sin imprimirlo. No habilitar otra ruta de documentación interactiva por omisión.
- Pruebas HTTP de liveness, documentación deshabilitada/habilitada y configuración inválida; sin identidad o datos privados.
- Workflow de CI con permisos mínimos y disparadores que cubran código, tests, dependencias/lock y el propio workflow.
- README con comandos exactos de instalación, arranque y tests, ejecutados por el implementador.

Python 3.12.14 y uv 0.12.23; dependencias exactas en `pyproject.toml` y `uv.lock`. El PR conserva los comandos y la evidencia de los 21 tests del bootstrap T0. El [README actual](../../README.md) incorpora T1 y enlaza sus comandos, que ahora requieren configuración explícita de PostgreSQL; esto no cambia el alcance histórico del bootstrap.

## Aceptación

- T0.1: instalación desde el lock y arranque en un entorno limpio sin archivos privados, cuentas pagadas ni base heredada.
- T0.2: HTTP comprueba status y cuerpo de liveness; no necesita DB ni actor de demo.
- T0.3: configuración inválida relevante falla de forma clara y sin revelar secretos.
- T0.4: tests y CI usan el mismo paquete y contrato; pruebas ausentes o fallidas hacen fallar el gate.
- T0.5: manifestar SHA local/remoto, comandos, tests, revisión independiente y resultado de CI de forma separada. Ningún resultado se presume.

## Fuera de alcance

PostgreSQL se implementa inmediatamente en T1. Tampoco incluye fuentes, autenticación, UI, IA, pagos, servicios contratados o deploy. No añadir carpetas, adapters o tablas vacías para esos módulos.

## Recuperación y salida

Recrear el entorno desechable desde archivos versionados. No tocar bases existentes. Entregar el cambio pequeño y su evidencia según [workflow](../workflow.md). Cerrar como «bootstrap»; no como «fundación persistente» o «MVP».
