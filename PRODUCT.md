# RoomieHub

<!-- impeccable:product-schema 1 -->

## Platform

web

PWA responsive e instalable. Android utiliza la misma aplicación web; el repositorio no contiene Kotlin, Flutter ni un cliente Android nativo. La interacción se adapta a pantallas táctiles, áreas seguras e historial del navegador.

## Users

Compañeros de piso que coordinan su convivencia. El idioma inicial es español y también se ofrece inglés. El uso diario en móvil, la navegación intuitiva y un buen modo oscuro son requisitos expresos del usuario; no se presupone una edad ni un segmento comercial.

## Product Purpose

Resolver las tareas de la vida compartida en un solo espacio: saber qué toca hacer, organizar compras y reservas, registrar gastos y pagos, acordar actividades, conversar y consultar puntos y castigos.

## Stack

Implementación existente: Next.js 16 App Router, React 19, TypeScript estricto, CSS/Tailwind, lucide-react y Supabase Auth/SSR, PostgreSQL con RLS, Storage privado y Realtime. Server Components leen; Server Actions y RPCs transaccionales escriben. No se introduce otro framework.

## Operating Context

Un usuario puede pertenecer a varios pisos. Acceso → Mis pisos → piso → seis secciones: Inicio, Calendario, Organización, Gastos, Convivencia y Chat. Cambiar de piso y cerrar sesión se hace desde Mi perfil. El logo del workspace vuelve al piso actual. Perfil y Notificaciones conservan el contexto de origen.

## Capabilities and Constraints

- Organización agrupa tareas, compra, reservas y ausencias. Calendario integra registros existentes y enlaza a su origen.
- Gastos conserva dinero exacto, participantes, moneda por piso, repartos, comprobantes, liquidaciones, recurrencias y auditoría.
- Convivencia conserva anonimato, reglas de compensación y castigos; Ranking no pertenece a Inicio.
- Todos los miembros activos tienen los mismos permisos. No existe administrador de piso.
- Chat único por piso; notificaciones y preferencias por canal. Email/push y Google dependen de su configuración real.
- Datos y archivos aislados por piso. No sustituir el backend por fixtures o almacenamiento local. No crear información para mejorar una captura.
- Se conservan rutas públicas, contratos API, reglas financieras, auth, permisos y esquema. Requisitos íntegros en `docs/product-requirements.md` y contratos de fases en `AGENTS.md`.

## Brand Commitments

RoomieHub y su símbolo de casa. Verde como acento principal, colores sobrios, tono cercano y claro. Tema claro y oscuro. La identidad se refina; no se reemplaza por una estética de landing o de dashboard financiero.

## Evidence on Hand

Repositorio y requisitos del usuario; auditorías previas en `docs/design/`. Cuenta de prueba de desarrollo configurada mediante variables seguras y acceso a dos pisos; se han ejecutado login y consultas reales. Las capturas autenticadas de esta auditoría se almacenan fuera de Git, sin secretos, con invitaciones enmascaradas. No hay diseños Figma aportados ni una sesión MCP de Figma conectada. No hay evidencia de investigación con usuarios externos ni de una prueba en Android físico.

## Product Principles

1. Las acciones cotidianas son fáciles de descubrir y requieren pocos pasos.
2. Filtros, navegación, creación y configuración tienen funciones distintas y se presentan como tales.
3. Conservar contexto, borradores, historial y enlaces profundos.
4. Mostrar errores, estados vacíos y resultados reales; no simular éxito.
5. Cambiar solo lo que mejora un problema observado y verificarlo en el navegador.

## Accessibility & Inclusion

WCAG AA como objetivo en texto y controles aplicables; teclado, foco visible, semántica y etiquetas comprensibles. Objetivo táctil de 44 px, con la excepción de anchura del calendario a 320 px documentada en `DESIGN.md`; texto de formulario legible en móvil, sin zoom deshabilitado. Respetar movimiento reducido y no comunicar estados solo por color. Sin nuevo onboarding, pricing o funciones de negocio inferidas. Los resultados y límites de la verificación real están en `UI_AUDIT.md`.
