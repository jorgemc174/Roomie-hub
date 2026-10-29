# Segunda revisión: habilidades de Vercel

Fuente: https://github.com/vercel-labs/agent-skills, revisión `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62`.

Habilidades consultadas: `web-design-guidelines`, `react-best-practices`, `composition-patterns`. Para diseño se descargaron las reglas actuales desde https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md.

## Correcciones

- `src/app/layout.tsx`: el color del navegador y `color-scheme` siguen el tema guardado, no solo la preferencia del sistema. Se añade regresión de ambos colores en Playwright.
- `src/components/auth-screen.tsx`: correo sin corrección ortográfica ni mayúsculas automáticas.
- `src/app/(workspace)/homes/[homeId]/page.tsx`: lecturas independientes en paralelo; avatares con dimensiones y carga diferida.
- `src/app/(workspace)/homes/[homeId]/layout.tsx`: imagen del piso con dimensiones reservadas.
- `src/app/(account)/profile/page.tsx`: foto con dimensiones reservadas.
- `src/styles/system.css`: cifras tabulares en saldos, contadores y comparaciones.

## Criterios conservados

`React.cache` solo deduplica por petición; no se introduce caché global de datos privados. Los componentes compartidos aceptan contenido mediante composición y variantes explícitas. Se conservan controles nativos, foco visible, movimiento reducido y todas las operaciones del backend. No se añaden dependencias ni se ejecutan scripts de despliegue de este repositorio.

Esta revisión acotada no certifica conformidad con todas las reglas ni sustituye la inspección autenticada pendiente en `validation.md`.
