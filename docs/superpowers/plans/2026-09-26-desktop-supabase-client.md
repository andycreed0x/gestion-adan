# Desktop Supabase Client Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Move the legacy Tkinter order manager into apps/desktop and make it operate against the existing Supabase repair-order schema, including online backups and safe legacy imports.

**Architecture:** Tkinter remains the presentation layer. A testable Python package handles environment validation, legacy conversion, and Supabase REST operations. The desktop process uses a local service key by explicit user request; it is not committed. A private database trigger preserves identity numbering after importing explicit legacy order numbers.

**Tech Stack:** Python 3.12, Tkinter, supabase-py, python-dotenv, uv, pytest, existing Supabase migrations.

**Spec:** docs/superpowers/specs/2026-09-26-desktop-supabase-client-design.md

## Global Constraints

- Desktop source lives under apps/desktop; remove src/gestion.py after porting it.
- Read SUPABASE_URL, falling back to NEXT_PUBLIC_SUPABASE_URL, plus SUPABASE_SECRET_KEY from root .env.
- Never print, commit, or test with credential values.
- Do not add desktop email/password authentication.
- Database identity numbering is authoritative; Python does not assign new authoritative numbers.
- Legacy imports retain old numbers, reject malformed lines, tolerate row-level failures, and can be retried.
- No local service is needed. Stop any service started for testing before completion.

## Review Focus

- A legacy value containing " | " must retain that value rather than corrupt its fields.
- DD/MM/YYYY dates, empty budgets, and ARS separators must map exactly.
- Importing numbers lower than the sequence cannot lower the next generated number.
- One failed import row cannot stop later valid rows.
- Network or print failures cannot discard a successfully saved online order.

---

### Task 1: Create the desktop project and configuration contract

**Files:**
- Create: apps/desktop/pyproject.toml
- Create: apps/desktop/gestion.py
- Create: apps/desktop/src/gestion_desktop/__init__.py
- Create: apps/desktop/src/gestion_desktop/config.py
- Create: apps/desktop/tests/test_config.py
- Create: apps/desktop/.env.example
- Modify: .env.example
- Modify: .gitignore

**Interfaces:**
- Produces: Settings(url: str, secret_key: str)
- Produces: load_settings(project_root: Path) -> Settings
- Produces: executable gestion.py calling app.main later

- [ ] Step 1: Write failing configuration tests for preferred SUPABASE_URL, NEXT_PUBLIC_SUPABASE_URL fallback, and redacted errors for missing settings.

~~~python
def test_load_settings_prefers_desktop_url(tmp_path):
    (tmp_path / ".env").write_text("SUPABASE_URL=https://example.supabase.co\nSUPABASE_SECRET_KEY=secret\n")
    assert load_settings(tmp_path).url == "https://example.supabase.co"
~~~

- [ ] Step 2: Run cd apps/desktop && uv run pytest tests/test_config.py -v. Expected: fail because the package is absent.
- [ ] Step 3: Use uv add to pin supabase, python-dotenv, and pytest; implement Settings without exposing values.
- [ ] Step 4: Add blank root and desktop environment templates and ignore .venv.
- [ ] Step 5: Run the focused tests. Expected: pass.
- [ ] Step 6: Commit with feat(desktop): add Python environment setup.

### Task 2: Implement legacy conversion, samples, and backup rendering

**Files:**
- Create: apps/desktop/src/gestion_desktop/models.py
- Create: apps/desktop/src/gestion_desktop/legacy.py
- Create: apps/desktop/tests/test_models.py
- Create: apps/desktop/tests/test_legacy.py

**Interfaces:**
- Produces: LegacyRecord, OrderInput, parse_legacy_contents(text) -> ParseResult
- Produces: write_sample_legacy_file(path) -> Path
- Produces: serialize_legacy_order(order) -> str

- [ ] Step 1: Write failing tests for preserving pipes in Falla, invalid lines, 12.500,50 to 1250050 cents, empty budget to None, pickup status, deterministic sample output, and backup serialization.
- [ ] Step 2: Run cd apps/desktop && uv run pytest tests/test_models.py tests/test_legacy.py -v. Expected: fail.
- [ ] Step 3: Implement DTOs, strict date/currency helpers, parser results with line numbers/raw text, sample generation, and legacy serialization.
- [ ] Step 4: Run focused tests. Expected: pass.
- [ ] Step 5: Commit with feat(desktop): add legacy conversion utilities.

### Task 3: Add sequence safety for explicit imported numbers

**Files:**
- Create: generated supabase/migrations/*_sync_repair_order_sequence.sql
- Modify: scripts/verify-schema.mjs

**Interfaces:**
- Produces: private BEFORE INSERT trigger for public.repair_orders
- Guarantees: high explicit number advances sequence; lower values never lower it

- [ ] Step 1: Extend the schema verifier with a failing assertion for the private trigger.
- [ ] Step 2: Run node scripts/verify-schema.mjs. Expected: fail before migration or report SUPABASE_DB_URL is missing.
- [ ] Step 3: Generate the filename with npx --yes supabase@2.117.0 migration new sync_repair_order_sequence.
- [ ] Step 4: Implement fixed-search-path private function and trigger; compare against current sequence and only call setval when incoming number is higher; revoke public execution.
- [ ] Step 5: When the administrative database URL is available, run node scripts/apply-migration.mjs && node scripts/verify-schema.mjs. Expected: pass.
- [ ] Step 6: Commit with fix(db): sync order sequence after legacy imports.

### Task 4: Build the Supabase repository

**Files:**
- Create: apps/desktop/src/gestion_desktop/repository.py
- Create: apps/desktop/tests/test_repository.py

**Interfaces:**
- Produces: SupabaseRepository(settings, client=None)
- Produces: list_orders, create_order, update_order, import_legacy, write_backup

- [ ] Step 1: Write fake-client tests verifying new inserts omit order_number, updates target the selected order/customer, imports upsert old numbers and continue after one remote row failure, and backups query/render/write orders.
- [ ] Step 2: Run cd apps/desktop && uv run pytest tests/test_repository.py -v. Expected: fail.
- [ ] Step 3: Implement joined reads and customer resolution by normalized name/phone.
- [ ] Step 4: Implement create/update mappings to the existing customer/order columns.
- [ ] Step 5: Implement retry-safe legacy upsert by order_number and online legacy snapshot export.
- [ ] Step 6: Run focused tests. Expected: pass.
- [ ] Step 7: Commit with feat(desktop): connect order workflow to Supabase.

### Task 5: Port the Tkinter workflow

**Files:**
- Create: apps/desktop/src/gestion_desktop/app.py
- Modify: apps/desktop/gestion.py
- Delete: src/gestion.py
- Create: apps/desktop/tests/test_app_helpers.py

**Interfaces:**
- Consumes: repository and legacy helpers
- Produces: main() and a testable controller
- Preserves: list, selection, search, prior/next, save, save-and-print, feedback, weekday backup, example creation, and import actions

- [ ] Step 1: Write failing controller tests for cycling through refreshed cache, refresh-after-save, and import-count feedback.
- [ ] Step 2: Run cd apps/desktop && uv run pytest tests/test_app_helpers.py -v. Expected: fail.
- [ ] Step 3: Port the current UI labels, field order, ticket text, local data directory, and temporary notices into app.py; replace local text database calls with repository calls.
- [ ] Step 4: Add Crear archivo de ejemplo and Importar archivo legado controls; confirm parsed valid/rejected counts before import and show failed line numbers.
- [ ] Step 5: Preserve the 17:30 weekday backup using online snapshot export. Isolate printing so failures are nonfatal after save.
- [ ] Step 6: Delete src/gestion.py and run its focused tests. Expected: pass.
- [ ] Step 7: Commit with feat(desktop): port Tkinter workflow to online orders.

### Task 6: Document and verify

**Files:**
- Modify: README.md
- Modify: apps/desktop/.env.example if needed

- [ ] Step 1: Document uv sync, desktop launch, blank root environment setup, sample/import workflow, and migration verification commands.
- [ ] Step 2: Run cd apps/desktop && uv run pytest -v. Expected: pass.
- [ ] Step 3: Run npm test && npm run typecheck && npm run build. Expected: pass.
- [ ] Step 4: When SUPABASE_DB_URL is available, apply and verify schema; otherwise retain exact operator command without values.
- [ ] Step 5: Run git diff --check and inspect git status.
- [ ] Step 6: Commit with docs: document desktop Supabase client.
