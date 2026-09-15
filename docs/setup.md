# Configuración de Supabase

## 1. Crear y preparar el backend

1. Crea un proyecto Supabase y guarda su contraseña de base de datos fuera del repositorio.
2. En un proyecto nuevo, ejecuta las migraciones completas en orden: `202609150001_foundation.sql` y después `202609150002_currency_profile_privacy.sql`, desde `supabase/migrations/`. Si ya aplicaste la primera, ejecuta **solo la segunda**. No se ha modificado la migración inicial. La segunda conserva datos/default EUR, sustituye la restricción de monedas por formato `[A-Z]{3}` y endurece la lectura de perfiles y avatares.
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
No implementar salida de piso hasta integrar saldos exactos y bloqueo por deudas. Las membresías inactivas ya están modeladas y protegidas.
