Continúa el proyecto RoomieHub existente.

Las Fases 1, 1.1, 2, 2.1, 3, 4, 5 y 5.1 están terminadas.

Las últimas migraciones deben incluir:

`202609150007_community_ratings_punishments.sql`
`202609150008_community_membership_epoch.sql`
y la migración aditiva de Fase 5.1 posterior a 008.

Antes de hacer nada:

1. Lee `AGENTS.md`.
2. Lee íntegramente `docs/product-requirements.md`.
3. Lee toda la documentación de entrega de fases anteriores.
4. Revisa TODAS las migraciones existentes.
5. Comprueba el estado real de:
   - Auth
   - homes/home_members
   - profiles
   - tasks/absences
   - shopping
   - expenses/settlements/recurrent expenses
   - reservations
   - activities
   - calendar
   - ratings
   - punishments
   - Realtime
   - Storage
   - timezone
6. Comprueba que la corrección de Fase 5.1 está presente. Si no está aplicada, NO implementes encima silenciosamente: indícalo.
7. NO modifiques migraciones anteriores.
8. Toda modificación de esquema debe ser mediante nuevas migraciones aditivas.
9. Mantén compatibilidad con datos existentes.
10. Esta es la FASE 6 FINAL FUNCIONAL.

# FASE 6 — CHAT, NOTIFICACIONES, PWA Y HARDENING FINAL

El objetivo es completar RoomieHub como producto funcional.

Esta fase debe implementar:

- chat general por piso
- mensajes en tiempo real
- imágenes y archivos
- enlaces
- respuestas
- reacciones
- notificaciones in-app
- preferencias por usuario
- recordatorios
- notificaciones email
- push web/PWA
- PWA instalable
- comportamiento offline razonable
- jobs/scheduler necesarios
- revisión global de seguridad
- rendimiento
- accesibilidad
- errores
- observabilidad básica
- preparación de producción
- regresión completa de toda la aplicación

No añadir funcionalidades nuevas fuera de estos objetivos.

==================================================
1. CHAT GENERAL POR PISO
==================================================

Cada piso debe tener UN chat general.

No implementar:

- chats privados
- varios canales
- grupos internos
- llamadas
- audio
- videollamadas

Conceptualmente:

1 home = 1 chat general.

==================================================
2. MODELO DE MENSAJES
==================================================

Crear modelo robusto para mensajes.

Entidad aproximada:

chat_messages

Campos posibles:

- id UUID
- home_id
- author_user_id
- body/text
- reply_to_message_id opcional
- created_at
- edited_at opcional
- deleted_at opcional
- client_id/idempotency_key
- version si es necesario

Mantener:

- integridad
- historial
- Realtime
- RLS
- paginación
- edición segura
- soft delete si procede

==================================================
3. MENSAJES DE TEXTO
==================================================

Permitir:

- texto
- emojis Unicode
- saltos de línea
- enlaces

Limitar tamaño razonablemente.

No permitir HTML arbitrario.

El contenido debe tratarse como texto seguro.

Evitar XSS.

Si se convierten URLs en enlaces:

- escapar contenido
- validar protocolos
- permitir como mínimo http/https

==================================================
4. ENVÍO
==================================================

Enviar mensaje debe ser:

- rápido
- idempotente
- resistente a doble click
- compatible con Realtime

Usar un client-generated UUID o idempotency key si resulta apropiado.

No mostrar dos mensajes por:

optimistic UI + evento Realtime.

==================================================
5. EDICIÓN
==================================================

Permitir editar mensajes propios.

No permitir que un miembro edite el texto escrito por otro.

La regla general de permisos iguales del piso NO implica falsificar la autoría de mensajes.

Mostrar de alguna forma discreta:

"editado"

Conservar lo necesario para auditoría/integridad si la arquitectura lo permite.

==================================================
6. ELIMINACIÓN
==================================================

Permitir al autor eliminar su mensaje.

Como la aplicación mantiene permisos iguales en gestión del piso, decidir y documentar si otros miembros pueden retirar contenido visible.

Preferencia:

- autor puede eliminar su mensaje
- otros miembros activos pueden ocultarlo/moderarlo si los requisitos de permisos iguales lo exigen
- nunca cambiar quién fue el autor

Preferir soft delete.

Un mensaje eliminado puede mostrarse como:

"Mensaje eliminado"

si tiene respuestas.

==================================================
7. RESPUESTAS
==================================================

Permitir responder a un mensaje.

Mostrar:

- pequeño preview del mensaje original
- nombre del autor original si sigue siendo visible
- fragmento del texto

Una respuesta NO debe copiar el contenido como nueva fuente de verdad.

Usar referencia al mensaje original.

Si el original fue eliminado:

mostrar:

"Mensaje eliminado"

sin romper la conversación.

==================================================
8. REACCIONES
==================================================

Permitir reacciones emoji.

Modelo aproximado:

message_reactions

- message_id
- user_id
- emoji
- created_at

Una persona puede tener una reacción concreta una sola vez por mensaje.

Constraint único equivalente:

message_id + user_id + emoji

Añadir/quitar reacción debe ser idempotente.

==================================================
9. ARCHIVOS DEL CHAT
==================================================

Permitir adjuntar:

- imágenes
- PDF
- documentos razonables

No permitir:

- ejecutables
- scripts
- HTML activo
- archivos potencialmente peligrosos sin control

Definir:

- whitelist MIME
- tamaño máximo razonable
- validación real del archivo cuando sea posible

Usar Storage privado.

==================================================
10. IMÁGENES
==================================================

Para imágenes:

- JPEG
- PNG
- WebP

Procesar/sanear de forma coherente con la seguridad ya empleada en valoraciones si existe infraestructura reutilizable.

Eliminar metadata sensible cuando sea razonable.

Crear miniaturas si aporta rendimiento y no complica excesivamente.

==================================================
11. PRIVACIDAD DE ARCHIVOS
==================================================

Solo miembros activos del piso pueden descargar archivos actuales del chat.

Usuario externo:

NO acceso.

No utilizar buckets públicos.

Las rutas no deben revelar:

- email
- nombre real
- metadata sensible

==================================================
12. HISTORIAL Y EXMIEMBROS
==================================================

Si alguien abandona el piso:

sus mensajes antiguos deben permanecer.

Mostrar nombre/avatar mediante la estrategia histórica/snapshot existente.

No conceder acceso actual al perfil por mantener un mensaje antiguo.

El exmiembro ya no puede:

- leer mensajes nuevos
- enviar
- reaccionar
- subir archivos

==================================================
13. PAGINACIÓN DEL CHAT
==================================================

NO cargar todo el historial de una vez.

Implementar paginación basada preferentemente en cursor.

Ejemplo:

cargar últimos 30–50 mensajes.

Al subir:

cargar anteriores.

Evitar offset profundo si puede degradarse.

==================================================
14. ORDEN DEL CHAT
==================================================

Orden determinista.

Preferencia:

created_at + id

o mecanismo equivalente.

Evitar saltos o duplicados con mensajes creados simultáneamente.

==================================================
15. SCROLL
==================================================

UX esperada:

- al entrar, mostrar mensajes recientes
- si el usuario está abajo, nuevos mensajes pueden mantener scroll
- si está leyendo mensajes antiguos, NO forzar scroll hacia abajo
- mostrar indicador de mensajes nuevos

==================================================
16. REALTIME CHAT
==================================================

Usar Supabase Realtime.

Sincronizar:

- mensajes nuevos
- ediciones
- eliminaciones
- reacciones

Filtrar por home_id cuando sea posible.

No crear una subscription global.

Limpiar subscriptions al:

- cambiar de piso
- cerrar sesión
- desmontar vista

==================================================
17. PRESENCIA / TYPING
==================================================

NO es obligatorio implementar presencia ni "está escribiendo".

Si es extremadamente sencillo y robusto, puede añadirse typing efímero mediante Presence/Broadcast.

Pero:

NO sacrificar estabilidad por ello.

Documentarlo como opcional.

==================================================
18. UI DEL CHAT
==================================================

Crear UI mobile-first.

Debe tener:

- lista de mensajes
- fecha/hora
- autor/avatar
- input
- enviar
- adjuntar
- responder
- reacciones
- edición/eliminación cuando corresponda

En móvil debe sentirse como un chat real.

No imitar visualmente ninguna aplicación concreta.

==================================================
19. NOTIFICACIONES — MODELO GENERAL
==================================================

Crear un sistema común de notificaciones.

No implementar cada módulo con lógica aislada.

Entidad aproximada:

notifications

Campos posibles:

- id
- user_id
- home_id
- type
- title
- body
- target_url
- source_type
- source_id
- created_at
- read_at
- dedupe_key
- metadata segura

No es obligatorio usar exactamente estos campos.

==================================================
20. NOTIFICACIONES IN-APP
==================================================

Implementar bandeja/centro de notificaciones.

Debe permitir:

- ver recientes
- distinguir leídas/no leídas
- marcar una como leída
- marcar todas como leídas
- navegar al contenido relacionado

Mostrar contador de no leídas en la navegación si encaja.

==================================================
21. TIPOS DE NOTIFICACIÓN
==================================================

Diseñar catálogo extensible.

Como mínimo estudiar eventos de:

TAREAS:
- tarea próxima
- deadline
- reasignación
- tarea atrasada si procede

RESERVAS:
- reserva próxima

ACTIVIDADES:
- actividad próxima
- cambios relevantes

GASTOS:
- gasto añadido que afecta al usuario
- recurrente variable pendiente
- liquidación relevante

CONVIVENCIA:
- positivo/negativo recibido
- castigo generado
- castigo actualizado

CHAT:
- mensaje nuevo cuando el usuario no es el propio autor

No es obligatorio activar absolutamente todos por defecto.

Diseñar preferencias sensatas.

==================================================
22. ANONIMATO Y NOTIFICACIONES
==================================================

CRÍTICO:

Una notificación sobre una valoración anónima NUNCA debe revelar el autor.

No revelar autor mediante:

- title
- body
- metadata
- source
- payload push
- email
- logs cliente
- target URL
- Realtime

Reutilizar la política de privacidad de Fase 5.

==================================================
23. PREFERENCIAS DE NOTIFICACIONES
==================================================

Cada usuario debe poder configurar sus preferencias.

Preferencias por:

- tipo/categoría
- canal

Canales:

- in-app
- email
- push

Ejemplo:

Tareas:
in-app ✅
email ❌
push ✅

Chat:
in-app ✅
email ❌
push ❌

==================================================
24. DEFAULTS
==================================================

Crear valores por defecto razonables.

In-app:

activado para eventos importantes.

Push:

opt-in según requisitos del navegador.

Email:

evitar spam.

No mandar email por cada mensaje de chat por defecto.

==================================================
25. RECORDATORIOS
==================================================

Permitir configurar recordatorios.

Opciones iniciales:

- 15 minutos antes
- 1 hora antes
- 1 día antes

Pueden aplicarse donde tenga sentido:

- deadline de tarea
- reserva
- actividad

No generar opciones absurdas para eventos sin fecha/hora.

==================================================
26. VARIOS RECORDATORIOS
==================================================

Diseñar para permitir uno o varios offsets si es razonable.

Si la UI del MVP se simplifica a uno por categoría, documentarlo.

Nunca generar el mismo recordatorio dos veces.

==================================================
27. DEDUPLICACIÓN
==================================================

Toda notificación derivada de un evento debe poder deduplicarse.

Ejemplo:

reservation_id + user_id + reminder_offset

o equivalente.

Un job repetido 20 veces no debe producir 20 avisos.

Usar constraints/dedupe_key.

==================================================
28. JOBS / SCHEDULER
==================================================

Esta fase SÍ puede introducir scheduler porque los recordatorios deben funcionar con la app cerrada.

Inspecciona la infraestructura existente y el Supabase real.

Implementa la opción más sencilla y segura compatible con el proyecto.

Opciones posibles:

- Supabase Cron / pg_cron
- Edge Function programada
- mecanismo equivalente de producción ya disponible

NO inventar un cron que solo funcione con `npm run dev`.

==================================================
29. JOB IDEMPOTENTE
==================================================

El proceso programado debe:

1. buscar eventos próximos
2. determinar destinatarios
3. respetar preferencias
4. crear notificaciones pendientes
5. deduplicar
6. enviar canales externos
7. registrar resultado

Debe ser idempotente.

==================================================
30. FRECUENCIA DEL JOB
==================================================

Elegir frecuencia razonable para recordatorios.

Ejemplo:

cada 5–15 minutos si la infraestructura lo permite.

No se necesita precisión de segundos.

Documentar la tolerancia temporal.

==================================================
31. EMAIL
==================================================

Implementar arquitectura para notificaciones por email.

NO utilizar claves secretas en cliente.

Cualquier API de email debe ejecutarse exclusivamente en entorno servidor/Edge Function.

Si el proyecto ya tiene proveedor configurado:

integrarlo.

Si NO existe proveedor/credenciales:

- implementar adapter/infraestructura
- mantener el canal desactivado hasta configurar credenciales
- documentar exactamente qué variable y proveedor hay que configurar

NO inventar claves.

NO confundir Supabase Auth emails con un servicio general de correo transaccional.

==================================================
32. CONTENIDO EMAIL
==================================================

Emails breves.

Ejemplo:

RoomieHub
Tienes una reserva dentro de 1 hora.
Lavadora — 18:00

[Ver en RoomieHub]

No enviar datos sensibles innecesarios.

No incluir autor de valoración anónima.

==================================================
33. PUSH WEB
==================================================

Implementar Web Push para la PWA.

Debe funcionar con:

- permisos del navegador
- service worker
- suscripción push
- backend
- VAPID o mecanismo web-push seguro equivalente

Las claves privadas NUNCA en frontend.

La clave pública puede exponerse cuando técnicamente corresponda.

==================================================
34. PUSH SUBSCRIPTIONS
==================================================

Crear tabla/modelo para subscriptions.

Debe soportar:

- un usuario con varios dispositivos/navegadores
- revocación
- endpoint expirado
- actualización
- eliminación al recibir 404/410 del push service

No asumir 1 usuario = 1 dispositivo.

==================================================
35. PERMISO PUSH
==================================================

NO pedir permiso al abrir la web por primera vez.

Solicitarlo tras acción explícita del usuario:

"Activar notificaciones push"

Explicar brevemente para qué sirven.

Si lo deniega:

la aplicación debe seguir funcionando.

==================================================
36. PUSH PAYLOAD
==================================================

Mantener payload mínimo.

Preferir:

- título
- descripción breve
- URL interna segura
- notification id

No introducir datos privados innecesarios.

==================================================
37. CLICK EN PUSH
==================================================

Al pulsar una notificación:

- abrir RoomieHub
- enfocar ventana existente si procede
- navegar al contenido relevante

Validar las rutas.

No permitir open redirect.

==================================================
38. PWA
==================================================

Terminar la PWA.

Debe incluir:

- manifest válido
- nombre
- short_name
- iconos adecuados
- theme/background
- display standalone
- start_url segura
- service worker
- installabilidad cuando navegador lo soporte

==================================================
39. ICONOS
==================================================

Generar/usar assets apropiados:

- 192x192
- 512x512
- maskable si procede

No usar iconos temporales rotos.

Mantener branding de RoomieHub.

==================================================
40. ACTUALIZACIONES DEL SERVICE WORKER
==================================================

Evitar que una versión antigua quede atrapada indefinidamente.

Implementar estrategia de actualización clara.

Cuando haya nueva versión:

- actualizar de forma segura
- opcionalmente avisar al usuario
- no provocar pérdida de formularios sin guardar

==================================================
41. OFFLINE — ALCANCE
==================================================

NO convertir RoomieHub en una aplicación local-first completa.

Implementar un modo offline razonable.

Objetivo:

si se pierde conexión:

- shell principal puede seguir mostrando una experiencia coherente si está cacheada
- mostrar claramente "Sin conexión"
- no fingir que acciones servidor se completaron

==================================================
42. NO FAKE SUCCESS OFFLINE
==================================================

CRÍTICO:

Si el usuario intenta:

- completar tarea
- crear gasto
- reservar
- mandar mensaje
- valorar
- registrar pago

sin conexión:

NO mostrar éxito si el servidor no confirmó la operación.

Mostrar:

"Sin conexión. Inténtalo cuando recuperes conexión."

No crear una cola offline compleja de escrituras salvo que pueda garantizarse correctamente.

Preferencia:

NO queuear operaciones monetarias ni sensibles.

==================================================
43. CACHÉ
==================================================

Cachear únicamente recursos seguros:

- assets estáticos
- fuentes propias
- shell necesario

Mucho cuidado al cachear:

- datos privados
- respuestas autenticadas
- archivos
- chat
- gastos

No dejar datos de un piso visibles tras cerrar sesión y entrar con otro usuario en el mismo navegador.

==================================================
44. LOGOUT Y CACHÉ
==================================================

Al cerrar sesión:

eliminar cualquier caché local privada que pueda revelar datos del usuario anterior.

Revisar:

- Cache Storage
- IndexedDB si se usa
- localStorage
- service worker
- datos persistidos por librerías

==================================================
45. AUTH + PWA
==================================================

No cachear respuestas de autenticación de forma peligrosa.

Login/logout/recovery/invitaciones deben continuar funcionando.

No interceptar callbacks OAuth de manera que rompa Auth.

==================================================
46. NETWORK STATUS
==================================================

Añadir indicador discreto:

"Sin conexión"

y recuperación al volver online.

No mostrar mensajes agresivos repetidamente.

==================================================
47. NOTIFICACIONES Y REALTIME
==================================================

Distinguir:

Realtime:
usuario tiene la app abierta.

Push/email:
usuario puede no tenerla abierta.

No enviar duplicados visuales absurdos.

Ejemplo:

si llega una notificación in-app por Realtime y también push:

es aceptable que el sistema operativo muestre push según preferencias,
pero la bandeja debe tener un único notification record.

==================================================
48. CHAT Y NOTIFICACIONES
==================================================

Para nuevos mensajes:

NO notificar al propio autor.

No enviar 50 emails si hay 50 mensajes.

Email de chat por defecto:

desactivado.

Push de chat:

configurable.

Si existe agrupación sencilla:

agrupar avisos cercanos del mismo piso.

No es requisito obligatorio si complica demasiado.

==================================================
49. BADGE
==================================================

Si la plataforma lo soporta de forma razonable:

actualizar badge con notificaciones no leídas.

No convertirlo en requisito bloqueante para navegadores sin soporte.

==================================================
50. PREFERENCIAS UI
==================================================

En Ajustes personales añadir sección:

Notificaciones

Mostrar claramente:

- In-app
- Push
- Email
- recordatorios

Permitir activar/desactivar.

Mostrar estado real de push:

- permitido
- bloqueado
- no configurado
- activo

==================================================
51. CENTRO DE NOTIFICACIONES UI
==================================================

Crear acceso desde navegación/header.

Debe funcionar en móvil y escritorio.

Mostrar:

- icono
- texto
- fecha relativa/absoluta
- estado leída
- link destino

Paginación si hay muchas.

==================================================
52. SEGURIDAD RLS — CHAT
==================================================

RLS completa.

Miembro activo:

puede leer chat del piso.

Usuario externo:

NO.

Exmiembro:

NO mensajes posteriores ni acceso operativo.

Las escrituras deben validar autor y home.

No aceptar un `author_user_id` arbitrario proporcionado por frontend.

==================================================
53. SEGURIDAD RLS — NOTIFICACIONES
==================================================

Cada usuario solo puede leer SUS notificaciones.

Aunque dos usuarios estén en el mismo piso:

Ana NO puede consultar directamente la bandeja privada de Jorge.

La creación automática debe realizarse por backend autorizado.

==================================================
54. PUSH SUBSCRIPTIONS SECURITY
==================================================

Un usuario solo puede gestionar sus propias subscriptions.

No exponer endpoints completos a otros miembros.

No publicar tablas sensibles por Realtime innecesariamente.

==================================================
55. SERVER SECRETS
==================================================

Revisar todo el proyecto.

NUNCA enviar al cliente:

- service role
- secret key
- VAPID private key
- email provider API key
- database password

Variables `NEXT_PUBLIC_*` solo para información realmente pública.

==================================================
56. RATE LIMIT / ABUSO
==================================================

Añadir protecciones razonables para:

- spam de mensajes
- spam de reacciones
- spam de notificaciones
- archivos gigantes

No hace falta infraestructura empresarial.

Implementar límites coherentes y documentados.

==================================================
57. CHAT XSS / LINKS
==================================================

Añadir tests para:

- `<script>`
- HTML malicioso
- javascript: URLs
- strings extrañas
- enlaces válidos

No renderizar contenido inseguro.

==================================================
58. ARCHIVOS MALICIOSOS
==================================================

Validar MIME real cuando resulte posible.

No confiar únicamente en extensión.

Nombre mostrado puede conservarse de forma segura,
pero Storage path debe utilizar identificador aleatorio.

Sanear nombres.

==================================================
59. REALTIME GLOBAL
==================================================

Revisar TODAS las subscriptions existentes del proyecto.

Buscar:

- listeners duplicados
- memory leaks
- subscriptions sin cleanup
- filtros incorrectos de home_id
- refetch loops

Corregirlos si se encuentran.

==================================================
60. MANEJO DE ERRORES
==================================================

No mostrar errores SQL crudos al usuario.

Mapear errores conocidos a mensajes claros.

Ejemplos:

Reserva:
"Este horario ya está ocupado."

Chat:
"No se pudo enviar el mensaje."

Notificación:
"No se pudo actualizar tu preferencia."

Mantener detalles técnicos en logging servidor cuando sea apropiado.

==================================================
61. ERROR BOUNDARIES
==================================================

Añadir manejo adecuado de errores de UI donde falte.

Una excepción en un widget no debe inutilizar toda la aplicación si puede evitarse.

==================================================
62. LOADING STATES
==================================================

Revisar todos los módulos.

Evitar:

- botones que parecen no responder
- doble envío
- formularios enviables mientras guardan

Usar loading/disabled de manera consistente.

==================================================
63. EMPTY STATES
==================================================

Revisar:

- tareas
- compras
- gastos
- reservas
- actividades
- convivencia
- chat
- notificaciones

Cada sección debe tener un empty state útil.

==================================================
64. RESPONSIVE FINAL
==================================================

Validar:

- 320/360 px
- móvil moderno
- tablet
- desktop
- pantallas grandes

Especialmente:

- formularios
- tablas
- calendario
- ranking
- chat
- modal/dialog
- centro de notificaciones

No debe existir scroll horizontal accidental general.

==================================================
65. TECLADO Y ACCESSIBILITY
==================================================

Revisión WCAG básica.

Comprobar:

- labels
- landmarks
- focus
- dialogs
- escape
- botones con nombre accesible
- formularios
- contraste
- aria-live para feedback importante cuando corresponda

No depender solo de color.

==================================================
66. REDUCED MOTION
==================================================

Respetar `prefers-reduced-motion` en animaciones importantes.

No introducir animaciones innecesarias.

==================================================
67. PERFORMANCE
==================================================

Revisar:

- bundle
- imágenes
- queries
- N+1
- exceso de realtime
- render loops
- calendario
- chat
- ranking
- balances
- historial

No optimizar prematuramente todo,
pero corregir problemas claros.

==================================================
68. ÍNDICES DE BASE DE DATOS
==================================================

Revisar EXPLAIN/consultas críticas si es posible.

Añadir índices necesarios para:

- últimos mensajes por home
- notifications por user/read/created_at
- reminders pendientes
- reactions
- push subscriptions
- consultas frecuentes de esta fase

No añadir índices redundantes masivamente.

==================================================
69. PAGINACIÓN
==================================================

Asegurar paginación en datos potencialmente grandes:

- chat
- notificaciones
- historial de valoraciones si ya existe
- gastos si actualmente crece ilimitadamente

No es necesario rehacer módulos que ya están correctamente paginados.

==================================================
70. LOGGING
==================================================

Añadir logging servidor mínimo para procesos automáticos:

- job de recordatorios
- email
- push

Nunca loguear:

- tokens
- contraseñas
- secret keys
- contenido sensible innecesario

==================================================
71. DELIVERY DE NOTIFICACIONES
==================================================

Si se necesita, crear entidad de entregas, por ejemplo:

notification_deliveries

para registrar:

- notification_id
- channel
- status
- attempts
- last_error_code seguro
- sent_at
- next_attempt_at

No guardar secretos ni respuestas completas de proveedores.

==================================================
72. REINTENTOS
==================================================

Email/push puede fallar temporalmente.

Implementar reintentos limitados y seguros.

Ejemplo:

pending → sent
pending → retry
→ failed tras N intentos

No reintentar para siempre.

Para push 404/410:

invalidar subscription.

==================================================
73. IN-APP ES FUENTE
==================================================

Preferencia arquitectónica:

crear primero un evento/notificación canónica.

Después los canales:

- push
- email

son entregas de esa notificación según preferencias.

Evitar tres sistemas independientes.

==================================================
74. NOTIFICACIONES YA PASADAS
==================================================

No enviar recordatorio de un evento que:

- fue cancelado
- ya terminó
- tarea ya completada
- reserva cancelada
- actividad cancelada

Revalidar justo antes de entregar.

==================================================
75. CAMBIOS DE EVENTO
==================================================

Si se cambia la hora de:

- reserva
- actividad
- deadline

los recordatorios futuros deben adaptarse.

No enviar el recordatorio correspondiente a la hora antigua.

Usar dedupe/versionado adecuado.

==================================================
76. TIMEZONE
==================================================

Recordatorios basados en la timezone del piso.

Mantener timestamps absolutos.

Especial atención a DST.

No duplicar recordatorios en cambios de hora.

==================================================
77. MULTI-HOME
==================================================

Un usuario puede pertenecer a varios pisos.

Chat, notificaciones y push deben identificar correctamente el piso.

No mezclar:

Piso A
Piso B

Una notificación debe navegar al piso correcto.

==================================================
78. CAMBIO DE PISO DESDE NOTIFICACIÓN
==================================================

Si el usuario pulsa una notificación de otro piso:

la aplicación debe abrir/cambiar al piso relacionado si sigue siendo miembro activo.

Si ya no pertenece:

mostrar estado seguro y no revelar información.

==================================================
79. PWA MULTI-HOME
==================================================

No almacenar un único home_id global de forma insegura que cause mezcla entre pisos.

Revisar navegación/state.

==================================================
80. I18N
==================================================

Todo lo nuevo debe estar en:

- español
- inglés

Incluyendo:

- chat
- notificaciones
- preferencias
- push prompts
- offline
- errores
- estados de instalación

No dejar strings visibles hardcodeados.

==================================================
81. TESTS CHAT
==================================================

Cubrir:

- enviar mensaje
- editar propio
- impedir falsificar autor
- eliminar
- reply
- reply a eliminado
- reacciones
- no duplicar reacción
- paginación
- aislamiento cross-home
- exmiembro sin acceso

==================================================
82. TESTS CHAT REALTIME
==================================================

Dos usuarios autenticados.

A envía.

B lo recibe sin refrescar.

B reacciona.

A ve reacción.

Editar/eliminar también sincronizan.

==================================================
83. TESTS ARCHIVOS CHAT
==================================================

Cubrir:

- imagen válida
- PDF permitido
- archivo prohibido
- MIME falso
- tamaño excesivo
- externo no descarga
- exmiembro no descarga nuevo contenido

==================================================
84. TESTS NOTIFICACIONES
==================================================

Cubrir:

- creación
- lectura
- marcar todo
- preferencias
- navegación
- aislamiento por usuario
- dedupe

==================================================
85. TESTS RECORDATORIOS
==================================================

Para:

- tarea
- reserva
- actividad

Testear:

- 15 min
- 1 h
- 1 día cuando aplique
- evento cancelado
- evento reprogramado
- job repetido
- timezone

==================================================
86. TESTS ANONIMATO
==================================================

Crear valoración anónima.

La notificación:

NO revela autor en:

- BD accesible
- API cliente
- Realtime
- push payload
- email render
- target URL

Obligatorio.

==================================================
87. TESTS PUSH
==================================================

Hasta donde permita entorno:

- registrar subscription
- evitar duplicado
- eliminar/inutilizar
- payload
- URL
- 404/410
- permiso denegado no rompe app

En Supabase real/navegador real validar cuando sea posible.

==================================================
88. TESTS EMAIL
==================================================

Con adapter/mock:

- preference off → no envío
- preference on → envío
- retry
- dedupe
- contenido seguro
- valoración anónima

Si existe proveedor real configurado:

hacer prueba controlada.

No enviar spam.

==================================================
89. TESTS OFFLINE
==================================================

Simular sin red.

Verificar:

- aplicación muestra estado offline
- navegación cacheada razonable funciona
- una escritura NO muestra falso éxito
- volver online recupera funcionalidad
- logout elimina caches privados

==================================================
90. TEST PWA
==================================================

Validar:

- manifest
- iconos
- service worker
- start_url
- standalone
- installability cuando la herramienta lo permita
- actualización SW

==================================================
91. TEST MULTI-HOME
==================================================

Usuario pertenece a A y B.

Verificar:

- chats separados
- notificaciones correctas
- target abre home correcto
- Realtime no mezcla mensajes
- logout limpia todo

==================================================
92. TESTS RLS
==================================================

Usuario A de Piso A.

Usuario B de Piso B.

A NO puede:

- leer chat B
- escribir chat B
- reaccionar B
- descargar adjuntos B
- leer notificaciones de B
- modificar push subscription de B

Comprobar por:

- tablas
- RPCs
- Storage
- endpoints servidor

==================================================
93. TESTS DE CARGA RAZONABLE
==================================================

No hace falta benchmark empresarial.

Pero probar al menos:

- cientos/miles de mensajes generados de prueba
- paginación
- muchas notificaciones

Comprobar que la UI no carga todo de golpe.

Eliminar fixtures después.

==================================================
94. E2E COMPLETO NUEVO
==================================================

FLUJO CHAT:

- A y B mismo piso
- A manda mensaje
- B lo recibe
- B responde
- A reacciona
- adjuntar imagen
- editar/eliminar

FLUJO NOTIFICACIÓN:

- crear reserva/actividad próxima
- job genera recordatorio
- usuario recibe in-app
- marcar leída
- click navega correctamente

FLUJO PUSH:

- activar push
- generar notificación de prueba controlada
- recibir
- pulsar
- abrir destino

FLUJO OFFLINE:

- entrar
- cortar red
- ver indicador
- intentar acción de escritura
- no fake success
- recuperar red
- operación vuelve a funcionar

==================================================
95. REGRESIÓN TOTAL
==================================================

Ejecutar y conservar tests de:

- Fase 1
- Fase 1.1
- Fase 2
- Fase 2.1
- Fase 3
- Fase 4
- Fase 5
- Fase 5.1

No solucionar esta fase rompiendo otras.

==================================================
96. REVISIÓN DE SEGURIDAD
==================================================

Realizar revisión global explícita:

AUTH
- sesiones
- callbacks
- redirect `next`
- OAuth

RLS
- tablas existentes
- tablas nuevas

STORAGE
- avatars
- expense attachments
- rating photos
- chat attachments

RPC
- SECURITY DEFINER
- search_path
- authorization

SECRETS
- cliente
- server
- Vercel
- Supabase

XSS
- chat
- nombres
- títulos
- URLs

IDOR
- IDs de otros pisos

CSRF / acciones servidor
- revisar según arquitectura

No afirmar "seguro" únicamente porque RLS esté activada.

==================================================
97. SERVICE ROLE
==================================================

Buscar todo el repositorio.

La service-role key:

NUNCA debe aparecer en:

- bundle cliente
- `NEXT_PUBLIC_*`
- Git
- documentación con valor real
- tests committed con secreto real

Usar secretos únicamente en runtime servidor donde sean necesarios.

==================================================
98. .ENV
==================================================

Revisar:

`.gitignore`
`.env.example`
`.env.local`

`.env.example`:

solo nombres/placeholders.

NO secretos reales.

==================================================
99. PRODUCCIÓN — VERCEL
==================================================

Preparar el proyecto para Vercel.

Comprobar variables necesarias.

Documentar cuáles son:

PÚBLICAS:
por ejemplo Supabase URL/publishable key si ya las usa el proyecto.

SECRETAS:
VAPID private key
email provider key
service role solo si una función servidor realmente la necesita

No duplicar variables innecesariamente.

==================================================
100. SUPABASE AUTH PRODUCCIÓN
==================================================

Documentar/verificar:

- Site URL
- Redirect URLs
- localhost desarrollo
- URL producción
- OAuth callback si Google está habilitado

No cambiar configuración sin necesidad.

==================================================
101. SCHEDULER PRODUCCIÓN
==================================================

Dejar el scheduler realmente operativo en Supabase real si técnicamente es posible.

Verificar:

- job existe
- frecuencia
- función llamada
- permisos
- secrets
- idempotencia

Si requiere un paso manual externo:

documentarlo exactamente.

==================================================
102. MIGRACIONES
==================================================

Crear una o varias migraciones NUEVAS después de la última existente.

Nombre orientativo:

`..._chat_notifications.sql`

y si es necesario:

`..._notification_scheduler.sql`

No es obligatorio usar exactamente esos nombres.

NO editar 001 hasta la última migración de Fase 5.1.

==================================================
103. POSIBLES TABLAS
==================================================

Modelo orientativo:

chat_messages
chat_reactions
chat_attachments

notifications
notification_preferences
notification_deliveries
push_subscriptions
reminder_preferences

No tienes que usar exactamente estas tablas.

Evitar sobreingeniería.

==================================================
104. DOCUMENTACIÓN
==================================================

Actualizar:

- README.md
- AGENTS.md
- docs/architecture.md
- docs/setup.md
- docs/validation.md

Crear:

`docs/phase-6-delivery.md`

Documentar:

- chat
- replies
- reactions
- archivos
- paginación
- Realtime
- notificaciones
- preferencias
- recordatorios
- scheduler
- email
- push
- VAPID
- PWA
- service worker
- offline
- cache
- RLS
- Storage
- secrets
- producción
- limitaciones

==================================================
105. SETUP MANUAL
==================================================

Si alguna funcionalidad requiere algo que yo deba hacer manualmente:

NO lo ocultes.

Ejemplos:

- crear VAPID keys
- añadir variables Vercel
- configurar proveedor email
- habilitar scheduler
- configurar una Edge Function

Al final dame pasos EXACTOS y mínimos.

No me pidas pegar claves secretas en el chat.

==================================================
106. VALIDACIÓN SUPABASE REAL
==================================================

Usar Supabase real si está disponible.

Crear datos temporales controlados.

Probar con:

- Usuario A
- Usuario B
- mismo piso
- Usuario C externo

Validar:

- chat
- replies
- reactions
- adjuntos
- Realtime
- notification privacy
- preferencias
- scheduler
- recordatorios
- cross-home
- exmiembro

Limpiar fixtures.

==================================================
107. VALIDACIÓN EN DOS NAVEGADORES
==================================================

Probar realmente:

Navegador A
Usuario A

Navegador B
Usuario B

Comprobar:

- mensajes en tiempo real
- reacciones
- notificaciones
- cambios de preferencias cuando corresponda

==================================================
108. BUILD PRODUCCIÓN
==================================================

Ejecutar:

- lint
- typecheck
- todos los tests
- test:db
- E2E
- build de producción

No considerar terminada Fase 6 si build falla.

==================================================
109. NO IMPLEMENTAR
==================================================

No añadir:

- DM/chat privado
- llamadas
- IA
- OCR
- mapas
- analytics compleja
- presupuestos
- más gamificación
- reservas recurrentes
- calendario externo
- nueva funcionalidad no pedida

El objetivo es TERMINAR y endurecer RoomieHub, no expandir alcance.

==================================================
110. CRITERIO DE TERMINACIÓN
==================================================

La Fase 6 solo está terminada si:

- Chat funciona realmente entre usuarios.
- RLS separa pisos.
- Realtime funciona.
- Replies funcionan.
- Reactions funcionan.
- Archivos privados funcionan.
- Notificaciones in-app funcionan.
- Preferencias funcionan.
- Recordatorios son idempotentes.
- Scheduler funciona o queda un único paso manual claramente identificado.
- Push funciona si las credenciales/configuración están disponibles.
- Email tiene integración real si proveedor está configurado, o adapter completo + pasos exactos si falta proveedor.
- PWA es instalable.
- Offline no produce falsos éxitos.
- Toda la regresión anterior pasa.
- Producción compila correctamente.

==================================================
AL TERMINAR
==================================================

NO empieces funcionalidades nuevas.

Entrégame un informe exacto con:

1. migraciones nuevas
2. tablas nuevas
3. RPCs/functions nuevas
4. Edge Functions/jobs creados
5. funcionamiento del chat
6. replies
7. reactions
8. adjuntos
9. paginación
10. Realtime
11. modelo de notificaciones
12. preferencias
13. tipos de eventos implementados
14. recordatorios
15. sistema de deduplicación
16. scheduler y frecuencia
17. email y proveedor/adapter
18. push
19. VAPID/configuración
20. PWA
21. service worker
22. estrategia offline
23. limpieza de caché al logout
24. RLS
25. Storage
26. revisión de secretos
27. revisión de seguridad
28. optimizaciones realizadas
29. accesibilidad
30. responsive
31. tests totales y resultados
32. E2E
33. validación Supabase real
34. validación en dos navegadores
35. build de producción
36. variables de entorno nuevas
37. pasos manuales que tengo que realizar
38. limitaciones conocidas
39. problemas que queden pendientes

Además, crea/actualiza `docs/phase-6-delivery.md` con esta información.

NO des por completado email o push si realmente solo existe una interfaz/mock.
Diferencia claramente:

- implementado y validado
- implementado pero requiere credenciales/configuración
- no implementado

No ocultes fallos ni limitaciones.