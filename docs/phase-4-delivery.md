# Fase 4 — Entrega

Petición conservada en [phase-4-requirements.md](phase-4-requirements.md). No se implementa Fase 5. Tareas, finanzas, privacidad de perfiles y reglas del producto se mantienen.

## 1. Migración

`202609150006_calendar_reservations_activities.sql`, aditiva y transaccional, después de 005. No modifica 001–005. El usuario confirmó ejecución completa en SQL Editor; posteriormente se verificaron operaciones reales mediante Auth/PostgREST. No se consultó el registro administrativo `supabase_migrations`.

## 2. Tablas

- `resources`: nombre/descripción, activo, versión, semilla opcional y snapshot de creador.
- `reservations`: recurso, responsable, título opcional, inicio/fin absolutos, snapshots, versión y cancelación.
- `activities`: título/descripción/lugar, inicio/fin opcional, creador, versión y cancelación.
- `activity_members`: una fila por actividad/usuario, snapshot de nombre y asistencia con baja lógica.

## 3. Constraints

Exclusión GiST `reservations_no_overlap`, rangos válidos y fin posterior a inicio, timestamps finitos, duración de reserva máxima de siete días, longitudes acotadas, FKs compuestas con home_id y membresía, participante único `(activity_id,user_id)`, recurso semilla único `(home_id,seed_key)`. `btree_gist` aporta igualdad UUID a GiST. No se añaden recurrencias de reservas.

## 4. Funciones

RPCs: `save_resource`, `initialize_resources`, `save_reservation`, `cancel_reservation`, `save_activity`, `cancel_activity`, `set_activity_attendance`. Conversión temporal: `calendar_local_instant`. Trigger privado: `calendar_membership_departure`, instalado sobre cambio de `home_members.active`.

## 5–6. Solapamiento y concurrencia

Mismo recurso y reservas no canceladas: `tstzrange(starts_at,ends_at,'[)') WITH &&`. 18–19 y 19–20 son compatibles; recursos distintos también. Los cinco casos de solapamiento están cubiertos. La RPC muestra el intervalo conflictivo en un error traducido; el constraint sigue siendo la última garantía aunque se omita ese chequeo.

Todas las escrituras toman el bloqueo transaccional del piso y comprueban usuario/membresía. Dos peticiones de miembros distintos se serializan. Versiones rechazan formularios antiguos; UUID + contenido de creación permiten reintentos idempotentes. Un cambio rechazado es atómico. La exclusión funciona también para escrituras SQL administrativas que omitan las RPCs.

## 7. Edición y cancelación

Todos los miembros activos pueden gestionar reservas. Recurso/responsable deben estar activos y pertenecer al piso. Nueva reserva o nuevo inicio no puede comenzar más de cinco minutos en el pasado; una reserva en curso admite edición conservando su inicio. Las terminadas no se editan. Cancelar conserva registro/nombres y libera horario, es idempotente y exige confirmación en UI. Las canceladas no aparecen entre próximas.

Desactivar recurso bloquea nuevas reservas y ediciones que lo seleccionen; no cancela silenciosamente las ya creadas. Se pueden cancelar o mover a otro recurso. Renombrar un recurso no reescribe automáticamente nombres históricos de reservas; al editar una reserva se actualiza su snapshot del recurso. La UI ofrece próximas, día, historial y filtro por recurso. Las tres semillas son explícitas, localizadas e idempotentes; no se añaden a pisos existentes sin pulsar el botón.

## 8–9. Actividades y participantes

Convivencia → Actividades: fecha/hora, fin opcional, ubicación y texto libre. El creador se apunta automáticamente y puede salir. Cualquier activo edita/cancela; editar mantiene participantes. Apuntarse/desapuntarse cambia únicamente la fila del usuario actual y es idempotente. No hay capacidad máxima ni roles especiales.

Cancelar conserva actividad y participantes. Una actividad sin fin se considera histórica al llegar su inicio; con fin, al llegar ese fin. No se permiten inscripciones tras ese momento. Se puede corregir texto de una actividad histórica conservando su inicio; no se borra su historial.

Al abandonar el piso se cancelan reservas propias cuyo inicio aún es futuro y se retira la asistencia a actividades futuras. Pasado y reservas/actividades en curso conservan snapshots; el exmiembro pierde acceso operativo. La salida sigue condicionada por saldos de Fase 3. No se amplía acceso al perfil actual.

## 10–11. Calendario y fuentes

`CalendarEvent` normaliza consultas RLS; no existe tabla de eventos duplicada. Mes con 42 celdas, inicio semanal del piso y agenda del día seleccionado. Cada evento enlaza con el registro/contexto de su módulo:

- Tareas existentes con deadline: instante y estado pendiente/atrasada/completada. Sin deadline: día lógico de inicio del periodo, todo el día.
- Reservas no canceladas: recurso, intervalo y responsable.
- Actividades no canceladas: título, intervalo, lugar y asistentes.
- Recurrentes financieros activos: siguiente fecha; periodos variables emitidos pendientes: fecha y estado pendiente. No todos los gastos históricos ni proyección infinita.

La consulta no genera tareas ni contabiliza recurrentes. Las funciones de generación existentes siguen siendo autoridad en sus módulos. Rangos con margen para offsets IANA y normalización exacta por fecha local; lecturas paginadas de 500 filas. Un evento que termina a medianoche no ocupa el día siguiente. Intervalos de varios días aparecen en cada día que tocan.

## 12. Filtros

Tareas, Reservas, Actividades y Gastos, combinables; Solo lo mío usa responsable de tarea/reserva, asistencia a actividad y pagador o participante del recurrente. Solo presentación; no modifica datos. Tipos con etiqueta y color usando variables del tema. Los filtros se conservan durante refresh del componente, no como preferencia permanente.

## 13. Timezone

Valores iniciales y presentación usan `homes.timezone`, no la zona del dispositivo. SQL interpreta datetime-local en la IANA actual y almacena timestamptz. Las fechas lógicas de tareas/recurrentes conservan la semántica de 004/005. Cambiar zona solo cambia la presentación de instantes ya guardados.

Huecos DST se rechazan mediante conversión ida/vuelta; horas repetidas usan la interpretación estándar de PostgreSQL y la UI lo explica. Guardar una hora sin cambiarla conserva el instante previo, incluso si cayó en la otra ocurrencia de una hora repetida. Formularios capturan la zona y versión con las que se abrieron; zona obsoleta requiere recargar. No se permite elegir explícitamente entre ambas ocurrencias de la hora repetida en esta fase.

## 14–15. Realtime y RLS

Las cuatro tablas se añaden a `supabase_realtime`. HomeSync escucha INSERT/UPDATE por home_id, espera sesión y suscripción PostgreSQL, refresca consultas y elimina canales al desmontar. Cancelaciones/asistencia son UPDATE, evitando depender de filtros DELETE. Las escrituras no se presentan como exitosas antes de confirmar el servidor.

RLS SELECT solo para miembros activos; clientes sin privilegios de escritura directa. RPCs SECURITY DEFINER con search_path vacío y comprobación auth bajo bloqueo. Función de trigger no ejecutable por clientes. Anónimos y externos no tienen acceso operativo. Snapshots mínimos permanecen aislados en el piso.

## 16–18. Verificación

Resultados y errores encontrados se registran en [validation.md](validation.md). Se ejecutan lint, typecheck, test, test:db, build, E2E público y `test:calendar:remote` con cuentas reales temporales.

La suite local prueba el constraint directamente, los cinco solapamientos, adyacencia, recursos distintos, edición/cancelación/versiones, actividades/asistencia, RLS, salida, DST/medianoche, normalización y filtros. PGlite serializa sus peticiones y no acredita contención multisesión.

El script remoto sí envía dos peticiones HTTP concurrentes con JWTs de dos usuarios: exactamente una reserva aceptada. También prueba formulario de recurso/reserva/edición/cancelación, actividad y asistencia en dos navegadores con Realtime sin recarga manual, calendario con cuatro fuentes/filtros y ausencia de generación, aislamiento, cambio de zona e instantes, hora inexistente/repetida y pérdida de acceso al salir. No es una prueba de carga masiva.

## 19. Pasos manuales

En otro proyecto, aplicar 001–006 por orden y configurar .env.local. En el proyecto de desarrollo actual, el usuario ya confirmó 006 y la integración real verificó su funcionamiento. Añadir recursos propios desde Reservas; las semillas son opcionales. Repetir el script de integración únicamente contra desarrollo si cambia la configuración. No hay despliegue de producción ni scheduler nuevo.

## 20. Límites conocidos

MVP mensual + agenda, sin vista semanal ni drag-and-drop. Reserva puntual de hasta siete días. No auditoría completa de cada edición, sí versiones/cancelación/snapshots. Recursos y vistas de reservas/actividades cargan su historial paginado y filtran en servidor; será conveniente añadir búsqueda y paginación de UI si el volumen crece mucho. Calendario carga asistentes del piso y filtra por actividad; no es una optimización para miles de planes.

No se ha hecho una prueba de carga, offline prolongado, OAuth/SMTP ni todos los husos IANA. Horas repetidas siguen una política fija. Generación y contabilización mantienen los límites documentados de las fases anteriores. No puntos, negativos, castigos, ranking, chat, notificaciones ni Fase 5.

Durante la integración con Next dev aparece intermitentemente `The destination stream closed early` al interrumpirse un refresh/navegación. Los flujos y las comprobaciones de datos pasan; el mensaje sigue pendiente de diagnóstico en desarrollo. Build de producción correcto, pero integración autenticada ejecutada con next dev, no next start.
