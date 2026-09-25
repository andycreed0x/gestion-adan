# Servicio Técnico ADAN

Aplicación web para gestionar órdenes de reparación, desplegada en Vercel y respaldada por Supabase.

## Requisitos

- Node.js 22 o superior
- Un proyecto Supabase con una contraseña de base de datos
- Vercel CLI autenticado para desplegar

## Desarrollo local

```bash
cp .env.example .env.local
npm install
npm test
npm run build
npm run dev
```

## Variables de entorno

| Variable | Uso | Exposición |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase | Navegador |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Clave pública de Supabase | Navegador |
| `SUPABASE_SECRET_KEY` | Cron y alta administrativa | Sólo servidor |
| `CRON_SECRET` | Autoriza la ruta cron | Sólo servidor |
| `SUPABASE_DB_URL` | Aplicación/verificación de migraciones | Sólo entorno administrativo |
| `INITIAL_ADMIN_EMAIL` | Cuenta inicial | Sólo bootstrap |
| `INITIAL_ADMIN_PASSWORD` | Contraseña inicial | Sólo bootstrap |

Nunca se deben commitear archivos `.env*` con valores reales.

## Base de datos

Las migraciones viven en `supabase/migrations/`. Para aplicar y verificar la base administrativamente se usa una URL de PostgreSQL sólo en la terminal:

```bash
export SUPABASE_DB_URL='postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres?sslmode=require'
node scripts/apply-migration.mjs
node scripts/verify-schema.mjs
```

La aplicación crea órdenes a partir de la secuencia de base de datos que inicia en `9380`. No calcula el siguiente número en el navegador.

## Supabase CLI

```bash
npx supabase@2.117.0 migration list --db-url "$SUPABASE_DB_URL"
npx supabase@2.117.0 db advisors --db-url "$SUPABASE_DB_URL" --type all
```

## Importación histórica

El importador revisa el archivo del programa anterior y genera JSON sin insertar datos automáticamente:

```bash
node scripts/import-legacy-orders.mjs /ruta/ordenes_servicio.txt
```

Las filas inválidas quedan en `rejected`; revisalas antes de convertir el resultado en una carga real.

## Cron de órdenes vencidas

`vercel.json` agenda una consulta de lunes a viernes a las 20:30 UTC. La ruta requiere `Authorization: Bearer $CRON_SECRET` y devuelve el conteo de órdenes abiertas con más de 90 días.

## Deploy en Vercel

Crear y vincular el proyecto desde la carpeta de la aplicación:

```bash
vercel project add gestion-adan
vercel link --yes --project gestion-adan
```

Configurar en Production las variables de la tabla anterior. Las dos variables `NEXT_PUBLIC_*` se pueden exponer al navegador; `SUPABASE_SECRET_KEY` y `CRON_SECRET` deben cargarse como secretos de Vercel.

```bash
vercel --prod --yes
```

## Usuario inicial

Para crear el primer usuario administrativo, ejecutar una vez con secretos únicamente en la terminal:

```bash
INITIAL_ADMIN_EMAIL='admin@gestion-adan.local' \
INITIAL_ADMIN_PASSWORD='cambiar-por-una-contraseña-segura' \
NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
SUPABASE_SECRET_KEY="$SUPABASE_SECRET_KEY" \
node scripts/seed-admin.mjs
```

Cambiá la contraseña inicial tras el primer acceso.
