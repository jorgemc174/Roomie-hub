# Plan: mejoras tras la auditoría (2026-11-01)

Rama: `mejoras-auditoria` (sin commits ni push salvo petición del usuario).
Reparto: Claude coordina/revisa; Codex implementa. Migraciones siempre aditivas (no tocar 001–015).

## Fase A — Dependencias (Claude)
- [x] next/eslint-config-next 16.4.3, sharp 0.35.5, override source-map-js ^1.2.2 (0 vulnerabilidades) → audit, typecheck, lint, test, build.

## Fase B — Correcciones de datos y seguridad (Codex, en paralelo, archivos disjuntos)
- [x] B1 SQL (migración 202611010001): deadlines de ocurrencias abiertas no borran retrasos (#3); delete_expense rechaza versión nula (#5); conflicto de idempotencia en recurrencias (#6). Con pruebas PGlite que reproduzcan cada fallo.
- [x] B2 App+Storage (migración 202611010002): fotos de valoraciones solo vía servidor saneado (#4); validación PDF de tickets (#7); chat autoriza y limita antes de decodificar adjuntos (#8). Con pruebas.

## Fase C — Interfaz minimalista (Codex por pasos, Claude revisa)
- [x] C1 Tareas: vista/fecha en un desplegable de filtros; Configurar en menú «⋯»; Crear como acción principal.
- [x] C2 Registros: castigos y recurrentes pendientes como resumen + acción; formulario solo al actuar.
- [x] C3 Acciones por elemento (compra, valoraciones, ausencias, gastos) en menú «⋯»; acción cotidiana directa.
- [x] C4 Pestañas (decisión del usuario 2026-11-01):
  - Organización: Tareas · Compra · Reservas; Ausencias al menú «⋯» (poco uso).
  - Convivencia: **Ranking** pasa a ser la vista principal y por defecto, como TABLA por participante (positivos, negativos y estado/castigos) ordenada según la regla de AGENTS.md; luego Puntos · Castigos · Actividades; Ajustes de puntos en «⋯».
  - Gastos: Movimientos · Saldos · Recurrentes; Historial en «⋯».
- [x] C5 Gastos (saldo compacto, Registrar pago arriba, reparto plegado) e Inicio (sin accesos duplicados).

## Fase D — Rendimiento y fiabilidad
- [x] Historial filtrado/paginado en SQL (#10); bandeja con Realtime (#11); avisos tras reasignación A→B→A (#12); lotes del worker y recordatorios (#9); limpieza de adjuntos abandonados; pruebas del scheduler (#13).

## Criterio de cierre por fase
typecheck + lint + test (+ test:db si toca SQL) + build en verde; revisión de diff por Claude.

## Cierre (2026-11-01)
- [x] Migraciones 202611010001-005 aplicadas y verificadas en Supabase (002/004 sin DROP).
- [x] Integrado en master (fast-forward) y subido.
- [ ] Pendiente: revisión visual con datos reales (requiere sesión del usuario).

## Fase E — Ajustes tras revisión visual con datos reales (2026-11-01)
Evidencia: capturas de «Piso 1» (móvil): Tareas = 14.561 px por acumulación de atrasadas y tarjetas repetitivas.
- [x] E1 Tareas compactas: «Esta semana» primero en filas compactas; «Atrasadas (N)» plegado y agrupado; sin fecha/estado redundantes; detalles al tocar o en «⋯». Sin completar en bloque (podría ocultar retrasos).
- [x] E2 Detalles: ranking (nombre truncado, «0 (0)»), «Crear» duplicado en estados vacíos, «Crear gasto» suelto en Inicio, título partido en Puntos, título de Organización estable.
- Resultado E: Tareas en móvil 14.561 px → 1.573 px con datos reales (Piso 1); 206 pruebas y build en verde.
