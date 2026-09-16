Continúa el proyecto RoomieHub existente.

Las Fases 1, 1.1, 2, 2.1, 3 y 4 están terminadas.

La migración más reciente es:

`202609150006_calendar_reservations_activities.sql`

Antes de modificar nada:

1. Lee `AGENTS.md`.
2. Lee íntegramente `docs/product-requirements.md`.
3. Lee la documentación de entrega de las fases anteriores.
4. Revisa todas las migraciones 001–006.
5. Revisa especialmente:
   - members/home_members
   - chores
   - chore_instances
   - chore_assignment_events
   - deadlines
   - Storage
   - timezone
   - dashboard
   - Realtime
6. No modifiques migraciones anteriores.
7. Implementa únicamente esta FASE 5.
8. Crea una nueva migración aditiva posterior a 006.
9. Mantén compatibilidad con todos los datos existentes.
10. No avances a chat, notificaciones, push, email ni PWA final.
11. Mantén español/inglés, responsive, modo claro/oscuro, RLS y Realtime.

# FASE 5 — CONVIVENCIA, POSITIVOS, NEGATIVOS, CASTIGOS Y RANKING

El objetivo es implementar el sistema de convivencia de RoomieHub:

- positivos
- negativos
- motivos configurables
- valoraciones manuales
- anonimato opcional
- foto opcional
- edición/eliminación
- negativos automáticos por tareas atrasadas
- conversión automática de positivos
- castigos por múltiplos de 5 negativos
- ranking
- historial suficiente
- Realtime
- RLS
- integración con dashboard

--------------------------------------------------
1. PRINCIPIO GENERAL
--------------------------------------------------

Todos los miembros activos del piso tienen los mismos permisos.

No existen administradores.

Cualquier miembro activo puede valorar a cualquier otro miembro activo del mismo piso.

No permitir valorarse a uno mismo salvo que exista una razón explícita muy fuerte.

Por defecto:

NO permitir auto-valoración.

--------------------------------------------------
2. POSITIVOS Y NEGATIVOS
--------------------------------------------------

Un miembro puede dar a otro:

- 1 positivo
- 1 negativo

Cada valoración debe representar una unidad.

No introducir cantidades arbitrarias en una sola valoración.

Ejemplo:

Ana da un positivo a Jorge.

Eso crea un registro individual de +1.

Si quiere dar 3 positivos, deben existir 3 registros o una operación equivalente auditable.

--------------------------------------------------
3. MODELO DE VALORACIONES
--------------------------------------------------

Crear un modelo robusto.

Entidad aproximada:

ratings

Campos posibles:

- id UUID
- home_id
- target_user_id
- created_by
- type: positive | negative
- reason_id
- custom_text opcional si procede
- is_anonymous
- attachment_path opcional
- source
- source_id opcional
- created_at
- updated_at
- deleted_at opcional

No es obligatorio usar estos nombres exactos.

Priorizar:

- auditabilidad
- historial
- integridad
- idempotencia
- RLS
- compatibilidad con valoraciones automáticas

--------------------------------------------------
4. FUENTE DE LA VALORACIÓN
--------------------------------------------------

Diferenciar claramente:

- manual
- task_overdue
- system

Ejemplo:

source = manual

o:

source = task_overdue
source_id = chore_instance_id

Esto es importante para evitar duplicados.

--------------------------------------------------
5. MOTIVOS CONFIGURABLES
--------------------------------------------------

Cada piso debe tener motivos para positivos y negativos.

Ejemplos positivos:

- Ayudó a limpiar
- Buena convivencia
- Ayudó a otro compañero
- Se encargó de algo extra
- Otro

Ejemplos negativos:

- No limpió
- Dejó zonas comunes sucias
- Molestó a otros compañeros
- No cumplió una tarea
- Otro

Cada piso puede:

- crear motivos
- editar motivos
- desactivar/eliminar lógicamente
- decidir si son positivos o negativos

--------------------------------------------------
6. MOTIVOS GENÉRICOS
--------------------------------------------------

Permitir inicializar motivos genéricos para pisos que todavía no tengan ninguno.

No duplicarlos al ejecutar varias veces.

La inicialización debe ser idempotente.

--------------------------------------------------
7. MOTIVO OBLIGATORIO
--------------------------------------------------

Toda valoración manual debe tener motivo.

Puede ser:

- reason_id
- o categoría "Otro" con texto adicional

No permitir valoración manual completamente sin contexto.

--------------------------------------------------
8. ANONIMATO
--------------------------------------------------

Cada valoración manual puede ser:

- identificada
- anónima

Si es anónima:

el usuario receptor NO debe ver quién la creó.

Pero el backend debe conservar `created_by` por:

- seguridad
- integridad
- auditoría

No exponer el autor mediante:

- API
- RPC
- JOIN accidental
- Realtime
- frontend
- Storage path
- metadata

al usuario que no debe verlo.

--------------------------------------------------
9. QUIÉN PUEDE VER EL AUTOR
--------------------------------------------------

Dado que no existen admins:

Preferencia:

- el propio autor puede saber que creó la valoración
- el resto del piso no ve autor si `is_anonymous = true`

No crear una vista administrativa especial.

Documentar el criterio.

--------------------------------------------------
10. ADJUNTO OPCIONAL
--------------------------------------------------

Una valoración manual puede incluir una foto opcional.

Usar Supabase Storage privado.

Permitir únicamente formatos razonables:

- image/jpeg
- image/png
- image/webp

Definir límite de tamaño.

No permitir archivos ejecutables ni PDFs aquí salvo que exista una razón fuerte.

--------------------------------------------------
11. PRIVACIDAD DEL ADJUNTO
--------------------------------------------------

Solo miembros activos del mismo piso deben poder acceder al adjunto.

Si la valoración es anónima:

el nombre/ruta/metadata del archivo no debe revelar la identidad del autor.

--------------------------------------------------
12. EDITAR VALORACIONES
--------------------------------------------------

Según los requisitos del producto:

todos los miembros activos tienen permisos iguales.

Por tanto, permitir editar valoraciones manuales del piso.

Pero:

- NO convertir valoración automática en manual
- NO permitir editar `source`
- NO permitir cambiar `source_id`
- NO permitir romper integridad histórica

Valorar si editar tipo positive ↔ negative es aceptable.

Preferencia:

permitir cambiarlo si sigue siendo una valoración manual y se recalculan correctamente los efectos.

Documentar la decisión.

--------------------------------------------------
13. ELIMINAR VALORACIONES
--------------------------------------------------

Todos los miembros activos pueden eliminar valoraciones manuales.

Preferir soft delete.

Si una valoración automática por retraso existe:

NO permitir eliminarla manualmente desde UI.

La lógica automática debe controlarla.

--------------------------------------------------
14. POSITIVOS DISPONIBLES
--------------------------------------------------

Los positivos tienen un comportamiento especial:

3 positivos disponibles eliminan 1 negativo.

Los positivos usados se consumen.

Por tanto hay que distinguir:

- positivos históricos recibidos
- positivos disponibles
- positivos consumidos

No basta con:

COUNT(positive)

--------------------------------------------------
15. REGLA 3 POSITIVOS → 1 NEGATIVO
--------------------------------------------------

Regla exacta:

Cada vez que un usuario acumule 3 positivos disponibles:

- consumir 3 positivos
- eliminar/compensar 1 negativo disponible

Ejemplo:

Jorge:
2 positivos
4 negativos

Recibe 1 positivo.

Resultado:

0 positivos disponibles
3 negativos efectivos

--------------------------------------------------
16. AUTOMATISMO DE CONVERSIÓN
--------------------------------------------------

La conversión debe ocurrir automáticamente.

Debe ser:

- transaccional
- determinista
- idempotente
- segura con concurrencia

No confiar en que el frontend haga:

1. insertar positivo
2. consultar total
3. borrar negativo

Implementar en backend/RPC/función.

--------------------------------------------------
17. QUÉ NEGATIVO SE COMPENSA
--------------------------------------------------

Definir criterio determinista.

Preferencia:

compensar el negativo efectivo más antiguo todavía no compensado.

No eliminar físicamente el registro.

Mantener historial.

Ejemplo de enfoque:

rating_redemptions

o equivalente.

Documentar claramente.

--------------------------------------------------
18. HISTORIAL VS SALDO ACTUAL
--------------------------------------------------

Debe poder conocerse:

Histórico:
- positivos recibidos
- negativos recibidos

Estado actual:
- positivos disponibles
- negativos efectivos

Ejemplo:

Histórico:
9 positivos
5 negativos

Se consumieron:
9 positivos → compensaron 3 negativos

Estado:
0 positivos disponibles
2 negativos efectivos

--------------------------------------------------
19. NO REVERTIR CASTIGOS PASADOS
--------------------------------------------------

Regla fundamental:

Si un castigo ya fue generado por alcanzar un umbral:

aunque después positivos reduzcan los negativos,

el castigo NO desaparece.

Los castigos generados son históricos e independientes.

--------------------------------------------------
20. TAREAS ATRASADAS
--------------------------------------------------

Integrar con las tareas existentes.

Una tarea con deadline que no está completada genera:

1 negativo por cada día COMPLETO de retraso.

Sin límite.

Ejemplo:

deadline:
lunes 18:00

martes 17:59:
0 negativos

martes 18:00:
1 negativo

miércoles 18:00:
2 negativos

jueves 18:00:
3 negativos

Respetar timezone del piso / deadline según arquitectura existente.

--------------------------------------------------
21. DESTINATARIO DEL NEGATIVO AUTOMÁTICO
--------------------------------------------------

El negativo corresponde al responsable de la tarea durante ese periodo.

Revisar la lógica existente de:

- asignaciones
- reasignaciones
- ausencias
- completed_at
- historial de asignación

No penalizar a una persona que ya no era responsable cuando se produjo el retraso si la tarea fue correctamente reasignada.

Definir el comportamiento exacto usando el historial existente.

--------------------------------------------------
22. COMPLETAR TARDE
--------------------------------------------------

Ejemplo:

deadline:
lunes 10:00

se completa:
jueves 13:00

Debe generar exactamente los días completos de retraso acumulados hasta completar.

Después de completarse:

NO seguir generando negativos.

--------------------------------------------------
23. NEGATIVOS AUTOMÁTICOS IDPOTENTES
--------------------------------------------------

Este punto es CRÍTICO.

Si una tarea lleva 5 días tarde:

debe haber 5 negativos.

No:

5 cada vez que se abre la app.

Crear una identidad única para cada penalización.

Ejemplo conceptual:

chore_instance_id + overdue_day_number

o:

chore_instance_id + logical_date

Debe existir constraint/garantía que impida duplicados.

--------------------------------------------------
24. GENERACIÓN BAJO DEMANDA
--------------------------------------------------

Actualmente no existe cron general.

Mantener el patrón actual:

- función/RPC idempotente
- invocación bajo demanda donde sea razonable
- preparada para futuro scheduler

No instalar cron en esta fase salvo que ya exista infraestructura específica.

--------------------------------------------------
25. NO GENERAR EFECTOS AL ABRIR CUALQUIER PANTALLA
--------------------------------------------------

Evitar que navegar por una vista no relacionada provoque trabajo excesivo.

La reconciliación de penalizaciones puede ocurrir:

- al abrir Convivencia
- al abrir Tareas
- al completar una tarea
- mediante una función común razonable

Diseñar de forma controlada.

--------------------------------------------------
26. MOTIVO AUTOMÁTICO
--------------------------------------------------

Las penalizaciones por retraso deben mostrarse con motivo claro.

Ejemplo:

"Tarea atrasada: Limpiar cocina"

y, si procede:

"Día 3 de retraso"

No depender de un motivo editable del piso.

Es una razón de sistema.

--------------------------------------------------
27. CASTIGOS
--------------------------------------------------

Los negativos efectivos generan castigos al alcanzar múltiplos de 5.

Regla:

5 → leve
10 → fuerte
15 → leve
20 → fuerte
25 → leve
30 → fuerte

etc.

Generalización:

múltiplo de 10 → fuerte
otro múltiplo de 5 → leve

--------------------------------------------------
28. MOMENTO DE GENERACIÓN DEL CASTIGO
--------------------------------------------------

Generar el castigo cuando el usuario ALCANZA o CRUZA un umbral que todavía no había generado.

Ejemplo:

Tiene 4.

Recibe +1 negativo.

→ genera castigo de 5.

Si pasa de 4 a 6 por algún proceso:

también debe generar castigo de 5.

--------------------------------------------------
29. VARIOS UMBRALES A LA VEZ
--------------------------------------------------

El sistema debe ser robusto incluso si una operación provoca cruzar varios umbrales.

Ejemplo teórico:

9 → 16

Debe crear:

- castigo fuerte de 10
- castigo leve de 15

Sin duplicados.

--------------------------------------------------
30. CASTIGOS PERSISTENTES
--------------------------------------------------

Un castigo ya generado:

NO se elimina automáticamente si bajan los negativos efectivos.

Ejemplo:

Jorge alcanza 5 → castigo leve.

Después recibe 3 positivos y baja a 4 efectivos.

El castigo de 5 sigue pendiente.

--------------------------------------------------
31. MODELO DE CASTIGOS
--------------------------------------------------

Crear entidad aproximada:

punishments

Campos posibles:

- id
- home_id
- user_id
- threshold
- severity: light | heavy
- description opcional
- status: pending | completed
- triggered_at
- completed_at
- completed_by
- created_at

Constraint único:

home/user/threshold

o equivalente.

No duplicar un castigo del mismo umbral.

--------------------------------------------------
32. CONTENIDO DEL CASTIGO
--------------------------------------------------

La aplicación NO decide automáticamente cuál es el castigo real.

Cuando se alcanza umbral:

crear:

"Castigo leve pendiente"

o:

"Castigo fuerte pendiente"

Los compañeros escriben/definen el castigo real.

Ejemplo:

- limpiar cocina extra
- limpiar el piso esta semana
- hacer una tarea adicional

--------------------------------------------------
33. CASTIGO LEVE / FUERTE
--------------------------------------------------

No hardcodear una acción concreta obligatoria.

Solo severidad.

light
heavy

La descripción concreta es editable por los miembros.

--------------------------------------------------
34. COMPLETAR CASTIGO
--------------------------------------------------

Permitir:

- añadir/editar descripción
- marcar cumplido
- conservar historial

Al completarse:

no modifica negativos.

No "gasta" negativos.

El umbral ya queda consumido históricamente.

--------------------------------------------------
35. EDICIÓN DE CASTIGO
--------------------------------------------------

Todos los miembros activos pueden:

- definir descripción
- modificarla
- marcar completado

No permitir cambiar:

- user_id
- threshold
- severity

--------------------------------------------------
36. RANKING
--------------------------------------------------

Crear una vista de ranking separada.

NO poner ranking completo en dashboard.

Orden:

1. menos negativos efectivos
2. en empate, más positivos disponibles

Si continúa empate:

usar criterio estable y no competitivo, por ejemplo nombre o UUID.

--------------------------------------------------
37. RANKING Y DATOS
--------------------------------------------------

Mostrar por miembro:

- nombre/avatar
- negativos efectivos
- positivos disponibles
- castigos pendientes

Opcionalmente:

históricos en detalle, no necesariamente en la tabla principal.

--------------------------------------------------
38. EXMIEMBROS
--------------------------------------------------

Los exmiembros:

- permanecen en historial de valoraciones
- permanecen en castigos históricos

Pero:

NO aparecen en ranking activo.
NO pueden recibir valoraciones nuevas.
NO participan en automatismos futuros.

--------------------------------------------------
39. UI CONVIVENCIA
--------------------------------------------------

Crear/terminar sección:

Convivencia

Puede contener tabs/subsecciones:

- Puntos
- Castigos
- Ranking
- Actividades

Actividades ya existen de Fase 4.

Integrarlas sin romperlas.

--------------------------------------------------
40. UI DE PUNTOS
--------------------------------------------------

Mostrar:

- tus positivos disponibles
- tus negativos efectivos
- valoraciones recientes
- botón "Valorar"

Permitir seleccionar:

- persona
- positivo/negativo
- motivo
- anónimo sí/no
- foto opcional

--------------------------------------------------
41. DETALLE DE MIEMBRO
--------------------------------------------------

Poder consultar el estado de un compañero:

- positivos disponibles
- negativos efectivos
- valoraciones visibles
- castigos pendientes/completados

No revelar autor de valoraciones anónimas.

--------------------------------------------------
42. UI DE CASTIGOS
--------------------------------------------------

Mostrar:

Pendientes

Ejemplo:

Jorge
Castigo leve
Umbral: 5 negativos
[Definir castigo]
[Marcar como cumplido]

Y sección de completados/historial si resulta razonable.

--------------------------------------------------
43. DASHBOARD
--------------------------------------------------

Actualizar Inicio de forma mínima.

Mostrar si existen:

- castigos pendientes del usuario
- quizás estado breve de puntos

NO mostrar ranking completo.

NO saturar dashboard.

--------------------------------------------------
44. REALTIME
--------------------------------------------------

Añadir Realtime para:

- ratings
- rating redemptions si aplica
- punishments
- rating reasons

Los cambios deben aparecer sin recargar.

Evitar doble representación por:

optimistic UI + evento realtime.

--------------------------------------------------
45. SEGURIDAD / RLS
--------------------------------------------------

Todas las tablas nuevas deben tener RLS.

Usuario externo:

ningún acceso.

Miembro activo:

acceso según reglas definidas.

Exmiembro:

solo historial mínimo si ya lo permite arquitectura, pero sin operaciones nuevas.

--------------------------------------------------
46. ANONIMATO Y RLS
--------------------------------------------------

Este punto requiere especial cuidado.

No basta con ocultar el nombre en React.

La consulta que recibe el usuario no debe incluir `created_by` si la valoración es anónima y ese usuario no tiene derecho a verlo.

Usar:

- view segura
- RPC
- función
- DTO backend

o solución equivalente.

Testearlo explícitamente.

--------------------------------------------------
47. STORAGE RLS
--------------------------------------------------

Fotos de valoraciones privadas.

Comprobar:

- miembro mismo piso → permitido
- usuario externo → rechazado
- exmiembro → sin acceso operativo

Ruta sin información sensible del autor.

--------------------------------------------------
48. RPCs
--------------------------------------------------

Usar operaciones transaccionales para procesos con efectos múltiples.

Ejemplos:

- crear valoración
- editar valoración
- eliminar valoración
- reconciliar positivos
- generar negativos atrasados
- generar castigos
- completar castigo

Evitar secuencias cliente vulnerables a fallos intermedios.

--------------------------------------------------
49. CONCURRENCIA DE POSITIVOS
--------------------------------------------------

Caso:

Jorge tiene 2 positivos disponibles.

Ana y Pablo le dan un positivo simultáneamente.

Resultado correcto:

Jorge recibe 2 nuevos positivos.

Total histórico aumenta en 2.

Se consumen exactamente 3 positivos.

Se compensa exactamente 1 negativo si existe.

Queda 1 positivo disponible.

No consumir 6.
No compensar dos negativos accidentalmente.

--------------------------------------------------
50. CONCURRENCIA DE CASTIGOS
--------------------------------------------------

Dos procesos detectan simultáneamente que Jorge alcanzó 5.

Resultado:

UN castigo de threshold 5.

Constraint + transacción.

--------------------------------------------------
51. EDICIÓN/ELIMINACIÓN Y EFECTOS
--------------------------------------------------

Este punto es importante.

Si se elimina o cambia una valoración manual:

los positivos/negativos efectivos deben recalcularse correctamente.

Pero:

castigos ya generados NO desaparecen.

Ejemplo:

5 negativos → castigo generado.

Se elimina uno manual → baja a 4.

Castigo permanece.

--------------------------------------------------
52. NO CREAR CASTIGO DOS VECES
--------------------------------------------------

Si:

- alcanza 5
- baja a 4
- vuelve a 5

NO crear otro castigo de 5.

Ese umbral ya fue generado históricamente.

--------------------------------------------------
53. NEGATIVOS AUTOMÁTICOS Y EDICIÓN DE TAREAS
--------------------------------------------------

Revisar casos como:

- tarea cancelada
- tarea desactivada
- deadline cambiado
- responsable reasignado
- tarea completada
- historial congelado

No generar penalizaciones sobre instancias que ya no deben penalizar.

No reescribir historia completada.

--------------------------------------------------
54. TIMEZONE
--------------------------------------------------

Todo cálculo de días de retraso debe respetar la lógica temporal existente.

No introducir cálculos UTC naïve.

Testear cerca de medianoche.

Usar helpers ya existentes cuando sea posible.

--------------------------------------------------
55. TESTS POSITIVOS/NEGATIVOS
--------------------------------------------------

Cubrir:

- positivo manual
- negativo manual
- motivo obligatorio
- anonimato
- foto
- edición
- eliminación
- no auto-valoración
- cross-home

--------------------------------------------------
56. TESTS DE CONVERSIÓN
--------------------------------------------------

Cubrir:

0 + 3 positivos
→ consume 3

3 positivos + 1 negativo
→ 0/0 efectivos

6 positivos + 3 negativos
→ 0 positivos / 1 negativo

8 positivos + 4 negativos
→ 2 positivos / 2 negativos

o comportamiento equivalente según el modelo.

--------------------------------------------------
57. TESTS DE CONCURRENCIA DE CONVERSIÓN
--------------------------------------------------

Simular positivos simultáneos.

Verificar:

- no doble consumo
- no doble compensación
- totales exactos

--------------------------------------------------
58. TESTS DE RETRASOS
--------------------------------------------------

Deadline:
lunes 10:00

Casos:

lunes 10:00 → 0
martes 09:59 → 0
martes 10:00 → 1
miércoles 10:00 → 2
jueves 12:00 → 3

Completar jueves 12:00:

debe quedarse en 3 para siempre.

--------------------------------------------------
59. TEST DE IDEMPOTENCIA DE RETRASOS
--------------------------------------------------

Ejecutar reconciliación 10 veces.

Una tarea con 4 días de retraso:

debe tener exactamente 4 negativos automáticos.

--------------------------------------------------
60. TEST REASIGNACIÓN
--------------------------------------------------

Tarea asignada a Ana.

Se reasigna correctamente a Jorge antes del periodo penalizable.

Asegurarse de que los negativos corresponden a la persona que realmente debe ser responsable según la semántica existente.

--------------------------------------------------
61. TESTS CASTIGOS
--------------------------------------------------

Cubrir:

4 → 5 = leve

9 → 10 = fuerte

14 → 15 = leve

19 → 20 = fuerte

Y:

- no duplicación
- bajar/subir de umbral
- historial persistente

--------------------------------------------------
62. TESTS RANKING
--------------------------------------------------

Ejemplo:

Ana: 1 negativo, 0 positivos
Jorge: 2 negativos, 20 positivos
Pablo: 1 negativo, 3 positivos

Orden:

Pablo
Ana
Jorge

Porque primero menos negativos y luego más positivos.

--------------------------------------------------
63. TESTS ANONIMATO
--------------------------------------------------

Crear valoración anónima.

El receptor:

NO puede descubrir autor mediante:

- consulta normal
- RPC
- Realtime
- campos relacionados
- metadata del adjunto

Este test es obligatorio.

--------------------------------------------------
64. E2E
--------------------------------------------------

Añadir flujos mínimos.

FLUJO 1:
- Ana da positivo a Jorge
- Jorge ve positivo
- no se revela autor si es anónimo

FLUJO 2:
- Jorge acumula 3 positivos
- se compensa un negativo

FLUJO 3:
- tarea atrasada
- se genera negativo automático
- recargar varias veces
- no se duplica

FLUJO 4:
- alcanzar 5 negativos
- aparece castigo leve
- definir castigo
- marcar completado

FLUJO 5:
- consultar ranking

--------------------------------------------------
65. VALIDACIÓN SUPABASE REAL
--------------------------------------------------

Si tienes acceso:

crear al menos 3 usuarios en un mismo piso.

Probar:

- positivos
- negativos
- anonimato
- fotografía
- 3 positivos → compensación
- penalización atrasada
- castigo de 5
- ranking
- Realtime

Añadir usuario externo:

verificar aislamiento.

Eliminar fixtures de prueba cuando proceda.

--------------------------------------------------
66. NO ROMPER FASES ANTERIORES
--------------------------------------------------

Ejecutar regresión sobre:

- auth
- homes
- invitations
- profiles
- tasks
- absences
- shopping
- expenses
- settlements
- recurrent expenses
- reservations
- activities
- calendar
- timezone

--------------------------------------------------
67. MIGRACIÓN
--------------------------------------------------

Crear nueva migración posterior a:

`202609150006_calendar_reservations_activities.sql`

Nombre esperado similar a:

`202609150007_community_ratings_punishments.sql`

NO modificar:

001
002
003
004
005
006

--------------------------------------------------
68. POSIBLES TABLAS
--------------------------------------------------

Podrían existir entidades como:

rating_reasons
ratings
rating_redemptions
punishments

o diseño equivalente.

No estás obligado a usar estos nombres.

Evitar almacenar simples contadores mutables como única fuente de verdad.

Debe poder reconstruirse el estado.

--------------------------------------------------
69. DOCUMENTACIÓN
--------------------------------------------------

Actualizar:

- README
- AGENTS.md
- docs/architecture.md
- docs/setup.md
- docs/validation.md

Crear:

`docs/phase-5-delivery.md`

Documentar especialmente:

- modelo de positivos/negativos
- histórico vs disponible
- consumo de positivos
- compensación de negativos
- anonimato
- retrasos
- idempotencia
- castigos
- umbrales
- ranking
- timezone
- RLS
- Storage
- Realtime
- concurrencia

--------------------------------------------------
70. CALIDAD
--------------------------------------------------

Ejecutar:

- lint
- typecheck
- unit tests
- test:db
- E2E
- build

No eliminar tests anteriores.

No considerar la fase completa si falla alguna regresión.

--------------------------------------------------
71. NO IMPLEMENTAR TODAVÍA
--------------------------------------------------

NO implementar:

- chat
- mensajes
- reacciones
- notificaciones in-app
- emails
- push
- scheduler/cron global
- modo offline final
- PWA final
- analítica
- gamificación adicional

No iniciar Fase 6.

--------------------------------------------------
AL TERMINAR
--------------------------------------------------

NO empieces la Fase 6.

Entrégame un resumen exacto con:

1. migración creada
2. tablas creadas
3. RPC/functions
4. funcionamiento de positivos
5. funcionamiento de negativos
6. motivos
7. anonimato
8. adjuntos
9. edición/eliminación
10. cómo se consumen 3 positivos
11. cómo se compensa un negativo
12. cómo se generan negativos por retraso
13. cómo se evita duplicarlos
14. cómo se determina responsable penalizado
15. cómo se generan castigos
16. cómo se evita duplicarlos
17. comportamiento al bajar y volver a subir de umbral
18. ranking
19. Realtime
20. RLS
21. Storage
22. tratamiento de timezone
23. tests y resultados
24. tests de concurrencia
25. validación contra Supabase real
26. pasos manuales pendientes
27. limitaciones conocidas

No avances a chat ni notificaciones hasta que revise esta fase.