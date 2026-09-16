# Fase 3 — Gastos

## Esquema y RPC

Migración **202609150005_expenses.sql**. Las migraciones 001–004 permanecen intactas.

| Tabla                       | Función                                                                        |
| --------------------------- | ------------------------------------------------------------------------------ |
| expenses                    | Gasto actual, pagador único, moneda, versión y baja lógica                     |
| expense_splits              | Participantes, snapshots de nombres, pesos e importes exactos                  |
| expense_events              | Revisión completa de gasto y reparto, autor y fecha; sin escrituras de cliente |
| settlements                 | Pagos registrados e idempotentes, con nombres históricos                       |
| recurring_expenses          | Plantillas, frecuencia, ancla, cursor y activación                             |
| recurring_expense_instances | Periodos pendientes/contabilizados, snapshot de plantilla y vínculo a gasto    |
| shopping_list_expense_links | Relación única lista–gasto                                                     |
| expense_attachments         | Metadatos de tickets privados                                                  |

RPC de usuario: `save_expense`, `delete_expense`, `expense_balances`, `record_settlement`, `save_recurring_expense`, `generate_recurring_expenses`, `confirm_recurring_expense`, `attach_expense_receipt`, `leave_home`, `my_departed_balance`. Helpers puros: `money_split`, `currency_scale`, `expense_occurrence`. Helpers internos de saldo, auditoría, reconciliación y triggers no son ejecutables por clientes. Las escrituras usan el bloqueo existente de la fila del piso.

## Dinero y reparto

PostgreSQL **bigint en unidades menores**. Límite por gasto/pago: 1.000.000.000.000 unidades menores. Cada fila está dentro del rango entero seguro de JavaScript; la aritmética del frontend usa BigInt. Las sumas SQL usan numeric exacto y los saldos viajan como texto, sin truncar valores acumulados grandes. Nunca se calcula dinero con float/double. El formato usa Intl.NumberFormat con cadena decimal exacta.

La escala está definida explícitamente en SQL y TypeScript: JPY/KRW/CLP y otras monedas sin decimales, BHD/KWD y otras con tres, CLF/UYW con cuatro, dos para el resto. El código de moneda sigue validando formato; un código desconocido usa dos decimales. La lista se mantiene en `currency_scale`/`money.ts`. No existe conversión. Cambiar moneda queda bloqueado desde el primer gasto, pago o plantilla, incluso con saldo cero o gastos eliminados: el historial no puede reinterpretarse.

- Igual: todos tienen peso 1. Dividir en entero y distribuir unidades restantes.
- Personalizado: pesos son cantidades en unidades menores; deben sumar exactamente el total.
- Porcentaje: centésimas de porcentaje (100 % = 10000). Suma exacta 10000.
- Residuos: mayores restos primero; empate por UUID ascendente. Determinista e independiente del orden de selección. 10,00/3 → 3,34/3,33/3,33.
- Constraint diferido comprueba la suma de los splits al terminar la transacción, incluso si una futura función se equivoca.

Un pagador por gasto, participe o no. El cálculo separa aportación del pagador y consumo de participantes; una futura tabla de aportaciones múltiples puede sustituir la primera sin cambiar el modelo de splits.

## Saldos y pagos sugeridos

Saldo = gastos pagados − participaciones + pagos enviados − pagos recibidos. Se excluyen gastos con baja lógica. No hay un saldo mutable almacenado como fuente de verdad. La suma de saldos es cero.

Las sugerencias son una vista calculada: ordenar acreedores/deudores por importe descendente y UUID; emparejar y consumir el menor importe de cada par. Como máximo N−1 transferencias entre N saldos no nulos. Es determinista y razonablemente compacto, sin prometer el mínimo combinatorio global. No se guardan como deudas independientes. Registrar un pago es una acción explícita.

## Edición, borrado y concurrencia

Crear gasto y splits, editar ambos, borrar, convertir compra, generar/confirmar recurrentes y comprobar salida son transacciones SQL. Todos los activos tienen los mismos permisos.

UUID estable por envío evita duplicados. Un reintento del alta con otro contenido devuelve conflicto. Ediciones y borrado comprueban la versión leída; no sobrescriben silenciosamente cambios de otro compañero. El formulario conserva esa versión aunque Realtime actualice la página; ante conflicto hay que recargar. Después de crear, el enlace Crear gasto abre una nueva solicitud.

Editar registra una nueva revisión con reparto completo. Eliminar aplica baja lógica y registra otra revisión; splits, tickets y revisiones permanecen. Una lista convertida o periodo recurrente contabilizado no se vuelve a emitir por eliminar su gasto. Los pagos se conservan sin edición/borrado en esta fase; una corrección puede registrarse como transferencia inversa, respetando los límites de exmiembros.

## Recurrentes y fechas

Frecuencias semanal, mensual y cada X meses (1–120). Fecha inicial + índice evita deriva en meses cortos: 31 enero → 28/29 febrero → 31 marzo. Se usa `home_local_date` y la zona IANA del piso, tanto al generar como para fechas iniciales del formulario.

Abrir Gastos o pulsar Revisar periodos pendientes procesa únicamente fechas ya vencidas, hasta 120 periodos por llamada. Si hay más, se muestra un aviso y se puede continuar. No se pregeneran gastos futuros. No hay cron instalado; las RPC permiten un futuro worker con autorización propia y reintentos. Sin visita/invocación no se materializan periodos automáticamente.

- Fijo: se contabiliza el importe de la plantilla si pagador/participantes siguen activos.
- Variable: pendiente sin importe inventado; no afecta al saldo hasta confirmación explícita.
- Si hay miembros inactivos: el fijo queda pendiente de revisión, sin asignarles nuevo gasto. La confirmación exige miembros activos.
- Plantilla variable: igual o porcentajes; cantidades personalizadas disponibles al confirmar el importe conocido.
- Editar/desactivar plantilla afecta a periodos no emitidos. Los pendientes ya emitidos conservan su snapshot; los contabilizados son gastos históricos. Reiniciar calendario exige ancla posterior a los periodos ya emitidos.
- Un índice único por plantilla/fecha y el bloqueo del piso evitan duplicados. Confirmar dos veces retorna el mismo gasto.

## Compra → gasto

Una lista completada ofrece Crear gasto. Prellena concepto, categoría inferida, fecha local, pagador actual y activos. El usuario introduce importe y reparto. SQL vuelve a comprobar completado y vínculo único dentro del bloqueo del piso. Dos conversiones simultáneas solo producen un gasto. No modifica productos. Una lista ya vinculada no puede convertirse otra vez aunque su gasto se elimine.

## Membresías y salida

`leave_home` calcula el saldo bajo el mismo bloqueo que gastos/pagos. Cualquier saldo no cero, tanto deuda como crédito, bloquea la salida e informa del importe. A cero marca la membresía inactiva, conserva el historial y reconcilia tareas pendientes actuales; 004 invalida futuras automáticas. El borrado de un piso también rechaza saldos individuales no cero para evitar un atajo.

Antiguos miembros no se añaden a gastos nuevos. Una edición histórica puede conservar participantes/pagador antiguos que ya estaban en ese gasto, con su snapshot previo; nunca añadir otro antiguo. Esa corrección puede reabrir su saldo. Un activo puede registrar la liquidación necesaria; respecto al exmiembro, solo se permite reducir deuda/crédito hacia cero, sin sobrepago. El exmiembro no recupera acceso a tablas, perfiles ni tickets. `my_departed_balance` solo devuelve su propio saldo y moneda, comprobando su membresía histórica; no devuelve movimientos ni perfiles ajenos.

## Adjuntos, seguridad y Realtime

Bucket privado `expense-receipts`, máximo 10 MiB, JPEG/PNG/WebP/PDF. Server Action valida MIME, tamaño y firma; el bucket restringe tamaño/MIME y las políticas ruta/extensión/piso. Objetos con UUID sin upsert. Acceso mediante ruta autenticada y URL firmada de descarga de 60 segundos. La URL emitida puede seguir válida durante esos 60 segundos tras salir.

El gasto se guarda antes de subir el ticket: PostgreSQL y Storage no comparten transacción. Si falla la subida o vinculación, se informa explícitamente de que el gasto existe y el ticket falló; puede reintentarse desde Editar. Se intenta borrar el objeto recién subido si no pudo vincularse. Se requiere futura limpieza programada de huérfanos y análisis antimalware antes de producción; no hay OCR.

Las ocho tablas tienen RLS para activos y no conceden escrituras directas. FK compuestas impiden referencias entre pisos; validaciones de RPC cubren también JSON de plantillas. Sin service-role en aplicación: solo scripts de fixtures.

Realtime añade INSERT/UPDATE de gastos, pagos, plantillas e instancias, siempre por home_id, reutilizando gestión de sesión, espera de suscripción y limpieza existente. Splits/revisiones se consultan tras el evento del padre, ya comprometida la transacción. Bajas lógicas emiten UPDATE. Inicio muestra solo el saldo resumido; no se añadieron estadísticas, calendario, puntos ni Fase 4.

## Validación y puesta en marcha

Consulte [validation.md](validation.md) para resultados comprobados y límites remotos, y [setup.md](setup.md) para aplicar únicamente migraciones pendientes. `scripts/validate-expenses-remote.mjs` incluye cuentas aisladas, flujo monetario, concurrencia, RLS, Storage y dos navegadores; limpia solo sus propios fixtures. Una prueba preparada no equivale a una prueba ejecutada.
