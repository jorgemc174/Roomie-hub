# RoomieHub — Fase 2

Base real para convivencia, con Next.js, TypeScript y Supabase. Requisitos completos: [docs/product-requirements.md](docs/product-requirements.md). Arquitectura y roadmap: [AGENTS.md](AGENTS.md).

## Ejecutar

Node.js 22.12+ y pnpm. `pnpm install`, copiar `.env.example` a `.env.local`, configurar Supabase como se explica en [docs/setup.md](docs/setup.md), ejecutar `pnpm dev` y abrir http://localhost:3000.

Sin variables la aplicación muestra instrucciones de conexión; no crea sesiones o pisos ficticios.

## Validar

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Navegador: `pnpm exec playwright install chromium` y `pnpm test:e2e`. Alcance exacto y comprobaciones pendientes: [docs/validation.md](docs/validation.md).

## Implementado

Registro, login/logout, recuperación y sesión SSR; perfil con nombre/foto; creación y unión a varios pisos, invitaciones regenerables, workspace y ajustes; permisos iguales y borrado exclusivo con un único miembro activo; Storage privado, RLS y suscripción Realtime base. Diseño mobile-first, claro/oscuro, diccionarios es/en y manifest inicial.

Organización incluye tareas recurrentes, reparto ponderado, rotaciones manuales, ausencias con reasignación, fechas límite y múltiples listas de compra, con Realtime. Calendario, gastos, convivencia y chat siguen como próximas fases. No hay localStorage ni datos de negocio ficticios.

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
- Generación al entrar al periodo (30 días), RPC explícita para otros rangos y preparación para jobs. No hay cron instalado ni puntos por retraso en esta fase.
- Compras solo con nombre y comprado, baja lógica, completar lista en una transacción. Sin precios, cantidades, notas ni gastos.
- Validación real: `node scripts/validate-organization-remote.mjs` contra **desarrollo**, con servidor activo. Crea y elimina sus propios usuarios/pisos de prueba; necesita clave administrativa únicamente para esos fixtures. Ver [validación](docs/validation.md).

1. Auth, perfil, pisos, invitaciones, RLS, Storage, tema e idioma.
2. Tareas y compras; después gastos, calendario, convivencia, chat y notificaciones según AGENTS.md.
