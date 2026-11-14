# Resultados de la renovación offline

**Implementación verificada el 14 de noviembre de 2026. La vista temporal real
queda pendiente de habilitar su configuración mediante el mecanismo autorizado.**
El control CC Safety Net bloqueó la preparación del archivo sensible de
configuración (regla secret.pattern.env-variant). No se reintentó por otra vía,
no se inició el servidor real y no se modificó Tailscale Serve.

## Código y verificaciones

- Rama: `feat/offline-data-snapshot`, worktree `.worktrees/offline-snapshot`.
- Base inmutable: `e033d384a96265785c9329d2d910e1bf7b691623`.
- `npm test`: **203 tests, 34 archivos, sin fallos**.
- `npm run typecheck`: correcto.
- `node --test e2e/*.test.mjs e2e/support/*.test.mjs`: **9 tests correctos**.
- `node scripts/import-legacy-orders.test.mjs`: correcto.
- `npm run test:backup`: **18 tests correctos**.
- `uv run --frozen pytest` en `apps/desktop`: **20 tests correctos**.
- `npx playwright test`: **15 escenarios correctos**, sin omitidos ni reintentos;
  Chromium real, service workers habilitados y servidor HTTP Supabase sintético.
- Build estándar Turbopack de producción y build webpack de comparación: correctos.
- La página `/offline` se genera estática y pública, sin datos privados.
- Sin migraciones, permisos ni datos reales modificados; sin GitHub ni Vercel.

El benchmark y la última suite funcional usaron el mismo conjunto de fuentes:
`1d0328fddd29c58fe1eb8c462a2082999fd06f1700a6c89b160beba85695455c`. Este manifiesto incluye una copia sintética del worker
antiguo para probar la actualización, idéntica a la base original; esa fixture
se agrega solo al árbol descartable de pruebas, no al código de producción.
Se verificaron además los hashes de todos los archivos actuales de aplicación.

## CPU, solicitudes, bytes y tiempo

Un calentamiento y **cinco repeticiones medidas** por tamaño y variante, misma
máquina, dependencias, compilador webpack y backend HTTP simulado. La CPU total
suma Next, mock y todo el árbol de Chromium. Incluye login y preparación, no
build ni arranque del navegador. El tiempo incluye 1.000 ms de quietud de red
para verificar que no quedan precargas en segundo plano.

| Órdenes | CPU antes (ms) | CPU después (ms) | Reducción CPU total | Solicitudes antes → después | Bytes antes → después | Tiempo antes → después (ms) |
|---:|---:|---:|---|---:|---:|---:|
| 25 | 1310 | 470 | 64.1 % | 59 → 18 | 279557 → 103290 | 1735 → 1287 |
| 52 | 2140 | 410 | 80.8 % | 117 → 18 | 543379 → 114390 | 2195 → 1265 |
| 100 | 3440 | 410 | 88.1 % | 215 → 18 | 1001470 → 134068 | 2972 → 1240 |
| 1000 | 22810 | 830 | No comparable: anterior incompleto | 1429 → 18 | 6822011 → 503972 | 13360 → 1362 |

El criterio de CPU de al menos 80 % se cumple para **52 y 100 órdenes**.
También se comprobó en todas las repeticiones nuevas:

- **0** solicitudes automáticas de detalle o ticket.
- **1** descarga de snapshot por preparación.
- **0** descargas de snapshot en revisitas dentro del TTL.
- Preparación completa de los cuatro tamaños, incluido 1.000.

El flujo anterior **no completó** 1.000 órdenes: su fan-out sin límite agotó
recursos de Chromium (medianas: 672 detalles y 670 tickets guardados).
Por eso no se presenta el porcentaje de esa fila como comparación de trabajo
completo. Los tamaños 52 y 100 sí completaron ambos flujos.

### Instrumentación y límites

Los primeros ensayos, que conservan sus informes, incluían grabación de trazas
durante cada medición y no alcanzaban el 80 % total para 52 órdenes. Un perfil
CDP identificó trabajo del propio observador (visitas DOM, serialización e
instrumentación de Playwright) dentro de la CPU de Chromium. El protocolo final
separa esa instrumentación: guarda una traza por calentamiento/tamaño/variante,
y no graba trazas en las cinco repeticiones medidas, igual para ambos flujos.
La suite funcional conserva sus 15 trazas completas. No se cambiaron los procesos
incluidos, el inicio/final del intervalo ni el umbral de aceptación.

Los logs conservan tamaños originales y marcan anomalías de caché de Chromium;
los tamaños negativos reportados por Playwright se normalizan a cero, nunca se
suman como tráfico negativo. La granularidad típica de CPU es 10 ms; procesos
muy breves entre muestras pueden quedar subcontados. No es una promesa de
capacidad ni latencia de producción.

## Evidencia local reproducible

- `e2e/benchmark-results/acceptance/`: informe final, manifiesto, 48 muestras,
  solicitudes, bytes, tiempos y trazas de calentamiento.
- `e2e/benchmark-results/profile-52/`: perfil CDP y CPU por proceso/hilo,
  solo diagnóstico, no aceptación.
- `e2e/benchmark-results/final/`, `optimized/`, `verified-reuse/` y
  `final-client/`: iteraciones anteriores conservadas, incluidas las que no
  alcanzaban el umbral; no se sustituyeron por un éxito.
- `e2e/results/`: última ejecución funcional, 15 trazas, captura y PDF del ticket.
- `docs/offline-testing.md`: comandos y límites de la metodología.
- `docs/offline-operacion.md`: uso, aislamiento, recuperación y advertencia de datos reales.

Los directorios de resultados están ignorados por Git y contienen solo datos
sintéticos. No se iniciaron Docker ni servicios de producción. Los servicios de
pruebas fueron detenidos.

## Pendiente para la vista de dos horas

Habilitar o preparar la configuración real mediante el mecanismo autorizado del
entorno. Después: build separado, servicio de usuario en loopback3000, verificar
HTTPS privado Tailscale, programar dos horas desde disponibilidad y comunicar
URL y vencimiento exacto. No hay todavía vista activa, ruta Serve creada ni hora
de apagado que pueda entregarse como verificada.
