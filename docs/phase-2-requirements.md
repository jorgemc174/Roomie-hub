Continúa el proyecto RoomieHub existente.

La Fase 1 y la Fase 1.1 están terminadas y funcionando con un proyecto Supabase real.

Antes de modificar nada:

1. Lee `AGENTS.md`.
2. Lee íntegramente `docs/product-requirements.md`.
3. Revisa las migraciones existentes.
4. Revisa la arquitectura actual.
5. Mantén todas las decisiones y reglas ya establecidas.
6. NO reestructures innecesariamente la Fase 1 que ya funciona.
7. Implementa únicamente esta FASE 2.
8. No avances a gastos, puntos, chat, calendario completo ni notificaciones.
9. Usa migraciones SQL nuevas y aditivas.
10. Mantén RLS como parte obligatoria de cada nueva tabla.

# FASE 2

Implementar completamente:

* tareas del piso
* recurrencias
* asignación manual
* reparto automático
* rotaciones
* ausencias
* reasignación durante ausencias
* completar tareas
* deadlines opcionales
* listas de compra múltiples
* productos
* completar productos/listas
* sincronización Realtime

Todo debe usar Supabase real.

No utilizar localStorage ni datos ficticios como backend.

---

# 1. TAREAS CONFIGURABLES POR PISO

Cada piso debe poder definir sus propias tareas.

Crear tareas genéricas cuando corresponda durante el setup inicial:

* Limpiar cocina
* Limpiar baño
* Limpiar salón
* Sacar basura
* Fregar suelo

Estas tareas son únicamente valores iniciales.

Los miembros pueden:

* crear
* editar
* eliminar/desactivar

cualquier tarea.

Todos los miembros activos del piso tienen los mismos permisos.

Cada tarea necesita como mínimo:

* id UUID
* home_id
* nombre
* descripción opcional
* dificultad
* activa/inactiva
* regla de recurrencia
* modo de asignación
* deadline habilitado/deshabilitado
* configuración de deadline si procede
* created_at
* updated_at

Mantén el modelo preparado para evolución futura.

---

# 2. DIFICULTAD

Cada tarea tiene dificultad entre 1 y 5:

1 = muy ligera
2 = ligera
3 = media
4 = pesada
5 = muy pesada

Validar también en base de datos.

El reparto automático debe usar esta dificultad como peso.

---

# 3. RECURRENCIA

Implementar como mínimo:

* diaria
* cada X días
* semanal
* cada X semanas
* mensual

No hardcodear la recurrencia únicamente en UI.

La base de datos debe almacenar una representación limpia y validable.

Debe poder calcularse de forma determinista:

* periodo actual
* siguiente aparición
* próxima asignación

El día de inicio/cambio semanal configurable del piso ya definido en Fase 1 debe respetarse.

Por defecto: lunes.

---

# 4. INSTANCIAS DE TAREA

No quiero que una tarea recurrente sea simplemente un checkbox permanente.

Separar conceptualmente:

### Definición de tarea

Ejemplo:
"Limpiar baño cada semana"

de:

### Instancia/asignación concreta

Ejemplo:
"Limpiar baño — semana del 14 al 20 de septiembre — Jorge"

Diseña tablas adecuadas para conservar historial y futuras extensiones.

Una instancia debe permitir conocer:

* definición original
* periodo
* responsable
* fecha de generación
* fecha límite opcional
* pendiente/completada
* cuándo se completó
* quién la marcó como completada

Evitar duplicar una instancia para el mismo periodo.

Usar constraints o claves idempotentes donde sea necesario.

---

# 5. UN RESPONSABLE

Cada instancia de tarea tiene exactamente UN responsable.

No permitir tareas compartidas entre varios responsables.

---

# 6. MODO MANUAL

Implementar rotación manual configurable por tarea.

Ejemplo:

Baño:

Ana → Jorge → Pablo → Ana → ...

Cada tarea puede tener un orden diferente.

Permitir:

* seleccionar miembros activos
* ordenar la rotación
* cambiar el orden
* añadir/quitar personas

Si un usuario deja el piso, no debe recibir nuevas asignaciones.

No destruir el historial anterior.

---

# 7. MODO AUTOMÁTICO

Implementar reparto automático.

Objetivo:

equilibrar razonablemente la carga entre los miembros disponibles utilizando la dificultad/peso de las tareas.

NO repartir únicamente por número de tareas.

Ejemplo:

Usuario A:
tarea peso 5

Usuario B:
dos tareas peso 2

Usuario C:
una tarea peso 3

La lógica debe considerar carga acumulada del periodo.

Diseña un algoritmo determinista y testeable.

No hace falta optimización matemática perfecta.

Prioridades:

1. miembros disponibles
2. menor carga ponderada del periodo
3. evitar sesgos permanentes
4. desempate estable/determinista

Documentar brevemente el algoritmo.

La lógica crítica no debe existir únicamente en componentes React.

---

# 8. AUSENCIAS

Crear sistema de ausencias.

Cada ausencia:

* id
* user_id
* home_id
* start_date
* end_date
* created_at

Validaciones:

* end >= start
* el usuario debe pertenecer al piso
* solo afecta al piso correspondiente

El usuario puede crear/modificar/eliminar sus ausencias.

Dado que todos tienen los mismos permisos dentro del piso, otros miembros también pueden gestionar ausencias si es coherente con la arquitectura actual.

Mostrar claramente:

* quién está ausente
* desde cuándo
* hasta cuándo

---

# 9. AUSENCIAS Y REPARTO

Durante una ausencia:

* el usuario no recibe nuevas asignaciones automáticas
* debe omitirse en rotaciones manuales para esos periodos
* si una instancia futura ya estaba asignada y cae dentro de la ausencia, debe poder reasignarse automáticamente

La nueva asignación debe ir a otro miembro disponible.

En automático:
usar el algoritmo de carga.

En manual:
continuar con el siguiente miembro elegible de la rotación.

Evitar perder o duplicar tareas.

No modificar tareas históricas ya completadas.

Cuando termina la ausencia, el usuario vuelve a ser elegible automáticamente.

No es necesario ejecutar una tarea especial para "activar" al usuario si la elegibilidad puede calcularse por fechas.

---

# 10. COMPLETAR TAREAS

Una tarea se completa simplemente marcándola como hecha.

No pedir:

* foto
* comentario
* aprobación

Registrar:

* completed_at
* completed_by

Cualquier miembro activo del piso puede marcarla como completada, respetando la regla de permisos iguales.

Permitir desmarcar/componer un error solo si puede hacerse de forma segura y auditada; si añade complejidad innecesaria, mantener la operación de completar como principal y documentarlo.

---

# 11. DEADLINES

Las tareas pueden:

* no tener deadline
* tener deadline configurable

Si no hay deadline:
la instancia simplemente permanece durante su periodo.

Si hay deadline:
guardar una fecha/hora concreta calculada para la instancia.

Mostrar visualmente:

* pendiente
* completada
* atrasada

IMPORTANTE:

En los requisitos futuros, cada día completo de retraso genera 1 negativo automático.

NO implementes todavía el sistema de positivos/negativos.

Sin embargo:

* deja el modelo de tareas preparado para detectar días completos de retraso
* crea una función/utilidad determinista que permita calcular overdue days
* escribe pruebas
* NO generes todavía puntos/penalizaciones
* documenta claramente el hook que utilizará la Fase 5

No crees una tabla de puntos incompleta solo para esta fase.

---

# 12. GENERACIÓN DE INSTANCIAS

Diseña una forma fiable de generar instancias de tareas recurrentes.

Debe ser:

* idempotente
* testeable
* segura
* compatible con jobs programados futuros

Ejecutar la generación dos veces para el mismo periodo NO debe duplicar tareas.

En desarrollo puede existir:

* generación bajo demanda al cargar/gestionar el periodo
* RPC segura
* función SQL

según lo que mejor encaje con la arquitectura.

Pero deja preparado el diseño para automatizarlo posteriormente con cron/job.

No dependas de que un usuario tenga abierta la app permanentemente.

---

# 13. UI DE ORGANIZACIÓN — TAREAS

Implementar una interfaz usable dentro de:

Organización → Tareas

Debe permitir:

* ver mis tareas
* ver todas las tareas del piso
* distinguir pendientes/completadas/atrasadas
* completar una tarea
* crear definición de tarea
* editar definición
* configurar recurrencia
* configurar dificultad
* seleccionar automático/manual
* configurar rotación manual
* activar/desactivar deadline
* gestionar tareas activas

Mantener diseño:

* pastel
* limpio
* mobile-first
* claro/oscuro
* es/en

No crear una pantalla sobrecargada.

Usar dialogs/drawers/formularios donde sea razonable.

---

# 14. "MIS TAREAS"

Priorizar una vista simple de lo que le toca al usuario actual.

Mostrar:

* tarea
* periodo
* deadline si existe
* estado
* dificultad

Completar debe requerir muy pocos clics.

---

# 15. AUSENCIAS EN UI

Añadir gestión de ausencias de forma sencilla.

Por ejemplo:

Organización → Tareas → Ausencias

o una ubicación equivalente limpia.

Permitir:

* marcar que estaré fuera
* elegir inicio
* elegir fin
* editar
* eliminar

Mostrar las ausencias actuales/próximas de los compañeros sin saturar la vista.

---

# 16. LISTAS DE COMPRA

Implementar múltiples listas por piso.

Cada lista necesita como mínimo:

* id
* home_id
* nombre
* created_at
* created_by
* estado si es necesario

Ejemplos:

* Mercadona
* Limpieza
* Fiesta
* IKEA

Todos los miembros activos pueden:

* crear listas
* cambiar nombre
* eliminar listas
* añadir productos
* completar productos

---

# 17. PRODUCTOS

Un producto necesita únicamente:

* id
* shopping_list_id
* nombre
* purchased/completed
* created_at
* created_by
* completed_at opcional
* completed_by opcional

NO añadir:

* cantidad
* notas
* precio individual

porque decidimos no incluirlos.

Mantenerlo deliberadamente simple.

---

# 18. COMPLETAR PRODUCTO

Pulsar/tachar un producto debe:

* actualizar backend
* sincronizarse mediante Realtime
* reflejarse inmediatamente en otros clientes

Debe poder distinguirse visualmente comprado/no comprado.

---

# 19. COMPLETAR LISTA ENTERA

Permitir marcar una lista completa como comprada.

Debe completar todos sus productos pendientes de forma segura.

Preferir una operación transaccional/RPC antes que hacer N updates independientes desde el navegador si es más correcto.

Registrar los timestamps necesarios.

---

# 20. COMPRA → GASTO

NO implementar todavía gastos porque pertenecen a la siguiente fase.

Pero prepara un punto claro en UI/modelo para que posteriormente una lista comprada pueda convertirse opcionalmente en gasto.

No crear gasto falso.

No mostrar un botón funcional si todavía no existe el módulo.

Puedes mostrar únicamente una indicación no interactiva si aporta valor, pero es preferible no mostrar nada hasta Fase 3.

---

# 21. REALTIME

Activar Realtime correctamente para lo necesario en esta fase:

* instancias/asignaciones de tareas
* completado de tareas
* definiciones si aporta valor
* listas de compra
* productos

Dos usuarios dentro del mismo piso deberían poder ver cambios sin refrescar manualmente.

Mantener aislamiento por piso.

No subscribirse globalmente a datos de otros pisos.

Limpiar subscriptions correctamente al desmontar.

---

# 22. RLS

Todas las nuevas tablas deben tener RLS.

Regla principal:

solo miembros activos del piso correspondiente pueden acceder a los datos operativos.

Todos los miembros activos tienen los mismos permisos.

Un usuario de un piso distinto NO puede:

* leer tareas
* cambiar tareas
* consultar rotaciones
* leer ausencias
* acceder a listas
* modificar productos

No confiar únicamente en filtros del frontend.

Crear pruebas de RLS.

---

# 23. HISTORIAL Y BAJAS

Si un usuario se convierte en antiguo miembro:

* conservar asignaciones históricas
* conservar completados históricos
* no incluirlo en nuevas asignaciones
* no incluirlo en nuevas rotaciones automáticas

No borrar registros históricos por cascade incorrectamente.

Revisar cuidadosamente las FK y estrategias de borrado.

---

# 24. DATOS INICIALES

Al crear un piso nuevo, debe ser posible disponer de las tareas genéricas indicadas.

Si modificar directamente el flujo existente de creación de piso puede introducir riesgo, implementa una función segura/idempotente de inicialización.

No dupliques tareas genéricas si se ejecuta dos veces.

Para pisos existentes como el que ya he creado durante Fase 1, proporciona una migración/estrategia segura para disponer de esos defaults sin destruir configuración.

---

# 25. INTERNACIONALIZACIÓN

Todos los textos nuevos deben estar en:

* español
* inglés

No introducir strings visibles hardcodeados.

Usar el sistema i18n ya existente.

---

# 26. ACCESIBILIDAD Y UX

Mantener:

* labels
* navegación por teclado razonable
* botones con estados disabled/loading
* feedback de errores
* feedback de éxito
* targets táctiles adecuados

En móvil debe ser cómodo tachar una tarea o producto.

---

# 27. ERRORES

Tratar errores de forma clara.

Ejemplos:

* recurrencia inválida
* dificultad fuera de 1–5
* rango de ausencia inválido
* no existen miembros disponibles
* lista inexistente
* usuario ya no pertenece al piso
* conflicto al generar una instancia
* conexión perdida

No mostrar errores internos de PostgreSQL directamente.

---

# 28. ESQUEMA

Diseña el esquema que consideres correcto.

Probablemente serán necesarias entidades equivalentes a:

* chores
* chore_rotations
* chore_rotation_members
* chore_instances / assignments
* absences
* shopping_lists
* shopping_items

No estás obligado a usar exactamente esos nombres si existe un modelo mejor.

Prioriza:

* normalización razonable
* integridad
* historia
* idempotencia
* facilidad para las próximas fases

No meter todo en JSONB si merece relaciones propias.

---

# 29. MIGRACIONES

Crear nuevas migraciones a partir de las existentes.

No modificar destructivamente:

* `202609150001_foundation.sql`
* `202609150002_currency_profile_privacy.sql`

salvo corrección absolutamente necesaria que se documente.

Idealmente crear una migración de Fase 2 con timestamp posterior.

Si tienes acceso MCP al proyecto Supabase:

1. comprueba primero que las migraciones remotas anteriores existen
2. aplica la nueva migración después de validarla
3. comprueba esquema/RLS resultante

Si NO tienes MCP:

* crea la migración en el repositorio
* indícame exactamente cuál debo ejecutar manualmente en SQL Editor

Nunca dependas de cambios manuales no reflejados en migraciones.

---

# 30. TESTS

Añadir tests relevantes.

Como mínimo cubrir:

### Tareas

* dificultad válida/inválida
* recurrencias
* no duplicar instancia del mismo periodo
* asignación automática
* balance por dificultad
* rotación manual
* usuario ausente omitido
* reasignación
* completar tarea
* RLS entre pisos
* antiguo miembro no recibe nuevas tareas
* cálculo de días de retraso

### Compra

* crear lista
* crear producto
* completar producto
* completar lista completa
* aislamiento RLS
* antiguo miembro sin acceso operativo

### Realtime

Si el entorno permite probarlo razonablemente, añadir comprobaciones útiles.
Si no, documentar claramente la validación manual necesaria.

---

# 31. DASHBOARD

Integra únicamente lo imprescindible de Fase 2.

El dashboard puede mostrar:

* mis tareas pendientes
* tareas atrasadas
* productos/listas de compra pendientes de forma resumida

No convertir el dashboard en una nueva feature enorme.

No implementar todavía:

* ranking
* gastos
* reservas
* actividades
* chat

---

# 32. NO IMPLEMENTAR EN ESTA FASE

NO desarrollar todavía:

* gastos
* liquidaciones
* gastos recurrentes
* compra → gasto
* reservas
* recursos
* actividades
* calendario completo
* positivos
* negativos manuales
* castigos
* ranking
* chat
* notificaciones email
* push
* service worker avanzado

Aunque existan páginas placeholder, no simules funcionalidad.

---

# 33. VALIDACIÓN FINAL

Antes de dar Fase 2 por terminada:

Ejecuta:

* lint
* typecheck
* tests
* build
* pruebas PostgreSQL/RLS
* e2e relevantes

Si existe Supabase remoto accesible:

valida también contra el backend real de desarrollo.

Comprueba manualmente o mediante e2e:

1. Usuario A crea tarea.
2. Usuario B del mismo piso la ve.
3. Usuario B la completa.
4. Usuario A observa el cambio sin refrescar cuando Realtime está activo.
5. Usuario de otro piso no puede acceder.
6. Ausencia evita asignación.
7. Reparto automático usa peso.
8. Rotación manual sigue orden.
9. Lista de compra aparece para ambos.
10. Tachado se sincroniza.
11. Completar lista completa funciona.
12. Tema claro/oscuro no se rompe.
13. Móvil funciona.
14. Español e inglés funcionan.

Corrige los fallos antes de terminar.

---

# 34. DOCUMENTACIÓN

Actualizar donde corresponda:

* README
* AGENTS.md
* docs/architecture.md
* docs/setup.md
* docs/validation.md
* product requirements únicamente si es necesario reflejar decisiones ya acordadas, nunca para eliminar requisitos

Documentar:

* esquema nuevo
* algoritmo de reparto
* recurrencias
* generación idempotente
* Realtime
* cómo se tratarán posteriormente los negativos por retraso

---

# AL TERMINAR

NO empieces Fase 3.

Entrégame:

1. resumen de lo implementado
2. migraciones nuevas
3. tablas nuevas
4. RPC/functions creadas
5. algoritmo usado para reparto automático
6. cómo funciona la rotación manual
7. cómo gestiona ausencias
8. qué suscripciones Realtime existen
9. pruebas ejecutadas y resultados
10. qué se ha comprobado contra Supabase remoto
11. cualquier paso manual que yo tenga que realizar
12. problemas o limitaciones pendientes

No continúes con gastos hasta que yo revise esta fase.
