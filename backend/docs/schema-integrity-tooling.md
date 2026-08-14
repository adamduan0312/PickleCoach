# Schema integrity tooling (Option C — light)

**Principle:** The **database** is the source of truth for what exists. Sequelize models (via `scripts/schema-map.js`) are the **representation** checked against the DB and against static field usage patterns.

**Canonical table list / truncate notes:** [`database-tables.md`](./database-tables.md).

## Scripts (run from `backend/`)

| npm script | Purpose |
|------------|---------|
| `npm run schema:drift` | Compare `INFORMATION_SCHEMA.COLUMNS` to Sequelize models (`schema-map.js`). Exit **1** if drift. |
| `npm run model:usage` | Regex-lite scan of `services/`, `controllers/`, `workers/`, `utils/` for `booking.foo`-style access vs model columns. Exit **1** on unknown fields. |
| `npm run ci:schema-check` | Runs both. In CI without MySQL, set `SCHEMA_DRIFT_ALLOW_SKIP=1` for the drift step (see below). |

### When CI has no MySQL

Set `SCHEMA_DRIFT_ALLOW_SKIP=1` so `schema:drift` exits **0** if the DB is unreachable (`model:usage` still runs). Example:

`SCHEMA_DRIFT_ALLOW_SKIP=1 npm run ci:schema-check`

## Configuration

- **`.schema-drift-ignore.json`** (in `backend/`) — `ignoreTables`, per-table `ignoreColumns`, `ignoreGlobalColumnNames`, `ignoreFieldUsagePatterns` (regex strings stripped before field scan).

## Schema map

- **`scripts/schema-map.js`** — builds the column map from live Sequelize `rawAttributes` (no hand-maintained column list).

## Runtime field tracking (off by default)

- **`utils/runtimeFieldTracker.js`**
- Enable only with **`TRACK_MODEL_FIELDS=true`** (default off — no log noise or proxy overhead).
- Use **`wrapInstanceForFieldTracking(instance, 'Booking')`** for a single row, or **`wrapModel(Booking, 'Booking')`** to proxy the Model class so common `find*` / `create` return values that look like Sequelize instances are wrapped (development only).
- Aggregates log on process `beforeExit`.
- **Not** wired into HTTP handlers or workers by default.

## Limitations (lite scope)

- `model:usage` is **regex-based** — it can miss dynamic property access. It strips **string literals** first (reduces false positives such as Stripe event types containing `dispute.*`). Sequelize static methods, association getters (`getFoo`), and common eager-load keys are filtered; tune via `ignoreFieldUsagePatterns` if needed.
- Type drift between Sequelize and MySQL uses coarse **families** (string / numeric / decimal / bool / date / json / enum / other). `tinyint(1)` is treated as **bool** to align with Sequelize `BOOLEAN`.
