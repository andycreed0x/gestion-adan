# Servicio Técnico ADAN — Diseño de implementación

## Objetivo

Crear una aplicación web para administrar órdenes de reparación de Servicio Técnico ADAN, reemplazando el programa Tkinter y su archivo de texto local por una aplicación Next.js desplegada en Vercel y una base de datos Supabase.

## Usuarios y acceso

- Sólo personal interno autenticado puede acceder a la aplicación.
- El ingreso usa email y contraseña de Supabase Auth.
- No se muestra registro público.
- Todos los usuarios autenticados son personal del mismo servicio técnico y pueden consultar y operar las órdenes. Los perfiles quedan preparados para incorporar roles más específicos sin cambiar el modelo.

## Alcance funcional

### Parte 1: operación diaria

1. Iniciar y cerrar sesión.
2. Ver una lista de órdenes con búsqueda por número, cliente, teléfono o equipo.
3. Crear y editar órdenes con cliente, equipo, accesorios, falla, resolución, presupuesto, estado y fecha de retiro.
4. Generar números correlativos desde 9380 en la base de datos.
5. Consultar una página imprimible de ticket.
6. Proteger datos mediante RLS y no exponer claves servidoras al navegador.

### Parte 2: operación ampliada

1. Reutilizar clientes entre órdenes.
2. Mantener eventos de auditoría para altas, ediciones y cambios de estado.
3. Adjuntar archivos o fotos privadas a las órdenes.
4. Mostrar reportes de órdenes abiertas, listas, retiradas y vencidas por la regla de 90 días.
5. Exponer un endpoint de cron protegido para revisar órdenes no retiradas; por ahora responde con el conteo, sin integrar proveedores externos de email o WhatsApp.
6. Incluir un importador local para el formato de archivo histórico de Tkinter, con validación de filas.

## Arquitectura

Next.js App Router contiene las páginas protegidas, acciones servidoras, validación y la vista imprimible. Las consultas y mutaciones ordinarias usan clientes Supabase SSR asociados a la sesión del usuario. El endpoint cron usa un cliente servidor con la clave secreta únicamente en Vercel, y nunca en JavaScript público.

Supabase contiene Auth, PostgreSQL y Storage. La base utiliza migraciones SQL imperativas versionadas. Las políticas RLS permiten acceso completo a empleados autenticados porque el producto es una herramienta interna única; ninguna política depende de `user_metadata` editable.

## Modelo de datos

- `public.profiles`: perfil de un usuario Auth con rol futuro y fecha de creación.
- `public.customers`: nombre, dirección y teléfono del cliente.
- `public.repair_orders`: correlativo, cliente, descripción de equipo, accesorios, falla, resolución, presupuesto en centavos, estado, fechas y usuario creador.
- `public.repair_order_events`: auditoría de inserciones y cambios de órdenes.
- `public.repair_order_attachments`: metadatos de archivos en el bucket privado `order-attachments`.

`repair_orders.order_number` usa una identity de PostgreSQL que comienza en 9380, lo cual evita la condición de carrera del enfoque previo `max + 1`.

## Reglas de datos

- Cliente y descripción de equipo son obligatorios.
- El presupuesto es opcional, pero si existe se guarda como entero no negativo de centavos.
- Los estados válidos son `received`, `in_progress`, `ready`, `picked_up` y `cancelled`.
- Una orden `picked_up` necesita una fecha de retiro; al asignar fecha de retiro se marca como `picked_up` si todavía no lo está.
- Una orden abierta con más de 90 días desde su recepción se considera vencida para reportes; el cron no modifica ni elimina datos.
- Los adjuntos quedan en Storage privado y cada ruta contiene el UUID de su orden y un UUID de archivo, nunca el nombre original como ruta.

## Seguridad

- `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` son los únicos valores expuestos al navegador.
- `SUPABASE_SECRET_KEY` y `CRON_SECRET` sólo viven en variables de entorno de Vercel.
- RLS se habilita en todas las tablas expuestas del esquema `public`.
- Las funciones de trigger viven en el esquema no expuesto `private`, con `search_path` fijo y permisos revocados a `PUBLIC`.
- El bucket es privado y las políticas de Storage permiten sólo usuarios autenticados.

## Verificación de entrega

La entrega se acepta cuando:

1. Las pruebas unitarias pasan.
2. El build de Next.js pasa.
3. La migración existe en el repositorio y se aplicó al proyecto Supabase.
4. Una consulta de PostgreSQL confirma tablas, RLS y la secuencia inicial.
5. Un usuario administrador de prueba puede obtener una sesión con email y contraseña.
6. El deploy de Vercel responde `200` en `/login` y redirige una ruta protegida sin sesión.
7. El repositorio remoto contiene los commits de la implementación.
