# Endurecimiento de Fase 2

## 1. Migración

`202609150004_task_lifecycle_timezone.sql`, aditiva. No cambia 001, 002, 003 ni la especificación del producto. Al aplicar, cancela futuras pendientes pregeneradas y conserva filas y eventos.

## 2. Semántica de instancias

- Completadas: inmutables, incluso si tienen fecha futura.
- Históricas pendientes y periodo actual: conservan sus snapshots y trabajo pendiente. La reconciliación de ausencias continúa operando sobre pendientes cuyo periodo no ha terminado.
- Futuras pendientes: inicio posterior al día local actual. Se cancelan con fecha y motivo; mantienen ID, snapshots y eventos y aparecen en la vista Canceladas. No cuentan como carga ni admiten completado.
- Regenerar crea otro ID para el periodo cancelado. Un índice único parcial impide duplicar periodos vivos; tampoco se permiten solapamientos con instancias actuales/completadas. Un cambio de recurrencia puede esperar al próximo periodo completo no solapado.

## 3. Horizonte

Solo Tareas llama a `ensure_current_chores`: genera periodos que contienen hoy y mañana locales. Compra y Ausencias no generan. Consultar fechas lejanas no amplía el horizonte. La ventana de lectura de 30 días no implica generación.

El formulario manual conserva ventanas explícitas de hasta 366 días de diferencia para recuperación/debug. No hay cron instalado; las RPC son idempotentes y reutilizables, pero un futuro worker necesitará cursor, reintentos y autorización adecuada.

## 4. Desactivar o editar

Desactivar impide nuevas emisiones y cancela futuras pendientes. Conserva el trabajo actual y las completadas. Cambiar recurrencia, modo, dificultad, ancla, deadline, nombre/descripción o rotación invalida futuras pendientes. Guardar valores idénticos no las cancela. Los triggers y RPC usan bloqueo del piso; los registros cerrados tienen protección contra modificaciones.

## 5. Zona horaria

`homes.timezone` valida nombres IANA. Nuevos pisos: Europe/Madrid; existentes: UTC para preservar el calendario anterior. Todos los miembros pueden cambiarla en Ajustes. SQL determina el día lógico; frontend usa Intl para fechas y presentación.

Al cambiar zona se conservan los periodos iniciados según cualquiera de las dos fechas locales y se cancelan los posteriores a ambas. Los deadlines siguen siendo timestamptz: no se reinterpretan instantes existentes ni se cambia la zona explícita de cada definición. Las tareas nuevas toman inicialmente la zona del piso. Las ausencias son fechas locales inclusivas.

## 6. Nuevos miembros

Una nueva membresía activa cancela futuras pendientes automáticas. La próxima generación corta vuelve a repartir con el nuevo miembro elegible; no garantiza asignación inmediata si el equilibrio o una ausencia lo excluye. No cambia historia, periodo actual ni rotaciones manuales. Repetir Unirse siendo activo no invalida instancias.

## 7–8. Validación

Resultados y limitaciones en [validation.md](validation.md). No incluye gastos ni Fase 3.
