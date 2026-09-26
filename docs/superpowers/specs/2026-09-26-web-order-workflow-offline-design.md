# Diseño: operación web de órdenes con trabajo sin conexión

## Objetivo

Acelerar la carga diaria de órdenes, identificar clientes por teléfono y permitir consultar, imprimir y crear órdenes aun durante un corte de internet, sin presentar como persistida una orden que todavía sólo existe en el navegador.

## Alcance acordado

- El formulario de orden recorre los controles en orden visual al presionar Enter. En los campos de texto largo, Shift+Enter conserva el salto de línea.
- Teléfono es el primer dato de cliente y no es obligatorio. Si contiene un número argentino válido, Enter busca el cliente; si lo encuentra completa nombre y dirección. Guardar actualiza el mismo cliente encontrado.
- El listado inicial contiene hoy y los 29 días calendario anteriores en `America/Argentina/Buenos_Aires`. Sin filtros activos, ésa es la única ventana. Cualquier filtro activo consulta todo el historial sujeto a ese filtro.
- El listado pagina 25 filas por página, conserva filtros en la URL y ofrece Anterior/Siguiente. Fuera de la ventana reciente, sólo se navega online.
- El navegador conserva lista y detalle de las órdenes recientes, más las vistas HTML de detalle e impresión necesarias para navegación offline. Sólo se muestra el aviso “Sin conexión” al usar esos datos cacheados.
- Sin conexión se pueden crear órdenes nuevas, consultar datos cacheados e imprimir tanto órdenes persistidas como pendientes. Las ediciones de órdenes existentes requieren conexión.
- Una orden offline se identifica como “Orden pendiente”, no recibe número estimado y advierte que no fue persistida. Cuando vuelve la conexión, se sincroniza automáticamente y recibe el número oficial de PostgreSQL. Los fallos no transitorios permanecen visibles y reintentables.
- La vista de detalle contiene Nueva orden, Imprimir ticket y Enviar por WhatsApp. WhatsApp usa el teléfono del cliente y un mensaje completo URL-codificado; requiere una orden persistida, teléfono válido y conectividad.

## Modelo de teléfono y clientes

`customers.phone` conserva el valor visible ingresado. Se agrega `customers.phone_normalized`, con unicidad parcial para valores no nulos.

La normalización acepta números argentinos locales de diez dígitos y sus presentaciones con `54` o `549`; elimina espacios, signos, guiones y el prefijo móvil `9` cuando sigue a `54`. El valor canónico siempre es `549` seguido de los diez dígitos locales. Un teléfono vacío se almacena como `NULL` canónico; un teléfono no vacío fuera de ese formato se rechaza en el formulario y en la API.

La migración normaliza datos existentes. Para cada teléfono canónico duplicado conserva el cliente con `updated_at` más reciente (desempate por `created_at`, luego `id`), reasigna allí todas las `repair_orders` de los duplicados y elimina esos registros antes de crear el índice único. Registros históricos con teléfono no vacío que no puedan normalizarse conservan su texto, quedan sin identificador canónico y no participan de la fusión; el formulario impedirá introducir nuevos valores inválidos.

Con teléfono canónico se busca y actualiza ese cliente. Sin teléfono se crea un cliente por orden y nunca se intenta deduplicar por nombre o dirección.

## Arquitectura

El servidor mantiene una única capa de aplicación para validar, resolver clientes, crear/actualizar órdenes y paginar. Las server actions y rutas API la reutilizan. Las rutas JSON autenticadas permiten la búsqueda de teléfono, el refresco de lista y la sincronización de la cola offline con la misma sesión Supabase; no exponen la clave secreta.

La aplicación instala un service worker propio que cachea sólo el shell y las respuestas GET autenticadas de `/orders`, detalles recientes e impresión. IndexedDB mantiene las representaciones de órdenes recientes, clientes conocidos y la cola de altas locales. La UI decide entre red y caché; el service worker sirve una respuesta exacta cacheada sólo tras un fallo de red. Al cerrar sesión se borran Cache Storage e IndexedDB para que datos internos no alcancen a otro usuario del mismo navegador.

## Interfaz y estados

- Los controles inválidos llevan borde rojo, texto de ayuda y `aria-invalid`; Guardar está deshabilitado hasta que la validación local sea correcta. La API revalida y, ante error, devuelve errores por campo sin limpiar el formulario.
- El teléfono se consulta al confirmar con Enter o al perder foco. Si no hay coincidencia, deja nombre y dirección editables sin advertencia bloqueante. Si no hay red, usa el índice local de clientes cacheados antes de permitir continuar.
- La orden pendiente aparece en lista y detalle con identificador local interno, rótulo “Orden pendiente de sincronización” y datos editables sólo antes de guardar. Imprimir abre la misma presentación de ticket con la leyenda pendiente; no muestra número oficial.
- La reconexión dispara sincronización al iniciar la app y en cada evento `online`. El proceso envía una alta por vez en el orden de creación, elimina de la cola sólo después de recibir el `id` y `order_number` del servidor, y refresca la caché. Un error de red detiene el ciclo sin perder la cola; una respuesta 4xx/5xx queda marcada para reintento explícito y muestra su motivo.
- El mensaje de WhatsApp incluye número de orden, cliente, teléfono, dirección, equipo, accesorios, falla, resolución, presupuesto, estado, fecha de ingreso y fecha de retiro. Se abre como `https://wa.me/<teléfono-canónico>?text=<mensaje-codificado>`.

## Seguridad y compatibilidad

- Las tablas y vistas expuestas siguen protegidas por RLS para `authenticated`; no se agrega ninguna clave privada al navegador.
- La vista de consulta de órdenes usa `security_invoker = true` y acceso sólo de usuarios autenticados, por lo que conserva las políticas de las tablas subyacentes.
- La cola offline contiene únicamente datos ya visibles para el usuario autenticado y se elimina al cerrar sesión. No se sincronizan actualizaciones offline para evitar conflictos entre operadores.
- El número definitivo lo asigna exclusivamente la identity de PostgreSQL al sincronizar; el navegador nunca calcula un correlativo.

## Aceptación

1. Enter sigue el orden de carga y Shift+Enter agrega una línea en textos largos.
2. Los errores se ven antes de guardar, el botón no permite envíos inválidos y el texto ingresado persiste ante un rechazo de servidor.
3. Variantes locales, `+54` y `+54 9` del mismo teléfono recuperan el mismo cliente; guardar actualiza sus datos y no crea duplicados.
4. Sin filtros se ven sólo 30 días argentinos; filtros e historial se paginan de a 25 filas.
5. Al desconectar se pueden listar, abrir detalle e imprimir órdenes recientes cacheadas, con “Sin conexión” visible. Las páginas no cacheadas no afirman estar disponibles.
6. Una alta offline se conserva tras recargar, se imprime como pendiente y se sincroniza al recuperar conexión, obteniendo después su número oficial sin duplicarse.
7. WhatsApp abre con un resumen completo sólo para una orden persistida con teléfono válido.

## Verificación operativa

La validación de navegador se realiza con una sesión autenticada y la migración
de teléfono aplicada. Debe probarse la búsqueda de un mismo cliente con
`11 4444-5555`, `+54 11 4444-5555` y `+54 9 11 4444-5555`; el primer listado
sin filtros para confirmar la ventana argentina de 30 días; y un rango anterior
para recorrer el historial de 25 filas por página.

Después de dejar terminar la precarga reciente, DevTools en modo Offline debe
permitir navegar todas las páginas cacheadas, abrir un detalle e imprimirlo con
el aviso `Sin conexión`. En ese estado también se crea e imprime una orden
`Pendiente de sincronización`, sin número. Al restaurar la conexión, debe
sincronizarse sola y recibir el número oficial. Finalmente, cerrar sesión y
probar Offline tras un nuevo login confirma que Cache Storage e IndexedDB se
limpiaron. La aceptación completa, incluidos pasos y comandos de migración,
queda reproducible en el README.
