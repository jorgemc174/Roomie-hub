# Validación de RoomieHub

## Fase 2 — 15 de septiembre de 2026

### Comprobado localmente

- `pnpm lint`: sin errores ni advertencias.
- `pnpm typecheck`: correcto, TypeScript estricto.
- `pnpm test`: **37/37** pruebas correctas. Incluye ambas suites PostgreSQL/RLS y lógica de redirección, monedas, auth, validadores y retrasos.
- `pnpm test:db`: ejecuta `database.test.ts` y `organization.test.ts`; ambas ejecutan las migraciones reales en PGlite.
- `pnpm build`: compilación de producción correcta, con la nueva ruta autenticada `/homes/[homeId]/organization`.
- `pnpm test:e2e`: **10/10** Chromium escritorio/móvil. Añadida protección anónima de Organización; se mantienen pruebas de auth, invitaciones, idioma/tema y overflow.

La suite nueva cubre: dificultades válidas/inválidas; cinco recurrencias y meses cortos/bisiestos; alineación semanal; rotaciones inválidas; reparto por peso (cargas 3/4/5), idempotencia y límite de ventana; manual A→B→C; ausencias/reasignación y vuelta a elegibilidad; ausencia total sin instancia huérfana; inactivos excluidos; snapshots históricos; completado por otro miembro; inicialización sin duplicados; deadline Europe/Madrid con DST; compra, desmarcado, lista completa y bajas lógicas; siete RLS, escrituras directas denegadas, IDs de otro piso, privilegios de helpers y publicación Realtime. `overdueDays` prueba días incompletos/completos, fecha futura, offsets y parada al completar.

### Comprobado contra Supabase remoto real

El usuario aplicó `202609150003_organization.sql` desde SQL Editor y confirmó `Success. No rows returned`. Se verificó posteriormente el esquema mediante RPC/REST; no se afirma acceso a `supabase_migrations.schema_migrations`, porque no hubo conexión SQL/MCP administrativa.

`node scripts/validate-organization-remote.mjs` terminó correctamente. Crea tres usuarios confirmados y dos pisos aislados exclusivamente para la prueba. Usa JWTs normales para todas las operaciones de negocio, y la clave administrativa solo para crear/eliminar fixtures y simular una baja. No envía correos ni altera el piso personal existente. La limpieza de sus propios usuarios y pisos terminó bien.

- Creación de piso JPY, unión, siete límites RLS y rechazo de operaciones con IDs ajenos.
- Evento INSERT de Realtime recibido por otra sesión autenticada.
- Tareas: generación e idempotencia, rotación A→B, reasignación por ausencia, completado por un compañero.
- Navegador A crea una tarea; B la ve y completa; A recibe el UPDATE y muestra Completada **sin recargar manualmente**.
- A crea lista y productos; B los ve, tacha un producto y completa toda la lista; A refleja ambos cambios sin recarga.
- Mi perfil contiene Mis pisos y Cerrar sesión; Cerrar sesión ya no aparece en la barra del workspace.
- Navegador desktop es/claro y móvil en/oscuro, sin overflow horizontal. Capturas de compra revisadas visualmente.
- Al convertir B en antiguo miembro de ese piso, pierde lectura de las siete tablas y la capacidad de escribir mediante RPC.

### Incidencias resueltas y límites

El primer lint señaló una lectura de `Date.now()` dentro del render del contador; se calculó el instante fuera del callback. Las pruebas reales descubrieron que un canal podía anunciar SUBSCRIBED antes de quedar lista su suscripción PostgreSQL: algunos eventos no llegaban al callback y otra pantalla permanecía pendiente. Se corrigió solicitando `postgres_changes_options.wait=true`; también se espera a la sesión SSR, se establece el JWT de Realtime y se usa un canal distinto por montaje para evitar interferencias de la limpieza asíncrona en Strict Mode. La ejecución completa posterior pasó. No se sustituyó la sincronización por un backend simulado ni por recargas manuales.

Quedan avisos no fatales del runner `NO_COLOR`/`FORCE_COLOR`. PGlite no emula el servicio Realtime ni prueba contención entre procesos. El script remoto sí usa Auth, REST y WebSockets reales, pero no es una prueba de carga, de cortes prolongados de red ni de todos los husos horarios. Los bloqueos transaccionales se revisaron; una prueba de estrés de concurrencia queda para endurecimiento previo a producción.

El empaquetado detectó que faltaba `.env.example` en el workspace; se restauró una plantilla con marcadores, sin credenciales. `scripts/package-project.ps1` comprueba archivos obligatorios y excluye .env.local, contraseñas, .git, dependencias, compilaciones y resultados de prueba. El ZIP contiene código, migraciones, documentación y lockfile; requiere instalar dependencias y configurar el entorno en otro equipo.

No hay scheduler instalado: generación bajo demanda/RPC, con formulario para recuperar ventanas anteriores. No hay desmarcado de tareas completadas, puntos, gastos ni Fase 3. Una ausencia que se solapa con cualquier día excluye durante el periodo completo; si no hay elegibles, se informa y se reintenta después de ajustar disponibilidad. Las horas se muestran en UTC, y los deadlines se calculan con la zona IANA elegida. No se han revalidado en esta fase entrega SMTP, Google OAuth ni limpieza de Storage.

### Reproducir integración remota

Servidor de desarrollo activo en `NEXT_PUBLIC_SITE_URL` y variables de `.env.local`. Ejecutar `pnpm test:remote` solo en desarrollo. La clave `SUPABASE_SECRET_KEY` o `SUPABASE_SERVICE_ROLE_KEY` se necesita en el script de fixtures, nunca en variables públicas ni dentro de la aplicación. No se registran contraseñas/tokens ni se guardan trazas de login. Para ejecutar solo API/Realtime sin navegador puede usarse `SKIP_REMOTE_UI=true`; esa variante no acredita la UI.

---

## Registro histórico de validación de la Fase 1

Los apartados siguientes describen lo comprobado en la revisión original, cuando todavía no había backend remoto disponible; el estado actual de Fase 2 está documentado arriba.

## Ejecutada en este entorno

- `pnpm build`: compilación de producción y generación de rutas.
- `pnpm typecheck`: TypeScript estricto.
- `pnpm lint`: configuración Next.js y TypeScript, sin errores ni advertencias.
- `pnpm test`: validadores de redirección, nombres y firmas de imagen; paridad de traducciones; migración completa y RLS en PostgreSQL embebido (PGlite).
- `pnpm test:e2e`: Chromium en escritorio y viewport móvil iPhone 13. Rutas públicas, registro/recuperación, conservación del código al pasar al registro, protección de ocho rutas privadas, cambio es/en y claro/oscuro con persistencia, ausencia de scroll horizontal. Capturas revisadas para login claro móvil y oscuro escritorio.

Las pruebas de SQL crean exclusivamente fixtures en una base efímera de test, nunca datos de la aplicación. Incluyen crear/unirse, múltiples pisos aislados, permisos iguales, denegación a terceros, regeneración de códigos, membresías inactivas, borrado solo por último miembro y políticas de objetos privados.

PGlite ejecuta PostgreSQL real, pero la suite instala un esquema mínimo que reproduce las interfaces `auth.uid()` y `storage.objects` necesarias: **no es una ejecución de los servicios Supabase Auth, Storage ni Realtime**. Tampoco comprueba carreras de procesos simultáneos; los bloqueos SQL se han revisado y deben probarse en una instancia real antes de producción.

Playwright utiliza una dirección local sin servicio Supabase y una clave explícita de test únicamente para renderizar las pantallas públicas y probar redirecciones anónimas. No intercepta ni simula respuestas de backend y no prueba acceso autenticado. No introduce estas variables en `.env.local`.

## Reproducir

```sh
pnpm install
pnpm exec playwright install chromium
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

La suite de navegador arranca y detiene su servidor de desarrollo en el puerto 3100. No ejecutar otro servidor Next de desarrollo del mismo proyecto en paralelo. Las capturas/trazas de test están en `test-results/` y no se versionan.

Se usa TypeScript 6.0.3 y ESLint 9.39.5 porque las dependencias de `eslint-config-next@16.3.5` aún no admiten TS 7 y ESLint 10 conjuntamente. Next.js, React y Tailwind usan versiones estables consultadas en el registro. Revisar compatibilidad de peers antes de actualizar; conservar pnpm-lock.yaml.

## Pendiente de un proyecto Supabase configurado

No se proporcionaron URL/clave ni proyecto remoto. No se afirma que estas comprobaciones estén ejecutadas:

1. Registrar dos cuentas A y B con correos que puedas abrir, confirmar ambas y verificar perfiles creados.
2. Iniciar sesión, recargar y abrir otra pestaña: sesión persistente. Recuperar contraseña desde correo, cambiarla y verificar login con la nueva.
3. A crea dos pisos; ambos aparecen en Mis pisos. Entrar a uno, volver a Mis pisos, entrar al otro.
4. B no ve ningún piso antes de unirse. Abrir URL del piso A directamente: no disponible. Consultar REST con el JWT de B: sin filas ajenas.
5. B se une por código al primer piso. El segundo sigue invisible. Repetir unión: no duplica membresía. Crear otro piso con B: A no lo ve.
6. B edita nombre, moneda e imagen del piso compartido. A ve el cambio; ambos tienen las mismas capacidades.
7. Regenerar invitación: código anterior rechazado; nuevo código funciona. Abrir enlace desde sesión anónima y completar login/unión. Repetir con registro que exige confirmar correo (también abrir el correo en otro navegador) y con Google: regresar a Unirse con el código prellenado sin reabrir la invitación. Confirmar que no se crea membresía hasta pulsar Unirse. Usar las plantillas actualizadas de setup.md.
8. Subir fotos JPEG/PNG/WebP al perfil y al piso. Rechazar formato no permitido y >5 MiB. Verificar RLS de Storage con un tercero ajeno.
9. B cambia preferencias/nombre/foto; refrescar y volver a iniciar sesión. Comprobar claro/oscuro y es/en en pantallas autenticadas, móvil y escritorio.
10. Intentar borrar el piso compartido desde RPC: rechazado. Crear piso individual y borrarlo: desaparece con su membresía/invitación.
11. Abrir dos sesiones y verificar cambios Realtime de nombre/miembros. Regenerar código en una sesión y recuperar foco en otra para refrescar.
12. Cerrar sesión y comprobar que /homes y el workspace vuelven al login. Desconectar red: aviso visible y ninguna escritura anunciada como guardada.
13. En una base de pruebas, ejecutar unión y borrado/regeneración simultáneos y comprobar que no existe un piso borrado con una unión confirmada ni se admite un código revocado.

Google requiere credenciales OAuth; SMTP externo, instalación PWA completa, push y limpieza programada de archivos huérfanos quedan documentados en setup/architecture.

## Corrección de fase 1: cobertura añadida

- Upgrade de una base poblada desde la migración inicial a `202609150002_currency_profile_privacy.sql`: conserva EUR y datos previos; acepta creación/edición internacional y rechaza códigos con formato incorrecto.
- Catálogo de las 30 monedas solicitadas, etiquetas es/en y preservación de una moneda válida fuera de la lista al editar. La validación de formato no es una certificación del registro ISO completo.
- RLS de perfiles y avatares: acceso propio, corte de acceso bilateral tras salir, cambio de nombre posterior no visible, mantenimiento del acceso si existe otro piso activo compartido y revocación al abandonar el último.
- Redirecciones: códigos independientes para distintas invitaciones, construcción de emailRedirectTo y callback OAuth, round-trip del destino sin cookies, recuperación, enlaces antiguos, fallos y ataques con URL externa/barras codificadas/caracteres de control.
- E2E: formularios login/registro conservan el código, rechazan next inseguro y los callbacks sin credenciales vuelven a login con el destino intacto. Variante `E2E_GOOGLE_ENABLED=true` comprueba el campo next del formulario Google; no inicia una sesión OAuth real.

Para ejecutar la variante Google en PowerShell: `$env:E2E_GOOGLE_ENABLED='true'; pnpm test:e2e; Remove-Item Env:E2E_GOOGLE_ENABLED`.

Estas pruebas locales no verifican entrega/renderizado real de las plantillas de Supabase, intercambio de tokens OAuth, sesiones autenticadas ni revocación real de URLs firmadas. En Supabase de pruebas, aplicar la segunda migración, comprobar JPY/CHF/MXN desde la UI y simular membresías inactivas desde SQL administrativo: no se ha añadido una función pública para abandonar pisos ni ningún módulo de fase 2.

### Resultado final de esta revisión

- `pnpm lint`, `pnpm typecheck`, `pnpm build` y `prettier --check .`: correctos.
- `pnpm test`: **22 pruebas correctas**, incluidas 12 comprobaciones SQL y su suite contenedora.
- `pnpm test:e2e`: **10/10** en escritorio y móvil con Google desactivado; **10/10** adicionales con `E2E_GOOGLE_ENABLED=true`. Esta segunda variante prueba la UI y continuidad del destino, no Google real.
- La especificación y la migración inicial conservan sus SHA-256 anteriores a la revisión. AGENTS solo incorpora las tres reglas relacionadas con este cambio.

Incidencias encontradas y resueltas: el primer arranque e2e chocó con el servidor de desarrollo anterior (se detuvo para las pruebas); dos aserciones por configuración detectaron que el callback usaba localhost en vez del origen configurado (corregido usando `NEXT_PUBLIC_SITE_URL`). También aparecieron cierres anticipados de streams al sustituir/cerrar documentos en las pruebas de desarrollo; se espera ahora a que terminen las respuestas y se limita la concurrencia a dos workers. Las dos ejecuciones finales completas terminaron sin esos errores. Solo permanecen avisos del runner sobre `NO_COLOR`/`FORCE_COLOR`, sin fallo de pruebas.
