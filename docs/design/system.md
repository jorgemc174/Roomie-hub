# RoomieHub — sistema de interfaz

> Registro de una entrega anterior. El sistema vigente y sus decisiones verificadas se mantienen en [DESIGN.md](../../DESIGN.md) y [UI_AUDIT.md](../../UI_AUDIT.md); prevalecen cuando difieren los tokens o medidas.

## Contexto

Next.js 16 App Router, React 19, TypeScript, Supabase SSR/RLS y Lucide. Aplicación de uso diario y colaboración entre compañeros de piso, móvil primero. Mantener las seis secciones, la igualdad de permisos, Mi perfil como acceso a Mis pisos/cierre de sesión y las transacciones existentes.

## Investigación

Se utilizó UI/UX Pro Max, repositorio nextlevelbuilder/ui-ux-pro-max-skill, revisión 28b3b8d. Consultas: `shared household productivity mobile` y, al detectar una propuesta de landing inadecuada, `productivity dashboard minimal green --design-system`; `error summary validation --domain ux`; `loading empty states --domain ux`; `loading suspense forms --stack nextjs`. Se revisaron quick-reference y pro-rules.

Aplicables: diseño plano y contenido primero, tipografía legible, estados accesibles, carga estable, objetivos táctiles amplios y movimiento breve. Los patrones de marketing generados no encajan en la aplicación autenticada y se descartan; no son una propuesta validada. Los colores generados no sustituyen el requisito del usuario de conservar el verde. Se conserva tipografía del sistema para evitar descargas y mantener rendimiento.

## Sistema

- Verde bosque como acción y orientación, menta en oscuro; colores auxiliares solo con significado.
- Tres superficies semánticas: fondo, tarjeta y superficie elevada. Separar `--line` decorativa de `--control-border` para campos.
- Texto normal/secundario con contraste mínimo 4,5:1; controles/foco significativos 3:1.
- Escala de espacio: 4, 8, 12, 16, 24, 32, 48 px. Radios de 10, 16 y 24 px por escala; no cada elemento como una tarjeta.
- Tipografía sistema: texto base 16 px, etiquetas 14 px, texto auxiliar 13 px; encabezados equilibrados y ancho de lectura acotado.
- Iconos Lucide, 20 px en acciones y 24 px en estados; decorativos ocultos a lectores.
- Una acción principal por bloque. Pestañas para destinos, selectores para filtros, desplegables para edición/configuración; nunca hacer pasar una acción por pestaña.
- Mantener las seis secciones por contrato del proyecto, aunque la recomendación genérica de la habilidad sea un máximo de cinco. Garantizar nombres y objetivos táctiles; no ocultar funciones para cumplir una cifra.
- Movimiento: 120 ms para pulsación, 180 ms para énfasis y 240 ms para entrada. Solo opacidad/transformación; desactivar animación con reduced-motion.

## Componentes

`PageHeader`: título/contexto/acción; `EmptyState`: explicación y siguiente paso real; `Feedback`: error/éxito informativos; `FormFeedback`: foco en fallos enviados; `LoadingSkeleton`: estructura estable sin datos ficticios; `CreatePanel`: formulario progresivo con enlace profundo y salida clara.

## Funciones por pantalla

Inicio destaca tareas, compra, saldo y resumen personal. Organización conserva tareas, compra, reservas y ausencias. Gastos conserva repartos, saldos, pagos, recurrentes, adjuntos y auditoría. Convivencia conserva puntos, castigos, ranking, actividades y motivos. Chat conserva texto/adjuntos/respuestas/reacciones/edición/borrado. Perfil, notificaciones y ajustes conservan todas las operaciones.

## Verificación

Probar es/en y claro/oscuro; 320/375/390/768/1440 px y paisaje; navegación por teclado, foco no oculto, reduced-motion, texto ampliado, estados vacíos y errores. Las capturas de componentes aislados se identifican como tales. No afirmar prueba autenticada contra Supabase hasta disponer de una cuenta de desarrollo y completar el recorrido.
