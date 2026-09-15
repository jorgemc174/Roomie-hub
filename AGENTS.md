# RoomieHub

## Alcance y arquitectura

Aplicación real, incremental, mobile-first. Fases 1 y 1.1 conservadas; fase 2 autorizada: tareas, rotaciones, ausencias y compra. No avanzar a fase 3 sin petición. La especificación íntegra y vinculante está en `docs/product-requirements.md`; no eliminar ni simplificar requisitos futuros.
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

## Roadmap

La Fase 2 usa `src/features/organization` y la migración aditiva `202609150003_organization.sql`. SQL es la autoridad de recurrencias, asignación ponderada, rotaciones, ausencias y completados; las siete tablas tienen RLS y no conceden escrituras directas a clientes. RPCs bajo bloqueo del piso. Snapshots mínimos de nombres escritos por backend. No borrar definiciones con historia: desactivar. Listas/productos/ausencias usan baja lógica para Realtime filtrado por home_id. Periodos UTC, fin exclusivo; ausencias con fin incluido y cualquier solapamiento excluye. Deadlines con zona IANA por definición. Sin elegibles: no crear instancia nueva; señalar asignación existente bloqueada y reintentar al gestionar/generar. `overdueDays` calcula bloques completos de 24 h, sin emitir puntos. No reinterpretar estos hooks como autorización para fases posteriores.

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
