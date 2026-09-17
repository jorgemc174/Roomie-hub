# Validación de RoomieHub

## Hardening de Fase 5 — Salida con retrasos pendientes (009)

Resultados del 16 de septiembre de 2026. Se añadió únicamente la migración `202609150009_departure_overdue.sql`, reemplazando leave_home. 001–008 y product-requirements.md comparados por SHA256 con el inicio de esta revisión: idénticos. El usuario confirmó 009 en SQL Editor.

| Comando                         | Resultado                                                      |
| ------------------------------- | -------------------------------------------------------------- |
| `npm run lint`                  | Correcto, sin errores ni advertencias                          |
| `npm run typecheck`             | Correcto                                                       |
| `npm test`                      | 99/99                                                          |
| `npm run test:db`               | 87/87                                                          |
| `npm run test:e2e`              | 10/10, escritorio y móvil                                      |
| `npm run build`                 | Producción correcta                                            |
| `npm run test:departure:remote` | Correcto con dos usuarios autenticados y tres pisos temporales |

Ocho casos nuevos y suite contenedora: A–E (cuatro días devengados, tres días adicionales fuera, castigo de cinco, backlog de 1.003 y reentrada sin rellenar hueco), deuda/externo/RLS, fallo tardío con rollback completo y reasignación existente. El caso de 1.003 incluye una frontera exactamente igual a now()/left_at y verifica 1.003 claves distintas más 200 castigos. Toda la regresión anterior se conserva.

En Supabase real, sin reconciliación previa, salir materializó 4/5/1.003 negativos y 0/1/200 castigos. Dos reconciliaciones concurrentes posteriores no duplicaron, salir de nuevo fue rechazado, RLS impidió lectura del exmiembro y reentrada abrió penalty_active_since sin duplicar historial. Se eliminaron las dos cuentas y tres pisos de fixture. El avance de tres días y la frontera posterior a reentrada se simularon en SQL local con fechas controladas; no se esperaron días ni se expuso un reloj administrativo por RPC remota.

Incidencia corregida: fixture financiero inicial con claves JSON incorrectas produjo invalid_amount; corregido el fixture al contrato existente. E2E solo emitió avisos NO_COLOR/FORCE_COLOR; ninguna prueba fallida en las ejecuciones finales. La transacción de salida puede tardar con backlogs enormes; si alcanza timeout, todo revierte y el usuario continúa activo, sin pérdida ni salida parcial.

[Entrega de este endurecimiento](phase-5-hardening.md). Sin Fase 6.

## Fase 5 — Convivencia (007 y 008)

Resultados del 16 de septiembre de 2026. Ambas migraciones confirmadas por el usuario en SQL Editor y comprobadas con comportamiento remoto. No se leyó el registro administrativo de migraciones.

| Comando                         | Resultado                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm run lint`                  | Correcto, sin errores ni advertencias                                                            |
| `npm run typecheck`             | Correcto                                                                                         |
| `npm test`                      | 90/90, regresiones anteriores incluidas                                                          |
| `npm run test:db`               | 78/78, PostgreSQL embebido PGlite                                                                |
| `npm run build`                 | Producción correcta, incluidas las rutas de Convivencia/Actividades/foto                         |
| `npm run test:e2e`              | 10/10, Chromium escritorio/móvil, 16 rutas privadas protegidas                                   |
| `npm run test:community:remote` | Flujos autenticados/API/Storage/Realtime/concurrencia correctos; limitación CDN explícita debajo |
| `npm run test:calendar:remote`  | Regresión remota completa de Fase 4 correcta                                                     |

### Cobertura añadida

19 pruebas adicionales contando suites: motivos/semillas/contexto/auto-valoración; edición/cambio de signo/baja/versiones; conversiones 3/0, 3/1, 6/3, 8/4, correcciones de positivos consumidos y criterio del negativo más antiguo; concurrencia encolada e idempotencia; umbrales 5/10/15/20, descenso/recuperación y completado sin gastar negativos; RLS de las cuatro tablas públicas, esquema privado/API/RPC/joins/publicación y exmiembros; fotos/metadata/propietario/ruta/EXIF/MIME/tamaño; retraso 24 h, DST, completado, diez repeticiones, asignación/bloqueo/cancelación; reentrada sin penalizaciones del periodo fuera; continuación de más de 500 días y múltiples umbrales; ranking y traducciones. Upgrade de 006 poblada con instancias completadas/bloqueadas conserva filas y evita inventar el bloqueo pasado.

Regresiones locales conservadas: auth/safeNext, pisos/invitaciones/perfiles, tareas/ausencias/compra, gastos/reparto/pagos/liquidaciones/recurrentes, reservas/actividades/calendario/timezones. PGlite usa interfaces de Auth/Storage de prueba; no acredita los servicios ni contención multisesión. La suite E2E pública usa transporte Supabase no disponible y no inventa sesiones/datos.

### Verificación remota

Cuatro cuentas temporales (Ana/Jorge/Pablo y externo), un piso compartido por tres. La UI crea valoración anónima con foto; destinatario la recibe por Realtime sin identidad. API, RPC, JOIN, esquema privado y payload Realtime no revelan autor. Bytes reales sin EXIF y metadata/owner/ruta sin identidad. Conversión al tercer positivo; dos positivos simultáneos con JWT distintos dejan exactamente una conversión adicional y un positivo disponible. Cuatro negativos por atraso tras diez llamadas; completar congela número. Dos reconciliaciones concurrentes producen un único castigo de cinco; UI define/completa y consulta ranking. Inglés/oscuro, móvil 360 px sin scroll horizontal. Salida deniega datos y foto nueva; reentrada registra penalty_active_since y no emite negativos del intervalo anterior. Se preservan los cuatro negativos históricos completados. Fixtures eliminados al terminar cada ejecución.

Regresión calendario remota: carreras de reservas (solo una gana), adyacencia/recursos diferentes, cancelación y edición, RLS/outsider/exmiembro, DST/timezone/versiones, creación/edición/cancelación desde UI, actividades entre dos navegadores, cuatro fuentes y filtros sin generar trabajo, es/en/tema oscuro móvil. Se revisaron capturas de ranking claro y puntos oscuros móvil.

### Incidencias y límites, sin ocultar fallos

- Primer E2E autenticado esperaba un estado de formulario que desaparece al mover un castigo a Completados: se corrigió la aserción para comprobar el resultado persistido y la sección final.
- **La prueba de revocación absoluta del URL de Storage ya descargado falló.** Se confirmó RLS=false, metadata denegada y descarga con nonce nuevo denegada; el CDN aún respondía 200 al URL previamente usado, incluso con no-store. La app ahora verifica membresía por petición, usa nonce nuevo y devuelve 404 al exmiembro. La prueba mantiene el diagnóstico `LIMITATION` para la copia cacheada y verifica ambas denegaciones reales. No se afirma revocación inmediata de copias ya entregadas. [Supabase CDN](https://supabase.com/docs/guides/storage/cdn/smart-cdn).
- La prueba nueva de upgrade detectó que su fixture intentaba modificar una instancia completada; la DB lo rechazó correctamente. Se corrigió la preparación insertando periodos distintos inicialmente, sin tocar la protección de historial.
- Runner de navegador: avisos NO_COLOR/FORCE_COLOR, sin pruebas fallidas. Build/lint/typecheck correctos. No se realizaron pruebas de carga ni despliegue de producción.
- 001–006 comparadas byte a byte con el ZIP de Fase 4, sin cambios. Product requirements conserva SHA256 `A54CD3E93EEFD40DC6FB94FC484FEF6F8E54DEF7120A32A5508DA71ED5C4B862`. 007 conserva SHA256 `43C55D7A6912ABE3FB5FA439879F22EE32926AF2BEF0CDC815897CBC62F09A08` desde su aplicación; 008 `445B6A6665D4D154CE6DA9AE587E1651CC4C9AE921F6D81BDE655021C3E585A4`.

Más semántica, pasos manuales y límites en [phase-5-delivery.md](phase-5-delivery.md). Los resultados inferiores son históricos de fases anteriores; sus pendientes no sustituyen esta validación actual.

## Fase 4 — Recursos, reservas, actividades y calendario (006)

Resultados del 16 de septiembre de 2026, con las seis migraciones:

| Comando                        | Resultado                                                            |
| ------------------------------ | -------------------------------------------------------------------- |
| `npm run lint`                 | Correcto, sin errores ni advertencias                                |
| `npm run typecheck`            | Correcto                                                             |
| `npm test`                     | 71/71, incluidas regresiones de todas las fases anteriores           |
| `npm run test:db`              | 61/61, PostgreSQL embebido PGlite                                    |
| `npm run build`                | Producción correcta; nuevas rutas calendario, actividades y reservas |
| `npm run test:e2e`             | 10/10 Chromium escritorio/móvil, incluidas nuevas rutas protegidas   |
| `npm run test:calendar:remote` | Integración autenticada contra Supabase real, API y dos navegadores  |

### Cobertura local

11 pruebas nuevas (incluida suite contenedora): cinco formas de solapamiento; límites [inicio,fin), otro recurso y constraint probado con INSERT SQL sin RPC; edición atómica/versiones, cancelación/reutilización de hueco; recursos configurables/semillas/desactivación; creador apuntado, participantes únicos/idempotentes, conservación al editar/cancelar; cuatro RLS, anónimo, cross-home, escrituras directas denegadas y exmiembros; snapshots al salir; DST inexistente/repetido, Madrid/Canarias/UTC/Tokio y medianoche; cambio de timezone preservando instante/formulario obsoleto; normalización de cuatro fuentes, pendientes, filtros, fecha lógica y final a medianoche.

PGlite procesa las dos peticiones enviadas juntas de forma serial. Esa prueba local **no** se presenta como contención multisesión. Las migraciones 001–005 son idénticas a las del ZIP entregado de Fase 3; product-requirements.md conserva SHA256 A54CD3E93EEFD40DC6FB94FC484FEF6F8E54DEF7120A32A5508DA71ED5C4B862.

### Supabase real

El usuario confirmó 006 en SQL Editor. La clave de fixtures ya funciona y 005 está disponible, a diferencia del diagnóstico histórico inferior. No se accedió al registro administrativo de migraciones; se verificaron tablas/RPC y comportamiento con datos reales de prueba.

El script crea tres cuentas confirmadas y un piso temporal; API de negocio con JWT de usuario, clave administrativa solo para fixtures. Comprobado:

- Dos solicitudes HTTP concurrentes de usuarios distintos sobre el mismo recurso/horario: exactamente una aceptada y una rechazada; una fila persistida.
- Horarios consecutivos y recursos distintos permitidos, edición conflictiva rechazada, cancelación libera hueco.
- Cuatro tablas invisibles para externo, escrituras directas/RPC ajenas rechazadas; antiguo sin acceso.
- Cambiar Madrid→Tokio conserva timestamps; formulario con zona antigua rechazado; hueco DST rechazado y hora repetida con interpretación estándar.
- Navegador crea Lavadora UI, reserva mañana, edita y cancela.
- A crea Cena italiana; B la recibe y se apunta; A ve a B sin recargar manualmente.
- Calendario incluye tarea con deadline, reserva, actividad y siguiente recurrente; filtros por tipo y Solo lo mío. Visitarlo no aumenta instancias de tareas ni contabiliza recurrentes.
- Escritorio y móvil 360px sin overflow; cambio de preferencias real a inglés/oscuro. Capturas revisadas visualmente en ambos temas.
- Limpieza de todos los usuarios/pisos creados por cada ejecución; no se modificó el piso personal del usuario.

No es prueba de carga masiva, recuperación de red prolongada, todos los husos IANA ni SMTP/OAuth. Las comprobaciones financieras remotas completas de Fase 3 no se vuelven a acreditar por el hecho de probar la lectura de un recurrente en esta fase.

### Incidencias y correcciones

- Windows bloquea pnpm mediante Control de aplicaciones. Mismos scripts ejecutados mediante npm/Node con dependencias existentes; sin cambiar lockfile.
- Lint detectó Date.now en render; se toma el instante de la petición sin esa llamada. Typecheck detectó inferencia demasiado estrecha de UUID en helpers de pruebas; tipos explícitos string. Ejecuciones finales correctas.
- Una aserción SQL comparaba texto UTC con la zona local del proceso; fixtures fijan UTC y las pruebas de zonas usan conversiones explícitas.
- Primera ejecución E2E: 9/10, timeout de 30 segundos compilando múltiples rutas frías. Se amplió a 60 segundos únicamente la prueba que visita quince rutas; ejecución final 10/10.
- Primer remoto: Playwright rechazó datetime-local con segundos cero redundantes; se usan valores normalizados HH:mm. Ejecución posterior completa correcta.
- Next dev registró un cierre anticipado de stream al navegar durante un refresh del runner remoto. Se espera networkidle antes/después de navegación, recarga y cierre de contextos, pero el mensaje sigue apareciendo de forma intermitente en Next dev al interrumpirse un refresh. Las nueve comprobaciones remotas terminan correctamente; no se acredita que ese mensaje de desarrollo esté resuelto ni se ha repetido la integración con next start. No se ocultaron errores de servidor ni se simuló la respuesta.
- Persisten avisos no fatales NO_COLOR/FORCE_COLOR del runner público.

No quedan migraciones pendientes en el proyecto remoto de desarrollo para esta fase. En otra instalación deben aplicarse 001–006. Semántica y límites: [phase-4-delivery.md](phase-4-delivery.md).

## Fase 3 — Gastos (005)

- PostgreSQL/PGlite: 12 pruebas nuevas de dinero, SQL, seguridad y firmas de tickets; 50/50 en `pnpm test:db` con todas las migraciones.
- `pnpm build`: producción correcta, incluye Gastos y descarga autenticada de tickets.
- `pnpm test:e2e`: 10/10 Chromium escritorio/móvil. Se amplió la protección anónima a Gastos y tickets. No sustituye la prueba autenticada de gastos.
- `pnpm lint`: sin errores ni advertencias; `pnpm typecheck`: correcto; `pnpm test`: 60/60.

Cobertura: decimales sin float, límite de importes, escalas 0/2/3/4, igual con residuo, custom y porcentaje, paridad SQL/TypeScript y mayores restos; saldos con pagador incluido/excluido, pagos y reintentos, sugerencias deterministas; edición atómica y versión obsoleta, baja lógica y auditoría; antiguos conservados, alta de antiguo rechazada, salida bloqueada con deuda o crédito y salida a cero; recurrentes fijos/variables, confirmación repetida, snapshots y desactivación, mensual bisiesto/sin deriva, fecha local entre UTC+14 y UTC−12, no generación futura; conversión de compra única; ocho RLS, helpers privados, RPC cross-home, Storage y acceso anónimo; firmas/tamaño/MIME del adjunto. La salida reconcilia la tarea actual sin romper la política de 004.

Incidencias resueltas durante desarrollo: el trigger diferido inicial referenciaba campos de otra tabla dentro de CASE; se corrigió con ramas PL/pgSQL. La incorporación de un import desplazó la directiva use server; lint/build lo detectaron y se restauró al inicio. Las ejecuciones posteriores pasan. E2E emite avisos no fatales NO_COLOR/FORCE_COLOR.

### Supabase real

Se intentó `node scripts/validate-expenses-remote.mjs`: se detuvo antes de crear fixtures porque PostgREST todavía no encuentra expense_balances (PGRST202), por lo que falta aplicar 005. Comprobación independiente de clave administrativa: HTTP 401, Unregistered API key. No hay herramienta SQL/MCP disponible. Se solicitó ejecutar la migración completa y actualizar la clave local; no se afirma aplicación remota ni pruebas autenticadas de esta fase hasta comprobarlo.

El script preparado prueba tres cuentas, gasto 30 EUR y pago 15 EUR, custom/porcentajes/residuos, ediciones y envíos concurrentes, conversión de compra concurrente, recurrentes/confirmación concurrente, ocho tablas RLS, tickets privados, salida con deuda y tras saldar, creación en escritorio y recepción por Realtime en otro navegador móvil. PGlite no prueba contención real ni servicios Supabase; estas comprobaciones siguen pendientes mientras falte el entorno remoto.

## Endurecimiento de Fase 2 (004)

- `pnpm lint` y `pnpm typecheck`: correctos.
- `pnpm test`: 48/48; `pnpm test:db`: 38/38. Incluyen 11 pruebas nuevas: Compra/Ausencias sin generación, horizonte corto, desactivación, recurrencia, rotación/no-op, dificultad/modo/ancla/deadline, completadas inmutables, nuevo miembro, idempotencia, zonas y medianoche/DST, RLS y actualización de 003 poblada conservando eventos.
- `pnpm build`: correcto.
- `pnpm test:e2e`: 10/10 en Chromium escritorio/móvil; auth, invitaciones, protección de Organización, idioma/tema y overflow. Avisos no fatales NO_COLOR/FORCE_COLOR. Estas pruebas públicas no acreditan flujos autenticados de Organización.

Supabase real: el usuario confirmó la aplicación completa de 004 en SQL Editor. Las RPC ensure_current_chores y home_local_date existen y rechazan acceso anónimo con 42501. No se ha consultado el registro administrativo de migraciones.

`pnpm test:remote` se intentó y falló antes de crear fixtures. Diagnóstico adicional: Auth responde, pero la clave administrativa local devuelve HTTP 401, «Unregistered API key». Por ello no se acredita integración autenticada ni Realtime de 004 contra Supabase real. El script extendido está incluido para repetirlo con una clave administrativa de desarrollo válida; nunca ponerla en variables públicas. Las comprobaciones remotas de la sección histórica inferior corresponden a 003, no a esta revisión.

001–003 y product-requirements.md conservan sus hashes. Ver [semántica de entrega](phase-2-hardening.md).

## Registro previo: Fase 2 — 15 de septiembre de 2026

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
