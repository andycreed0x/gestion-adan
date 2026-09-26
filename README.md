# Servicio Técnico ADAN

Aplicación web y cliente de escritorio para gestionar órdenes de reparación, respaldados por Supabase.

## Requisitos

- Node.js 22 o superior para la aplicación web
- Python 3.12 o superior y uv para el escritorio
- Un proyecto Supabase con una contraseña de base de datos
- Vercel CLI autenticado para desplegar

## Desarrollo local web

~~~bash
cp .env.example .env.local
npm install
npm test
npm run build
npm run dev
~~~

## Variables de entorno

| Variable | Uso | Exposición |
| --- | --- | --- |
| SUPABASE_URL | URL de Supabase para el cliente de escritorio | Sólo máquina local |
| NEXT_PUBLIC_SUPABASE_URL | URL del proyecto Supabase | Navegador |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Clave pública de Supabase | Navegador |
| SUPABASE_SECRET_KEY | Cron, administración y cliente escritorio | Sólo entorno confiable |
| CRON_SECRET | Autoriza la ruta cron | Sólo servidor |
| SUPABASE_DB_URL | Aplicación/verificación de migraciones | Sólo entorno administrativo |
| INITIAL_ADMIN_EMAIL | Cuenta inicial | Sólo bootstrap |
| INITIAL_ADMIN_PASSWORD | Contraseña inicial | Sólo bootstrap |

Nunca se deben commitear archivos .env con valores reales.

## Cliente de escritorio Tkinter

El programa de escritorio vive en apps/desktop/gestion.py; no forma parte del
directorio src de Next.js. Conserva el flujo de órdenes del programa original
pero guarda y consulta las tablas online de Supabase.

1. Copiá apps/desktop/.env.example a .env en la raíz del repositorio.
2. Completá sólo los valores locales:

~~~bash
SUPABASE_URL=https://TU_PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=tu-clave-de-servidor
~~~

SUPABASE_URL puede omitirse si ya existe NEXT_PUBLIC_SUPABASE_URL en ese
archivo. La clave de servidor permite operar sin una pantalla de login, por lo
que el escritorio debe ejecutarse únicamente en equipos confiables y el
archivo .env nunca debe versionarse ni distribuirse.

3. Instalá las dependencias y abrí el programa:

~~~bash
cd apps/desktop
uv sync
uv run python gestion.py
~~~

El botón Crear archivo de ejemplo genera
~/ServicioTecnicoADAN/ordenes_servicio_ejemplo.txt. Usá luego Importar archivo
legado para revisar los conteos y cargar las filas válidas. La importación
conserva el número histórico y se puede reintentar: actualiza por order_number
en vez de crear duplicados. La copia automática de lunes a viernes a las 17:30
exporta el estado online al formato anterior en
~/ServicioTecnicoADAN/Backups/<día>/ordenes_servicio.txt.

## Base de datos

Las migraciones viven en supabase/migrations. Para aplicar y verificar la base
administrativamente se usa una URL de PostgreSQL sólo en la terminal:

~~~bash
export SUPABASE_DB_URL='postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres?sslmode=require'
node scripts/apply-migration.mjs
node scripts/verify-schema.mjs
~~~

La aplicación crea órdenes a partir de la secuencia de base de datos que inicia
en 9380. No calcula el siguiente número en el navegador.

Antes de importar órdenes históricas en una base compartida, aplicá la
migración sync_repair_order_sequence. El trigger privado que incorpora adelanta
la secuencia si la importación aporta un número mayor, evitando que una orden
nueva choque con un número legado:

~~~bash
export SUPABASE_DB_URL='postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres?sslmode=require'
node scripts/apply-migration.mjs
node scripts/verify-schema.mjs
~~~

## Supabase CLI

~~~bash
npx supabase@2.117.0 migration list --db-url "$SUPABASE_DB_URL"
npx supabase@2.117.0 db advisors --db-url "$SUPABASE_DB_URL" --type all
~~~

## Importación histórica por terminal

El importador revisa el archivo del programa anterior y genera JSON sin insertar
datos automáticamente:

~~~bash
node scripts/import-legacy-orders.mjs /ruta/ordenes_servicio.txt
~~~

Las filas inválidas quedan en rejected; revisalas antes de convertir el
resultado en una carga real. Para insertar desde la interfaz de escritorio,
usá el flujo documentado arriba tras aplicar la migración de secuencia.

## Cron de órdenes vencidas

vercel.json agenda una consulta de lunes a viernes a las 20:30 UTC. La ruta
requiere Authorization: Bearer $CRON_SECRET y devuelve el conteo de órdenes
abiertas con más de 90 días.

## Deploy en Vercel

Crear y vincular el proyecto desde la carpeta de la aplicación:

~~~bash
vercel project add gestion-adan
vercel link --yes --project gestion-adan
~~~

Configurar en Production las variables de la tabla anterior. Las dos variables
NEXT_PUBLIC_* se pueden exponer al navegador; SUPABASE_SECRET_KEY y
CRON_SECRET deben cargarse como secretos de Vercel.

~~~bash
vercel --prod --yes
~~~

## Usuario inicial

Para crear el primer usuario administrativo, ejecutar una vez con secretos
únicamente en la terminal:

~~~bash
INITIAL_ADMIN_EMAIL='admin@gestion-adan.local' \
INITIAL_ADMIN_PASSWORD='cambiar-por-una-contraseña-segura' \
NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
SUPABASE_SECRET_KEY="$SUPABASE_SECRET_KEY" \
node scripts/seed-admin.mjs
~~~

Cambiá la contraseña inicial tras el primer acceso.

### Clientes por teléfono y operación sin conexión

La aplicación web identifica al cliente por su teléfono argentino cuando está
presente. Conserva el formato escrito en `customers.phone` y usa una versión
canónica interna para reconocer variantes como `11 4444-5555`, `+54 11
4444-5555` y `+54 9 11 4444-5555`.

La migración `normalize_customer_phone_identity` conserva el cliente duplicado
más recientemente actualizado, mueve allí sus órdenes y elimina los duplicados
antes de aplicar unicidad para teléfonos normalizables. Los teléfonos históricos
que no puedan normalizarse se conservan como texto y no se fusionan.
