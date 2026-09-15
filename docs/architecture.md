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

Las etiquetas usan `Intl.DisplayNames` para es/en. No hay importes ni conversión en esta fase; cuando se muestren importes deberán formatearse con `Intl.NumberFormat(locale, { style: 'currency', currency })`, respetando los decimales de cada moneda (JPY no se trata como EUR). La aritmética seguirá siendo exacta, independiente del formateo.

## Perfil actual frente a registros históricos

`can_read_profile()` permite el propio perfil y perfiles de personas con las que se comparte **al menos un piso donde ambas membresías están activas**. Salir de un piso no corta el acceso si queda otro compartido activo; salir del último sí. Las políticas de avatares reutilizan esta regla. Las URLs ya firmadas pueden seguir funcionando durante sus cinco minutos de vigencia; no se pueden emitir nuevas sin autorización.

Cuando existan mensajes, gastos, valoraciones o tareas, cada registro conservará una referencia de autor/participante y un **snapshot mínimo del nombre visible en el momento de la operación**, escrito por el backend en la misma transacción. Ese snapshot pertenece al piso y usa su RLS; no se obtiene haciendo joins al perfil actual del antiguo miembro. Los cambios posteriores del perfil no lo actualizan. No copiar email, preferencias ni URL/avatar actual. Los snapshots de varios participantes se modelarán como registros hijos con referencias compuestas al piso. Las valoraciones anónimas mantendrán la identidad real en un ámbito restringido, sin exponerla por el snapshot público. Las correcciones o anonimización histórica requerirán una operación explícita y auditada. No se crean todavía esas tablas o módulos.

## Continuidad de las invitaciones en Auth

`/invite/CODIGO` conduce a `/homes/join?code=CODIGO`. Login/registro transportan `next` en enlaces y campos ocultos; cada Server Action vuelve a validarlo. Google lleva `next` en su callback; registro lo incluye en `emailRedirectTo` y la plantilla lo conserva con `.RedirectTo`. No se usa una cookie compartida de invitación que pueda ser sobrescrita por otra pestaña. La confirmación por token hash puede abrirse en otro navegador porque el destino viaja en el correo; Google usa el verificador PKCE de la sesión que inició OAuth.

`safeNext` rechaza destinos externos, barras inversas, controles, formas codificadas y rutas que normalizan a `//`. Se comprueba antes de enviarlo al proveedor y al recibir su respuesta. Los fallos vuelven a login conservando solo el destino seguro; los enlaces sin destino llevan a Mis pisos. Confirmación y OAuth establecen la sesión **antes** de redirigir; ninguna de esas rutas añade miembros. El usuario confirma la unión en su formulario habitual.

Los callbacks construyen la redirección absoluta sobre `NEXT_PUBLIC_SITE_URL`, nunca sobre un Host/X-Forwarded-Host recibido. Mantener el mismo origen durante el flujo para las cookies de sesión/PKCE.
