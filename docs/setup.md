# Configuración de Supabase

## 1. Crear y preparar el backend

1. Crea un proyecto Supabase y guarda su contraseña de base de datos fuera del repositorio.
2. En un proyecto nuevo, ejecuta las migraciones completas en orden: `202609150001_foundation.sql`, `202609150002_currency_profile_privacy.sql`, `202609150003_organization.sql`, `202609150004_task_lifecycle_timezone.sql` y `202609150005_expenses.sql`, desde `supabase/migrations/`. Ejecuta únicamente las pendientes. Las dos primeras no se modifican en Fase 2. La segunda conserva EUR y restringe perfiles; la tercera añade Organización.
3. Alternativa CLI para un proyecto enlazado: `supabase link --project-ref TU_REFERENCIA`, después `supabase db push`. No ejecutar ambos métodos sobre el mismo esquema sin sincronizar el historial de migraciones.
4. La aplicación nunca necesita la clave secreta ni `service_role`. Las escrituras de pisos pasan por RPC autenticadas; las lecturas por RLS. No añadir roles de propietario/admin.

## 2. Variables

Copiar `.env.example` a `.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://TU_PROYECTO.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false
```

URL y publishable key: panel del proyecto → Connect/API Keys. La anon key heredada también funciona como valor de publishable key, pero se recomienda la clave publicable actual. Estas variables son públicas por diseño; nunca introducir claves secretas. Reiniciar desarrollo tras cambios; reconstruir para producción porque `NEXT_PUBLIC_*` se incorpora al bundle.

Abrir la aplicación con el mismo origen de `NEXT_PUBLIC_SITE_URL` (no alternar localhost y 127.0.0.1 durante Auth). Los callbacks redirigen a ese origen canónico y no confían en el Host de la petición para construir el destino.

## 3. Auth y correos

- Activar proveedor Email y confirmación de correo. La validación de RoomieHub exige ahora un mínimo de **4 caracteres** en registro y cambio de contraseña, por petición del usuario. **Supabase Auth estándar impone un suelo de 6 caracteres**: configurar 4 no basta para reducirlo; no se ha cambiado ni sustituido ese servicio. Por tanto, 4–5 caracteres pasan la validación local pero pueden ser rechazados por el backend. La aceptación real de 4 queda pendiente de un proveedor compatible. No se alteran ni rellenan artificialmente las contraseñas. Referencia: [configuración de Supabase Auth](https://github.com/supabase/auth/blob/master/internal/conf/configuration.go).
- Authentication → URL Configuration: Site URL `http://localhost:3000`. Añadir `http://localhost:3000/auth/confirm?**` y `http://localhost:3000/auth/callback?**` a Redirect URLs. Estos patrones permiten el parámetro `next` variable únicamente en los dos endpoints previstos. En producción sustituir host/protocolo por el origen HTTPS exacto, sin comodines de dominio. Mantener temporalmente el callback sin query si hay enlaces antiguos pendientes.
- **Actualizar también las plantillas existentes**. En **Confirm signup**: `<a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=email">Confirmar cuenta</a>`.
- En **Reset password**: `<a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=recovery">Cambiar contraseña</a>`.
- La aplicación siempre envía `emailRedirectTo`/`redirectTo` con `/auth/confirm?next=...`, de modo que el separador `&amp;` de estas plantillas es intencional. No quitar `next` ni sustituir `.RedirectTo` por `.SiteURL`: se perdería el código. Para correos iniciados desde herramientas externas, usar el mismo contrato de URL o una plantilla específica; estas plantillas corresponden a los flujos de RoomieHub.
- El handler valida `token_hash` y establece cookies. La confirmación vuelve al destino interno del enlace incluso en otro navegador, sin depender de cookies de la pestaña de registro. El callback PKCE de Google conserva el mismo `next` y necesita completar el flujo en el navegador que lo inició. Recuperación conduce siempre a `/reset-password`.
- Los enlaces antiguos sin `next` siguen confirmando y llevan a Mis pisos; no es posible recuperar un código que nunca se incluyó. Los códigos revocados siguen siendo rechazados al pulsar Unirse. Autenticarse no ejecuta `join_home`.
- En producción configurar SMTP propio para correo fiable. Los límites y restricciones del proveedor de prueba de Supabase no equivalen a un servicio de correo listo para usuarios.
- Google es opcional: crear credenciales en Google Cloud, configurar el proveedor Google en Supabase y su callback indicado por Supabase. Solo entonces poner `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`. Sin ello el botón no se muestra.

## 4. Storage y Realtime

### Si el registro rechaza el correo

- `email_address_not_authorized`: el SMTP de pruebas de Supabase solo envía a direcciones del equipo del proyecto. Para una prueba propia usa tu dirección real asociada al equipo de Supabase; para otros usuarios configura **Authentication → Email → SMTP Settings** con host, puerto, usuario, contraseña y remitente verificado de tu proveedor. Esas credenciales van en Supabase, nunca en variables `NEXT_PUBLIC_*`.
- `email_address_invalid`: revisa el correo y usa un dominio real; Supabase no admite dominios de ejemplo/prueba.
- La aplicación muestra ahora mensajes distintos para ambos casos. No desactiva la confirmación de correo ni crea cuentas mediante privilegios administrativos para sortearlos.
- Referencia: [SMTP de Supabase](https://supabase.com/docs/guides/auth/auth-smtp).

### Almacenamiento y suscripciones

- Buckets privados `avatars` y `home-images`, creados por la migración. Límite 5 MiB; MIME JPEG, PNG, WebP. La aplicación comprueba firma binaria y genera nombres UUID. No SVG, PDF ni ejecutables en esta fase.
- Rutas `USER_ID/UUID.ext` y `HOME_ID/UUID.ext`; imágenes mediante URL firmada de 5 minutos. Las URL son tokens de acceso: no publicarlas. La revocación de membresía impide emitir nuevas URL, pero las ya emitidas funcionan hasta su expiración.
- Realtime publica `homes` y `home_members`, con RLS. La suscripción del workspace refresca cambios y limpia canales al salir. Recuperar foco también recarga. Las invitaciones se refrescan al guardar/recuperar foco, sin emitir códigos por canales.
- Los archivos sustituidos o de pisos borrados quedan privados y sin acceso desde la aplicación. Antes de producción, programar limpieza de objetos huérfanos con margen para ediciones concurrentes. No se borra un objeto que otra edición pueda estar usando.

## 5. Arranque y producción

`pnpm install` → `pnpm dev` → http://localhost:3000.
Producción: `pnpm build` y `pnpm start` en un host compatible con Next.js Node, con HTTPS y las variables anteriores. No usar exportación estática: auth SSR y Server Actions necesitan servidor. Este repositorio no se ha desplegado ni ha creado un proyecto Supabase externo.

La aplicación falla de forma explícita si falta backend; jamás usa datos simulados. El cierre de sesión de Supabase invalida las sesiones según su alcance predeterminado.

## Referencias de integración

- [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Next.js Proxy](https://nextjs.org/docs/app/getting-started/proxy)
- [Plantillas de correo y RedirectTo](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Allowlist de redirecciones](https://supabase.com/docs/guides/auth/redirect-urls)

## Evolución

Generar tipos desde tu esquema con `supabase gen types typescript --linked > src/lib/supabase/database.types.ts` al modificar migraciones. Revisar el diff y ejecutar typecheck.
La salida de piso está implementada desde 005 con saldos exactos y bloqueo por deudas; preserva membresías inactivas e historia.

## Fase 2 en un proyecto existente

1. Tras las dos migraciones anteriores, ejecutar **solo** `supabase/migrations/202609150003_organization.sql` completo en SQL Editor. `Success. No rows returned` es el resultado esperado. No repetir el archivo si terminó bien. No modifica ni borra datos de Fase 1.
2. Abrir Organización → Configurar tareas → Añadir tareas iniciales. Es opcional, idempotente y válida también para pisos existentes. Los nombres siguen el idioma de quien inicializa.
3. Configurar recurrencia, dificultad, modo y deadline. El periodo actual y las completadas conservan sus datos; editar o desactivar cancela las futuras pendientes, preservando eventos.
4. Cambiar el día semanal del piso realinea las definiciones semanales. Cancela futuras pendientes; conserva actuales/completadas y evita solaparlas durante la transición.
5. Realtime añade automáticamente `chores`, `chore_instances`, `absences`, `shopping_lists`, `shopping_items` a la publicación. Suscripciones INSERT/UPDATE con filtro home_id; bajas lógicas se propagan como UPDATE. No desactivar RLS para obtener eventos.
6. Verificar dos sesiones compartidas y otra ajena. El script de integración crea fixtures aislados y los limpia; no ejecutarlo contra producción. `.env.local` y `test-account-*.credentials.txt` no se distribuyen.

### Generación y futura programación

`generate_chore_instances(target, from_date, through_date)` admite ventanas de hasta 366 días de diferencia y puede repetirse. Solo Tareas invoca ensure_current_chores: hoy y mañana locales, independientemente del rango consultado. Compra y Ausencias no generan. Para recuperar periodos no visitados se usa Generar y revisar asignaciones, en ventanas consecutivas. No requiere mantener una pestaña abierta, pero **no hay scheduler instalado**: si nadie abre el periodo ni invoca la RPC, no se materializan sus instancias. Un futuro job mantendrá un cursor de ventanas, las ejecutará cronológicamente y reintentará los periodos sin elegibles. Separar la autorización del worker de la RPC de usuario antes de exponer acceso administrativo; no introducir service-role en frontend ni quitar comprobaciones auth.

Los periodos y ausencias usan fechas del calendario local del piso; deadlines usan zona IANA explícita y se convierten a timestamptz. El último día de ausencia está incluido. Cualquier solapamiento excluye durante el periodo entero. Si todos están ausentes, no se crea una instancia nueva; las existentes pendientes se señalan bloqueadas conservando su último responsable hasta poder reasignar.

### Actualización de endurecimiento (004)

Si 001–003 ya están aplicadas, ejecutar únicamente `supabase/migrations/202609150004_task_lifecycle_timezone.sql` completo, una sola vez. No repetir migraciones anteriores. La actualización cancela futuras pendientes pregeneradas; conserva el periodo actual, completadas y eventos.

Ajustes del piso → Zona horaria permite seleccionar o escribir una zona IANA válida. Los pisos existentes conservan UTC; los nuevos usan Europe/Madrid por defecto. Cambiarla preserva los periodos iniciados bajo cualquiera de las dos zonas. Los deadlines existentes conservan su instante y zona de definición; nuevas tareas toman la zona del piso como valor inicial. Ver [semántica](phase-2-hardening.md).

## Fase 3 — Configuración

En instalaciones con 001–004 aplicadas, ejecutar **solo** `supabase/migrations/202609150005_expenses.sql` completo en SQL Editor. En instalación nueva, ejecutar 001 a 005 en orden. No repetir ni modificar archivos ya aplicados. La migración crea ocho tablas, RPCs, políticas, publicación Realtime y bucket privado expense-receipts. No añade datos ficticios.

Abrir Gastos para crear movimientos y generar periodos vencidos; Ajustes ofrece Salir del piso con comprobación transaccional del saldo. Moneda bloqueada tras el primer movimiento o plantilla. Fechas según zona del piso. Tickets hasta 10 MiB; Server Actions admite 12 MB para el formulario y su envoltorio. En hosting, comprobar también el límite de tamaño del proxy/proveedor. No hay cron ni análisis antimalware instalado.

Validación remota de desarrollo: servidor activo en NEXT_PUBLIC_SITE_URL y ejecutar `node scripts/validate-expenses-remote.mjs`. Requiere clave secreta administrativa válida en SUPABASE_SECRET_KEY (o la antigua SUPABASE_SERVICE_ROLE_KEY) exclusivamente para fixtures. Si devuelve Unregistered API key, actualizar la clave local del mismo proyecto; no pegarla en el chat ni en Git. SKIP_REMOTE_UI=true ejecuta únicamente API/Storage, sin acreditar navegadores/Realtime visual. Nunca ejecutar los fixtures en producción.

El entorno de aplicación sigue usando solo clave publicable y sesión del usuario. Para instalación en otro equipo: pnpm install, configurar .env.local desde .env.example, aplicar migraciones pendientes y pnpm dev.

## Fase 4 — Configuración (006)

Con 001–005 aplicadas, ejecutar completo una sola vez `supabase/migrations/202609150006_calendar_reservations_activities.sql` en SQL Editor. Instalaciones nuevas: 001→006 en orden. Necesita `btree_gist`; la migración la activa si falta. Crea cuatro tablas, constraints, RPCs, RLS, trigger de salida y publicación Realtime, dentro de una transacción. No repetir ni editar migraciones anteriores.

Recursos iniciales son opcionales: Organización → Reservas → Recursos → Añadir baño, cocina y lavadora. Puede crearse cualquier recurso propio. No se insertan recursos automáticamente en pisos existentes. Convivencia contiene Actividades. Calendario muestra registros existentes; no hay scheduler ni materialización desde esa página.

Pruebas remotas: servidor activo en NEXT_PUBLIC_SITE_URL, `npm run test:calendar:remote`. Usa la clave administrativa local solo para crear/eliminar tres cuentas confirmadas y un piso de prueba; operaciones normales con JWT de cada cuenta. No imprime contraseñas ni tokens. SKIP_REMOTE_UI=true omite navegadores (no acredita UI/Realtime visual). El script borra únicamente los fixtures que él creó. Usar un proyecto de desarrollo, nunca producción.

En este equipo Windows bloquea el ejecutable pnpm mediante Control de aplicaciones. Los scripts de validación se ejecutaron mediante npm/Node con las dependencias ya instaladas; no se cambió la resolución del lockfile. Playwright inicia Next directamente con Node. Detener otro Next dev del mismo checkout antes del E2E público (puerto 3100); reiniciar después `npm run dev` (3000).

Las nuevas reservas duran como máximo 7 días y admiten 5 minutos de margen en el pasado. Se rechazan horas locales inexistentes; en horas repetidas se usa hora estándar. Cambiar timezone no altera los instantes ya guardados. Para revisar un formulario abierto antes del cambio hay que recargarlo. Ver [semántica completa](phase-4-delivery.md).
