# Verificación de interfaz

> Registro histórico. La cuenta de desarrollo ya está configurada y se ha comprobado la navegación autenticada. Los resultados actuales, las capturas y los límites están documentados en [UI_AUDIT.md](../../UI_AUDIT.md). El apartado pendiente de esta entrega anterior describe su situación en aquel momento.

## Ejecutado

- `pnpm lint`, `pnpm typecheck` y `pnpm build`.
- `pnpm test`: 134 pruebas aprobadas; incluye lógica, PostgreSQL/RLS y semántica de los nuevos componentes.
- Playwright con Chromium del entorno y Google habilitado para la UI: 22 pruebas aprobadas en escritorio y móvil. Backend intencionalmente no disponible en esta suite: no acredita acceso a Google/Supabase real.
- Nueva regresión: un fallo real de la Server Action de acceso conserva correo y contraseña, presenta un error anunciado, mueve el foco al mensaje y permite reintentar.
- Capturas de la aplicación pública en claro/oscuro, es/en, escritorio/móvil; se inspeccionaron visualmente.
- Integración aislada de los componentes reales: apertura/cierre y retorno del foco, conservación del borrador tras error, copia real al portapapeles, foco del mensaje y semántica de carga. Se usaron datos de prueba locales, sin reemplazar el backend de la aplicación.
- Matriz de componentes: 320×740, 375×812, 390×844, 768×1024, 1440×1000 y paisaje 667×375. Sin desbordamiento de documento. Controles de creación, copia y navegación de al menos 44 px de alto. Texto ampliado a 20 px y movimiento reducido comprobados.
- Contraste calculado: controles claros 3,49:1; controles oscuros 4,20:1; texto secundario claro 5,66:1; secundario oscuro 7,58:1; texto de acción oscura 9,19:1. Esto no equivale a una auditoría WCAG completa.

## Pendiente externo

El usuario confirma que dispone de un entorno de desarrollo, pero `E2E_USER_EMAIL` y `E2E_USER_PASSWORD` todavía no están presentes en la máquina. No se han creado cuentas, cambiado datos remotos ni usado claves administrativas. Falta el recorrido autenticado de pisos, tareas, compra, reservas, gastos, convivencia, chat, perfil y notificaciones contra ese entorno.

Para continuar: inyectar esas dos variables por un canal seguro y confirmar que `NEXT_PUBLIC_SUPABASE_URL` apunta a desarrollo. No enviar credenciales por el chat. Después se pueden inspeccionar y corregir las pantallas privadas con datos reales, distinguiendo los resultados de las capturas aisladas.
