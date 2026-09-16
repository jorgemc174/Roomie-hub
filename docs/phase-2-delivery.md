# Entrega de Fase 2

1. **Implementado:** tareas configurables, recurrencias, dificultad, automático/manual, ausencias y reasignaciones, completar, deadline opcional e historial. Varias listas de compra con productos y completado transaccional. UI es/en, claro/oscuro, móvil, dashboard resumido y sincronización. Mis pisos/Cerrar sesión en Mi perfil.
2. **Migración:** `supabase/migrations/202609150003_organization.sql`, aplicada por el usuario y verificada mediante el backend real. Las dos anteriores no se modifican.
3. **Tablas:** `chores`, `chore_rotation_members`, `chore_instances`, `chore_assignment_events`, `absences`, `shopping_lists`, `shopping_items`. Todas con RLS.
4. **RPCs:** `chore_period`, `save_chore`, `initialize_chores`, `generate_chore_instances`, `reconcile_chore_assignments`, `save_absence`, `complete_chore`, `shopping_command`. Helpers no públicos: `organization_lock`, `chore_eligible`, `choose_chore_assignee`, `realign_chore_weeks` (trigger).
5. **Automático:** disponibles activos; menor peso acumulado en la semana del piso; menor carga histórica; hash determinista tarea/periodo/usuario. Procesamiento cronológico, tareas más pesadas primero.
6. **Manual:** orden propio de miembros por tarea, editable con subir/bajar/añadir/quitar; se continúa después del responsable anterior y se salta a inactivos/ausentes.
7. **Ausencias:** fechas inclusivas, solo ese piso, exclusión por solapamiento del periodo. Reasignación de pendientes actuales/futuras y registro del cambio; completadas/históricas intactas. Si todos están ausentes se informa del bloqueo, sin crear responsables ficticios.
8. **Realtime:** cinco tablas operativas por home_id, INSERT/UPDATE; rotaciones actualizan su definición. Bajas lógicas para sincronizar eliminaciones. Se conservan suscripciones base de homes/home_members. Espera de disponibilidad PostgreSQL, JWT y limpieza al desmontar.
9. **Pruebas:** lint, typecheck, build, 37 pruebas unitarias/PostgreSQL y 10 e2e públicos correctos. Ver `docs/validation.md` para cobertura e incidencias corregidas.
10. **Remoto:** tres cuentas de test, dos pisos; JWT/RLS/RPC reales, creación/completado y reasignación; dos navegadores observan cambios reales de tareas y compras sin recarga; perfil, idioma, tema y móvil. Fixtures eliminados al terminar.
11. **Paso manual:** la migración ya está aplicada en el proyecto actual. Para las cinco tareas genéricas del piso existente, Organización → Configurar tareas → Añadir tareas iniciales. Al copiar el ZIP a otro equipo, instalar dependencias y crear `.env.local` según `docs/setup.md`.
12. **Límites:** generación bajo demanda, sin cron instalado; tareas completadas no se desmarcan; periodos/ausencias UTC y deadlines con zona IANA; sin personas disponibles se informa y reintenta. Stress de concurrencia, cortes prolongados, OAuth/SMTP y automatizaciones futuras no están acreditados por esta entrega.

No se implementa Fase 3 ni gastos, puntos, calendario completo, chat o notificaciones.

## Revisión posterior

El endurecimiento 004 sustituye el horizonte y las reglas de futuras instancias descritos en la entrega original. Consulte [la semántica actual](phase-2-hardening.md) y [validación](validation.md).
