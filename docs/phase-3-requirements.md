Continúa el proyecto RoomieHub existente.

Las Fases 1, 1.1, 2 y 2.1 están terminadas y la migración más reciente es:

`202609150004_task_lifecycle_timezone.sql`

Antes de modificar nada:

1. Lee `AGENTS.md`.
2. Lee íntegramente `docs/product-requirements.md`.
3. Revisa todas las migraciones existentes.
4. Revisa la arquitectura actual.
5. Respeta la timezone configurable del piso y el lifecycle de tareas ya implementado.
6. No modifiques migraciones anteriores.
7. Implementa únicamente esta FASE 3.
8. No avances a reservas, actividades, calendario completo, puntos, castigos, chat o notificaciones.
9. Usa una nueva migración aditiva.
10. Todo debe funcionar con Supabase real, RLS y datos persistentes.

# FASE 3 — GASTOS

El objetivo es implementar un sistema completo de gastos compartidos similar en funcionalidad esencial a Tricount, pero con diseño, arquitectura y código propios.

Debe incluir:

- gastos
- participantes
- reparto igual
- reparto personalizado
- reparto porcentual
- saldos
- quién debe a quién
- liquidaciones
- pagos entre compañeros
- gastos recurrentes fijos
- gastos recurrentes variables
- adjuntos
- categorías
- categorización automática básica
- compra → gasto
- bloqueo de salida del piso mientras existan deudas
- Realtime
- RLS
- precisión monetaria exacta

--------------------------------------------------
1. MODELO MONETARIO
--------------------------------------------------

La precisión del dinero es crítica.

NO uses float/double como fuente de verdad monetaria.

Usa preferentemente unidades menores enteras:

- EUR → céntimos
- USD → cents
- etc.

Si existe una razón técnica fuerte para usar PostgreSQL numeric exacto, documéntala.

Todos los cálculos deben ser exactos y deterministas.

No deben existir errores tipo:

0.1 + 0.2 !== 0.3

Los splits deben sumar exactamente el total.

El tratamiento de residuos de redondeo debe ser determinista y testeado.

Usar la moneda configurada en `homes.currency`.

No implementar conversión de divisas.

--------------------------------------------------
2. GASTOS
--------------------------------------------------

Crear un modelo real de gastos.

Cada gasto debe contener como mínimo:

- id UUID
- home_id
- título/concepto
- importe total
- moneda o snapshot de moneda si procede
- fecha del gasto
- pagador
- categoría
- created_by
- created_at
- updated_at
- estado o soft delete si es necesario

El pagador puede ser participante o no.

Los antiguos miembros deben conservarse correctamente en gastos históricos.

No deben poder seleccionarse en gastos nuevos.

--------------------------------------------------
3. PARTICIPANTES
--------------------------------------------------

No todos los miembros tienen que participar en todos los gastos.

Ejemplo:

Piso:
Ana, Jorge, Pablo, Laura

Cena:
Ana, Jorge y Pablo participan.
Laura no.

Solo los participantes seleccionados deben recibir parte del gasto.

--------------------------------------------------
4. REPARTO IGUAL
--------------------------------------------------

Implementar reparto igual.

Ejemplo:

60 €
3 participantes

20 € cada uno.

Resolver correctamente casos como:

10,00 € / 3

No perder ni crear dinero.

Distribuir los céntimos restantes de forma determinista.

Documentar el criterio utilizado.

--------------------------------------------------
5. REPARTO PERSONALIZADO
--------------------------------------------------

Permitir introducir cantidades exactas.

Ejemplo:

100 €

Ana → 50 €
Jorge → 30 €
Pablo → 20 €

La suma debe coincidir exactamente con el total.

Rechazar cualquier distribución inconsistente.

--------------------------------------------------
6. REPARTO POR PORCENTAJES
--------------------------------------------------

Permitir porcentajes.

Ejemplo:

Ana → 50 %
Jorge → 30 %
Pablo → 20 %

La suma debe ser exactamente 100 %.

Transformar los porcentajes a importes monetarios exactos resolviendo residuos de redondeo de forma determinista.

--------------------------------------------------
7. PAGADOR PARTICIPANTE O NO
--------------------------------------------------

Ejemplo:

Jorge paga 60 €.

Participantes:
Jorge, Ana, Pablo.

Cada uno consume 20 €.

Resultado:

Ana debe 20 €
Pablo debe 20 €
Jorge tiene +40 €

También debe funcionar si el pagador no forma parte de los beneficiarios.

--------------------------------------------------
8. VARIOS PAGADORES
--------------------------------------------------

En esta fase basta con UN pagador por gasto.

Sin embargo, diseña el esquema para no bloquear completamente una futura ampliación a varios pagadores.

No añadas varios pagadores ahora si complica innecesariamente el MVP.

Documenta la decisión.

--------------------------------------------------
9. SALDOS
--------------------------------------------------

Calcular el saldo neto de cada miembro del piso.

Mostrar conceptos como:

- Te deben X
- Debes X
- Estás saldado

El saldo debe derivarse de:

- gastos
- splits
- liquidaciones

No usar un campo balance mutable como única fuente de verdad.

La información debe ser auditable y recalculable.

--------------------------------------------------
10. QUIÉN DEBE A QUIÉN
--------------------------------------------------

Implementar una simplificación de deudas.

Ejemplo:

Ana +40
Jorge -15
Pablo -25

Resultado sugerido:

Jorge paga Ana 15
Pablo paga Ana 25

La sugerencia debe:

- conservar el balance exacto
- ser determinista
- minimizar razonablemente el número de transferencias
- ser testeable

Separar claramente:

BALANCE REAL

de

SUGERENCIA DE LIQUIDACIÓN

Las sugerencias no son deudas almacenadas independientes.

--------------------------------------------------
11. LIQUIDACIONES
--------------------------------------------------

Permitir registrar:

"Jorge pagó 24 € a Ana"

Campos:

- id
- home_id
- from_user
- to_user
- amount
- date
- created_by
- created_at

Mantener historial.

Una liquidación modifica el balance derivado.

No eliminar gastos originales.

--------------------------------------------------
12. VALIDACIONES DE LIQUIDACIONES
--------------------------------------------------

No permitir:

- amount <= 0
- pagarse a uno mismo
- usuarios de otro piso
- importes inválidos

Un antiguo miembro con saldo pendiente debe poder participar en una liquidación necesaria para cerrar su deuda.

Diseñar este caso sin darle acceso general al resto del piso.

--------------------------------------------------
13. SALIR DEL PISO CON DEUDAS
--------------------------------------------------

Implementar finalmente esta regla:

Un usuario NO puede abandonar definitivamente el piso si su saldo monetario no es exactamente 0.

Al intentar salir:

- calcular saldo real
- si saldo != 0, bloquear
- indicar cuánto debe o cuánto le deben

Cuando el saldo sea 0:

- permitir salida
- marcar membership como inactiva
- conservar todo el historial

Esta regla debe estar protegida también en backend/RPC.

No depender solo del frontend.

--------------------------------------------------
14. EDITAR GASTOS
--------------------------------------------------

Todos los miembros activos tienen permisos iguales.

Permitir editar:

- título
- importe
- fecha
- pagador
- participantes
- reparto
- categoría

La operación debe ser transaccional.

Nunca dejar temporalmente un gasto con splits que no sumen el total.

--------------------------------------------------
15. ELIMINAR GASTOS
--------------------------------------------------

Permitir eliminar gastos respetando historial e integridad.

Elegir una estrategia segura:

- soft delete
- reversión
- eliminación controlada

Los balances deben actualizarse correctamente.

Documentar la decisión.

--------------------------------------------------
16. ADJUNTOS
--------------------------------------------------

Permitir opcionalmente:

- imagen
- foto de ticket
- PDF

Usar Supabase Storage privado.

Validar:

- tipos MIME
- tamaño máximo razonable

No permitir ejecutables.

Solo miembros autorizados del piso pueden acceder.

--------------------------------------------------
17. CATEGORÍAS
--------------------------------------------------

Crear categorías iniciales como:

- Supermercado
- Alquiler
- Electricidad
- Agua
- Internet
- Limpieza
- Transporte
- Ocio
- Comida
- Hogar
- Suscripciones
- Otros

Permitir cambiar manualmente la categoría.

--------------------------------------------------
18. CATEGORIZACIÓN AUTOMÁTICA
--------------------------------------------------

Intentar inferir categoría desde el concepto.

Ejemplos:

Mercadona → Supermercado
Lidl → Supermercado
Iberdrola → Electricidad
Netflix → Suscripciones
Alquiler septiembre → Alquiler

No usar IA externa.

Usar reglas/aliases extensibles.

Fallback:

Otros

--------------------------------------------------
19. GASTOS RECURRENTES
--------------------------------------------------

Crear plantillas de gastos recurrentes.

Campos aproximados:

- id
- home_id
- título
- categoría
- pagador
- participantes
- split
- frecuencia
- fixed/variable
- siguiente fecha
- activa/inactiva
- created_by
- timestamps

Usar timezone del piso.

--------------------------------------------------
20. RECURRENTE FIJO
--------------------------------------------------

Ejemplo:

Alquiler
450 €
mensual

Cuando llega el periodo:

crear el gasto automáticamente con ese importe.

La generación debe ser:

- idempotente
- segura
- sin duplicados por periodo

No hace falta instalar cron todavía si no forma parte de la arquitectura actual.

Puede usarse generación bajo demanda/RPC, dejando preparado cron futuro.

--------------------------------------------------
21. RECURRENTE VARIABLE
--------------------------------------------------

Ejemplo:

Electricidad
mensual
importe variable

Al llegar el periodo:

NO inventar un importe.

Crear un pendiente:

"Introduce el importe de electricidad de septiembre"

Solo cuando alguien introduzca/confirme el importe se contabiliza el gasto.

--------------------------------------------------
22. FRECUENCIAS
--------------------------------------------------

Soportar como mínimo:

- semanal
- mensual
- cada X meses

Usar timezone del piso para determinar periodos y fechas lógicas.

No introducir de nuevo bugs UTC cerca de medianoche.

--------------------------------------------------
23. COMPRA → GASTO
--------------------------------------------------

Integrar el módulo de compras de Fase 2.

Cuando una lista esté completada, permitir:

"Crear gasto"

Solicitar:

- importe total
- pagador
- participantes
- tipo de reparto

Prellenar:

- concepto = nombre de la lista
- categoría probable

Guardar relación entre:

shopping_list ↔ expense

Evitar crear accidentalmente dos gastos desde la misma lista.

No modificar los productos.

--------------------------------------------------
24. UI DE GASTOS
--------------------------------------------------

Crear sección funcional:

Gastos

Debe mostrar de forma limpia:

- tu balance
- cuánto debes
- cuánto te deben
- listado de gastos
- botón crear gasto
- saldos
- pagos/liquidaciones
- gastos recurrentes

Mobile-first.

No crear estadísticas complejas.

--------------------------------------------------
25. CREAR GASTO — UX
--------------------------------------------------

Formulario cómodo en móvil.

Campos:

- concepto
- importe
- fecha
- pagador
- participantes
- tipo de reparto
- categoría
- adjunto opcional

Valores por defecto:

- fecha actual según timezone del piso
- pagador = usuario actual
- participantes = miembros activos

Permitir modificar todo.

Mostrar antes de guardar cuánto corresponde a cada participante.

No permitir guardar si la distribución es inválida.

--------------------------------------------------
26. SALDOS — UI
--------------------------------------------------

Crear una vista clara.

Ejemplo:

Tu saldo
+42,35 €

Ana te debe 20 €
Pablo te debe 22,35 €

o:

Debes 15 € a Ana

Mostrar también pagos sugeridos.

No confundir sugerencias con movimientos reales.

--------------------------------------------------
27. REGISTRAR PAGO — UI
--------------------------------------------------

Desde la vista de saldos:

Registrar pago

Campos:

- quién paga
- quién recibe
- importe
- fecha

Actualizar inmediatamente los balances.

--------------------------------------------------
28. REALTIME
--------------------------------------------------

Añadir Realtime para:

- creación de gastos
- edición
- eliminación
- liquidaciones
- recurrentes pendientes/confirmados

Los compañeros deben ver cambios sin refrescar.

Filtrar siempre por home_id.

Limpiar subscriptions correctamente.

--------------------------------------------------
29. RLS
--------------------------------------------------

Todas las tablas nuevas deben tener RLS.

Un usuario externo al piso NO puede:

- ver gastos
- leer splits
- crear gastos
- modificar gastos
- ver liquidaciones
- acceder a tickets
- consultar recurrentes

Miembros activos:

mismos permisos.

Exmiembros:

solo acceso mínimo imprescindible si aún tienen saldos que liquidar.

No permitir acceso general mediante esta excepción.

Preferir RPCs específicas si es necesario.

--------------------------------------------------
30. HISTORIAL
--------------------------------------------------

Conservar correctamente datos históricos de exmiembros.

Un exmiembro debe seguir apareciendo en:

- gastos históricos
- splits antiguos
- liquidaciones históricas

Pero no debe estar disponible para nuevos gastos.

Usar snapshots si la arquitectura existente lo requiere.

--------------------------------------------------
31. TIMEZONE
--------------------------------------------------

Respetar `homes.timezone`.

Usarla para:

- fecha por defecto
- recurrentes
- siguiente periodo
- UI lógica

Los timestamps absolutos pueden seguir almacenados como timestamptz.

--------------------------------------------------
32. DASHBOARD
--------------------------------------------------

Actualizar Inicio únicamente con:

- saldo resumido
- opcionalmente gasto recurrente pendiente

No convertir Inicio en dashboard financiero.

--------------------------------------------------
33. NO IMPLEMENTAR
--------------------------------------------------

No implementar todavía:

- estadísticas de gastos
- gráficas
- presupuestos
- OCR
- conversión de monedas
- reservas
- actividades
- calendario completo
- positivos
- negativos
- castigos
- ranking
- chat
- notificaciones push/email

--------------------------------------------------
34. ESQUEMA
--------------------------------------------------

Diseña modelo relacional limpio.

Posibles entidades:

- expenses
- expense_splits
- settlements
- recurring_expenses
- recurring_expense_instances
- expense_attachments
- shopping_list_expense_links

No estás obligado a usar exactamente esos nombres.

Priorizar:

- exactitud
- integridad
- historial
- auditabilidad
- RLS
- idempotencia
- transacciones

--------------------------------------------------
35. RPCs
--------------------------------------------------

Las operaciones complejas deben ser atómicas.

Usar RPCs/transacciones para:

- crear gasto + splits
- editar gasto + splits
- eliminar/revertir
- registrar pago
- generar recurrente fijo
- confirmar recurrente variable
- convertir compra a gasto
- salir del piso comprobando balance

Evitar múltiples escrituras cliente que puedan quedar a medias.

--------------------------------------------------
36. CONCURRENCIA
--------------------------------------------------

Revisar:

- doble click al crear gasto
- dos usuarios editando
- dos usuarios confirmando mismo recurrente
- dos usuarios convirtiendo misma compra
- liquidación duplicada

Usar:

- constraints
- locks
- idempotency keys
- transacciones

cuando tenga sentido.

--------------------------------------------------
37. TESTS DE DINERO
--------------------------------------------------

Cubrir:

- reparto igual exacto
- reparto igual con residuo
- cantidades personalizadas
- porcentajes
- suma exacta
- importes inválidos
- redondeo determinista
- importes grandes razonables

--------------------------------------------------
38. TESTS DE BALANCE
--------------------------------------------------

Cubrir:

- pagador participante
- pagador no participante
- varios gastos
- liquidaciones
- saldo cero
- sugerencias de pago
- conservación exacta del balance

--------------------------------------------------
39. TESTS DE MEMBRESÍA
--------------------------------------------------

Cubrir:

- activo participa
- antiguo no puede añadirse a gasto nuevo
- antiguo permanece en histórico
- salida con deuda bloqueada
- salida con saldo cero permitida

--------------------------------------------------
40. TESTS DE RECURRENTES
--------------------------------------------------

Cubrir:

- fijo
- variable
- no duplicar periodo
- confirmar variable
- timezone
- idempotencia

--------------------------------------------------
41. TESTS COMPRA → GASTO
--------------------------------------------------

Cubrir:

- lista completada → gasto
- evitar duplicado accidental
- reparto correcto
- relación entre lista y gasto

--------------------------------------------------
42. TESTS SEGURIDAD
--------------------------------------------------

Cubrir:

- aislamiento RLS entre pisos
- Storage
- exmiembros
- RPC cross-home
- acceso anónimo rechazado

--------------------------------------------------
43. VALIDACIÓN REMOTA
--------------------------------------------------

Si tienes acceso al Supabase real:

1. comprobar migraciones existentes
2. crear nueva migración Fase 3
3. aplicarla
4. comprobar tablas
5. comprobar RLS
6. comprobar RPCs
7. probar con varias cuentas

Prueba funcional mínima:

A y B están en el mismo piso.

- A crea gasto de 30 € entre A y B.
- B debe 15 €.
- B paga 15 € a A.
- ambos quedan a 0.
- probar reparto personalizado.
- probar porcentajes.
- probar redondeo.
- completar lista de compra y convertirla a gasto.
- crear recurrente fijo.
- crear recurrente variable.
- usuario externo no accede.
- usuario con deuda no puede abandonar el piso.
- después de saldar, puede abandonar.

Eliminar fixtures de test al terminar.

--------------------------------------------------
44. CALIDAD
--------------------------------------------------

Ejecutar:

- lint
- typecheck
- tests
- tests DB
- build
- E2E

Mantener:

- español/inglés
- claro/oscuro
- responsive
- mobile-first
- estados loading
- feedback de errores
- prevención de doble envío
- accesibilidad básica

--------------------------------------------------
45. MIGRACIÓN
--------------------------------------------------

Crear una nueva migración posterior a:

`202609150004_task_lifecycle_timezone.sql`

NO modificar:

001
002
003
004

La nueva migración debe contener toda la estructura necesaria de Fase 3.

Si el acceso MCP/Supabase funciona:

aplicar y verificar.

Si no:

dejar el archivo preparado e indicar exactamente qué debo ejecutar manualmente.

--------------------------------------------------
46. DOCUMENTACIÓN
--------------------------------------------------

Actualizar:

- README
- AGENTS.md
- docs/architecture.md
- docs/setup.md
- docs/validation.md

Documentar especialmente:

- representación monetaria
- redondeos
- splits
- balances
- algoritmo de liquidaciones sugeridas
- recurrentes
- compra → gasto
- salida con deuda
- RLS
- Realtime

No eliminar requisitos futuros.

--------------------------------------------------
AL TERMINAR
--------------------------------------------------

NO empieces Fase 4.

Entrégame un resumen con:

1. migración creada
2. tablas creadas
3. RPC/functions creadas
4. representación monetaria utilizada
5. algoritmo de redondeo
6. funcionamiento de splits
7. cálculo de balances
8. algoritmo de liquidaciones sugeridas
9. comportamiento de edición/eliminación
10. recurrentes fijos
11. recurrentes variables
12. compra → gasto
13. regla de salida con deuda
14. Realtime
15. RLS
16. tests ejecutados y resultados
17. validación realizada contra Supabase real
18. pasos manuales pendientes
19. limitaciones conocidas

No avances a reservas, actividades o calendario hasta que revise esta fase.