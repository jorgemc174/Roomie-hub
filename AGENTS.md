# RoomieHub

## Alcance y arquitectura

Aplicación real, incremental, mobile-first. Fases 1, 1.1, 2, 2.1 y 3 conservadas; Fase 4 autorizada: recursos, reservas, actividades y calendario unificado. No avanzar a Fase 5 sin petición. La especificación íntegra y vinculante está en `docs/product-requirements.md`; no eliminar ni simplificar requisitos futuros.
Next.js estable App Router, React, TypeScript estricto, Tailwind CSS; Supabase Auth SSR con cookies, PostgreSQL RLS y Storage privado. Server Components para lecturas, Server Actions para escrituras, SQL transaccional para invariantes. No service-role en la aplicación. Nunca sustituir backend por datos ficticios ni localStorage.
`src/app`: rutas; `src/components`: UI; `src/lib`: validación, i18n y clientes Supabase; `src/features`: contratos para módulos futuros; `supabase/migrations`: esquema versionado; `tests`: pruebas.

## Reglas invariables

- Un usuario puede pertenecer a varios pisos. Cambiar de piso desde Mis pisos, fuera del workspace. Datos y archivos aislados por RLS.
- El acceso a Mis pisos y Cerrar sesión está en Mi perfil, por petición del usuario. El logo del workspace vuelve al piso actual.
- Todos los miembros activos tienen idénticos permisos: no admin/propietario/moderador. Solo borrar un piso con exactamente un miembro activo; comprobar con bloqueo transaccional.
- Invitación permanente por código/enlace, entrada directa sin aprobación. Cualquier miembro regenera e invalida el código anterior.
- Salir exige deudas liquidadas; preservar membresía inactiva e historia, excluir antiguos miembros de nuevas operaciones/ranking/asignación.
- El perfil actual y el avatar solo son visibles para uno mismo o para usuarios con al menos un piso donde ambos estén activos. Los futuros registros históricos conservarán snapshots mínimos del nombre, escritos por backend y aislados por piso; nunca justificar acceso permanente al perfil actual. Respetar el anonimato de valoraciones.
- Moneda internacional: código ISO 4217 con formato de tres letras mayúsculas y EUR por defecto; catálogo ampliable, sin conversión. No fijar la base a EUR/USD/GBP. Importes futuros con aritmética exacta y presentación Intl.NumberFormat según moneda/idioma.
- Invitaciones durante auth: conservar next interno validado por safeNext en email/password, confirmación de correo y Google. El correo debe transportar el destino sin depender de cookies de otra pestaña; autenticación no implica pulsar Unirse automáticamente.
- Navegación: Inicio, Calendario, Organización (tareas/compra/reservas), Gastos, Convivencia (puntos/castigos/actividades), Chat. Perfil/ajustes secundarios. Nunca ranking en Inicio.
- Tareas configurables (cocina, baño, salón, basura, suelo iniciales), dificultad 1–5, frecuencias diaria/cada X días/semanal/cada X semanas/mensual, límite opcional, día semanal configurable (lunes inicial). Un responsable; automático equilibra dificultad; manual usa rotación propia. Ausencias reasignan y excluyen temporalmente. Completar tachando, auditoría autor/fecha, sin pruebas/comentarios.
- Un negativo por día completo de retraso sin límite hasta completar; clave única tarea/día, trabajos idempotentes.
- Valoraciones manuales sin límite: receptor/autor/signo/motivo/foto/fecha/anonimato/automático. Anonimato debe proteger autor en API. Motivos configurables con semillas según especificación.
- Consumir 3 positivos disponibles para cancelar 1 negativo, registrar conversión. Negativos no se reinician. Castigos cada múltiplo 5: leve 5/15/25..., fuerte 10/20/30...; pendientes con descripción humana y finalización. No duplicar ni eliminar por reducción posterior. Ranking activos: menos negativos, después más positivos.
- Gastos: pagador, participantes, reparto igual/personalizado/porcentaje/exclusiones, fecha/categoría/ticket imagen o PDF. Dinero entero en unidades menores o numeric exacto, nunca float inseguro. Saldos, deudas, liquidaciones y pagos conservan historia. Moneda única sin conversión. Recurrencia fija contabiliza; variable requiere confirmar importe. Categoría inferida con fallback Otros y edición manual, sin estadísticas complejas.
- Varias listas de compra, solo nombre/comprado; tachar producto o lista, realtime, conversión opcional a gasto con reparto.
- Recursos configurables (baño/cocina/lavadora iniciales); reservas puntuales sin recurrencia, solapamientos impedidos por constraint PostgreSQL por recurso.
- Actividades título/descripción/fecha/hora/lugar/creador/participantes, apuntarse/desapuntarse. Calendario integra y filtra tareas/límites/actividades/reservas/recurrencias.
- Un chat general por piso: texto/emojis/imágenes/archivos/enlaces/respuestas/reacciones. No subchats.
- Notificaciones app/push/email con preferencias y recordatorios 15m/1h/1d. Realtime para chat/tareas/compras/reservas/actividades/puntos/gastos/liquidaciones/notificaciones.
- Storage privado para perfiles/pisos/pruebas/tickets/chat; acceso autorizado, no ejecutables. PWA manifest/iconos/standalone ahora, service worker/offline/push preparados; no simular éxito offline.
- Automatizaciones idempotentes: negativos, recurrencias, recordatorios, ausencias, notificaciones.

## Convenciones y calidad

Textos visibles en diccionarios es/en; fechas/números/monedas con Intl. Tema claro/oscuro, pastel sobrio, accesibilidad y móvil. Validar entradas en servidor y constraints en DB. Funciones SECURITY DEFINER con search_path fijo, privilegios mínimos y comprobación auth.uid(). Tipos sin any. No botones inertes. Errores visibles y estados pending. Ejecutar lint, typecheck, build, pruebas de lógica y RLS; distinguir probado de pendiente de credenciales. Migraciones aditivas, no secretos en Git.

## Gastos — Fase 3

Migración aditiva 005. Bigint en unidades menores; máximo 10^12 por movimiento, BigInt en frontend y sumas SQL numeric exactas serializadas como texto. Escala explícita por moneda; nunca conversión ni cambio de moneda tras historial financiero. Repartos iguales/personalizados/porcentaje (10000 centésimas), mayores restos con desempate UUID. Saldos derivados; sugerencias separadas. Versiones para edición concurrente, UUID de idempotencia, auditoría de revisiones y baja lógica. Un pagador por gasto. Ocho tablas RLS, clientes solo lectura y RPCs transaccionales bajo bloqueo del piso. Snapshots mínimos preservan exmiembros, nunca amplían acceso al perfil. Antiguos no se añaden a gastos nuevos; edición histórica puede conservarlos. Activos registran pagos para reducir saldos antiguos; exmiembro solo consulta propio saldo por RPC específica. Salida y borrado del piso bloqueados ante saldos no cero. Recurrencias vencidas según timezone, 120 periodos por llamada, fijo contabiliza/variable confirma; miembros inactivos requieren revisión. Plantillas variables iguales/porcentajes, personalizado al confirmar. Compra completada tiene vínculo único incluso tras borrar gasto. Storage privado y tickets validados hasta 10 MiB, URLs de descarga 60 s. Realtime por home_id. Detalles en docs/phase-3-delivery.md. No implementar fases posteriores.

## Calendario, reservas y actividades — Fase 4

Migración aditiva 006, sin modificar 001–005. Cuatro tablas con RLS: resources, reservations, activities y activity_members. Lecturas por miembros activos, escrituras mediante RPC bajo bloqueo del piso. Reservas puntuales con exclusión GiST por recurso e intervalo [inicio, fin), parcial para no canceladas; nunca sustituirla por validación frontend. Versiones de edición y UUID de creación evitan sobreescrituras/duplicados. Bajas lógicas preservan nombres e historia. Desactivar recurso conserva reservas existentes; cancelar libera el intervalo. Salir cancela reservas propias futuras y participación futura, conserva pasado e instantes en curso.

Horas locales convertidas en SQL usando homes.timezone, guardadas como timestamptz. Rechazar horas DST inexistentes; repetidas usan interpretación estándar de PostgreSQL. Editar horas sin cambio conserva el instante original; formularios con timezone obsoleta se rechazan. Creador de actividad queda apuntado; inscripción única/idempotente, edición mantiene participantes. CalendarEvent es una capa de lectura, nunca otra tabla ni disparador de generación de tareas/gastos. Mes + agenda, tipos y solo lo mío, enlaces al módulo fuente. Realtime INSERT/UPDATE por home_id para las cuatro tablas. Detalles y límites en docs/phase-4-delivery.md. No puntos, castigos, ranking, chat ni notificaciones.

## Roadmap

La Fase 2 usa `src/features/organization` y la migración aditiva `202609150003_organization.sql`. SQL es la autoridad de recurrencias, asignación ponderada, rotaciones, ausencias y completados; las siete tablas tienen RLS y no conceden escrituras directas a clientes. RPCs bajo bloqueo del piso. Snapshots mínimos de nombres escritos por backend. No borrar definiciones con historia: desactivar. Listas/productos/ausencias usan baja lógica para Realtime filtrado por home_id. Migración 004: periodos según timezone IANA del piso, fin exclusivo; ausencias con fin incluido y cualquier solapamiento excluye. Deadlines con zona IANA por definición. Sin elegibles: no crear instancia nueva; señalar asignación existente bloqueada y reintentar al gestionar/generar. `overdueDays` calcula bloques completos de 24 h, sin emitir puntos. Generación habitual solo en Tareas, hoy..mañana local mediante ensure_current_chores; Compra/Ausencias no generan. Completadas y canceladas inmutables; editar/desactivar cancela solo futuras pendientes, preservando eventos y periodo actual. Nueva membresía invalida futuras automáticas. Pisos existentes UTC, nuevos Europe/Madrid, editable. No reinterpretar estos hooks como autorización para fases posteriores.

1. Fundación: auth, perfiles, pisos, invitaciones, permisos, storage, UI, i18n, tema y scaffolding PWA/realtime.
2. Tareas, rotaciones, ausencias, compra y sincronización realtime.
3. Gastos exactos, pagos, deudas, salida de piso, recurrencias y compra→gasto.
4. Recursos/reservas sin solapamientos, actividades y calendario.
5. Valoraciones/conversiones/ranking/castigos y jobs idempotentes.
6. Chat y adjuntos, notificaciones, recordatorios, PWA offline/push, endurecimiento y despliegue.
   No avanzar de fase sin petición del usuario.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
