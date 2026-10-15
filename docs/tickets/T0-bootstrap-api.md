# T0: arrancar FastAPI y sus comprobaciones propias

Estado: implementado localmente; autor reporta 21 tests, lint, formato y build correctos. Revisión independiente de código y CI remota pendientes. Escritor: `implementar_base_fastapi`. Dependencia: entorno y directorio del código confirmados. Spec: [0001](../specs/0001-fundacion.md).

## Resultado

Un checkout limpio instala dependencias fijadas, inicia FastAPI y verifica la vida del proceso mediante HTTP. Una CI específica ejecuta sus pruebas reales. Este bootstrap todavía no acredita base de datos ni disponibilidad del producto.

## Alcance

- Paquete backend nuevo mínimo, configuración explícita y lock reproducible.
- Paquete `src/aulalista_api`, factory `aulalista_api.app:create_app` y `GET /health/live` → 200 con `{"status":"ok"}`. Sólo vida del proceso, sin readiness simulada.
- `AULALISTA_DOCS_ENABLED=false` por defecto; `true` habilita `/docs` y `/openapi.json`. Un valor inválido falla sin imprimirlo. No habilitar otra ruta de documentación interactiva por omisión.
- Pruebas HTTP de liveness, documentación deshabilitada/habilitada y configuración inválida; sin identidad o datos privados.
- Workflow de CI con permisos mínimos y disparadores que cubran código, tests, dependencias/lock y el propio workflow.
- README con comandos exactos de instalación, arranque y tests, ejecutados por el implementador.

El [README](../../README.md) recoge los comandos reales del candidato, contrastados con `.github/workflows/backend.yml` y los archivos de implementación. Python 3.12.14 y uv 0.12.23; dependencias exactas en `pyproject.toml` y `uv.lock`. El log local muestra 21 tests y comprobaciones correctas; no se ha convertido ese log en prueba de CI remota.

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
