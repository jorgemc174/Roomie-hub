# Fase 5 — Hardening de salida y retrasos

## Migración y alcance

`202609150009_departure_overdue.sql`, aditiva y transaccional después de 008. Únicamente reemplaza `public.leave_home(uuid)` y reafirma su ACL; no añade tablas, parámetros, acceso público a helpers ni cambios de frontend. 001–008 y product-requirements.md se conservan byte a byte. No se inicia Fase 6.

## Orden transaccional

1. `organization_lock(target)` bloquea el piso y comprueba membresía activa/auth.uid().
2. Se conserva la comprobación de saldo financiero exactamente cero; un saldo pendiente aborta antes de emitir nada.
3. Se fija `departure_at := now()` una sola vez. Es el instante lógico de la transacción PostgreSQL, igual que el usado por los hooks existentes de asignación/calendario; no es la hora de commit ni se recalcula por lote. Ese mismo valor se guarda en `left_at`.
4. Se llama a `community_private.issue_overdue(target, departure_at)` mientras la persona sigue activa. Se repite mientras `more=true`, con cursor persistente dentro de la transacción. Si el helper indicara más trabajo sin progreso, se aborta en vez de entrar en un bucle infinito.
5. Se reconcilian positivos, negativos y castigos de todos los miembros activos, incluido quien sale, mediante `reconcile_person`. El helper compartido recorre el piso completo: por eso también se reconcilian los demás miembros, evitando materializar negativos ajenos sin sus conversiones/castigos.
6. Solo entonces se cambia active=false/left_at y se ejecuta el `reconcile_departure_chores` existente. Se conservan los triggers de invalidación futura y salida de reservas/actividades.

El cutoff congelado incluye la frontera que cae exactamente en él; no emite la siguiente frontera. Completed_at sigue limitando tareas completadas. Días bloqueados, instancias canceladas, personas inactivas y fronteras anteriores a la ventana de elegibilidad siguen las reglas de 008. La reasignación al salir ocurre después de guardar los negativos correspondientes al responsable anterior.

## Backlog, idempotencia y atomicidad

Se mantiene el límite interno de 500 decisiones por llamada al helper, sin límite de lotes en la salida. Se probaron 1.003 días pendientes (tres lotes). No se llama a la RPC pública que usa su propio ahora por cada lote; el helper recibe siempre el mismo departure_at.

Los cursores por instancia, decisiones únicas instancia/día y constraint de valoración `(source_id, overdue_day)` evitan duplicados. Los castigos mantienen su clave única piso/persona/umbral. El bloqueo del piso serializa salida y reconciliación concurrentes. Repetir leave_home una vez inactivo devuelve unauthorized, sin efectos; reconciliar posteriormente conserva el historial.

La operación es una sola transacción: si el último paso falla, se revierten membresía, cursores, negativos, conversiones y castigos. No se confirma una salida parcial. Un backlog extraordinario puede prolongar la transacción y alcanzar límites de timeout del servidor; en ese caso se aborta íntegramente y el usuario permanece activo. No se introduce un job ni un permiso para saltarse el procesamiento.

## Salida y reentrada

Después de salir no se añaden negativos al exmiembro. Los ya emitidos y los castigos quedan históricos. La 008 permanece intacta: reentrar registra penalty_active_since; no se rellena el intervalo fuera del piso, aunque no hubiera reconciliación durante ese intervalo. Solo son elegibles fronteras desde esa nueva ventana. Una tarea correctamente reasignada puede generar negativos futuros para su nuevo responsable; no para quien salió.

Esta corrección protege salidas a partir de su aplicación. No reescribe decisiones históricas ya clasificadas inactive antes de 009 ni inventa ventanas pasadas de membresía.

## Pruebas nuevas

`tests/community-departure.test.ts`: ocho casos más la suite contenedora.

- A: cuatro días sin reconciliación se materializan al salir; RLS del exmiembro y diez reconciliaciones posteriores sin cambios.
- B: tres días adicionales con cutoff de fixture no añaden negativos al exmiembro; se registran tres decisiones inactive.
- C: cinco días materializan un único castigo leve de umbral 5, persistente tras salir.
- D: 1.003 decisiones, 1.003 negativos únicos y 200 umbrales; frontera final exactamente igual al cutoff y left_at, sin duplicados posteriores.
- E: salir/reentrar sin job durante el intervalo fuera; tres fronteras omitidas, primera frontera posterior elegible y repeticiones idempotentes.
- Saldo financiero pendiente y usuario externo: salida denegada, sin efectos parciales; helpers siguen privados.
- Fallo inducido después de procesar backlog: rollback completo, reintento posterior correcto.
- Reasignación existente al otro miembro después de liquidar la responsabilidad anterior.

B/E simulan tiempo únicamente en fixtures SQL con privilegios del test y llaman al helper privado; no se añade ninguna RPC para manipular tiempo desde la aplicación.

## Validación local y remota

- `npm run lint`, `npm run typecheck`: correctos.
- `npm test`: 99/99; `npm run test:db`: 87/87, incluyendo regresión completa previa.
- `npm run build`: correcto. `npm run test:e2e`: 10/10 escritorio/móvil. Avisos NO_COLOR/FORCE_COLOR del runner, sin fallos finales. Resultados en [validation.md](validation.md).
- Supabase real: usuario confirmó 009 en SQL Editor. `npm run test:departure:remote` creó dos cuentas autenticadas y tres pisos de fixture. Los casos 4/5/1.003 produjeron exactamente esos negativos y 0/1/200 castigos antes de desactivar, sin reconciliación previa. Dos peticiones simultáneas posteriores no duplicaron; salida repetida denegada, RLS revocada y reentrada con epoch nueva comprobadas.
- La clave administrativa se usa solo para preparar fechas/filas controladas de prueba y limpiar. leave_home/reconcile/join se ejecutan con JWT de los usuarios. Se eliminaron exclusivamente esas dos cuentas y tres pisos.
- No se simularon tres días reales de espera en remoto ni se añadieron RPCs de reloj: ese caso temporal está probado localmente. No se consultó el registro administrativo de migraciones.

Incidencia durante el desarrollo: el primer fixture financiero usaba claves JSON incorrectas y recibió invalid_amount antes de ejecutar la salida. Se corrigió el fixture al contrato existente; no cambió la lógica financiera. No quedan fallos conocidos en la regresión de este endurecimiento.
