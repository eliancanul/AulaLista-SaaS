# ADR 0001: base nueva con ámbito personal

Fecha: 2026-10-15 UTC. Estado: decisiones de producto y stack confirmadas; detalles de implementación propuestos para validación en T0–T2.

## Contexto

El nuevo repositorio privado empieza vacío. El cliente inicial es un docente individual. Se prevé suscripción, con precio a investigar. No existen usuarios ni datos anteriores que migrar. La primera necesidad técnica es conservar un material y su historia sin mezclar propiedad, identidad y pago.

## Decisiones confirmadas

- Backend FastAPI y base PostgreSQL.
- Un ámbito personal por propietario. No modelar escuelas, invitaciones institucionales o transferencias de propiedad en la fundación.
- Código y datos de prueba nuevos; sin importador de legado.
- Mantener separados guardar, interpretar, editar, aceptar y autorizar usos posteriores de una fuente.
- Una suscripción futura concede derechos de servicio; pagar no transfiere propiedad del material.

## Decisiones técnicas del primer corte

1. Backend modular pequeño y síncrono; una Session por operación y transacciones breves. SQLAlchemy, psycopg y Alembic son las candidatas para T1; versiones y compatibilidad se verifican y fijan en lock al implementar.
2. `Principal` es identidad interna estable, no un login. `PersonalScope` tiene propietario obligatorio, único y referenciado por clave foránea.
3. El servidor normal no expone atajos de identidad. Hasta integrar un proveedor real, los materiales sólo son ejercitables por pruebas que inyectan actores; runtime responde 401.
4. Fuentes sintéticas opacas de 1 a 65 536 bytes pueden conservarse en PostgreSQL durante T2. Una transacción confirma bytes, metadatos y recibo. Esta elección evita coordinación prematura con objetos; no selecciona el almacenamiento de documentos reales.
5. Cada versión confirmada es inmutable y recuperable. Escrituras validan propiedad, versión esperada e idempotencia dentro del caso de uso.
6. PostgreSQL real acredita integridad, transacciones y concurrencia. T0 puede ser un bootstrap sin DB; la fundación persistente permanece abierta hasta T1 y T2.

## Consecuencias

Se puede construir sin decidir precio, frontend o proveedor de IA. El corte no simula login, procesamiento ni una demo comercial completa. Las migraciones de esquema de la base nueva sí son necesarias aunque no exista migración de datos históricos.

El backend tendrá que incorporar identidad, aislamiento reforzado, almacenamiento y recuperación antes de admitir documentos reales. Los criterios de ese piloto se especificarán por separado. RLS es una defensa posterior a verificar bajo el rol runtime; no reemplaza la autorización del caso de uso.

## Opciones pospuestas

React/TypeScript/Vite para UI; proveedor OIDC; objetos privados; parser aislado; cola; proveedor/modelo de IA; cobro y hosting. Las recomendaciones previas son insumos para sus decisiones, no compras ni integraciones aprobadas automáticamente.

## Cuándo reconsiderar

- Si se incorpora propiedad institucional, membresías o transferencias: nuevo ADR de autoridad antes del esquema.
- Si se admiten documentos reales o tamaños mayores: almacenamiento, límites, permisos, recuperación y privacidad antes de la carga.
- Si mediciones justifican otra estrategia de acceso a DB o procesos: registrar la evidencia y pruebas de compatibilidad.

## Verificación

[T0](../tickets/T0-bootstrap-api.md), [T1](../tickets/T1-postgresql-ambito.md) y [T2](../tickets/T2-fuentes-versionadas.md) concretan los criterios. Decidir aquí no equivale a haber ejecutado esas pruebas.
