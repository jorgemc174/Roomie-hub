Continúa el proyecto RoomieHub existente.

Las Fases 1, 1.1, 2, 2.1 y 3 están terminadas.

La migración más reciente es:

`202609150005_expenses.sql`

Antes de modificar nada:

1. Lee `AGENTS.md`.
2. Lee íntegramente `docs/product-requirements.md`.
3. Lee `docs/phase-3-delivery.md`.
4. Revisa todas las migraciones 001–005.
5. Revisa el modelo actual de homes, miembros, tareas, gastos y timezone.
6. No modifiques migraciones anteriores.
7. Implementa únicamente esta FASE 4.
8. Crea una nueva migración aditiva posterior a 005.
9. Mantén compatibilidad con datos ya existentes.
10. Respeta RLS, Realtime, timezone, i18n, modo oscuro y responsive existentes.
11. No avances a puntos, negativos, castigos, ranking, chat o notificaciones.

# FASE 4 — RECURSOS, RESERVAS, ACTIVIDADES Y CALENDARIO UNIFICADO

El objetivo es añadir la organización temporal y social del piso mediante:

- recursos configurables
- reservas de recursos
- prevención de solapamientos
- actividades
- participantes en actividades
- calendario unificado
- filtros
- integración con tareas y gastos recurrentes
- Realtime
- RLS
- timezone del piso

--------------------------------------------------
1. RECURSOS DEL PISO
--------------------------------------------------

Cada piso puede tener recursos reservables.

Ejemplos:

- Baño
- Cocina
- Lavadora
- Secadora
- Salón
- Televisión
- Plaza de garaje
- Aspiradora
- Otro recurso compartido

Los recursos NO deben estar hardcodeados.

Cada piso puede:

- crear recursos
- editar nombre
- opcionalmente añadir descripción
- activar/desactivar recurso
- eliminarlo lógicamente si es necesario

Todos los miembros activos tienen los mismos permisos.

Crear algunos recursos iniciales genéricos si tiene sentido al crear/configurar un piso.

No crear recursos automáticamente de forma que molesten a pisos existentes.

--------------------------------------------------
2. MODELO DE RECURSOS
--------------------------------------------------

Crear un modelo similar a:

resources

Campos aproximados:

- id UUID
- home_id
- name
- description opcional
- active
- created_by
- created_at
- updated_at

Puede añadirse información adicional si aporta valor real.

No sobrediseñar.

--------------------------------------------------
3. RESERVAS
--------------------------------------------------

Permitir reservar un recurso.

Una reserva debe contener como mínimo:

- id
- home_id
- resource_id
- usuario creador
- usuario/responsable
- título opcional si tiene sentido
- start_at
- end_at
- created_at
- updated_at
- estado si se necesita para cancelación/historial

Las reservas son de una sola ocasión.

NO implementar recurrencias de reservas en esta fase.

--------------------------------------------------
4. TIMEZONE DE RESERVAS
--------------------------------------------------

Usar la timezone configurable de `homes.timezone`.

La UI debe trabajar con fecha/hora local del piso.

Guardar timestamps absolutos como `timestamptz`.

Ejemplo:

Piso:
Europe/Madrid

Usuario elige:

16/09/2026
18:00 → 19:00

La UI debe interpretar correctamente ese horario en Europe/Madrid.

No depender de la timezone del dispositivo como fuente de verdad del piso.

--------------------------------------------------
5. VALIDACIÓN TEMPORAL
--------------------------------------------------

No permitir:

- end_at <= start_at
- reservas con fechas inválidas
- recurso inexistente
- recurso de otro piso
- reservar un recurso desactivado
- cross-home access

Decidir razonablemente si se permiten reservas en el pasado.

Preferiblemente:

- nuevas reservas no pueden comenzar claramente en el pasado
- historial existente se conserva

Documentar la decisión.

--------------------------------------------------
6. SOLAPAMIENTOS
--------------------------------------------------

REGLA FUNDAMENTAL:

El MISMO recurso NO puede tener dos reservas que se solapen.

Ejemplo:

Lavadora:

Ana:
18:00–19:00

Jorge intenta:
18:30–19:30

Debe rechazarse.

Pero:

Lavadora:
18:00–19:00

Cocina:
18:30–19:30

Sí se permite.

--------------------------------------------------
7. LÍMITES DE SOLAPAMIENTO
--------------------------------------------------

Tratar los intervalos como:

[start_at, end_at)

Por tanto:

Reserva A:
18:00–19:00

Reserva B:
19:00–20:00

NO se solapan.

Debe permitirse.

Documentar y testear esta semántica.

--------------------------------------------------
8. PROTECCIÓN EN BASE DE DATOS
--------------------------------------------------

La prevención de solapamientos NO puede depender únicamente del frontend.

Debe estar protegida en PostgreSQL.

Preferir una solución robusta como:

- exclusion constraint con rango temporal
- constraint equivalente
- transacción con locking correcto

siempre considerando:

- resource_id
- reservas activas
- concurrencia

Dos usuarios intentando reservar el mismo recurso al mismo tiempo no deben poder crear reservas solapadas.

--------------------------------------------------
9. EDITAR RESERVA
--------------------------------------------------

Permitir editar:

- recurso
- fecha
- hora inicio
- hora fin
- título si existe

Debe volver a validarse el solapamiento.

La operación debe ser atómica.

No permitir que una edición provoque conflicto.

--------------------------------------------------
10. CANCELAR RESERVA
--------------------------------------------------

Permitir cancelar una reserva.

Preferir conservar historial si encaja con la arquitectura actual.

Una reserva cancelada:

- no bloquea nuevos horarios
- puede conservarse para historial
- no aparece como activa por defecto

No es necesario crear un historial complejo de auditoría.

--------------------------------------------------
11. PERMISOS DE RESERVAS
--------------------------------------------------

Siguiendo la regla general del proyecto:

todos los miembros activos del piso tienen permisos equivalentes.

Pueden:

- crear
- editar
- cancelar reservas

No introducir roles de administrador.

Usuarios externos:

ningún acceso.

Exmiembros:

sin acceso operativo a reservas nuevas.

--------------------------------------------------
12. UI DE RECURSOS
--------------------------------------------------

Dentro de Organización o donde mejor encaje con la navegación existente:

Crear sección:

Reservas

Debe permitir:

- ver recursos disponibles
- crear recurso
- editar recurso
- desactivar recurso
- ver próximas reservas

Mobile-first.

--------------------------------------------------
13. CREAR RESERVA — UX
--------------------------------------------------

Formulario cómodo:

- recurso
- fecha
- hora inicio
- hora fin
- título opcional

Mostrar claramente:

- timezone del piso
- disponibilidad
- posibles conflictos

Si existe conflicto:

mostrar un mensaje útil como:

"Este recurso ya está reservado de 18:00 a 19:00."

No limitarse a mostrar un error PostgreSQL crudo.

--------------------------------------------------
14. VISTA DE RESERVAS
--------------------------------------------------

Crear al menos:

- próximas reservas
- reservas del día
- opción de ver por recurso

No es necesario hacer todavía un sistema visual extremadamente complejo estilo Google Calendar.

El calendario unificado se implementa más adelante en esta misma fase.

--------------------------------------------------
15. ACTIVIDADES
--------------------------------------------------

Implementar actividades sociales del piso.

Una actividad puede representar:

- cena
- cine
- salir
- partido
- viaje
- fiesta
- cocinar juntos
- cualquier plan dentro o fuera del piso

--------------------------------------------------
16. MODELO DE ACTIVIDADES
--------------------------------------------------

Crear modelo similar a:

activities

Campos mínimos:

- id UUID
- home_id
- title
- description opcional
- starts_at
- ends_at opcional
- location opcional
- created_by
- created_at
- updated_at
- active/cancelled si procede

No limitar las actividades a categorías cerradas.

--------------------------------------------------
17. FECHA Y HORA DE ACTIVIDAD
--------------------------------------------------

Usar timezone del piso.

Debe ser posible crear:

- actividad con fecha/hora
- actividad con hora de finalización opcional

Ejemplo:

"Cena italiana"
20/09/2026
21:00

La hora debe interpretarse según `homes.timezone`.

--------------------------------------------------
18. UBICACIÓN
--------------------------------------------------

Permitir texto libre.

Ejemplos:

- En casa
- Cine ABC
- Playa
- Calle X
- Valencia

NO integrar mapas externos ni APIs en esta fase.

--------------------------------------------------
19. PARTICIPANTES EN ACTIVIDADES
--------------------------------------------------

Los miembros pueden:

- apuntarse
- desapuntarse

Debe mostrarse quién está apuntado.

Ejemplo:

Cena italiana

Apuntados:
- Ana
- Jorge
- Pablo

No limitar número de participantes.

--------------------------------------------------
20. CREADOR Y PARTICIPACIÓN
--------------------------------------------------

Decidir comportamiento coherente:

Preferencia:

al crear una actividad, el creador queda apuntado automáticamente.

Debe poder desapuntarse después si quiere.

Documentar esta decisión.

--------------------------------------------------
21. EDICIÓN DE ACTIVIDADES
--------------------------------------------------

Todos los miembros activos pueden editar actividades.

Permitir:

- título
- descripción
- fecha/hora
- ubicación

Mantener participantes al editar.

--------------------------------------------------
22. CANCELACIÓN DE ACTIVIDAD
--------------------------------------------------

Permitir cancelar/eliminar una actividad.

Preferir soft delete/cancelación si es coherente con el resto del proyecto.

Una actividad cancelada:

- no debe aparecer entre próximas actividades normales
- no debe bloquear nada
- puede conservarse históricamente

--------------------------------------------------
23. REALTIME ACTIVIDADES
--------------------------------------------------

Si un miembro:

- crea actividad
- edita
- cancela
- se apunta
- se desapunta

los demás miembros del piso deben verlo sin recargar.

--------------------------------------------------
24. UI DE ACTIVIDADES
--------------------------------------------------

Crear una vista sencilla dentro de Convivencia.

Debe mostrar:

- próximas actividades
- fecha/hora
- ubicación
- miembros apuntados
- botón Apuntarme / Salirme
- crear actividad

Mantener diseño limpio.

--------------------------------------------------
25. CALENDARIO UNIFICADO
--------------------------------------------------

Implementar el calendario central de RoomieHub.

Debe reunir información de varios módulos existentes.

Fuentes:

1. tareas
2. reservas
3. actividades
4. gastos recurrentes relevantes

NO duplicar físicamente todos esos datos en una tabla de eventos salvo que exista una razón arquitectónica fuerte.

Preferir una capa de consulta/normalización.

--------------------------------------------------
26. TAREAS EN CALENDARIO
--------------------------------------------------

Mostrar:

- tareas con deadline
- tareas correspondientes al periodo/día si la arquitectura permite hacerlo de forma clara

Como mínimo:

toda tarea con deadline debe aparecer.

Usar:

- título
- responsable
- fecha límite
- estado completada/pendiente/atrasada

No cambiar la lógica de tareas ya terminada en Fase 2.1.

--------------------------------------------------
27. RESERVAS EN CALENDARIO
--------------------------------------------------

Mostrar:

- recurso
- hora inicio
- hora fin
- responsable

Ejemplo:

18:00–19:00
Lavadora
Jorge

--------------------------------------------------
28. ACTIVIDADES EN CALENDARIO
--------------------------------------------------

Mostrar:

- título
- hora
- ubicación
- participantes si es razonable

--------------------------------------------------
29. GASTOS RECURRENTES EN CALENDARIO
--------------------------------------------------

Integrar únicamente fechas relevantes.

Ejemplos:

- próximo alquiler
- electricidad pendiente
- recurrente variable esperando importe

No mostrar cada gasto histórico como evento.

No modificar la lógica financiera de Fase 3.

--------------------------------------------------
30. NORMALIZACIÓN DE EVENTOS
--------------------------------------------------

Crear una representación frontend/backend común para eventos de calendario.

Por ejemplo:

CalendarEvent {
  id
  sourceType
  sourceId
  title
  startsAt
  endsAt
  allDay
  status
  metadata
}

No es obligatorio usar exactamente esta interfaz.

El objetivo es que diferentes módulos puedan representarse de forma homogénea.

--------------------------------------------------
31. NO DUPLICAR FUENTE DE VERDAD
--------------------------------------------------

Una reserva sigue teniendo como fuente de verdad:

reservations

Una actividad:

activities

Una tarea:

chore_instances

Un recurrente financiero:

modelo existente de recurrentes

El calendario NO debe convertirse en una segunda fuente de verdad.

--------------------------------------------------
32. VISTAS DEL CALENDARIO
--------------------------------------------------

Implementar una interfaz razonable para MVP.

Como mínimo:

- vista mensual
- listado/agenda del día seleccionado

Si es sencillo con la librería elegida:

- vista semanal

Pero no sacrificar estabilidad por una UI compleja.

Mobile-first.

En móvil una agenda clara es más importante que copiar Google Calendar.

--------------------------------------------------
33. FILTROS
--------------------------------------------------

Permitir filtrar por tipo:

- Tareas
- Reservas
- Actividades
- Gastos

Debe ser posible activar/desactivar categorías visualmente.

Los filtros son de presentación.

No borrar datos.

--------------------------------------------------
34. FILTRO PERSONAL
--------------------------------------------------

Si resulta natural con la arquitectura, añadir:

"Solo lo mío"

Debe poder mostrar por ejemplo:

- mis tareas
- mis reservas
- actividades donde estoy apuntado

Para gastos recurrentes, mantener criterio razonable.

Si añade demasiada complejidad, documentarlo como mejora futura.

--------------------------------------------------
35. NAVEGACIÓN DESDE CALENDARIO
--------------------------------------------------

Al pulsar un evento:

Tarea → detalle/contexto de tarea

Reserva → detalle/edición de reserva

Actividad → detalle de actividad

Gasto recurrente → sección financiera correspondiente

No crear copias independientes editables dentro del calendario.

--------------------------------------------------
36. COLORES
--------------------------------------------------

Diferenciar tipos de evento visualmente.

Usar el sistema visual actual.

No hardcodear colores que rompan:

- modo claro
- modo oscuro
- accesibilidad

--------------------------------------------------
37. TIMEZONE DEL CALENDARIO
--------------------------------------------------

TODO el calendario debe utilizar la timezone del piso.

Especial atención a:

- cambio de día cerca de medianoche
- DST
- Europe/Madrid
- UTC
- Atlantic/Canary
- zonas con diferencia grande respecto al navegador

No usar simplemente:

new Date().toLocaleDateString()

sin especificar correctamente el contexto temporal cuando pueda provocar errores.

--------------------------------------------------
38. CAMBIO DE TIMEZONE
--------------------------------------------------

Si un piso cambia su timezone:

los timestamps absolutos existentes deben seguir representando el mismo instante.

La UI debe mostrarlos en la nueva timezone.

No reinterpretar silenciosamente timestamps antiguos como si fueran hora local nueva.

Las fechas lógicas de tareas/recurrentes deben respetar las decisiones ya implementadas en fases anteriores.

--------------------------------------------------
39. RLS DE RECURSOS
--------------------------------------------------

Activar RLS.

Miembro activo del piso:

puede leer/crear/editar recursos.

Usuario externo:

ningún acceso.

Exmiembro:

sin acceso operativo.

--------------------------------------------------
40. RLS DE RESERVAS
--------------------------------------------------

Miembro activo:

puede consultar y gestionar reservas del piso.

Usuario externo:

ningún acceso.

Nunca confiar en `home_id` enviado por el cliente sin validar membership.

--------------------------------------------------
41. RLS DE ACTIVIDADES
--------------------------------------------------

Miembro activo:

puede:

- ver actividades
- crear
- editar
- cancelar
- apuntarse
- desapuntarse

Usuarios externos:

ningún acceso.

--------------------------------------------------
42. RPCs / TRANSACCIONES
--------------------------------------------------

Usar RPCs donde una operación requiera consistencia.

Especialmente:

- crear reserva
- editar reserva
- cancelar
- apuntarse a actividad si aporta atomicidad

No crear RPCs innecesarias para CRUD trivial si RLS y constraints ya bastan.

--------------------------------------------------
43. CONCURRENCIA EN RESERVAS
--------------------------------------------------

Caso crítico:

Ana y Jorge intentan reservar la lavadora 18:00–19:00 prácticamente a la vez.

Solo UNO puede conseguirlo.

Debe estar garantizado por backend/base de datos.

No usar patrón:

1. SELECT disponibilidad
2. frontend cree que está libre
3. INSERT sin protección

porque existe race condition.

--------------------------------------------------
44. CONCURRENCIA EN ACTIVIDADES
--------------------------------------------------

Dos clics rápidos en "Apuntarme" no deben crear duplicados.

Crear constraint único:

activity_id + user_id

o equivalente.

Apuntarse/desapuntarse debe ser idempotente cuando sea razonable.

--------------------------------------------------
45. REALTIME
--------------------------------------------------

Añadir Realtime para:

- resources
- reservations
- activities
- activity participants

y lo necesario para calendario.

No crear suscripciones globales.

Filtrar por home_id siempre que la arquitectura lo permita.

Limpiar subscriptions al:

- cambiar de piso
- desmontar componente
- cerrar sesión

Evitar duplicados de eventos provocados por optimistic UI + Realtime.

--------------------------------------------------
46. ESTADOS DE CARGA
--------------------------------------------------

Todas las vistas nuevas deben contemplar:

- loading
- empty
- error
- success

Ejemplos:

"No hay reservas próximas."

"No hay actividades todavía."

"No hay eventos este día."

--------------------------------------------------
47. RESPONSIVE
--------------------------------------------------

Probar especialmente:

- 360px
- móvil normal
- tablet
- escritorio

Calendario mensual debe seguir siendo usable en móvil.

Si una cuadrícula mensual resulta demasiado estrecha:

mostrar información resumida y agenda detallada debajo.

--------------------------------------------------
48. ACCESIBILIDAD
--------------------------------------------------

Como mínimo:

- formularios con labels
- botones accesibles
- foco de teclado
- diálogos manejables con teclado
- contraste suficiente
- no depender únicamente del color para diferenciar eventos

--------------------------------------------------
49. I18N
--------------------------------------------------

Añadir todos los strings nuevos en:

- español
- inglés

No dejar textos visibles hardcodeados en un único idioma.

--------------------------------------------------
50. TESTS DE RECURSOS
--------------------------------------------------

Cubrir:

- crear
- editar
- desactivar
- aislamiento entre pisos
- recurso desactivado no reservable

--------------------------------------------------
51. TESTS DE RESERVAS
--------------------------------------------------

Cubrir como mínimo:

Reserva existente:
10:00–11:00

Rechazar:

- 09:30–10:30
- 10:00–11:00
- 10:30–11:30
- 10:15–10:45
- 09:00–12:00

Permitir:

- 09:00–10:00
- 11:00–12:00

También:

- otro recurso misma hora permitido
- end <= start rechazado
- cross-home rechazado
- recurso desactivado rechazado

--------------------------------------------------
52. TEST DE CONCURRENCIA DE RESERVA
--------------------------------------------------

Simular dos creaciones concurrentes solapadas.

Resultado:

solo una debe persistir.

Este test es importante.

--------------------------------------------------
53. TESTS DE ACTIVIDADES
--------------------------------------------------

Cubrir:

- crear actividad
- editar
- cancelar
- creador apuntado automáticamente
- apuntarse
- desapuntarse
- evitar duplicado
- exmiembro no se puede apuntar
- usuario externo no accede

--------------------------------------------------
54. TESTS DE CALENDARIO
--------------------------------------------------

Crear escenario con:

- tarea con deadline
- reserva
- actividad
- recurrente financiero

Comprobar que aparecen normalizados correctamente.

Testear filtros.

--------------------------------------------------
55. TESTS DE TIMEZONE
--------------------------------------------------

Cubrir al menos:

Europe/Madrid
UTC

Y un caso cercano a medianoche.

Idealmente añadir:

Atlantic/Canary

Verificar que:

- el día mostrado es correcto
- la hora mostrada es correcta
- no se desplaza evento al día incorrecto

--------------------------------------------------
56. TESTS RLS
--------------------------------------------------

Con:

Piso A
Piso B

Usuario A no puede:

- leer recursos B
- leer reservas B
- crear reservas B
- leer actividades B
- apuntarse a actividades B

Comprobar RPCs también.

--------------------------------------------------
57. TESTS E2E
--------------------------------------------------

Añadir flujos E2E mínimos:

FLUJO 1

- entrar al piso
- crear Lavadora
- reservar mañana 18:00–19:00
- ver reserva
- editarla
- cancelarla

FLUJO 2

- crear actividad "Cena"
- usuario A apuntado
- usuario B entra
- se apunta
- ambos aparecen

FLUJO 3

- calendario
- visualizar tarea
- reserva
- actividad
- recurrente
- filtrar tipos

--------------------------------------------------
58. VALIDACIÓN SUPABASE REAL
--------------------------------------------------

Si tienes acceso al proyecto real:

1. comprobar esquema actual
2. aplicar migración nueva
3. comprobar RLS
4. comprobar funciones/RPC
5. probar dos cuentas reales

Escenario:

Ana y Jorge están en el mismo piso.

- Ana crea Lavadora.
- Ana reserva 18:00–19:00.
- Jorge intenta 18:30–19:30 → rechazado.
- Jorge reserva 19:00–20:00 → aceptado.
- ambos ven cambios por Realtime.
- Ana crea actividad.
- Jorge se apunta.
- ambos la ven en calendario.

Crear además otro usuario en otro piso y verificar aislamiento.

Eliminar fixtures de prueba cuando sea posible.

--------------------------------------------------
59. INTEGRACIÓN CON LO EXISTENTE
--------------------------------------------------

NO romper:

- autenticación
- perfiles
- pisos
- invitaciones
- tareas
- ausencias
- compras
- gastos
- balances
- recurrentes
- timezone
- salida del piso

Ejecutar regresión.

--------------------------------------------------
60. NO IMPLEMENTAR TODAVÍA
--------------------------------------------------

No implementar en esta fase:

- positivos
- negativos
- castigos
- ranking
- chat
- mensajes
- reacciones
- notificaciones in-app
- email notifications
- push
- OCR
- mapas
- geolocalización
- calendarios externos Google/Apple
- reservas recurrentes

No iniciar Fase 5.

--------------------------------------------------
61. MIGRACIÓN
--------------------------------------------------

Crear una nueva migración posterior a:

`202609150005_expenses.sql`

Nombre esperado similar a:

`202609150006_calendar_reservations_activities.sql`

El nombre exacto puede adaptarse al timestamp del proyecto.

NO modificar:

001
002
003
004
005

Debe ser aditiva.

--------------------------------------------------
62. POSIBLES TABLAS
--------------------------------------------------

El diseño puede usar entidades similares a:

resources
reservations
activities
activity_members

No estás obligado a usar estos nombres.

No crear una tabla `calendar_events` como fuente de verdad duplicada salvo razón técnica muy justificada.

--------------------------------------------------
63. DOCUMENTACIÓN
--------------------------------------------------

Actualizar:

- README
- AGENTS.md
- docs/architecture.md
- docs/setup.md
- docs/validation.md

Crear si encaja:

`docs/phase-4-delivery.md`

Documentar:

- recursos
- reservas
- semántica [start,end)
- protección de solapamientos
- concurrencia
- actividades
- participantes
- normalización del calendario
- timezone
- filtros
- RLS
- Realtime
- limitaciones

--------------------------------------------------
64. CALIDAD FINAL
--------------------------------------------------

Ejecutar:

- lint
- typecheck
- unit tests
- test:db
- E2E
- build

No considerar la fase terminada si rompe tests anteriores.

Mantener todos los tests existentes.

--------------------------------------------------
AL TERMINAR
--------------------------------------------------

NO empieces Fase 5.

Entrégame un resumen exacto con:

1. migración creada
2. tablas creadas
3. constraints añadidas
4. RPC/functions creadas
5. cómo se evita el solapamiento
6. cómo se maneja la concurrencia
7. comportamiento de edición/cancelación
8. funcionamiento de actividades
9. funcionamiento de participantes
10. cómo se construye el calendario unificado
11. qué fuentes aparecen en calendario
12. filtros disponibles
13. tratamiento de timezone
14. Realtime
15. RLS
16. tests ejecutados y resultados
17. tests de concurrencia realizados
18. validación contra Supabase real
19. pasos manuales pendientes
20. limitaciones conocidas

No avances a puntos, castigos, ranking, chat ni notificaciones hasta que revise esta fase.