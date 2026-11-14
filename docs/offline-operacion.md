# Datos offline y vista local

## Alcance

La preparación descarga un snapshot privado de las órdenes recibidas en los
últimos 30 días calendario argentinos (hoy y los 29 días anteriores). El listado
local tiene páginas de 25 filas, búsqueda, estado y fechas. No descarga adjuntos
ni habilita edición o eliminación offline. El ticket reutiliza los campos de
dos columnas, contactos, condiciones e impresión automática del flujo online.

`GET /api/orders/offline-snapshot` verifica al usuario con `getUser()`, consulta
con su cliente público y las políticas RLS existentes, y devuelve
`Cache-Control: private, no-store`. Los lotes internos son de hasta 500 órdenes,
con cursor ascendente por número; se continúa hasta un lote vacío, incluso si el
servidor impone un límite menor. No se agregan migraciones, grants ni cambios de
base para esta funcionalidad.

## Preparar y comprobar

1. Iniciá sesión con conexión y abrí `/orders`.
2. Esperá **Órdenes recientes disponibles sin conexión**. Si la preparación falla,
   no se promete disponibilidad: se conserva el último snapshot completo y se
   informa la preparación incompleta.
3. Desconectá la PC o usá Network > Offline en las herramientas del navegador.
   Recargá `/orders`, recorré las páginas y abrí una orden reciente aunque nunca
   hayas visitado su detalle. El aviso **Modo offline** identifica datos locales.
4. Abrí **Imprimir ticket**. Las condiciones y la tabla son las mismas que online;
   la impresión no incluye presupuesto, dirección, estado, resolución ni retiro.
5. Creá una orden sin conexión, recargá e imprimila. Debe mostrar **Pendiente de
   sincronización**, sin número oficial. Reconectá para enviarla. Los errores de
   validación/aplicación requieren **Reintentar sincronización**; los errores de
   red detienen la cola sin borrarla.
6. Cerrá sesión usando **Salir**. La navegación espera la limpieza privada; otras
   pestañas pierden el acceso al cambiar la identidad. Nunca uses un perfil de
   navegador compartido como sustituto del control de acceso del sistema.

La sesión local verificada tiene vencimiento. Si vence estando offline, se debe
renovar con conexión antes de volver a escribir o habilitar los datos locales.
No se usa `getSession()` para autorizar: únicamente se lee su expiración después
de verificar identidad con `getUser()`.

## Actualización, seguridad y recuperación

- TTL de 120 segundos, sin polling: se comprueba al entrar al listado, enfocar la
  aplicación o reconectar. Crear, editar, borrar y sincronizar invalidan la copia.
- Web Locks coordina actualizaciones y envíos entre pestañas. En navegadores sin
  este mecanismo se informa que la preparación no está disponible, sin introducir
  un fallback de envíos concurrentes.
- IndexedDB v3 separa registros por propietario. La descarga completa se valida
  antes de una transacción que reemplaza el conjunto; un corte o falta de espacio
  no destruye el snapshot anterior ni los pendientes.
- Las colas antiguas `pendingCreates` de v1/v2 no tienen propietario verificable.
  Se conservan en cuarentena, fuera de `privatePending`. El shell informa su
  cantidad, pero nunca las muestra, reasigna ni envía automáticamente. Para
  recuperación manual explícita, el responsable debe verificar el origen y
  exportarlas desde IndexedDB con las herramientas del navegador, sin exponer
  datos personales en tickets o repositorios. No borrar la base ni limpiar todos
  los datos del sitio antes de recuperar estos pendientes.
- El service worker guarda un shell público y sus recursos, con hasta cuatro
  descargas de recursos simultáneas. Elimina las cachés de HTML privado antiguas
  al activarse. Solo sustituye una navegación de documento compatible cuando
  falla la red; no sustituye API, RSC, CSV, redirects ni errores HTTP normales.
- Antes de enviar, se reserva un recibo local pequeño; una confirmación recibida
  conserva su identificador aunque falle la escritura posterior en IndexedDB.
  Al recuperar espacio o renovar la sesión de la misma cuenta, se finaliza ese
  recibo sin repetir el POST. Un recibo de resultado incierto requiere revisión
  y reintento explícito con aviso de posible duplicación.
- Revocar o vencer la sesión bloquea el acceso, pero conserva los pendientes
  asociados a esa cuenta para una nueva autenticación verificada. **Salir** sí
  elimina los datos privados; los pendientes heredados sin dueño siguen en
  cuarentena.
- La exclusión mutua evita envíos locales simultáneos, no garantiza idempotencia
  distribuida: una respuesta perdida después de una creación confirmada en el
  servidor puede requerir conciliación manual antes de reintentar.

## Vista temporal conectada a producción

La vista privada usa la autenticación habitual y muestra **Vista local conectada
a datos reales**. Una modificación manual afecta los datos reales. No es una
sandbox ni un despliegue en Vercel.

Se sirve únicamente por HTTPS de Tailscale, sin Funnel y sin cambiar ACLs. Para
revisarla desde otra PC, esa PC debe pertenecer a la misma tailnet y tener acceso
al dispositivo. El cierre programado ocurre dos horas después de verificar su
disponibilidad; también puede cerrarse antes con el comando entregado junto a
la URL. Al detenerla, se elimina solo la ruta Serve creada para esta vista.

Los scripts de pruebas automáticas emplean exclusivamente endpoints y cuentas
sintéticos y no copian archivos `.env` ni credenciales reales. Ver
`docs/offline-testing.md` para comandos, métricas y limitaciones de la
verificación reproducible.
