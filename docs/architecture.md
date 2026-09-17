# Arquitectura de RoomieHub

## Límites

App Router sirve rutas públicas `/login`, `/register`, `/forgot-password`, confirmaciones y `/setup`. `/homes` lista solo datos permitidos por RLS. `/homes/new`, `/homes/join` y `/profile` están en el layout de cuenta. El layout independiente `/homes/[homeId]` ofrece el workspace; todas sus páginas vuelven a comprobar usuario/piso antes de consultar. Nunca se confía en el layout como única frontera de seguridad.

SSR usa cookies renovadas por Proxy. Las Server Actions vuelven a comprobar usuario y entradas. Se usa clave publicable con JWT del usuario, nunca service-role. Las funciones SQL SECURITY DEFINER fijan `search_path` y comprueban `auth.uid()`. Insertar membresías, crear/borrar pisos y rotar invitaciones directamente está prohibido.

La fila del piso serializa uniones, regeneraciones, ajustes y borrados. La unión vuelve a comprobar el código tras adquirir el bloqueo; un borrado cuenta miembros dentro de la misma transacción. Una misma unión no duplica membresías.

## Preferencias y traducciones

Diccionarios tipados es/en y cookies de idioma/tema para SSR sin parpadeo. Son preferencias de interfaz, no almacenamiento de datos de negocio. El perfil las persiste en Supabase y el login con contraseña las restaura. La selección pública de idioma/tema afecta al dispositivo; el perfil permite guardar en la cuenta.

## Módulos futuros

`src/features/contracts.ts` define límites compartidos, no tablas vacías ni acciones falsas. Añadir cada módulo como feature con queries, actions, UI y migración RLS propias.
Cada entidad colaborativa tendrá home_id, referencias compuestas que impidan relacionar registros de pisos distintos, y políticas para miembros activos. No confiar solo en un filtro de frontend.

## Jobs y notificaciones

Futuro worker (Supabase Edge Functions + scheduler o proceso servidor) con tabla outbox y clave única de idempotencia. Transacciones escriben cambios y eventos juntos. Adaptadores independientes in_app/push/email, preferencias por usuario y recordatorio en minutos. Nunca ejecutar trabajos confiando en que alguien abra una página.
Deduplicación tarea/día para negativos, instancia/periodo para recurrencias y receptor/evento/canal para notificaciones. Los detalles completos de positivos, castigos y gastos siguen en AGENTS.md y la especificación.

## PWA

Manifest, icono SVG y metadatos standalone iniciales. Fase posterior: PNG 192/512 y maskable, service worker versionado y página offline pública, suscripciones push con VAPID y autorización. No cachear respuestas privadas de Auth, RPC o datos de otros pisos. No cola optimista para dinero/reservas/valoraciones; mostrar desconexión y confirmar únicamente tras persistencia. No se anuncia instalación/offline completo en esta fase.

## Retención y archivos

URLs firmadas cortas. Verificar MIME y firma en servidor; no interpretar archivos como código. Futuro chat/tickets necesita política de contenido y análisis adicional. Limpieza de objetos huérfanos con margen temporal y comprobación de referencias. Antes de ofrecer eliminación de cuenta hay que diseñar anonimización histórica compatible con relaciones.

## Monedas internacionales

`homes.currency` guarda un código de tres letras ASCII mayúsculas con EUR por defecto. La base valida formato, no el registro completo ISO 4217: un código sintácticamente válido no garantiza que sea una moneda oficial. `src/lib/currencies.ts` mantiene un catálogo curado de códigos ISO habituales; añadir monedas consiste en ampliar esa lista. Server Actions validan el mismo formato que SQL. El selector conserva también una moneda válida ya guardada aunque todavía no esté en el catálogo, para no cambiarla accidentalmente al editar otros ajustes.

Las etiquetas usan `Intl.DisplayNames` para es/en. La Fase 3 añade importes sin conversión; se formatean con `Intl.NumberFormat(locale, { style: 'currency', currency })`, respetando los decimales de cada moneda (JPY no se trata como EUR). La aritmética seguirá siendo exacta, independiente del formateo.

## Perfil actual frente a registros históricos

`can_read_profile()` permite el propio perfil y perfiles de personas con las que se comparte **al menos un piso donde ambas membresías están activas**. Salir de un piso no corta el acceso si queda otro compartido activo; salir del último sí. Las políticas de avatares reutilizan esta regla. Las URLs ya firmadas pueden seguir funcionando durante sus cinco minutos de vigencia; no se pueden emitir nuevas sin autorización.

Cuando existan mensajes, gastos, valoraciones o tareas, cada registro conservará una referencia de autor/participante y un **snapshot mínimo del nombre visible en el momento de la operación**, escrito por el backend en la misma transacción. Ese snapshot pertenece al piso y usa su RLS; no se obtiene haciendo joins al perfil actual del antiguo miembro. Los cambios posteriores del perfil no lo actualizan. No copiar email, preferencias ni URL/avatar actual. Los snapshots de varios participantes se modelarán como registros hijos con referencias compuestas al piso. Las valoraciones anónimas mantendrán la identidad real en un ámbito restringido, sin exponerla por el snapshot público. Las correcciones o anonimización histórica requerirán una operación explícita y auditada. Fases 2–5 implementan estos snapshots en tareas, gastos, reservas, actividades y valoraciones; los autores anónimos se guardan exclusivamente en el esquema privado.

## Continuidad de las invitaciones en Auth

`/invite/CODIGO` conduce a `/homes/join?code=CODIGO`. Login/registro transportan `next` en enlaces y campos ocultos; cada Server Action vuelve a validarlo. Google lleva `next` en su callback; registro lo incluye en `emailRedirectTo` y la plantilla lo conserva con `.RedirectTo`. No se usa una cookie compartida de invitación que pueda ser sobrescrita por otra pestaña. La confirmación por token hash puede abrirse en otro navegador porque el destino viaja en el correo; Google usa el verificador PKCE de la sesión que inició OAuth.

`safeNext` rechaza destinos externos, barras inversas, controles, formas codificadas y rutas que normalizan a `//`. Se comprueba antes de enviarlo al proveedor y al recibir su respuesta. Los fallos vuelven a login conservando solo el destino seguro; los enlaces sin destino llevan a Mis pisos. Confirmación y OAuth establecen la sesión **antes** de redirigir; ninguna de esas rutas añade miembros. El usuario confirma la unión en su formulario habitual.

Los callbacks construyen la redirección absoluta sobre `NEXT_PUBLIC_SITE_URL`, nunca sobre un Host/X-Forwarded-Host recibido. Mantener el mismo origen durante el flujo para las cookies de sesión/PKCE.

## Organización — Fase 2

### Esquema y seguridad

`202609150003_organization.sql` es aditiva. Tablas:

| Tabla                   | Responsabilidad                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| chores                  | Definición, dificultad, recurrencia tipada, ancla, modo, deadline opcional, estado y clave de semilla                 |
| chore_rotation_members  | Orden propio por tarea, sin repetir personas/posiciones, FK compuesta al piso                                         |
| chore_instances         | Una instancia por tarea/periodo; un responsable obligatorio, snapshots de nombre/peso, deadline concreto y completado |
| chore_assignment_events | Historial append-only de asignación/reasignación con nombre mínimo                                                    |
| absences                | Persona, nombre, fechas inclusivas, baja lógica                                                                       |
| shopping_lists          | Listas múltiples, creador y completador con snapshots, estado derivado y baja lógica                                  |
| shopping_items          | Nombre y comprado, autores/fechas, FK compuesta a lista/piso, baja lógica                                             |

Las siete tienen RLS SELECT con `is_home_member(home_id)`. No hay permisos INSERT/UPDATE/DELETE directos para clientes. Todas las escrituras pasan por RPC SECURITY DEFINER, `search_path=''`, auth comprobada y bloqueo de la fila del piso; esto también serializa con las operaciones de Fase 1. Las claves compuestas impiden mezclar pisos. Referencias históricas a perfiles restringen su borrado; membresías no se eliminan al salir. Borrar el piso mediante su regla existente elimina sus datos dependientes, no perfiles.

Snapshots de responsables, autores y completadores se escriben en SQL leyendo el nombre visible en ese momento. No contienen correo/avatar/preferencias ni cambian cuando cambia el perfil. No amplían `can_read_profile`. Completar tareas es idempotente y conserva el primer autor/timestamp: no hay desmarcado de tareas en esta fase. Compra sí permite marcar/desmarcar; representa el estado actual con su última autoría, sin prometer historial de todos los toggles.

### Recurrencias y generación

`chore_period(kind,n,anchor,on_date)` es pura: devuelve inicio incluido y fin excluido. Diaria/cada X días usan desplazamientos desde el ancla; semanal/cada X semanas usan múltiplos de siete. Guardar una tarea semanal normaliza su ancla al día de inicio del piso (lunes inicial). Cambiar ese ajuste realinea las definiciones semanales mediante `realign_chore_weeks`, cancelando futuras pendientes y conservando actuales/completadas. Mensual mantiene el día del ancla y lo acorta al último día de meses cortos: 31 enero → 28/29 febrero → 31 marzo, sin deriva.

`generate_chore_instances` procesa ventanas acotadas a 366 días de diferencia, cronológicamente y con tareas más pesadas primero; desempate por UUID. Índice único parcial (chore_id,period_start) WHERE cancelled_at IS NULL, bloqueo del piso y rechazo de periodos solapados con los ya emitidos impiden duplicados, también después de editar recurrencia. Las actuales y completadas conservan nombre/peso/deadline; editar o desactivar cancela las futuras pendientes y conserva historia. Durante realineaciones se espera al siguiente periodo completo que no se solape con uno ya emitido.

Solo la pestaña Tareas materializa los periodos que contienen hoy y mañana según el calendario local, mediante ensure_current_chores; el rango consultado no amplía la generación. Compra y Ausencias no generan. Un formulario permite backfill explícito de ventanas anteriores. Los pendientes antiguos siguen visibles aunque su periodo haya terminado. La RPC es reutilizable e idempotente; no hay cron instalado. Un futuro worker necesita cursor persistente, procesamiento cronológico, reintentos y una autorización administrativa separada de la RPC de usuario. No se depende de una pestaña permanentemente abierta ni se afirma que haya ejecución programada sin configurarla.

### Reparto y ausencias

Automático: candidatos activos y sin ausencia solapada con el periodo; menor suma de dificultad de las instancias que empiezan en la semana del piso, después menor suma histórica, finalmente hash estable de tarea/periodo/usuario y UUID. La carga incluye tareas manuales y completadas, excluye canceladas; completar pronto no provoca asignaciones extra por sí mismo. Procesar las más pesadas primero equilibra razonablemente pesos, no solo cantidades. El desempate histórico/hash reduce sesgos persistentes. No pretende optimización perfecta ni equivalencia entre generar ventanas en órdenes distintos: invocar en orden cronológico.

Manual: empieza por la primera posición; después del último responsable del periodo anterior, sigue el siguiente miembro elegible y vuelve al principio. Cada tarea conserva su orden independiente. Editar la rotación cancela futuras pendientes para permitir su regeneración; mantiene el periodo actual. Los inactivos y ausentes se saltan sin borrar su historial.

Ausencias son inclusivas y específicas del piso. Se excluye cualquier persona cuya ausencia se solape con alguna fecha del periodo completo (regla conservadora explícita). Guardar/editar/eliminar ausencia y generar invocan `reconcile_chore_assignments`. Revisa pendientes cuyo periodo no ha terminado; no modifica completadas ni periodos históricos cerrados. Manual continúa después del responsable ausente; automático vuelve a usar carga. Si no hay elegibles, una instancia nueva no se crea y se informa del bloqueo; una existente conserva un responsable obligatorio y se señala `assignment_blocked`. Al recuperar disponibilidad se limpia ese estado o se reasigna. No se necesitan flags de activación al terminar una ausencia.

### Deadlines y futura Fase 5

`deadline_days IS NULL` significa deshabilitado. Si existe, SQL combina inicio + días + hora local en `deadline_timezone` IANA y guarda timestamptz. Periodos/ausencias usan calendario local del piso; UI muestra las horas en su zona IANA. `overdueDays(deadline, now, completed)` devuelve floor de milisegundos transcurridos / 86400000, nunca negativo y se detiene en completed_at. El futuro job de negativos utilizará una clave única (instance_id, overdue_day), sin límite de días ni dobles penalizaciones. Esta fase no crea tablas de puntos ni emite penalizaciones.

### Compra y Realtime

`shopping_command` implementa crear/renombrar/eliminar lista, añadir/eliminar/tachar producto y completar lista. El bloqueo del piso hace transaccional el completado entero, incluso frente a añadir un producto concurrentemente. Añadir/desmarcar reabre la lista; lista vacía no se anuncia comprada. `completed_at/by` de la lista es el futuro punto de enlace para crear opcionalmente un gasto; Fase 3 añade conversión explícita y vínculo único a expenses.

`HomeSync` escucha `homes` por id y `home_members` por home_id; añade INSERT/UPDATE de chores, chore_instances, absences, shopping_lists y shopping_items por home_id. Las rotaciones se guardan junto con la definición, cuyo UPDATE refresca la UI. Las bajas lógicas evitan depender de DELETE, que no conserva filtros/RLS completos en Postgres Changes. Las ráfagas se agrupan antes de `router.refresh`; el canal se elimina al desmontar y se vuelve a consultar al recuperar foco/reconectar. Errores de canal se muestran como sincronización degradada. Los registros consultados siguen pasando por RLS: el nombre de canal nunca concede acceso.

Referencia operativa: [protocolo Realtime de Supabase](https://supabase.com/docs/guides/realtime/protocol). Distinguir la unión del canal de la confirmación de la suscripción PostgreSQL al comprobar su disponibilidad.

### Navegación

Organización tiene pestañas Tareas/Compra/Ausencias y vistas Mis tareas/Todas/Configurar. Los formularios secundarios se despliegan con details accesible por teclado. Mi perfil contiene Mis pisos y Cerrar sesión; el logo del workspace vuelve al piso actual. Inicio resume tareas actuales pendientes/atrasadas y productos pendientes. La Fase 3 añade saldo resumido. No añade ranking, reservas, actividades ni chat.

### Ciclo de vida y zona horaria (004)

La migración 004 añade cancelación auditable, índice único parcial y triggers de invalidación bajo bloqueo del piso. La fecha SQL home_local_date es autoridad; homeDate usa Intl para valores iniciales del frontend. Consulte [la semántica completa](phase-2-hardening.md) para cambios de configuración, membresía y zona, y límites de transición.

## Gastos — Fase 3

La migración 005 implementa un libro recalculable de gastos, splits y pagos. Representación entera, reparto por mayores restos, auditoría, control de versiones, recurrentes y políticas detalladas en [phase-3-delivery.md](phase-3-delivery.md). Este documento es la referencia completa de semántica monetaria y retención.

La RPC leave_home serializa la comprobación de saldo con todas las escrituras financieras, conserva la membresía inactiva y ejecuta reconciliación privada de tareas. La función pública de Organización mantiene su comprobación original; no se debilitan sus permisos para permitir la salida. Un trigger impide que cambiar moneda o borrar un piso reinterprete/elimine deudas.

## Fase 4 — Calendario, reservas y actividades

`src/features/calendar` contiene modelos, normalización pura, Server Components de consulta y Server Actions de gestión. La migración 006 añade resources/reservations/activities/activity_members. La fuente de verdad de tareas y finanzas no cambia. CalendarEvent solo existe como contrato de lectura; los enlaces vuelven al módulo original.

Las RPC de escritura reutilizan organization_lock: autenticar, comprobar membresía y bloquear el piso antes de leer/editar. La exclusión GiST `reservations_no_overlap` protege el recurso e intervalo tstzrange [inicio,fin) incluso si se omite el chequeo amistoso de la RPC. Versiones rechazan ediciones obsoletas; create_request + UUID permite reintentos de creación. Cancelar es UPDATE y libera la exclusión parcial; no destruye snapshots. No hay roles especiales ni acceso operativo para antiguos.

SQL convierte fecha/hora local en la zona IANA actual; la UI usa Intl con zona explícita. Round-trip rechaza huecos DST y PostgreSQL resuelve horas repetidas usando hora estándar. Un formulario lleva su zona original y versión; no se actualizan silenciosamente cuando Realtime refresca el servidor. Si las horas no cambiaron se conservan los instantes, también durante una repetición DST. Los timestamps de reservas/actividades no se reescriben al cambiar la zona del piso.

HomeSync añade las cuatro tablas a INSERT/UPDATE filtrado por home_id. Las bajas lógicas permiten que las cancelaciones y salidas se propaguen; se mantienen auth de WebSocket, espera de suscripción y limpieza al desmontar. RLS se aplica a cada nueva lectura. Cerrar una actividad preserva sus participantes; editarla no altera inscripciones. Un trigger de salida cancela reservas con inicio futuro y elimina lógicamente la asistencia futura; conserva pasado y eventos en curso.

La consulta mensual limita por rangos, pagina lecturas de 500 filas y usa un margen UTC de dos días para cubrir todos los offsets IANA; la pertenencia exacta al día se calcula con la zona del piso. No se generan tareas ni recurrentes. Tareas sin límite van al inicio lógico de su periodo; recurrentes muestran próxima fecha activa y periodos variables pendientes emitidos. No se proyecta indefinidamente ni se duplican gastos históricos.

[Entrega y límites](phase-4-delivery.md). Referencias técnicas: [rangos y exclusión PostgreSQL](https://www.postgresql.org/docs/current/rangetypes.html), [interpretación DST](https://www.postgresql.org/docs/current/datetime-invalid-input.html).

## Convivencia — Fase 5

Las migraciones 007 y 008 añaden un registro de valoraciones y conversiones reconstruibles, sin contadores como única fuente de verdad. Las cuatro tablas públicas tienen RLS por miembro activo y solo SELECT; nueve tablas nuevas en total con RLS. Los autores y actores de auditoría están separados en `community_private`, sin acceso cliente ni Realtime. Las etiquetas de autor llegan mediante una RPC que oculta todos los autores anónimos salvo al propio autor. Los snapshots históricos nunca amplían acceso al perfil actual.

Todas las operaciones toman `organization_lock(home)` y ejecutan sus efectos en una transacción. Tripletes de positivos, negativos compensados y umbrales se determinan en SQL, con claves únicas. La edición usa versión; la creación UUID estable. Los castigos tienen vida independiente de los saldos y no desaparecen tras corregir una valoración.

Los jobs privados registran cada decisión por instancia/día. Se calcula cada bloque completo de 24 horas desde `deadline_at`, conservando los instantes y zona de definición de Fase 2.1. El historial de asignación determina responsable/bloqueo en cada frontera. `penalty_active_since` evita retroactividad anterior a la última reentrada sin cambiar `joined_at` ni historia de otros módulos. El límite de 500 decisiones por llamada permite continuar el backlog bajo demanda; no instala scheduler.

Las fotos pasan por decodificación y recodificación con sharp, luego Storage privado y asociación versionada. SQL y Storage no comparten transacción: un fallo parcial se muestra y permite volver a adjuntar; puede dejar objetos huérfanos. El servidor de imágenes comprueba membresía/RLS cada vez y usa descarga con `cacheNonce` y no-store. Una URL de Storage ya descargada puede seguir en el CDN aunque cambie la RLS: se comprobó en desarrollo incluso con cabecera no-store. No prometer revocación de copias ya entregadas; ningún enlace de descarga de la UI evita la comprobación del servidor. Véase [CDN de Supabase](https://supabase.com/docs/guides/storage/cdn/smart-cdn).

Realtime publica únicamente valoraciones saneadas, conversiones, motivos y castigos con home_id; provoca refresh de Server Components, sin insertar una segunda copia optimista. El dashboard lee el resumen propio, sin reconciliar ni mostrar ranking. Actividades conserva su implementación en una ruta propia. [Entrega completa](phase-5-delivery.md).

### Fase 5: salida con retrasos pendientes (009)

`leave_home` ahora liquida los retrasos devengados antes de desactivar la membresía. Mantiene saldo cero/bloqueo del piso, congela now() como instante lógico de salida y left_at, agota issue_overdue hasta more=false y reconcilia conversiones/castigos de activos antes de la baja. Los hooks existentes de tareas y calendario continúan después. Una sola transacción, sin efectos parciales ante error/timeout; 008 sigue excluyendo el intervalo fuera al reingresar. [Semántica y pruebas](phase-5-hardening.md).
