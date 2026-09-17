# RoomieHub — Fase 5

Base real para convivencia, con Next.js, TypeScript y Supabase. Requisitos completos: [docs/product-requirements.md](docs/product-requirements.md). Arquitectura y roadmap: [AGENTS.md](AGENTS.md).

## Ejecutar

Node.js 22.12+ y pnpm. `pnpm install`, copiar `.env.example` a `.env.local`, configurar Supabase como se explica en [docs/setup.md](docs/setup.md), ejecutar `pnpm dev` y abrir http://localhost:3000.

Sin variables la aplicación muestra instrucciones de conexión; no crea sesiones o pisos ficticios.

## Validar

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Navegador: `pnpm exec playwright install chromium` y `pnpm test:e2e`. Alcance exacto y comprobaciones pendientes: [docs/validation.md](docs/validation.md).

## Implementado

Registro, login/logout, recuperación y sesión SSR; perfil con nombre/foto; creación y unión a varios pisos, invitaciones regenerables, workspace y ajustes; permisos iguales y borrado exclusivo con un único miembro activo; Storage privado, RLS y suscripción Realtime base. Diseño mobile-first, claro/oscuro, diccionarios es/en y manifest inicial.

Organización incluye tareas recurrentes, reparto ponderado, rotaciones manuales, ausencias con reasignación, fechas límite y múltiples listas de compra, con Realtime. Gastos incluye reparto, pagos y recurrentes; Reservas, Actividades y Calendario están implementados. Convivencia incluye valoraciones, conversiones automáticas, penalizaciones por retraso, castigos y ranking. Chat y notificaciones siguen pendientes. No hay localStorage ni datos de negocio ficticios.

## Archivos principales

- `src/app/`: rutas, layouts y Server Actions.
- `src/components/`: formularios con errores/pending, navegación y componentes compartidos.
- `src/lib/supabase/`: clientes SSR/browser y contrato de tipos de la base.
- `src/lib/i18n/`: diccionarios, preferencias y contexto.
- `src/features/`: suscripciones y contratos para futuras fases.
- `supabase/migrations/202609150001_foundation.sql`: esquema, transacciones, RLS y Storage.
- `tests/`: validadores, PostgreSQL y navegador.
- [docs/architecture.md](docs/architecture.md): decisiones y límites futuros.

## Pendiente de configuración externa

Aplicar las migraciones pendientes según [setup](docs/setup.md). El desarrollo ya utiliza un Supabase real; el repositorio no incluye sus credenciales. Google es opcional. Service worker/offline/push y limpieza de objetos huérfanos quedan para fases posteriores.

## Fases

### Corrección de fase 1

Monedas internacionales (30 opciones, EUR inicial), privacidad del perfil actual al terminar la última membresía compartida e invitaciones conservadas en login, registro con confirmación y Google. Las migraciones originales y la especificación del producto se conservan.

### Fase 2

- Nueva migración: `supabase/migrations/202609150003_organization.sql`.
- UI: Organización → Tareas / Compra / Ausencias. Mi perfil contiene Mis pisos y Cerrar sesión.
- Tareas iniciales: Configurar tareas → Añadir tareas iniciales; seguro para pisos nuevos o existentes, sin duplicados ni reemplazar ediciones.
- Definiciones editables; instancias con un responsable, peso, periodo, deadline y snapshots de nombres. Historial de asignaciones y completados.
- Generación solo en Tareas para hoy y mañana según la zona del piso, RPC explícita para otros rangos y preparación para jobs. No hay cron instalado ni puntos por retraso en esta fase.
- Compras solo con nombre y comprado, baja lógica, completar lista en una transacción. Sin precios, cantidades, notas ni gastos.
- Validación real: `node scripts/validate-organization-remote.mjs` contra **desarrollo**, con servidor activo. Crea y elimina sus propios usuarios/pisos de prueba; necesita clave administrativa únicamente para esos fixtures. Ver [validación](docs/validation.md).

1. Auth, perfil, pisos, invitaciones, RLS, Storage, tema e idioma.
2. Tareas y compras; después gastos, calendario, convivencia, chat y notificaciones según AGENTS.md.

## Endurecimiento de Fase 2

Migración aditiva `202609150004_task_lifecycle_timezone.sql`: cancelación auditable de futuras pendientes, calendario local configurable y reparto futuro actualizado al entrar miembros. Ver [semántica y entrega](docs/phase-2-hardening.md). No incluye Fase 3.

## Fase 3 — Gastos compartidos

Gastos con reparto igual, exacto o porcentual; saldos derivados y pagos sugeridos; registro de pagos; edición auditada y baja lógica; recurrentes fijos/variables; tickets privados; compra→gasto y salida solo con saldo cero. Moneda única con aritmética exacta y calendario del piso.

Aplicar `supabase/migrations/202609150005_expenses.sql` después de 004. Ver [entrega y decisiones](docs/phase-3-delivery.md), [configuración](docs/setup.md) y [validación](docs/validation.md). No incluye Fase 4.

## Fase 4 — Reservas, actividades y calendario

Recursos configurables en Organización → Reservas, reservas sin solapamientos, actividades con participantes en Convivencia y calendario mensual con agenda, tipos y Solo lo mío. Horas del piso, RLS y sincronización entre miembros; se preservan tareas y finanzas.

Nueva migración `202609150006_calendar_reservations_activities.sql`, después de 005. [Entrega completa](docs/phase-4-delivery.md), [configuración](docs/setup.md) y [validación](docs/validation.md). No incluye Fase 5.

Los scripts también se ejecutan con `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:db`, `npm run build`, `npm run test:e2e`. Integración autenticada de desarrollo: `npm run test:calendar:remote` con el servidor local activo y credenciales en .env.local. El lockfile de dependencias sigue siendo pnpm-lock.yaml.

## Fase 5 — Convivencia

Puntos, motivos configurables, anonimato en backend, fotos privadas, consumo automático de tres positivos, negativos por días completos de retraso, castigos persistentes y ranking de miembros activos. Inicio solo muestra el resumen propio. Actividades sigue disponible en Convivencia → Actividades.

Migraciones aditivas **007 y 008**, después de 006. [Entrega y decisiones](docs/phase-5-delivery.md), [configuración](docs/setup.md) y [resultados de validación](docs/validation.md). `npm run test:community:remote` prueba Supabase real con cuentas temporales y limpieza. La aplicación no usa clave administrativa. No se implementa Fase 6.

### Hardening de Fase 5

Migración aditiva **009**: salir materializa los retrasos ya devengados y sus castigos antes de desactivar al miembro, conservando saldo cero, historial y reentrada. Procesa también backlogs de más de 500 decisiones. [Entrega y validación](docs/phase-5-hardening.md).
