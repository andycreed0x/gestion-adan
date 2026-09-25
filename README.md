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
