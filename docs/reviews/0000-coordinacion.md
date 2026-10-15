# Coordinación inicial de la fundación

Fecha: 2026-10-15 UTC. Tipo: registro de coordinación, no revisión de código ni consulta empresarial completada.

## Responsabilidades

- Preparación de documentación: agente `preparar_fundacion_saas`, autor exclusivo de este paquete.
- Implementación: agente `implementar_base_fastapi`, escritor exclusivo de su checkout separado.
- Coordinación: agente padre. Publicación e integración GitHub: agente `revisar_integrar_incrementos`, único escritor remoto; verifica el alcance autorizado antes de actuar.

## Acuerdos confirmados

- Repositorio destino privado nuevo: `eliancanul/AulaLista-SaaS`; código anterior intacto.
- Público individual, suscripción con precios pendientes, inicio limpio y stack FastAPI/PostgreSQL.
- Este paquete sólo escribe documentación local; no implementa código ni publica en GitHub.
- Los agentes pueden comunicarse directamente; decisiones relevantes quedan registradas y la revisión independiente se preserva.
- Separar T0 del primer ticket es admisible si reduce el cambio; T1 con PostgreSQL sigue inmediatamente. T0 no acredita persistencia.

## Contrato conciliado con implementación

El implementador confirmó T0 separado: Python 3.12, paquete `src/aulalista_api`, factory `aulalista_api.app:create_app` y `GET /health/live` → 200 con `{"status":"ok"}`. Sin readiness ni DB simulada. `AULALISTA_DOCS_ENABLED` cierra docs/OpenAPI por defecto y rechaza valores inválidos sin imprimirlos. Los comandos reales están en README, contrastados con el workflow y archivos del candidato. El implementador reportó 21 tests, lint, formato y build correctos con Python 3.12.14 y uv 0.12.23. Este autor inspeccionó el log local; no reejecutó las pruebas ni declara sustituida la revisión independiente.

El integrador verificó el bootstrap de main en `adad3f4f64d6078d4914ef6ba348774428e92c24`, tras la revisión del README mínimo por este autor. Después revisó documentación v1: sin bloqueantes de contratos/privacidad; pidió conciliar el estado y los comandos con T0. La v2 conserva los párrafos del bootstrap y añade el arranque/pruebas reales. El integrador confirmó además los enlaces #165/#166 y la pertinencia de originales/versiones/autoridad; la propuesta institucional antigua no se trasladó. Esta revisión documental no acredita CI ni revisión independiente del código.

## Lecturas y procedencia

Se leyeron las propuestas `first-ticket.md` y el informe técnico preparado para AulaLista el 15 de octubre de 2026 UTC, además de las copias aprobadas de las skills Ponytail y writing-for-agents. Se aplicaron sus criterios de cambio mínimo completo, pruebas de garantías y documentación breve con referencias condicionadas.

Se adaptó el borrador que asumía el repositorio antiguo: aquí no corresponde modificar ADR históricos ni retirar CI heredada. Los contratos de producto relevantes sí se preservan. No se copió código, fuentes docentes, fixtures antiguas ni resultados de pruebas del legado.

## Estado de verificación

Revisión documental independiente v1 realizada por `revisar_integrar_incrementos`, con conciliación de estado incorporada en v2. Pendientes: aceptación de v2, revisión independiente de código, CI remota y pruebas T1/T2. H0 todavía no se declara completado. La existencia de este registro no acredita que un consultor humano o un panel externo haya participado.


## Estado posterior (2026-10-15 UTC)

Este registro anterior se conserva como historia. T0 quedó integrado mediante [PR #1](https://github.com/eliancanul/AulaLista-SaaS/pull/1), main `11c8d4d3e41295dbf5d49023f36b78f4eff1d1e0`, con revisión independiente y [CI postmerge success](https://github.com/eliancanul/AulaLista-SaaS/actions/runs/38686682062). T1 tiene candidato local con 64 tests correctos; su revisión independiente y CI remota del SHA final siguen pendientes. T2 no está implementado. La decisión H0 de continuar se registra por separado en la revisión del hito y no sustituye los gates técnicos.
