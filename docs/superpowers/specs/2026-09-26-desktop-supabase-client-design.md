# Desktop Supabase Client Design

## Goal

Move the legacy Tkinter manager from src/gestion.py into apps/desktop/ and make it use the repository's existing Supabase repair-order schema.

## Constraints

- Preserve the existing desktop workflow: list, select, search, navigate, create, edit, print, weekday backup, and legacy import.
- Do not add an email/password screen.
- Load local credentials from a root .env; never commit it.
- Per the user's explicit preference, use the local SUPABASE_SECRET_KEY in the desktop process for the smallest Python-side change. The key must never occur in source, templates, tests, output, or Git.
- Reuse public.customers, public.repair_orders, and their existing event triggers.
- Use uv and commit a lockfile.
- Keep all desktop code outside the Next.js source directory.

## Layout

~~~
apps/desktop/
  gestion.py
  pyproject.toml
  .env.example
  src/gestion_desktop/
    __init__.py
    app.py
    config.py
    models.py
    repository.py
    legacy.py
  tests/
~~~

gestion.py remains the executable entry point. The small package isolates Tkinter presentation, Supabase operations, and pure legacy-data conversion so tests do not need a display or production key.

## Configuration

The root .env.example gains SUPABASE_URL=. The desktop client loads the root .env and accepts SUPABASE_URL first, falling back to the existing NEXT_PUBLIC_SUPABASE_URL, plus SUPABASE_SECRET_KEY. apps/desktop/.env.example documents the same blank settings for operators who run that directory separately.

## Data Flow

SupabaseRepository uses supabase-py and exposes list_orders, create_order, update_order, import_legacy, and export_legacy_snapshot.

- New orders resolve a customer by normalized name and phone, then insert without an explicit order number. PostgreSQL remains authoritative for numbering.
- Updates modify the selected order and its selected customer.
- The Tkinter list/search/next/previous flow uses a refreshed in-memory cache only; Supabase is authoritative.
- Legacy dates convert from DD/MM/YYYY to ISO dates. Blank budgets map to NULL; ARS decimal/grouping formats map to cents. A pickup date maps to picked_up; otherwise the record maps to received.
- Online backup serializes current orders into the legacy text format in the existing local Backups/<weekday> directory.

## Legacy Import

The app exposes Crear archivo de ejemplo and Importar archivo legado. The example creates deterministic open and picked-up records under the current local data directory. Import parsing reports accepted and rejected lines before confirmation.

The importer resolves customers and upserts orders by old order_number, so retrying an interrupted import is safe. It continues after a row failure and reports its source line.

The schema requires a private BEFORE INSERT trigger that advances repair_orders_order_number_seq when an explicit historical number exceeds its current value. It never lowers the sequence and exposes no public RPC. This prevents future web or desktop inserts from colliding after an import.

## Verification

Pure tests use a fake Supabase adapter, covering configuration, currency/date conversion, parsing, sample creation, customer resolution, payloads, retry-safe imports, rejected lines, backup rendering, and controller cache behaviour. Operator verification imports the generated example into a safe database after applying the migration. No production key is needed by automated tests.
