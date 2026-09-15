# RoomieHub — Fase 1

Base real para convivencia, con Next.js, TypeScript y Supabase. Requisitos completos: [docs/product-requirements.md](docs/product-requirements.md). Arquitectura y roadmap: [AGENTS.md](AGENTS.md).

## Ejecutar

Node.js 22.12+ y pnpm. `pnpm install`, copiar `.env.example` a `.env.local`, configurar Supabase como se explica en [docs/setup.md](docs/setup.md), ejecutar `pnpm dev` y abrir http://localhost:3000.

Sin variables la aplicación muestra instrucciones de conexión; no crea sesiones o pisos ficticios.

## Validar

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Navegador: `pnpm exec playwright install chromium` y `pnpm test:e2e`. Alcance exacto y comprobaciones pendientes: [docs/validation.md](docs/validation.md).

## Implementado

Registro, login/logout, recuperación y sesión SSR; perfil con nombre/foto; creación y unión a varios pisos, invitaciones regenerables, workspace y ajustes; permisos iguales y borrado exclusivo con un único miembro activo; Storage privado, RLS y suscripción Realtime base. Diseño mobile-first, claro/oscuro, diccionarios es/en y manifest inicial.

Los cinco módulos futuros son páginas informativas claramente marcadas como próximas fases, sin controles que simulen operaciones. No hay localStorage ni datos de negocio ficticios.

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

Aplicar migración y configurar Auth/URLs/plantillas email con las variables de `.env.example`. No se ha provisionado ni desplegado un proyecto remoto. La comprobación integral de usuarios, correo, Storage y Realtime exige ese backend. Google es opcional. Service worker/offline/push y limpieza de objetos huérfanos quedan para fases posteriores.

## Fases

### Corrección de fase 1

Monedas internacionales (30 opciones, EUR inicial), privacidad del perfil actual al terminar la última membresía compartida e invitaciones conservadas en login, registro con confirmación y Google. Aplicar la **nueva** migración `202609150002_currency_profile_privacy.sql` y actualizar las URLs/plantillas de Auth según [setup](docs/setup.md). La migración original y la especificación del producto se conservan. No se ha iniciado la fase 2.

1. Auth, perfil, pisos, invitaciones, RLS, Storage, tema e idioma.
2. Tareas y compras; después gastos, calendario, convivencia, chat y notificaciones según AGENTS.md.
