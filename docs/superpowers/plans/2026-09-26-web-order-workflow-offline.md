# Web Order Workflow Offline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernizar el flujo web de órdenes para carga rápida por teclado, clientes identificados por teléfono, listado paginado de historial y operación/impresión offline segura de órdenes recientes.

**Architecture:** Extraer reglas de validación, teléfono, listado y persistencia a módulos compartidos que usan las páginas, server actions y rutas API. Agregar una migración de identidad de clientes, una vista `security_invoker` de lectura paginada y una capa PWA sin dependencias nuevas: service worker para documentos/activos e IndexedDB para datos recientes y altas pendientes. Las altas offline se sincronizan secuencialmente contra una API autenticada cuando vuelve la red; las ediciones existentes siguen siendo online.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript estricto, Zod 4, Vitest 5, Supabase SSR/JS 2, PostgreSQL/Supabase, Cache Storage, Service Worker e IndexedDB nativos.

**Spec:** `docs/superpowers/specs/2026-09-26-web-order-workflow-offline-design.md`

## Global Constraints

- Trabajar en la rama aislada `feat/web-order-workflow-offline` dentro de `.worktrees/web-order-workflow-offline`.
- Mantener Node.js `>=22`, TypeScript estricto y App Router; no añadir una librería PWA ni una clave privada al navegador.
- El número oficial de orden sólo lo asigna PostgreSQL; una orden offline se llama literalmente `Orden pendiente` y no recibe correlativo estimado.
- La ventana sin filtros es hoy más 29 días previos en `America/Argentina/Buenos_Aires`; cualquier filtro activo habilita la búsqueda en todo el historial y las páginas contienen 25 filas.
- El teléfono es opcional; si existe, normalizar a `549` + diez dígitos locales y usarlo como identificador único parcial. `phone` conserva el texto visible.
- Una orden offline puede crearse, navegarse e imprimirse, pero no editar una orden existente ni enviar WhatsApp; toda impresión pending incluye `Pendiente de sincronización` y omite número oficial.
- Invalidar visualmente antes de guardar, no borrar valores por error de validación y conservar la validación servidor como respaldo.
- Nunca commitear credenciales; mantener RLS y `security_invoker = true` para vistas de lectura expuestas.
- No iniciar servicios para esta implementación. Si una verificación manual inicia uno, detenerlo antes de terminar.
- Usar RED → GREEN por tarea y commits convencionales que contengan código, pruebas y documentación de la misma unidad.

## Review Focus

- Formatos argentinos equivalentes (`11 4444-5555`, `+54 11 4444-5555`, `+54 9 11 4444-5555`) deben resolver exactamente el mismo cliente; se prueba en Task 1 y Task 2.
- Un teléfono histórico no normalizable no debe abortar la migración ni participar de una fusión; se prueba con las aserciones de migración/verificador de Task 2.
- La primera página sin filtros no puede filtrar en memoria ni incluir una orden de hace 31 días; se prueba en Task 3 y Task 6.
- Un fallo de red durante la sincronización no puede duplicar ni descartar una alta pendiente; se prueba en Task 4 y Task 5.
- El caché de un usuario debe eliminarse al cerrar sesión, y el cartel `Sin conexión` no debe mostrarse cuando hay red; se prueba en Task 4 y Task 6.

---

## File Structure

- `src/lib/customer-phone.ts` — normalización, validación y tipos de teléfono argentino compartidos por cliente/API.
- `src/lib/orders.ts` — validación por campo y reglas de dominio de formularios, preservando el parser actual como adaptador de servidor.
- `src/lib/order-service.ts` — operaciones autenticadas reutilizables: resolver cliente, alta/edición y consulta paginada.
- `src/lib/order-list.ts` — constantes, parámetros URL y contratos de páginas de listado.
- `src/lib/offline/*` — contratos serializables, IndexedDB, cola de sincronización y funciones puras probadas sin DOM.
- `src/app/api/orders/route.ts` y `src/app/api/customers/by-phone/route.ts` — API JSON autenticada para datos de navegador y sincronización.
- `src/app/(app)/orders/*` — páginas SSR que entregan contenido online e hidratan componentes de lista/detalle con fallback cacheado.
- `src/components/order-form.tsx`, `orders-workspace.tsx`, `offline-runtime.tsx`, `offline-banner.tsx`, `order-ticket.tsx` — UI cliente con validación, navegación offline, impresión y estados de sincronización.
- `public/order-offline-sw.js` — service worker con cache de documentos GET privados, activos y mensajes de precarga/limpieza.
- `supabase/migrations/*_normalize_customer_phone_identity.sql` — migración generada que normaliza/fusiona clientes, agrega identidad y crea la vista paginada.
- `scripts/verify-schema.mjs` y `README.md` — verificaciones de base y operación offline.

### Task 1: Definir contratos de teléfono, validación por campo y representación imprimible

**Files:**
- Create: `src/lib/customer-phone.ts`
- Create: `src/lib/customer-phone.test.ts`
- Create: `src/lib/order-ticket.ts`
- Create: `src/lib/order-ticket.test.ts`
- Modify: `src/lib/orders.ts`
- Modify: `src/lib/orders.test.ts`

**Interfaces:**
- Produces: `normalizeArgentinePhone(raw: string): string | null`, `validateArgentinePhone(raw: string): string | null`, `OrderField`, `OrderDraft`, `validateOrderDraft(draft: OrderDraft): OrderValidation`, and `buildOrderTicketLines(ticket: OrderTicket): string[]`.
- Guarantees: canonical phone is `549` plus ten national digits; blank maps to `null`; nonblank invalid input has one Spanish error; `OrderValidation` retains all raw values and maps errors to fields.
- Consumes: no new interfaces.

- [ ] **Step 1: Write failing phone and validation tests**

```ts
expect(normalizeArgentinePhone('11 4444-5555')).toBe('5491144445555')
expect(normalizeArgentinePhone('+54 9 11 4444-5555')).toBe('5491144445555')
expect(validateArgentinePhone('123')).toBe('Ingresá un teléfono argentino válido')
expect(validateOrderDraft({ customerPhone: '123', customerName: 'Ana', equipment: 'TV' }).fieldErrors.customerPhone)
  .toBe('Ingresá un teléfono argentino válido')
```

Also test blank phone, budget errors, mandatory name/equipment, pickup date/status consistency, and a pending ticket containing `Pendiente de sincronización` without `N° Orden`.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `npm test -- src/lib/customer-phone.test.ts src/lib/orders.test.ts src/lib/order-ticket.test.ts`

Expected: FAIL because the contracts and field-error validator do not exist.

- [ ] **Step 3: Implement the pure domain contracts**

Create `src/lib/customer-phone.ts` as the single canonicalizer. Strip non-digits, accept local ten-digit values or values prefixed with `54`/`549`, and return `549${nationalDigits}` only for ten national digits. Keep the existing `parseOrderInput` public signature, but implement it by adapting `validateOrderDraft` so server actions retain identical business rules.

Create `src/lib/order-ticket.ts` with a serializable `OrderTicket` union for `{ persistence: 'persisted'; orderNumber: number }` and `{ persistence: 'pending' }`; pending output must include the fixed warning and omit the number line.

- [ ] **Step 4: Run focused and full domain tests to verify GREEN**

Run: `npm test -- src/lib/customer-phone.test.ts src/lib/orders.test.ts src/lib/order-ticket.test.ts && npm test`

Expected: PASS with all existing domain behavior retained.

- [ ] **Step 5: Commit the domain work unit**

```bash
git add src/lib/customer-phone.ts src/lib/customer-phone.test.ts src/lib/order-ticket.ts src/lib/order-ticket.test.ts src/lib/orders.ts src/lib/orders.test.ts
git commit -m "feat: validate order drafts and normalize phones"
```

### Task 2: Migrate customer phone identity and provide a safe paginated order view

**Files:**
- Create: generated `supabase/migrations/*_normalize_customer_phone_identity.sql`
- Modify: `scripts/verify-schema.mjs`
- Modify: `README.md`

**Interfaces:**
- Consumes: canonical-phone rule from Task 1.
- Produces: `customers.phone_normalized text`, private `normalize_argentine_phone(text)` and `set_customer_phone_normalized` trigger, unique partial `customers_phone_normalized_key`, and public `repair_order_list` view with `security_invoker = true`.
- Produces: view columns `id`, `order_number`, `equipment`, `status`, `budget_cents`, `received_on`, `picked_up_on`, `customer_name`, `customer_address`, `customer_phone`, `customer_phone_normalized` and `search_text`.

- [ ] **Step 1: Extend the schema verifier with failing assertions**

Add checks for the column, unique partial index, private trigger/function, the `security_invoker` view, its grant to `authenticated`, and an index supporting `received_on DESC, order_number DESC` paging.

```js
assert.equal(await scalar(`select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.repair_order_list'::regclass`), true)
assert.equal(await scalar(`select exists (select 1 from pg_indexes where indexname = 'customers_phone_normalized_key')`), true)
```

- [ ] **Step 2: Run the verifier before the migration to verify RED**

Run: `SUPABASE_DB_URL="$SUPABASE_DB_URL" node scripts/verify-schema.mjs`

Expected: FAIL for the missing phone identity/view assertions, or report the already documented missing administrative URL.

- [ ] **Step 3: Generate and implement the migration**

Run: `npx supabase@2.117.0 migration new normalize_customer_phone_identity`.

In the generated file, create a fixed-search-path private normalizer that returns `NULL` for blank or legacy-unparseable input; add/backfill `phone_normalized`; rank duplicates by `updated_at DESC, created_at DESC, id`, move their `repair_orders.customer_id` to the selected row, delete duplicate rows, then install the partial unique index and trigger. Create `repair_order_list` with `WITH (security_invoker = true)`, grant only `authenticated` select, and add the date/order paging index. Do not use `SECURITY DEFINER` for the view or its read path.

- [ ] **Step 4: Apply and verify against the administrative database when available**

Run: `SUPABASE_DB_URL="$SUPABASE_DB_URL" node scripts/apply-migration.mjs && SUPABASE_DB_URL="$SUPABASE_DB_URL" node scripts/verify-schema.mjs`

Expected: PASS; the verifier reports the required tables, phone identity and order-list view.

- [ ] **Step 5: Document the one-way customer merge**

Describe that the migration preserves the newest duplicate, moves its orders, deletes duplicates, and leaves unparseable historical phones unmatched rather than inventing identities.

- [ ] **Step 6: Commit the database work unit**

```bash
git add supabase/migrations scripts/verify-schema.mjs README.md
git commit -m "feat(db): identify customers by normalized phone"
```

### Task 3: Centralize authenticated order reads, customer lookup and writes behind reusable services

**Files:**
- Create: `src/lib/order-list.ts`
- Create: `src/lib/order-list.test.ts`
- Create: `src/lib/order-service.ts`
- Create: `src/lib/order-service.test.ts`
- Create: `src/app/api/orders/route.ts`
- Create: `src/app/api/customers/by-phone/route.ts`
- Modify: `src/app/(app)/orders/actions.ts`
- Modify: `src/app/(app)/orders/page.tsx`

**Interfaces:**
- Produces: `ORDER_PAGE_SIZE = 25`, `parseOrderListSearchParams`, `buildOrderListQuery`, `queryOrderPage(supabase, filters)`, `lookupCustomerByPhone(supabase, phone)`, `createOrder(supabase, userId, draft)`, and `updateOrder(supabase, orderId, draft)`.
- Produces: `GET /api/orders` returning `{ orders, page, pageSize, total, filters }`, `POST /api/orders` returning persisted order id/number, and `GET /api/customers/by-phone?phone=` returning customer or `null`.
- Guarantees: no filters means Argentina 30-day window; any `q`, `status`, `receivedFrom`, or `receivedTo` removes that implicit window; filtering happens before the 25-row range.

- [ ] **Step 1: Write failing list/service tests with fake Supabase builders**

```ts
expect(parseOrderListSearchParams(new URLSearchParams())).toMatchObject({ page: 1, pageSize: 25, implicitRecentWindow: true })
expect(parseOrderListSearchParams(new URLSearchParams('q=9380'))).toMatchObject({ implicitRecentWindow: false })
expect(buildOrderListQuery(fake, { page: 2, pageSize: 25 }).calls).toContainEqual(['range', 25, 49])
```

Cover `America/Argentina/Buenos_Aires` boundaries, query/status/date combinations, customer lookup by canonical value, updating a matched customer, creating a fresh customer for blank phone, and API 401/422/201 response shapes.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `npm test -- src/lib/order-list.test.ts src/lib/order-service.test.ts`

Expected: FAIL because shared list/service modules and API routes do not exist.

- [ ] **Step 3: Implement list contracts and Supabase service layer**

Use `repair_order_list` for all paged reads with exact count, stable `received_on DESC, order_number DESC` order, and range `(page - 1) * 25…page * 25 - 1`. Compute calendar boundaries with `Intl.DateTimeFormat(..., { timeZone: 'America/Argentina/Buenos_Aires' })`, not the host timezone. Resolve nonempty customer phones solely by `phone_normalized`; update name/address/visible phone of that record. With a blank phone, insert a new customer and do not apply former name/phone matching.

Make both existing server actions and JSON routes call these same functions. JSON routes require a Supabase session and return field errors as 422 JSON instead of redirecting; preserve existing action redirects for the online edit form.

- [ ] **Step 4: Replace the 250-row in-memory listing**

Change `/orders` SSR to use `queryOrderPage` and pass its typed response to later client workspace code. Keep all filter values and `page` in generated navigation links; show total and the real current page rather than `tableOrders.length` alone.

- [ ] **Step 5: Run focused, full and type tests to verify GREEN**

Run: `npm test -- src/lib/order-list.test.ts src/lib/order-service.test.ts && npm test && npm run typecheck`

Expected: PASS; no source still queries `repair_orders` with `.limit(250)` for the main list.

- [ ] **Step 6: Commit the server/API work unit**

```bash
git add src/lib/order-list.ts src/lib/order-list.test.ts src/lib/order-service.ts src/lib/order-service.test.ts src/app/api src/app/'(app)'/orders/actions.ts src/app/'(app)'/orders/page.tsx
git commit -m "feat: paginate orders through shared services"
```

### Task 4: Build the private browser cache, queue and service-worker boundary

**Files:**
- Create: `src/lib/offline/types.ts`
- Create: `src/lib/offline/order-store.ts`
- Create: `src/lib/offline/order-store.test.ts`
- Create: `src/lib/offline/sync.ts`
- Create: `src/lib/offline/sync.test.ts`
- Create: `src/components/offline-runtime.tsx`
- Create: `src/components/offline-banner.tsx`
- Create: `src/components/logout-button.tsx`
- Create: `public/order-offline-sw.js`
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/app/login/actions.ts`

**Interfaces:**
- Produces: browser-only `OrderStore` methods `putRecentPage`, `putOrder`, `findCachedCustomer`, `enqueueCreate`, `listPending`, `replacePendingWithPersisted`, `markSyncFailure`, and `clear`.
- Produces: `syncPendingOrders(store, postOrder): Promise<SyncResult>` and an `OfflineRuntime` that calls it on initial load and `online`.
- Produces: service-worker messages `CACHE_ORDER_ROUTES`, `CACHE_NEW_ORDER_ROUTE`, and `CLEAR_PRIVATE_ORDER_CACHE`.
- Guarantees: queued records retain a UUID `localId`, raw validated draft, creation timestamp and sync error; they are removed only after a successful API response.

- [ ] **Step 1: Write failing store and synchronizer tests with an in-memory adapter**

```ts
await store.enqueueCreate(pending)
await expect(syncPendingOrders(store, postOrder)).resolves.toMatchObject({ synced: 1 })
expect(await store.getPending(pending.localId)).toBeNull()
```

Test cache replacement after a success, network error retaining the item/stopping later sends, 422 retaining the item with its server message, FIFO ordering, cached customer lookup, and `clear()` emptying all stores.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `npm test -- src/lib/offline/order-store.test.ts src/lib/offline/sync.test.ts`

Expected: FAIL because the offline modules do not exist.

- [ ] **Step 3: Implement IndexedDB behind a testable adapter**

Use database name `adan-orders-v1` with object stores `orders`, `customers`, and `pendingCreates`; keep database access in browser-only code and inject a memory adapter in tests. Store complete recent detail payloads, not just table rows. Implement sequential sync using `POST /api/orders`; treat only a network failure as a temporary stop, and preserve HTTP/API failures with their text for manual retry.

- [ ] **Step 4: Implement service worker registration, cache policy and logout cleanup**

`OfflineRuntime` registers `/order-offline-sw.js`, tracks `navigator.onLine`, triggers sync on startup/reconnection, and sends detail/print URLs from fresh recent data to the worker. The worker caches static assets plus successful GET navigation responses for `/orders`, `/orders/new`, `/orders/<id>`, and `/orders/<id>/print`; network is preferred and exact cached responses are used only when fetch fails. It must never cache API POSTs or serve a different user’s data after receiving cleanup.

Replace the server-rendered logout button with `LogoutButton`, which sends the cleanup message and clears IndexedDB before submitting the existing logout action. `OfflineBanner` renders only when offline cached data is being displayed.

- [ ] **Step 5: Run offline unit tests and typecheck to verify GREEN**

Run: `npm test -- src/lib/offline/order-store.test.ts src/lib/offline/sync.test.ts && npm run typecheck`

Expected: PASS; browser-specific global objects are not evaluated by Node tests.

- [ ] **Step 6: Commit the offline infrastructure work unit**

```bash
git add src/lib/offline src/components/offline-runtime.tsx src/components/offline-banner.tsx src/components/logout-button.tsx public/order-offline-sw.js src/app/'(app)'/layout.tsx src/app/login/actions.ts
git commit -m "feat: cache recent orders and queue offline creates"
```

### Task 5: Convert the order form to client-side validated, keyboard-first creation with offline persistence

**Files:**
- Create: `src/components/order-form.test.ts`
- Create: `src/components/pending-order-detail.tsx`
- Modify: `src/components/order-form.tsx`
- Modify: `src/components/submit-button.tsx`
- Modify: `src/app/(app)/orders/new/page.tsx`
- Modify: `src/app/(app)/orders/[id]/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `validateOrderDraft`, phone helpers, `OrderStore`, `syncPendingOrders`, customer lookup API and `OrderTicket` from Tasks 1–4.
- Produces: controlled `OrderForm` props `mode: 'create' | 'update'`, `onPersisted(order)`, and a pending detail at `/orders/new?pending=<localId>`.
- Guarantees: focus sequence is phone → name → address → equipment → accessories → reported fault → resolution → budget → status → received date → pickup date → save; Enter advances, Shift+Enter adds a line only in textareas.

- [ ] **Step 1: Write failing component-behavior tests**

Add a minimal React DOM test environment and test utilities only if the repository needs them; pin versions and lockfile. Test that an invalid budget paints its input invalid and disables Save without clearing other values, Enter focuses the next declared field, Shift+Enter does not advance from a textarea, phone lookup fills editable name/address, and offline submission enqueues then displays the pending detail.

- [ ] **Step 2: Run the focused form test to verify RED**

Run: `npm test -- src/components/order-form.test.ts`

Expected: FAIL because the existing uncontrolled form lacks client validation, focus control and offline submission.

- [ ] **Step 3: Implement controlled form state and explicit keyboard sequence**

Make `OrderForm` a client component with raw values initialized from server values. Run `validateOrderDraft` after every field edit; apply `aria-invalid`, per-field Spanish messages and a disabled Save when `fieldErrors` is nonempty. Bind Enter at the form level to the exact field-name list, call lookup before focusing name after phone, and reserve Shift+Enter for textarea line breaks. Do not intercept Ctrl/Cmd shortcuts or selection behavior.

For `mode: 'create'`, submit JSON to `/api/orders` while online. On `TypeError`/offline, create a `pendingCreates` record and replace the form with `PendingOrderDetail`; on 422, map API errors to the same form state; on success, navigate to `/orders/<id>`. For `mode: 'update'`, block Save with a connection-required message when offline and otherwise retain the existing server action route.

- [ ] **Step 4: Implement pending rendering and offline print**

`PendingOrderDetail` reads its `localId` from IndexedDB, renders `OrderTicket` with `persistence: 'pending'`, shows its sync status/error, exposes retry, and uses `window.print()` so printing works without a network request. Cache `/orders/new` through Task 4’s service-worker message so an offline navigation with `?pending=` can hydrate this view.

- [ ] **Step 5: Add accessible visual states**

Add `.field-error`, invalid input/textarea/select styles, disabled button styles, `.offline-banner`, `.pending-order`, and print CSS that preserves the pending warning while hiding controls. Keep existing responsive layout behavior.

- [ ] **Step 6: Run component, full and type tests to verify GREEN**

Run: `npm test -- src/components/order-form.test.ts && npm test && npm run typecheck`

Expected: PASS; invalid submissions do not redirect or erase input, and a pending order remains printable.

- [ ] **Step 7: Commit the form work unit**

```bash
git add package.json package-lock.json vitest.config.ts src/components src/app/'(app)'/orders/new/page.tsx src/app/'(app)'/orders/'[id]'/page.tsx src/app/globals.css
git commit -m "feat: support validated offline order creation"
```

### Task 6: Deliver paginated online/offline list and cached order-detail navigation

**Files:**
- Create: `src/components/orders-workspace.tsx`
- Create: `src/components/orders-workspace.test.ts`
- Create: `src/components/cached-order-detail.tsx`
- Modify: `src/components/order-table.tsx`
- Modify: `src/app/(app)/orders/page.tsx`
- Modify: `src/app/(app)/orders/[id]/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: paged `OrderListPage` from Task 3 and `OrderStore`/offline state from Task 4.
- Produces: `OrdersWorkspace` with filter URL parameters, `Previous`/`Next` links, cache hydration and cached pending rows; `CachedOrderDetail` that prefers IndexedDB only when offline.
- Guarantees: only recent cached data is browsable offline, active filters remain in links, and `Sin conexión` appears only for cache-backed content.

- [ ] **Step 1: Write failing workspace tests**

```ts
expect(pageWithoutFilters.orders.every((order) => order.receivedOn >= recentStart)).toBe(true)
expect(buildPageHref({ q: 'ana', page: 2 })).toBe('/orders?q=ana&page=2')
expect(mergeCachedPending(serverOrders, pendingOrders)[0].persistence).toBe('pending')
```

Test previous/next disabled boundaries, preserving all filter inputs, offline merging of pending rows, ignoring older-than-30-day cache records, banner state, and cache-only navigation refusing an unavailable older filtered page.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `npm test -- src/components/orders-workspace.test.ts`

Expected: FAIL because no workspace/cache navigation component exists.

- [ ] **Step 3: Implement paginated workspace and cache refresh**

Render the server-provided page through `OrdersWorkspace`. While online, persist its full recent-detail payloads, cache `/orders`, each recent `/orders/<id>`, and each print URL, then render conventional page links with all query parameters. On offline state, read only the local recent window plus pending items; navigate within available cached pages and retain filters only when their cached result exists. Make unavailable searches/history clearly non-actionable rather than showing an empty result as authoritative.

- [ ] **Step 4: Implement detail fallback**

Keep SSR detail for online requests. `CachedOrderDetail` replaces only the data section after hydration when there is no network and an IndexedDB record exists, including the offline banner and ticket data. The page’s cached HTML remains a route-level fallback supplied by the worker; do not issue Supabase requests from the browser for cached data.

- [ ] **Step 5: Run focused, full and type tests to verify GREEN**

Run: `npm test -- src/components/orders-workspace.test.ts && npm test && npm run typecheck`

Expected: PASS; online pagination remains URL-addressable and offline mode reads no server data.

- [ ] **Step 6: Commit the browsing work unit**

```bash
git add src/components/orders-workspace.tsx src/components/orders-workspace.test.ts src/components/cached-order-detail.tsx src/components/order-table.tsx src/app/'(app)'/orders/page.tsx src/app/'(app)'/orders/'[id]'/page.tsx src/app/globals.css
git commit -m "feat: browse cached recent orders offline"
```

### Task 7: Add ticket reuse, WhatsApp sharing and detail-page actions

**Files:**
- Create: `src/lib/order-share.ts`
- Create: `src/lib/order-share.test.ts`
- Create: `src/components/whatsapp-order-button.tsx`
- Modify: `src/app/(app)/orders/[id]/page.tsx`
- Modify: `src/app/(app)/orders/[id]/print/page.tsx`
- Modify: `src/components/print-button.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: `buildWhatsAppOrderUrl(order: ShareableOrder): URL | null` and `WhatsAppOrderButton`.
- Consumes: canonical phone and `OrderTicket` contracts from Task 1.
- Guarantees: the WhatsApp message contains each agreed order field, uses `wa.me/<canonical-phone>?text=...`, and returns `null` for missing phone, pending persistence or offline state.

- [ ] **Step 1: Write failing share/ticket tests**

```ts
const url = buildWhatsAppOrderUrl(persistedOrder)
expect(url?.host).toBe('wa.me')
expect(url?.pathname).toBe('/5491144445555')
expect(url?.searchParams.get('text')).toContain('Orden #9380')
expect(buildWhatsAppOrderUrl({ ...persistedOrder, persistence: 'pending' })).toBeNull()
```

Assert that name, phone, address, equipment, accessories, fault, resolution, formatted budget, status, received date and pickup date appear in the decoded text.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `npm test -- src/lib/order-share.test.ts`

Expected: FAIL because no WhatsApp formatter exists.

- [ ] **Step 3: Implement reusable actions and ticket rendering**

Make the print route consume `OrderTicket` instead of hand-rendering fields so persisted and pending printing share copy/formatting. Add header actions in the persisted detail in this order: `Nueva orden`, `Imprimir ticket`, `Enviar por WhatsApp`. The WhatsApp component opens the generated URL in a new tab with `noopener`; disable it with explanatory text for no phone, offline mode or pending orders. Do not block `PrintButton` offline.

- [ ] **Step 4: Run focused, full and type tests to verify GREEN**

Run: `npm test -- src/lib/order-share.test.ts && npm test && npm run typecheck`

Expected: PASS; a persisted online order can share the full message and every printable pending ticket retains its warning.

- [ ] **Step 5: Commit the actions work unit**

```bash
git add src/lib/order-share.ts src/lib/order-share.test.ts src/components/whatsapp-order-button.tsx src/components/print-button.tsx src/app/'(app)'/orders/'[id]'/page.tsx src/app/'(app)'/orders/'[id]'/print/page.tsx src/app/globals.css
git commit -m "feat: print and share repair orders"
```

### Task 8: Verify end-to-end behavior, document operator workflow and prepare delivery

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-09-26-web-order-workflow-offline-design.md`
- Modify: `docs/superpowers/plans/2026-09-26-web-order-workflow-offline.md`

**Interfaces:**
- Consumes: all prior task interfaces.
- Produces: reproducible operator validation steps and documentation of cache privacy, pending orders and offline print.

- [ ] **Step 1: Add documented manual acceptance scenarios**

Document exact browser checks: online customer lookup with each accepted format; no-filter 30-day list; older filtered pagination; DevTools Offline after a recent cache refresh; open cached detail; print cached persisted detail; create/print a pending order; restore network and observe assigned number; logout/login and verify cache clearing; WhatsApp from persisted order.

- [ ] **Step 2: Run automated verification**

Run: `npm test && npm run typecheck && npm run build`

Expected: PASS with no failing Vitest tests, no TypeScript errors and a successful production build.

- [ ] **Step 3: Run schema verification when administrative credentials are available**

Run: `SUPABASE_DB_URL="$SUPABASE_DB_URL" node scripts/verify-schema.mjs`

Expected: PASS and confirms the phone identity/view checks. If the URL is absent, record that production-schema verification remains an operator step; do not fabricate a result.

- [ ] **Step 4: Run the manual offline acceptance check and stop any service started**

If `npm run dev` is used for the browser checks, stop that exact process before proceeding. Verify the visible text is exactly `Sin conexión` only with cached data, and that offline print shows `Pendiente de sincronización` for local orders.

- [ ] **Step 5: Inspect the final diff and commit documentation/verification updates**

Run: `git diff --check && git status --short && git log --oneline main..HEAD`

Expected: no whitespace errors, only intended files, and one coherent conventional commit per completed task.

```bash
git add README.md docs/superpowers/specs/2026-09-26-web-order-workflow-offline-design.md docs/superpowers/plans/2026-09-26-web-order-workflow-offline.md
git commit -m "docs: document offline order workflow"
```

## Self-Review

- **Spec coverage:** Tasks 1 and 5 cover keyboard flow/inline validation; Task 2 covers normalization, merging and schema; Task 3 covers server pagination and lookup; Tasks 4–6 cover cache, offline queue, banner, cached list/detail and automatic synchronization; Task 7 covers printing, WhatsApp and new-order action; Task 8 covers acceptance and documentation.
- **Type consistency:** Phone canonicalization is introduced in Task 1 and consumed by the database/API/UI thereafter; `OrderStore`/`syncPendingOrders` originate in Task 4 before UI consumers; `OrderTicket` originates in Task 1 before both pending and print consumers.
- **Review-focus coverage:** Each of the five risks in Review Focus has a named test in the owning task.
- **Proportion:** The plan defines public contracts, persistence states and test evidence without prescribing component internals beyond behavior that would otherwise be ambiguous.
