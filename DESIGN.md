---
name: RoomieHub
description: Herramienta cotidiana de convivencia, clara y tranquila, con verde como orientación.
colors:
  primary: '#257a55'
  primary-dark: '#8fe0b5'
  background: '#f5f7f4'
  background-dark: '#0d0f12'
  surface: '#ffffff'
  surface-dark: '#1c1f25'
  ink: '#1e2a26'
  ink-dark: '#ebeef1'
  muted: '#5a6862'
  muted-dark: '#a3abb5'
  line: '#e1e6e1'
  line-dark: '#393f49'
typography:
  body:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
    fontSize: '1rem'
    lineHeight: 1.6
  page-title:
    fontSize: '2rem'
    fontWeight: 600
    lineHeight: 1.14
    letterSpacing: '-0.025em'
  section-title:
    fontSize: '1.125rem'
    fontWeight: 600
    lineHeight: 1.35
  mobile-title:
    fontSize: '1.625rem'
    fontWeight: 600
rounded:
  control: '12px'
  panel: '16px'
spacing:
  base: '4px'
  control: '12px'
  panel: '24px'
---

## Overview

Sistema refinado y verificado sobre la implementación existente. Modo Operate de Impeccable y modalidad app de Taste Skill: la calidad se mide por comprensión, legibilidad y acciones disponibles. Mantener la identidad verde. Los tokens normativos son los de los archivos CSS y esta documentación refleja la entrega verificada. No cambiar la paleta por una receta de skill: los colores existentes pasan la revisión de legibilidad en los estados probados; se mejora la jerarquía, no la saturación.

## Colors

Las variables semánticas están en `src/app/globals.css`; escala y componentes compartidos en `src/styles/system.css`. El fondo oscuro es grafito neutro (decisión del usuario, 2026-11-01), no negro absoluto ni azul; el verde menta y los tintes pastel aportan el color. Paleta «Menta y pastel» (2026-11-01): verde menta es el color principal (acción, navegación, Tareas/Organización); celeste = Calendario/eventos; melocotón = Gastos/dinero; lavanda = Convivencia/puntos; rosa = negativos/castigos (distinto del rojo de error). Cada pastel tiene `--X` (tinte de fondo) y `--X-ink` (texto/icono legible, AA ≥4,5:1 sobre su tinte y sobre superficie en ambos temas). Los colores codifican significado, nunca decoran. Distinguir fondo, superficie y control. El acento orienta la navegación y la acción principal; rojo solo para errores y acciones destructivas. Los tintes de eventos del calendario codifican su origen, no decoran todos los bloques.

## Typography

Mantener fuentes de sistema disponibles sin descargas ni cambios de métricas por red. Un h1 por pantalla. Títulos de sección y nombres de objetos diferenciados de sus metadatos. Importes y contadores usan cifras tabulares; dinero se formatea mediante Intl y las funciones existentes, sin redondeos visuales adicionales.

## Layout

Mobile first. Móvil: navegación inferior existente con las seis secciones y etiquetas, áreas seguras, contenido que no quede tapado por la barra. Entre 701 y 1050 px el contenido ocupa el ancho disponible y las seis secciones pasan a una barra inferior rotulada; desde 1051 px se conserva la sidebar con nombre del piso y texto de destinos. Ancho de lectura restringido para formularios; listas y calendario utilizan el espacio útil. Las pestañas internas se desplazan dentro de su propio contenedor y conservan el enlace activo. No añadir un menú Más ni ocultar secciones sin una necesidad demostrada.

## Elevation & Depth

Separar por espaciado, líneas y pasos de luminosidad. Evitar sombra y borde fuerte simultáneos, superficies anidadas y tarjetas meramente decorativas. Reservar elevación perceptible para elementos superpuestos.

## Shapes

Controles de 12 px de radio y paneles de 16 px, definidos mediante tokens. Las tarjetas de pisos con imagen conservan su radio específico. La base del espaciado es 4 px; 8/12 para controles, 16/24 para paneles y 24/32 para secciones. Los controles son reconocibles, con alto táctil mínimo de 44 px. No introducir botones gigantes para compensar una jerarquía confusa.

## Components

`Navigation`, `SectionTabs`, `TaskNavigation` y `ExpensesNav` conservan rutas y semántica. `CreatePanel` abre una acción; `SectionDisclosure` agrupa ajustes, filtros o historial y mantiene sus campos montados. `ActionForm` conserva valores y feedback, `FormFeedback` anuncia errores, `EmptyState` ofrece una siguiente acción real y `LoadingSkeleton` representa una carga sin simular datos. El chat mantiene confirmación de eliminación y edición propia; vacío utiliza altura natural para exponer el compositor. Las tareas se agrupan por periodo y cada ocurrencia repite su rango de fechas visible para que los enlaces #task-ID no pierdan contexto. Puntos presenta Valorar antes del detalle contable; todos los contadores siguen disponibles. No usar ARIA menu para desplegables con formularios.

## Do's and Don'ts

- Verificar claro/oscuro, 320/390/768/1440 px, teclado y movimiento reducido.
- Usar textos es/en existentes o añadir ambas traducciones.
- Conservar filtros en URL y los enlaces de retorno; no duplicar configuración en selectores de vistas.
- Mantener datos reales, controles funcionales y la autoridad del backend.
- Evitar degradados decorativos, iconos en cajas repetidas, fotografías genéricas, estadísticas inventadas y animaciones sin propósito.
- Una recomendación de skill no invalida los requisitos del producto. Se conserva la navegación y la tipografía aunque una receta genérica sugiera reemplazarlas.

La altura táctil objetivo es 44 px. En la cuadrícula de siete días del calendario, a 320 px las celdas son más estrechas, con separación y 48 px de alto; es una excepción geométrica documentada, no una afirmación de ancho mínimo 44 px en todas las celdas. Las flechas mensuales sí tienen un ancho mínimo de 44 px. Los campos editables usan 16 px de texto para evitar zoom de foco en móvil. El nombre de la aplicación y los contadores del topbar tienen al menos 12 px. Se conserva la reducción de movimiento, el feedback real del router y las transiciones funcionales de los desplegables; no se añade animación decorativa.
