Quiero que construyas una aplicación llamada **RoomieHub**.

Es una aplicación para compañeros de piso que centraliza la convivencia: tareas, gastos, compras, reservas de espacios/recursos, actividades, chat y un sistema de positivos/negativos.

Quiero construirla como un proyecto real y mantenible, NO como una demo visual ni un prototipo con datos falsos.

## FORMA DE TRABAJAR

Antes de empezar a programar:

1. Analiza todos los requisitos de este prompt.
2. Crea un archivo `AGENTS.md` en la raíz donde quede resumida:

   * arquitectura
   * stack
   * reglas importantes del producto
   * convenciones de código
   * roadmap
3. Crea también un `README.md` con instrucciones para ejecutar el proyecto.
4. Divide el desarrollo en fases.
5. En esta primera tarea NO intentes implementar toda la aplicación.
6. Implementa únicamente la FASE 1 indicada al final.
7. Deja la arquitectura preparada para las funciones futuras.
8. Ejecuta lint, typecheck y las pruebas que correspondan antes de terminar.
9. Corrige los errores que encuentres.
10. No uses datos falsos/localStorage como sustituto del backend real.
11. No implementes botones que aparenten funcionar pero no hagan nada.
12. Si algo necesita claves externas que todavía no existen, prepara correctamente la integración y documenta qué falta.

---

# STACK

Utiliza preferentemente:

* Next.js estable con App Router
* React
* TypeScript estricto
* Tailwind CSS
* Supabase
* PostgreSQL
* Supabase Auth
* Supabase Realtime
* Supabase Storage
* PWA
* arquitectura preparada para notificaciones push y email
* sistema de internacionalización preparado para español e inglés

Usa versiones estables actuales y evita dependencias innecesarias.

La aplicación debe ser **mobile-first**, responsive y poder instalarse en el futuro como PWA.

El idioma inicial será español.

---

# DISEÑO

Quiero una interfaz:

* moderna
* limpia
* agradable
* colores pastel
* no infantil
* bordes redondeados
* espacios generosos
* iconografía sencilla
* animaciones discretas
* modo claro
* modo oscuro

Paleta aproximada:

* lavanda pastel
* verde menta suave
* azul cielo suave
* melocotón
* fondos neutros

No abuses de colores, gradientes ni tarjetas.

Debe sentirse como una aplicación móvil moderna también desde navegador.

---

# CONCEPTO PRINCIPAL

Un usuario puede pertenecer a varios pisos.

Flujo:

Usuario
→ inicia sesión
→ pantalla "Mis pisos"
→ selecciona un piso
→ entra al espacio de ese piso.

El cambio de piso se hace desde "Mis pisos", fuera del workspace interno.

Cada piso tiene:

* nombre
* imagen opcional
* moneda
* miembros
* código/enlace de invitación
* configuración propia

Los datos de distintos pisos deben estar completamente separados.

---

# AUTENTICACIÓN

Implementar:

* registro con email y contraseña
* login
* logout
* recuperación de contraseña
* sesión persistente

Dejar preparada autenticación con Google, pero no debe impedir ejecutar el proyecto si todavía no existen las credenciales OAuth.

Perfil inicial:

* nombre
* foto

---

# PERMISOS DEL PISO

Todos los miembros activos tienen exactamente los mismos permisos.

NO existe:

* administrador
* propietario
* moderador

Cualquier miembro puede crear, editar o borrar contenido del piso.

Excepción:

El piso solo puede eliminarse cuando quede un único miembro activo.

---

# INVITACIONES

Cada piso tiene:

* código de invitación
* enlace de invitación

Una persona con un código válido entra directamente al piso.

No requiere aprobación.

El código no caduca.

Cualquier miembro puede regenerarlo y el anterior deja de funcionar.

---

# SALIR DEL PISO

Un usuario puede abandonar un piso.

Si todavía tiene deudas pendientes con otros miembros:

* impedir la salida definitiva
* informar claramente del motivo

Cuando el saldo sea 0 puede salir.

Sus datos históricos deben mantenerse.

Debe pasar a ser un miembro anterior/inactivo.

No debe aparecer en:

* nuevos gastos
* nuevas tareas
* reservas
* ranking
* reparto automático
* actividades nuevas

Pero su nombre debe seguir apareciendo cuando sea necesario para entender registros históricos.

---

# NAVEGACIÓN PRINCIPAL FUTURA

Mantener una navegación limpia.

Secciones:

### Inicio

Dashboard.

### Calendario

Calendario común del piso.

### Organización

* tareas
* compra
* reservas

### Gastos

### Convivencia

* positivos/negativos
* castigos
* actividades

### Chat

Perfil y ajustes deben ir en una zona secundaria, no como sección principal.

---

# DASHBOARD FUTURO

Mostrará cosas relevantes como:

* tareas pendientes
* tareas atrasadas
* próximas reservas
* próximas actividades
* productos pendientes
* saldo que debes / te deben
* castigos pendientes
* avisos

NO mostrar el ranking de positivos/negativos en Inicio.

---

# TAREAS DEL PISO

Cada piso configura sus propias tareas.

Dar tareas genéricas iniciales:

* limpiar cocina
* limpiar baño
* limpiar salón
* sacar basura
* fregar suelo

Pero se pueden editar/eliminar/añadir.

Cada tarea tendrá:

* nombre
* descripción opcional
* frecuencia
* dificultad 1-5
* activa/inactiva
* fecha límite opcional
* sistema de asignación

Frecuencias previstas:

* diaria
* cada X días
* semanal
* cada X semanas
* mensual

Por defecto la semana cambia el lunes, pero cada piso puede cambiar ese día.

---

# REPARTO DE TAREAS

Cada tarea tiene UNA sola persona responsable.

Dos modos:

### Automático

La aplicación reparte las tareas intentando equilibrar la carga según la dificultad.

Dificultad:

1 = muy ligera
2 = ligera
3 = media
4 = pesada
5 = muy pesada

No repartir solo según número de tareas.

### Manual

Cada tarea puede tener su propia rotación.

Ejemplo:

Baño:
Ana → Jorge → Pablo → Ana...

---

# AUSENCIAS

Un usuario puede marcar:

* fecha de inicio
* fecha de fin

Durante ese periodo:

* no recibe nuevas tareas automáticas
* sus tareas se reasignan automáticamente

Después vuelve automáticamente a estar disponible.

---

# COMPLETAR TAREAS

Las tareas se completan simplemente tachándolas.

No pedir:

* foto
* validación
* comentarios

Registrar internamente cuándo y quién la completó.

---

# TAREAS ATRASADAS

Si una tarea tiene fecha límite:

Por cada día completo de retraso se genera automáticamente:

**1 negativo**

No existe límite máximo.

Debe continuar hasta que la tarea se complete.

Ejemplo de motivo:

"Tarea 'Limpiar baño' atrasada 3 días."

Debe ser imposible generar el mismo negativo dos veces para el mismo día de retraso.

---

# POSITIVOS Y NEGATIVOS

Cualquier miembro puede poner positivos o negativos a otro.

No existe límite diario.

Cada valoración tiene:

* receptor
* autor
* positivo/negativo
* motivo
* foto opcional
* fecha
* anónimo sí/no
* automático sí/no

El usuario puede elegir si su valoración manual es anónima.

El autor real puede conservarse en base de datos por integridad aunque no se muestre.

---

# MOTIVOS

Cada piso tiene motivos configurables.

Crear algunos genéricos inicialmente.

Negativos:

* no fregó los platos
* dejó una zona común sucia
* hizo demasiado ruido
* no cumplió una tarea

Positivos:

* ayudó a limpiar
* ayudó a otro compañero
* compró algo necesario
* tomó iniciativa

Cada piso puede crear, editar y borrar sus propios motivos.

---

# REGLA 3 POSITIVOS

Cada:

**3 positivos disponibles**

se consumen automáticamente para eliminar:

**1 negativo**

Ejemplo:

5 positivos
4 negativos

se convierte en:

2 positivos
3 negativos

Registrar internamente la conversión.

---

# CASTIGOS

Los negativos no se reinician.

En:

5, 15, 25, 35... negativos
→ castigo leve.

En:

10, 20, 30, 40...
→ castigo fuerte.

Cada múltiplo de 5 genera un castigo.

La app NO decide cuál es el castigo.

Crea un castigo pendiente.

Los compañeros escriben el castigo y posteriormente alguien lo marca como completado.

Campos:

* usuario castigado
* leve/fuerte
* umbral
* descripción
* pendiente/completado
* fecha
* fecha de finalización

No duplicar castigos accidentalmente.

Una reducción posterior de negativos NO elimina castigos ya generados.

---

# RANKING

Mostrar:

* usuario
* positivos disponibles
* negativos actuales

Orden:

1. menos negativos
2. en empate, más positivos

Excluir antiguos miembros.

---

# GASTOS

Quiero funcionalidad similar en concepto a Tricount, pero con diseño y código propios.

Cada gasto:

* concepto
* cantidad
* fecha
* persona que pagó
* participantes
* forma de reparto
* ticket/foto/PDF opcional
* categoría

Permitir:

* reparto igual
* cantidades personalizadas
* porcentajes
* excluir miembros

Calcular:

* saldo neto
* quién debe a quién
* liquidaciones recomendadas

Usar tipos numéricos seguros para dinero.

NO usar floating point de forma insegura.

---

# PAGOS ENTRE COMPAÑEROS

Permitir registrar:

"Ana pagó 24 € a Jorge"

Esto actualiza automáticamente los saldos.

Conservar historial.

---

# MONEDA

Cada piso tiene UNA moneda principal configurable.

Ejemplos:

* EUR
* USD
* GBP

No hacer conversión automática entre monedas en el MVP.

---

# GASTOS RECURRENTES

Permitir:

### Fijo

Ejemplo:

Alquiler → 450 € cada mes.

Se genera automáticamente.

### Variable

Ejemplo:

Electricidad mensual.

La app crea el pendiente y un usuario introduce/confirma el importe antes de contabilizarlo.

---

# CATEGORÍAS DE GASTO

Intentar detectar automáticamente la categoría por el concepto.

Ejemplos:

Mercadona → supermercado

Iberdrola → electricidad

Alquiler septiembre → alquiler

Si no está claro:

* Otros

El usuario puede cambiarla manualmente.

No hacen falta estadísticas complejas de gastos.

---

# LISTAS DE COMPRA

Cada piso puede tener varias listas.

Ejemplos:

* Mercadona
* Limpieza
* Fiesta
* IKEA

Cada producto solo necesita:

* nombre
* comprado/no comprado

No hacen falta cantidades ni notas.

Permitir:

* tachar un producto
* tachar toda una lista

Sincronización en tiempo real.

---

# COMPRA → GASTO

Después de comprar una lista, opcionalmente permitir:

* introducir total
* seleccionar quién pagó
* seleccionar participantes
* repartir gasto

y convertirlo directamente en un gasto.

---

# RECURSOS RESERVABLES

Cada piso puede configurar recursos.

Genéricos iniciales:

* baño
* cocina
* lavadora

Pueden crear otros.

Ejemplo:

* salón
* plaza de garaje
* secadora

---

# RESERVAS

Las reservas son puntuales.

No recurrentes.

Campos:

* recurso
* usuario
* fecha
* hora inicio
* hora fin

NO permitir reservas solapadas del mismo recurso.

Este bloqueo debe existir también en backend/base de datos.

Ejemplo inválido:

Baño 19:00-19:30
Baño 19:15-20:00

Ejemplo válido:

Baño 19:00-19:30
Cocina 19:00-20:00

---

# ACTIVIDADES

Cada piso puede crear actividades dentro o fuera de casa.

Campos:

* título
* descripción
* fecha
* hora
* ubicación
* creador
* participantes

Los usuarios pueden apuntarse o desapuntarse.

Mostrar quién está apuntado.

---

# CALENDARIO

Un calendario común debe integrar:

* tareas
* fechas límite
* actividades
* reservas
* gastos recurrentes relevantes

Debe poder filtrarse por tipo.

---

# CHAT

Cada piso tiene UN chat general.

Permitir:

* texto
* emojis
* imágenes
* archivos
* enlaces
* respuestas a mensajes
* reacciones con emojis

Realtime.

No crear chats separados por tareas o actividades.

---

# NOTIFICACIONES

Preparar arquitectura para:

* notificaciones dentro de la app
* push PWA
* email

Cada usuario puede configurar qué recibe.

Ejemplos:

* nueva tarea
* tarea próxima a vencer
* tarea atrasada
* reserva próxima
* nueva actividad
* recordatorio de actividad
* gasto recurrente variable
* positivo/negativo
* castigo

Recordatorios configurables como:

* 15 minutos
* 1 hora
* 1 día

---

# TIEMPO REAL

Preparar Supabase Realtime para:

* chat
* tareas
* compras
* reservas
* actividades
* puntos
* gastos
* liquidaciones
* notificaciones

---

# AJUSTES PERSONALES

Incluir futuramente:

* nombre
* foto
* idioma
* tema
* notificaciones
* recordatorios

---

# AJUSTES DEL PISO

Incluir:

* nombre
* imagen
* moneda
* código de invitación
* día de cambio semanal
* tareas
* dificultad
* rotaciones
* recursos
* motivos de positivos/negativos
* miembros

Todos los miembros tienen permiso para modificarlo.

---

# INTERNACIONALIZACIÓN

El idioma principal inicial es español.

Preparar desde el inicio:

* `es`
* `en`

No hardcodear textos visibles dentro de componentes.

Usar sistema de traducciones.

Fechas, horas, números y monedas deben poder localizarse correctamente.

---

# PWA

La aplicación deberá convertirse en una PWA instalable.

Preparar arquitectura para:

* manifest
* iconos
* modo standalone
* service worker
* soporte offline razonable
* notificaciones push

Las operaciones colaborativas importantes no deben fingir que se han realizado si no existe conexión al backend.

---

# SEGURIDAD

Supabase debe utilizar Row Level Security.

Un usuario solo puede acceder a información de pisos a los que pertenece.

No permitir acceso cruzado entre pisos.

Esto aplica a:

* miembros
* tareas
* chat
* gastos
* compras
* fotos
* archivos
* puntos
* reservas
* actividades
* configuración

La seguridad debe estar en backend/base de datos, no solamente ocultando rutas en frontend.

---

# STORAGE

Supabase Storage se utilizará para:

* fotos de perfil
* imágenes del piso
* pruebas de positivos/negativos
* tickets/facturas
* archivos del chat

Aplicar controles de acceso.

No permitir archivos ejecutables.

---

# OPERACIONES AUTOMÁTICAS

Diseñar para soportar trabajos programados:

* negativos diarios por tareas atrasadas
* gastos recurrentes
* recordatorios
* expiración de ausencias
* notificaciones

Estas operaciones deben ser IDEMPOTENTES.

Ejecutar una operación dos veces no debe duplicar resultados.

---

# FASES DEL PROYECTO

Quiero trabajar incrementalmente.

### FASE 1 — IMPLEMENTAR AHORA

Implementa completamente:

1. Inicialización correcta del proyecto.
2. Estructura de carpetas limpia.
3. Tailwind.
4. Diseño base pastel.
5. Modo claro/oscuro.
6. Internacionalización preparada con español e inglés.
7. Supabase configurado mediante variables de entorno.
8. Auth:

   * registro
   * login
   * logout
   * recuperación de contraseña
9. Perfil:

   * nombre
   * foto
10. Base de datos inicial.
11. Tablas:

* profiles
* homes
* home_members
* invitations

12. Row Level Security para estas tablas.
13. Crear piso.
14. Unirse a piso mediante código.
15. Pantalla "Mis pisos".
16. Seleccionar un piso.
17. Workspace básico del piso.
18. Navegación preparada para:

* Inicio
* Calendario
* Organización
* Gastos
* Convivencia
* Chat

19. Ajustes personales básicos.
20. Ajustes del piso básicos:

* nombre
* imagen
* moneda
* código de invitación

21. Regla:

* todos los miembros tienen mismos permisos.

22. Regla:

* un piso solo puede borrarse cuando tiene un miembro.

23. Estructura preparada para realtime.
24. Responsive mobile-first.
25. README.
26. AGENTS.md.
27. `.env.example`.
28. migraciones SQL de Supabase dentro del repositorio.

NO implementes todavía los módulos completos de tareas, gastos, compras, reservas, puntos o chat.

Pero deja la arquitectura preparada para añadirlos después.

---

# VALIDACIÓN DE FASE 1

Antes de terminar:

Comprueba:

* que compila
* que TypeScript no tiene errores
* que lint pasa
* que las rutas principales funcionan
* que no hay imports rotos
* que el usuario no autenticado no entra al workspace
* que un usuario solo ve sus pisos
* que no puede consultar un piso ajeno
* que crear un piso funciona
* que unirse mediante código funciona
* que cambiar de piso funciona
* que cerrar sesión funciona
* que claro/oscuro funciona
* que español/inglés funciona
* que móvil se ve correctamente

Si puedes escribir pruebas útiles para lógica importante, hazlo.

Corrige los problemas encontrados antes de dar por finalizada la fase.

---

# AL TERMINAR

No continúes automáticamente con la Fase 2.

Cuando la Fase 1 esté terminada:

1. Resume exactamente qué has creado.
2. Lista los archivos importantes.
3. Explica qué tengo que configurar en Supabase.
4. Indica qué variables debo poner en `.env.local`.
5. Indica cualquier paso manual que sea necesario.
6. Señala cualquier limitación pendiente.
7. Propón cuál debería ser la Fase 2.

No borres ni simplifiques requisitos futuros del `AGENTS.md`.

Quiero que RoomieHub vaya creciendo sobre esta misma arquitectura durante todo el proyecto.
