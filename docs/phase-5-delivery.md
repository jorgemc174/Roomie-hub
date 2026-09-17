# Fase 5 — Convivencia

Petición íntegra en [phase-5-requirements.md](phase-5-requirements.md). Fases anteriores conservadas; sin chat, notificaciones, emails, push, cron global ni PWA final.

## 1. Migraciones

- `202609150007_community_ratings_punishments.sql`: modelo, transacciones, anonimato, fotos, retrasos, castigos y Realtime.
- `202609150008_community_membership_epoch.sql`: ventana de elegibilidad nueva al reingresar; impide generar después penalizaciones del periodo fuera del piso.

Ambas aditivas y transaccionales después de 006. El usuario confirmó su ejecución en SQL Editor; se validó comportamiento mediante Auth/PostgREST/Storage reales, sin acceso al registro administrativo de migraciones. 007 ya estaba aplicada al detectar el caso de reentrada: se mantiene intacta y se corrige con 008. 001–006 y product-requirements.md no se modifican.

## 2. Tablas

Públicas: `rating_reasons`, `ratings`, `rating_redemptions`, `punishments`. Privadas: `community_private.rating_authors`, `rating_audit`, `rating_uploads`, `penalty_progress`, `penalty_days`. Las nueve tienen RLS. La tabla pública ratings no contiene autor/editor ni FK que permita un join a la autoría. Los saldos se derivan de registros, no de contadores mutables.

Se amplía el historial de asignaciones con orden estable y transiciones de bloqueo/desbloqueo. 008 añade `home_members.penalty_active_since`; no cambia joined_at ni el historial de los demás módulos.

## 3. RPCs y funciones

RPCs: `initialize_rating_reasons`, `save_rating_reason`, `save_rating`, `delete_rating`, `community_balances`, `rating_author_labels`, `reconcile_community`, `save_punishment`, `prepare_rating_photo`, `attach_rating_photo`, `rating_photo_access`.

Helpers privados: reconciliación de una persona, emisión de retrasos, seguimiento de bloqueo, completado y reentrada, saneado de metadata. SECURITY DEFINER con search_path vacío, autorización y privilegios mínimos. Las escrituras bloquean la fila del piso mediante organization_lock; lecturas comprueban membresía activa. Ninguna RPC permite al cliente elegir la hora de ejecución del job.

## 4. Positivos

Cada valoración representa +1. Histórico = tipo original recibido, incluso si luego se corrigió o eliminó; el historial permite ver esas bajas/correcciones. Disponible/consumido se calcula sobre valoraciones actualmente vivas. La UI distingue estos conceptos y muestra créditos pendientes.

## 5. Negativos

Cada valoración manual o penalización representa −1. No hay reinicio temporal. Negativos efectivos = negativos vivos menos compensaciones vigentes, mínimo cero. Los registros compensados no se borran. Los originales y las revisiones permiten reconstruir cambios.

## 6. Motivos

Todos los activos pueden crear/editar/desactivar motivos positivos o negativos, con versión. Diez semillas es/en explícitas e idempotentes; Otro exige texto. Toda valoración manual necesita motivo activo del mismo piso y contexto cuando se requiera. El snapshot conserva el texto histórico al renombrar/desactivar un motivo. Los retrasos usan una razón de sistema independiente de este catálogo.

## 7. Anonimato

El autor se conserva solo en tablas privadas. rating_author_labels devuelve su identidad en identificadas o al propio autor; en anónimas devuelve NULL a todos los demás. Auditoría/actores no salen por API, joins ni Realtime. Un compañero puede corregir una anónima, pero no quitarle anonimato; solo el autor puede identificarla. Cambiar una identificada a anónima no borra información ya vista por otras personas. Tampoco puede impedirse inferir autor por el contenido voluntario de una foto/texto o por el contexto del piso.

## 8. Adjuntos

Foto opcional JPEG/PNG/WebP, máximo 5 MiB y 20 megapíxeles, sin animaciones. Se decodifica validando MIME real, orienta y recodifica a WebP, hasta 2048×2048, sin EXIF/XMP/IPTC. No PDF/SVG/ejecutables. Ruta piso/valoración/UUID aleatorio sin nombre original ni autor. La metadata de Storage se sanea, incluidos owner/owner_id y user_metadata, para no revelar autor por info/list.

## 9. Edición y eliminación

Todos los activos pueden editar signo/motivo/texto/foto de manuales y dar de baja lógicamente, con confirmación. Receptor, source y source_id son inmutables. Se permite corregir una manual histórica de un exmiembro, sin crear valoraciones nuevas para él. Automáticas no editables/eliminables por usuario. No auto-valoración nueva. Versiones rechazan formularios obsoletos; UUID/contenido de creación aseguran reintentos. Auditoría privada conserva actor y snapshots.

## 10. Consumo de tres positivos

Se ordenan positivos vivos por effective_at e ID y se forman tripletes disjuntos. Cada triplete se consume automáticamente, dentro de la misma transacción. Se registra rating_redemptions. Incluso con cero negativos se consumen tres y queda un crédito pendiente (negative_id NULL), cumpliendo el caso 0 + 3 solicitado. El número de disponibles queda entre 0 y 2; no hay límites a las valoraciones recibidas.

## 11. Compensación

Se asigna cada triplete al negativo vivo más antiguo por effective_at/ID. Un crédito pendiente compensa el siguiente negativo cuando aparezca. Al editar/eliminar se revocan asignaciones incompatibles y reconstruye el reparto determinista; no se eliminan esas conversiones históricas. Se impide doble uso de negativo/triplete vigente con índices únicos. Ejemplos: 3P/1N→0/0; 6P/3N→0/1; 8P/4N→2/2.

## 12. Retrasos

Un negativo por cada bloque completo de 24 h desde deadline_at, hasta el menor entre ahora y completed_at. Lunes 10:00→martes 09:59 = 0; martes 10:00 = 1; jueves 12:00 = 3. Tras completar no se acumulan más. Solo instancias con deadline no canceladas. Cambiar definición/deadline conserva snapshots de instancias actuales/completadas y cancela futuras conforme a 004; una definición desactivada aún puede tener una obligación actual pendiente, que conserva su retraso.

Se ejecuta en Convivencia (excepto la ruta de Actividades), Tareas y al completar. No al abrir Compra/Ausencias/Gastos/Calendario/Inicio. Máximo 500 decisiones por llamada, continuación persistente y aviso/botón en Convivencia. No hay límite de días acumulados, ni cron instalado. El exceso pendiente tras completar se procesa en llamadas posteriores con el cutoff de completed_at.

## 13. Idempotencia de retrasos

Clave única `(source_id, overdue_day)`, cursor por instancia y decisión privada única instancia/día. Diez ejecuciones no duplican. Bloqueo del piso serializa transacciones; las decisiones emitidas no se reescriben. Reintentar un lote parcialmente pendiente continúa desde el cursor confirmado.

## 14. Responsable penalizado

Se busca la última asignación existente en la frontera de cada bloque de 24 h, con desempate estable por event_order. Si una instancia se emitió retroactivamente sin evento anterior, se usa su primer evento. Reasignación antes de la frontera penaliza al nuevo responsable. Frontera bloqueada se registra exenta; inactivo/no incorporado también. 008 exige frontera posterior a la última reentrada, sin rellenar retroactivamente periodos fuera; las penalizaciones anteriores ya emitidas se conservan.

Para instancias ya bloqueadas antes de 007, se registra el estado actual y se omiten conservadoramente días pasados cuyo bloqueo no estaba auditado. No se inventa ese historial. La regla usa responsable en la frontera, no prorratea las 24 h entre varios responsables.

## 15. Generación de castigos

Tras reconciliar, se emiten todos los umbrales de cinco alcanzados y aún no emitidos. 5/15/25… leve, 10/20/30… fuerte. La app no decide la acción: queda pendiente hasta que un activo escribe descripción y marca cumplido. Completar exige descripción y conserva autor/fecha; no consume negativos.

## 16. Evitar castigos duplicados

Constraint único piso/persona/umbral, insert on conflict y bloqueo transaccional. Dos procesos simultáneos no crean dos castigos de cinco.

## 17. Bajar y volver a subir

El castigo emitido permanece, pendiente o cumplido, aunque baje el saldo por positivos o correcciones. Al recuperar el mismo umbral no se repite. Cruzar varios umbrales genera los que faltan. Los exmiembros conservan historial, pero no se generan nuevos castigos para ellos mientras estén inactivos.

## 18. Ranking

Solo activos: menos negativos efectivos, más positivos disponibles y UUID estable. Nombre/avatar actual solo de perfiles autorizados; muestra castigos pendientes y enlace al detalle. Historial de exmiembros mediante snapshots, nunca acceso ampliado a perfil. Inicio solo resumen propio, sin ranking.

## 19. Realtime

Cuatro tablas públicas con filtro home_id; refresco de Server Components, sin duplicar filas con inserciones optimistas. Autores/auditoría/uploads/progreso no publicados. Actividades sigue usando su implementación de Fase 4 en `/community/activities`, y el calendario enlaza a esa ruta.

## 20. RLS

Externos y exmiembros no leen las cuatro tablas ni ejecutan operaciones nuevas. Activos tienen idénticos permisos, sin admins. Clientes solo SELECT, escrituras por RPC; tablas privadas sin grants y fuera del esquema expuesto. Las pruebas cubren API, RPC, JOIN, publicación y acceso directo denegado.

## 21. Storage y revocación

Bucket privado rating-photos. Inserción exige intención de subida válida del actor activo; sin sobrescritura libre. Asociación con versión y misma valoración/piso; descarga exige membresía activa y valoración no eliminada. La ruta de la app vuelve a comprobarlo, descarga con nonce nuevo y responde private/no-store, sin URL firmada reutilizable.

**Limitación confirmada:** Supabase CDN puede servir una respuesta descargada anteriormente aunque la RLS ya deniegue acceso y aunque el archivo se suba con no-store. En la prueba, info/RPC/descarga nueva fueron denegados, la ruta de la app devolvió 404, pero la URL antigua aún devolvía su copia. La suite lo registra como LIMITATION; no se presenta como revocación inmediata de toda copia en CDN. La app no usa ese enlace cacheado. Véase [documentación CDN](https://supabase.com/docs/guides/storage/cdn/smart-cdn). Una copia descargada tampoco puede retirarse del dispositivo del usuario.

## 22. Zona horaria

Los deadlines existentes ya son timestamptz calculados con zona IANA de definición; no se reinterpretan al cambiar timezone. Retraso = duración exacta de 24 h, no diferencia de fechas UTC ni de medianoches locales. Fechas visibles se formatean con Intl y zona del piso. Pruebas de DST y regresiones de medianoche/zonas de fases anteriores.

## 23. Pruebas locales

Resultados completos en [validation.md](validation.md). 90 pruebas lógicas/SQL, de las cuales 78 en test:db; PGlite ejecuta SQL real con interfaces mínimas Auth/Storage, sin afirmar equivalencia con servicios remotos. Incluye todas las regresiones previas y 19 comprobaciones nuevas, con las suites contenedoras. Lint, typecheck, build y navegador se registran por separado.

## 24. Concurrencia

Local: solicitudes encoladas PGlite, sin afirmar multisesión. Remoto: dos miembros envían positivos simultáneos con dos conexiones/JWT reales; partiendo de dos disponibles queda uno, con exactamente una conversión adicional. Dos reconciliaciones simultáneas emiten un único castigo de cinco. Constraints/versiones complementan el bloqueo común del piso.

## 25. Supabase real

007 y 008 confirmadas por el usuario. Script con tres miembros y un externo: login real, valoración anónima con foto desde UI, destinatario por Realtime, API/RPC/joins sin autor, EXIF y metadata sin identidad, compensación, concurrencia, cuatro días de atraso/diez llamadas, completado, castigo/edición/cumplimiento/ranking, idioma inglés/tema oscuro/móvil 360 px, aislamiento y salida/reentrada. Se comprueba 404 de foto en la app tras salir y denegación de petición Storage nueva. Se documenta el resultado CDN anterior. Limpieza dirigida de cuentas, piso y fotos de cada ejecución, sin alterar datos personales.

## 26. Pasos manuales

En desarrollo no queda migración por aplicar tras ambas confirmaciones. Inicializar motivos en los pisos donde se quiera usar el catálogo genérico. En otra instalación aplicar 001→008 y configurar Auth/Storage como setup. SMTP/Google y puesta en producción conservan sus verificaciones externas anteriores. No se instala scheduler ni se inicia Fase 6.

## 27. Límites conocidos

Además del CDN ya descrito: SQL y Storage no comparten transacción, por lo que una foto puede fallar tras guardar la valoración; la UI informa y permite reintentar sin duplicar valoración. Posibles huérfanos sin limpieza programada. Procesamiento de atrasos bajo demanda de 500 decisiones; no se promete emisión puntual con la app cerrada. La UI pagina valoraciones por 50; consultas de saldos/conversiones/castigos recorren el historial del piso y necesitan optimización para volúmenes muy grandes. No se ejecutaron pruebas de carga ni despliegue de producción. Saneado de bytes se garantiza por el flujo de subida de la app; un miembro que voluntariamente escriba su identidad en texto/píxeles no obtiene anonimato sobre ese contenido.
