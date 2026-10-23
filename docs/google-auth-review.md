# Revisión local del acceso con Google

## Alcance

Se revisa el flujo de la aplicación actual sin cliente OAuth real ni cambios en Google Cloud, Supabase o 2FA. Esta revisión no lee `.env.production`, no modifica archivos de entorno y no consulta el backend remoto. Los cambios previos de configuración que ya existieran en el árbol de trabajo quedan fuera de esta revisión.

## Correcciones

- El callback escribe las cookies del SDK directamente en la respuesta de redirección y conserva sus cabeceras de caché. Tanto éxito como error llevan `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`, `Pragma: no-cache` y `Expires: 0`.
- Una regla específica de Next.js impide que la política global sobrescriba `Referrer-Policy: no-referrer` en `/auth/callback`. La URL de destino no transporta el código ni los detalles del error del proveedor.
- El proxy conserva cookies de escrituras anteriores y aplica las cabeceras de caché del SDK cuando refresca la sesión. El cliente Supabase de servidor queda protegido por `server-only`.
- El formulario de Google incorpora el error inicial del callback a su propio estado, evitando dos avisos al reintentar. Mientras espera, desactiva el botón y los campos, muestra el texto de carga, marca `aria-busy` y oculta avisos anteriores.
- El callback respeta `sb_flow_id` cuando está presente: el SDK valida ese identificador sin recurrir al verificador de otro flujo. Los callbacks anteriores sin ese parámetro siguen siendo compatibles. No se activa ninguna opción experimental del proveedor.

## Prueba reproducible

Con las dependencias y Chromium de Playwright instalados:

```sh
pnpm test:auth:local
```

El comando copia únicamente rutas de código, documentación, pruebas y configuración de herramientas a un directorio temporal. No copia archivos `.env*`, `.git` ni builds previos. Inicia los procesos con una lista explícita de variables públicas de prueba y marcadores privados sintéticos; no hereda credenciales del proceso. Corrige las rutas absolutas de los lanzadores de pnpm únicamente en la copia y separa los builds de desarrollo y producción para evitar cargar dos runtimes de Next.js. Ejecuta lint, las pruebas de lógica/RLS, un build de producción con Turbopack, typecheck, la suite OAuth y las regresiones públicas/PWA con el botón de Google deshabilitado. Usa los puertos locales 3200, 54331 y 3100, y elimina la copia al terminar.

La suite OAuth utiliza el código real de Next.js y `@supabase/ssr`/`supabase-js` instalados. Un servidor HTTP local de pruebas sustituye únicamente los endpoints externos de Auth; no se añade ningún backend ficticio a la aplicación. El servidor comprueba el challenge S256 contra el verificador recibido y consume cada código una sola vez. La sesión y el usuario que devuelve son exclusivamente fixtures locales.

Cobertura en escritorio y móvil:

| Flujo                              | Comprobación                                                                                                                                                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inicio OAuth                       | Botones de acceso y registro independientes del formulario de contraseña; proveedor Google, callback canónico, challenge S256 y cookie del verificador.                                                                                 |
| Callback correcto                  | Intercambio con el verificador, cookies en la respuesta, cabeceras privadas, vuelta a Unirse, código prellenado, sesión tras recargar y cero llamadas automáticas a `join_home`.                                                        |
| Reutilización y entradas inválidas | Código repetido, verificador ausente, identificador de flujo inválido y callback incompleto.                                                                                                                                            |
| Invitaciones                       | `next` se conserva al iniciar, cancelar y fallar; destinos externos o codificados se rechazan; un `X-Forwarded-Host` falsificado no cambia el origen canónico.                                                                          |
| Disponibilidad                     | Proveedor desactivado, HTTP 503, ajustes malformados y timeout: error local y posibilidad de reintentar o entrar con correo.                                                                                                            |
| Estado de formulario               | Carga visible, botón desactivado, `aria-busy`, desaparición del error anterior y un único aviso al finalizar.                                                                                                                           |
| Privacidad                         | Los detalles de error del proveedor no aparecen en la página; marcadores de secretos administrativos, OAuth, email, push y jobs no aparecen en HTML, respuestas de acciones, cabeceras/payloads del navegador ni bundles de producción. |

Los tokens de sesión del usuario en cookies son parte del contrato SSR y del cliente Supabase del navegador. La prueba de secretos se refiere a credenciales de infraestructura y del proveedor; no afirma que una sesión de navegador carezca de sus propios tokens. Tampoco inspecciona ni certifica los valores reales que pueda tener una instalación en variables `NEXT_PUBLIC_*`.

## Resultado de la revisión

- Lint, typecheck, build de producción con Turbopack y formato de los archivos modificados: correctos.
- Pruebas de lógica y RLS en PostgreSQL embebido: **125 correctas**.
- OAuth con SDK real y endpoints HTTP locales: **24 correctas**, en escritorio y móvil. Incluye renovación de una sesión vencida a través del proxy y los Server Components protegidos, cookies nuevas, cabeceras privadas y una segunda petición sin otra renovación.
- Regresiones públicas y PWA: **16 correctas y 2 omitidas**. Las dos omisiones corresponden al botón Google deshabilitado en esa variante; los mismos errores de conexión están cubiertos con Google habilitado en la suite OAuth.
- El service worker permanece activo en las pruebas de navegador. La persistencia se comprueba en las cookies efectivamente guardadas y con una recarga; la renovación del proxy se prueba además con un cliente HTTP independiente para evitar carreras con precargas del navegador.

## Pendiente fuera de la revisión local

El acceso real sigue pendiente de desbloquear Google Cloud mediante la seguridad de la cuenta del usuario, crear el cliente OAuth web y configurar Client ID/Secret en el proveedor Google de Supabase. Deben verificarse los orígenes, la URL de retorno de Supabase registrada en Google y el callback de RoomieHub permitido en Supabase, siguiendo [setup](setup.md#activar-el-acceso-con-google).

Después hay que probar el consentimiento real, la creación/vinculación de la cuenta y su perfil, el intercambio de tokens real, la sesión persistente y el regreso desde una invitación sin unión automática. El servidor local de pruebas no acredita las reglas de Google, la configuración remota ni el RLS del servicio desplegado. Las pruebas SQL usan PostgreSQL embebido y no escriben en Supabase remoto.

Referencias consultadas: [Google con Supabase](https://supabase.com/docs/guides/auth/social-sign-in/auth-google) y [cliente SSR y cabeceras de sesión](https://supabase.com/docs/guides/auth/server-side/creating-a-client).
