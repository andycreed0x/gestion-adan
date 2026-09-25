# Servicio Técnico ADAN Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar una aplicación Next.js protegida por contraseña para operar órdenes de reparación, con Supabase como backend y Vercel como destino de producción.

**Architecture:** Next.js App Router separa las páginas, componentes de formulario, acciones servidoras y utilidades de dominio. Supabase SSR mantiene las sesiones en cookies; PostgreSQL aplica integridad, secuencias, auditoría, RLS y Storage privado. Un endpoint cron de Vercel usa una clave exclusivamente servidor para consultar órdenes vencidas.

**Tech Stack:** Next.js, React, TypeScript estricto, Vitest, Zod, Supabase JS, `@supabase/ssr`, PostgreSQL 17, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-25-repair-orders-design.md`

## Global Constraints

- Usar TypeScript estricto y App Router.
- Nunca commitear claves ni prefijar una clave secreta con `NEXT_PUBLIC_`.
- Habilitar RLS en toda tabla de `public` y usar políticas `TO authenticated` explícitas.
- Mantener el presupuesto como centavos enteros y no usar `float`.
- Crear migraciones SQL versionadas y aplicar el mismo SQL a Supabase.
- Probar cada comportamiento de dominio en RED → GREEN antes del código de producción.
- Crear commits convencionales por unidad de trabajo, con pruebas y documentación asociadas.

## Review Focus

- Número correlativo concurrente: la base debe asignar el identificador sin consultar `max + 1`; se prueba en Task 2 con identity y restricción única.
- Presupuesto inválido: valores negativos, no numéricos o con más de dos decimales deben rechazar el formulario; se prueba en Task 3.
- Retiro inconsistente: fecha de retiro debe normalizar el estado a `picked_up`; se prueba en Task 3.
- Acceso anónimo: ninguna tabla ni objeto de Storage debe quedar accesible sin sesión; se inspecciona con políticas y consultas en Task 2 y Task 6.
- Archivos peligrosos: nombres originales no pueden controlar rutas de Storage; se prueba el generador de rutas en Task 5.

---

## File Structure

- `package.json` — scripts y versiones exactas de dependencias.
- `src/lib/orders.ts` — validación, dinero, estados, ticket, vencimiento y parseo histórico puro.
- `src/lib/orders.test.ts` — pruebas de dominio sin red.
- `src/lib/supabase/{browser,server,admin,middleware}.ts` — clientes Supabase por entorno.
- `src/app/login/*` — formulario y acción de autenticación.
- `src/app/(app)/*` — layout protegido, dashboard, listado, formulario, ticket y reportes.
- `src/app/api/cron/overdue/route.ts` — endpoint cron protegido.
- `src/components/*` — interfaz reutilizable del formulario, adjuntos y botón de impresión.
- `supabase/migrations/*.sql` — esquema, triggers, RLS y Storage.
- `scripts/import-legacy-orders.mjs` — importación validada del archivo de Tkinter.
- `scripts/apply-migration.mjs` — aplica migraciones mediante una conexión de administración definida sólo por entorno.
- `vercel.json` — invocación diaria del cron.
- `.env.example` — nombres de variables sin valores secretos.
- `README.md` — instalación, despliegue, migración e importación.

### Task 1: Bootstrap, documentación y pruebas de dominio

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `src/lib/orders.ts`, `src/lib/orders.test.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `.env.example`, `README.md`
- Modify: `.gitignore`
- Test: `src/lib/orders.test.ts`

**Interfaces:**
- Produces: `parseOrderInput(input)`, `formatCurrency(cents)`, `makeAttachmentPath(orderId, name)`, `isOverdue(order, today)`, `parseLegacyLine(line)`.
- Consumes: no earlier application interfaces.

- [ ] **Step 1: Write failing domain tests**

```ts
expect(parseOrderInput({ customerName: '', equipment: 'TV' }).success).toBe(false)
expect(parseOrderInput({ customerName: 'Ana', equipment: 'TV', budget: '12,50' }).data.budgetCents).toBe(1250)
expect(makeAttachmentPath('order-id', '../foto.png')).toMatch(/^order-id\/[a-f0-9-]+\.png$/)
```

- [ ] **Step 2: Run the focused test to verify RED**

Run: `npm test -- src/lib/orders.test.ts`
Expected: FAIL because `src/lib/orders.ts` does not export the tested functions.

- [ ] **Step 3: Implement minimal domain functions and app shell**

```ts
export function formatCurrency(cents: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(cents / 100)
}
```

Use Zod for form parsing, generate random attachment filenames, and create the public home redirecting to `/orders`.

- [ ] **Step 4: Run focused and full tests**

Run: `npm test -- src/lib/orders.test.ts && npm test`
Expected: PASS with zero failing tests.

- [ ] **Step 5: Commit the work unit**

```bash
git add .gitignore package.json package-lock.json tsconfig.json next.config.ts vitest.config.ts src docs README.md .env.example
git commit -m "feat: bootstrap repair order application"
```

### Task 2: PostgreSQL schema, RLS and migration application

**Files:**
- Create: `supabase/migrations/202609250001_create_repair_orders.sql`, `scripts/apply-migration.mjs`, `scripts/verify-schema.mjs`
- Modify: `README.md`, `.env.example`
- Test: SQL assertions in `scripts/verify-schema.mjs`

**Interfaces:**
- Consumes: domain status values from `src/lib/orders.ts`.
- Produces: tables `profiles`, `customers`, `repair_orders`, `repair_order_events`, `repair_order_attachments`; bucket `order-attachments`; RLS policies and `private` trigger functions.

- [ ] **Step 1: Write a failing schema verifier**

```js
const tables = await query(`select tablename from pg_tables where schemaname = 'public'`)
assert(tables.includes('repair_orders'))
assert.equal(await scalar(`select relrowsecurity from pg_class where oid = 'public.repair_orders'::regclass`), true)
```

- [ ] **Step 2: Run verifier before migration**

Run: `SUPABASE_DB_URL="$SUPABASE_DB_URL" node scripts/verify-schema.mjs`
Expected: FAIL because `repair_orders` does not exist.

- [ ] **Step 3: Implement and apply migration**

Create the migration with UUID primary keys, a `bigint generated by default as identity (start with 9380)` order number, check constraints, audit and timestamp triggers in `private`, authenticated-staff policies, indexes for status/date, a private attachment bucket and policies. Apply every migration inside a transaction through `scripts/apply-migration.mjs`.

- [ ] **Step 4: Verify migration and RLS**

Run: `SUPABASE_DB_URL="$SUPABASE_DB_URL" node scripts/verify-schema.mjs`
Expected: PASS and print tables, enabled RLS and next order number 9380.

- [ ] **Step 5: Commit the work unit**

```bash
git add supabase scripts README.md .env.example
git commit -m "feat: add secure Supabase repair order schema"
```

### Task 3: Supabase SSR authentication and protected navigation

**Files:**
- Create: `src/lib/supabase/browser.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/admin.ts`, `src/lib/supabase/middleware.ts`, `middleware.ts`, `src/app/login/page.tsx`, `src/app/login/actions.ts`, `src/app/login/login-form.tsx`, `src/app/(app)/layout.tsx`
- Modify: `src/app/page.tsx`, `.env.example`
- Test: `src/lib/orders.test.ts` auth-independent route guard tests where applicable

**Interfaces:**
- Consumes: environment variables documented in `.env.example`.
- Produces: `createBrowserClient()`, `createServerClient()`, `createAdminClient()`, `updateSession(request)` and the `/login` flow.

- [ ] **Step 1: Write failing tests for redirect-safe helpers**

```ts
expect(getSafeRedirect('/orders')).toBe('/orders')
expect(getSafeRedirect('https://attacker.test')).toBe('/orders')
```

- [ ] **Step 2: Run the focused test to verify RED**

Run: `npm test -- src/lib/orders.test.ts`
Expected: FAIL because the redirect helper is absent.

- [ ] **Step 3: Implement SSR clients and password login**

Use `@supabase/ssr`, call `signInWithPassword`, expose a logout server action, redirect unauthenticated users from `(app)` to `/login`, and preserve only local redirect paths.

- [ ] **Step 4: Run tests and build**

Run: `npm test && npm run build`
Expected: PASS and a successful production build.

- [ ] **Step 5: Commit the work unit**

```bash
git add src middleware.ts .env.example package.json package-lock.json
git commit -m "feat: add password authentication and protected routes"
```

### Task 4: Orders and customers CRUD

**Files:**
- Create: `src/app/(app)/orders/page.tsx`, `src/app/(app)/orders/new/page.tsx`, `src/app/(app)/orders/[id]/page.tsx`, `src/app/(app)/orders/actions.ts`, `src/components/order-form.tsx`, `src/components/order-table.tsx`
- Modify: `src/lib/orders.ts`, `src/lib/orders.test.ts`, `src/app/(app)/layout.tsx`
- Test: `src/lib/orders.test.ts`

**Interfaces:**
- Consumes: `parseOrderInput`, Supabase server client and schema tables.
- Produces: `createOrder(formData)`, `updateOrder(id, formData)`, `listOrders(query)`, `getOrder(id)`.

- [ ] **Step 1: Write failing state and money tests**

```ts
expect(parseOrderInput({ customerName: 'Ana', equipment: 'TV', budget: '-1' }).success).toBe(false)
expect(parseOrderInput({ customerName: 'Ana', equipment: 'TV', pickedUpOn: '2026-09-25' }).data.status).toBe('picked_up')
```

- [ ] **Step 2: Run focused tests to verify RED**

Run: `npm test -- src/lib/orders.test.ts`
Expected: FAIL because state normalization is not implemented.

- [ ] **Step 3: Implement server actions and pages**

Create or reuse a customer by normalized name/phone, insert or update an order through the session-bound server client, display validation errors, and render a search form plus status/date filters. Never build a PostgREST `or` string from unescaped user text; run the search on a bounded result set with the pure case-insensitive matcher.

- [ ] **Step 4: Run tests and build**

Run: `npm test && npm run build`
Expected: PASS and successful build.

- [ ] **Step 5: Commit the work unit**

```bash
git add src
git commit -m "feat: add repair order CRUD workflow"
```

### Task 5: Tickets, attachments, reporting, overdue cron and legacy import

**Files:**
- Create: `src/app/(app)/orders/[id]/print/page.tsx`, `src/components/print-button.tsx`, `src/components/attachment-form.tsx`, `src/app/(app)/reports/page.tsx`, `src/app/api/cron/overdue/route.ts`, `scripts/import-legacy-orders.mjs`, `scripts/import-legacy-orders.test.mjs`, `vercel.json`
- Modify: `src/lib/orders.ts`, `src/lib/orders.test.ts`, `README.md`, `.env.example`
- Test: `src/lib/orders.test.ts`, `scripts/import-legacy-orders.test.mjs`

**Interfaces:**
- Consumes: order ticket/domain helpers, attachments table/bucket and admin client.
- Produces: printable ticket, private attachment upload, dashboard report, protected cron response and legacy parser CLI.

- [ ] **Step 1: Write failing tests for overdue orders and legacy parsing**

```ts
expect(isOverdue({ receivedOn: '2026-06-26', status: 'received' }, new Date('2026-09-25'))).toBe(true)
expect(parseLegacyLine('N° Orden: 9380 | Cliente: Ana | Equipo: TV').orderNumber).toBe(9380)
```

- [ ] **Step 2: Run focused tests to verify RED**

Run: `npm test -- src/lib/orders.test.ts && node scripts/import-legacy-orders.test.mjs`
Expected: FAIL because the overdue and parser behavior is absent.

- [ ] **Step 3: Implement operational extras**

Render ticket data in print CSS, upload attachments under `orderId/randomUuid.ext`, calculate report totals in server pages, require `Authorization: Bearer $CRON_SECRET` for the cron route, and make the import CLI emit accepted rows and rejected rows without writing to the database by default.

- [ ] **Step 4: Run tests and build**

Run: `npm test && node scripts/import-legacy-orders.test.mjs && npm run build`
Expected: PASS and successful build.

- [ ] **Step 5: Commit the work unit**

```bash
git add src scripts vercel.json README.md .env.example
git commit -m "feat: add repair order operations and reporting"
```

### Task 6: Deploy, seed, runtime verification and documentation

**Files:**
- Create: `scripts/seed-admin.mjs`
- Modify: `README.md`, `.env.example`
- Test: deployed HTTP and Supabase Auth/Data API checks

**Interfaces:**
- Consumes: Vercel project, environment values and deployed build.
- Produces: production URL, an initial verified administrator created from `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD`, and a production verification record.

- [ ] **Step 1: Add deployment commands and variables to README**

Document `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and `CRON_SECRET`; label the last two server-only.

- [ ] **Step 2: Create/link Vercel project and set environment values**

Run `vercel project add gestion-adan`, then use the CLI to link and set Production environment values without writing them to files. Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` and a generated `CRON_SECRET` to Production.

- [ ] **Step 3: Seed the initial administrator**

Create `scripts/seed-admin.mjs` that calls `supabase.auth.admin.createUser({ email, password, email_confirm: true })` with `SUPABASE_SECRET_KEY`, `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD`. Run it with a generated password and retain the credential only for the final handoff.

- [ ] **Step 4: Deploy production**

Run: `vercel --prod --yes`
Expected: production deployment URL printed by CLI.

- [ ] **Step 5: Verify deployed behavior**

Run: `curl -fsS "$DEPLOYMENT_URL/login"`, `curl -I "$DEPLOYMENT_URL/orders"`, a password grant request for the seeded administrator, and the protected cron endpoint with its configured secret.
Expected: login HTML returns 200, orders redirects without a session, password grant returns 200, cron returns JSON 200 with valid authorization and 401 without it.

- [ ] **Step 6: Commit and push**

```bash
git add README.md .env.example
git commit -m "docs: document production deployment"
git push -u origin feat/repair-orders
```

After final review, merge the verified feature branch into `main` and push `main` because the remote repository started empty.
