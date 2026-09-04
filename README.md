# DBForge

A production-quality, cross-platform **database GUI client** — PostgreSQL first, with a driver
abstraction that makes adding MySQL/SQLite/SQL Server a matter of implementing one interface.

Think TablePlus + DataGrip + VS Code: dense, keyboard-first, fast, and safe around production data.

```
Open app → select connection → browse schema → write SQL → execute → edit cells → save
```

---

## 1. Architecture overview

Clean layering — no database logic in UI components:

```
┌──────────────────────────────────────────────────────────┐
│ Renderer (React 19 + zustand + CodeMirror 6)             │
│   components/ state/ lib/        no SQL, no credentials  │
└──────────────▲───────────────────────────────────────────┘
               │ typed IPC via contextBridge (window.api)
┌──────────────┴───────────────────────────────────────────┐
│ Main process                                             │
│   services/   ConnectionService · QueryService ·          │
│               ExplorerService · HistoryService ·          │
│               TransactionService · SettingsService        │
│   persistence/ JsonStore · CredentialStore (safeStorage)  │
│   database/   DatabaseDriver ◄── PostgresDriver           │
│               driverRegistry (future drivers plug in here)│
└──────────────▲───────────────────────────────────────────┘
               │ pg Pool / ssh2 tunnel
          PostgreSQL 9.6+
```

Key decisions:

- **The renderer never touches SQL text for internal operations** (metadata, browse-data) and never
  sees credentials. Explorer/browse actions go over IPC as *typed sources* (`ExploreSource`,
  `BrowseTarget`); the main process builds the catalog SQL.
- **`DatabaseDriver` is the single seam.** Connect/test/execute/cursor-page/cancel/explain/export/
  metadata/transactions/save-edits are all interface methods. A `MySQLDriver` later implements the
  same contract; UI + services don't change.
- **Long-lived cursors, not long-lived transactions:** streaming SELECTs use server-side cursors
  (`DECLARE … CURSOR` + `FETCH FORWARD n`), each fetch on a short checkout from the pool. Cursor
  sessions idle-timer out and are re-`DECLARE`d on demand, so a half-scrolled million-row result
  never pins a connection or holds snapshots open.
- **Cancellation stays inside the driver:** `pg_cancel_backend(pid)` is issued on a side connection
  by the Postgres driver; the service layer just calls `cancel(sessionKey)`.
- **SQL classification is ergonomics, not security.** UI pre-flight blocking is a convenience; the
  real read-only guarantee is the *engine* connection setting (see §5).

## 2. Project structure

```
src/
  shared/                     # contracts shared by all layers (no node/browser deps)
    models/                   # connection, result, explorer, history, settings, editor, txn
    ipc/                      # channel names + typed request/response contract
    sql/                      # splitter (quotes/$$/nested comments), classifier,
                              # formatter (sql-formatter wrapper), edit planner
  main/
    database/
      DatabaseDriver.ts       # the driver abstraction
      PostgresDriver.ts       # pg implementation: cursors, cancel, explain, export, txns
      metadata.ts             # catalog queries (schemas/tables/views/funcs/seqs/types/…)
      errors.ts               # PG error → QueryErrorInfo (sqlstate/position/detail/hint)
      ssh.ts                  # ssh2 tunnel
      postgresExport.ts       # streaming CSV/TSV/JSON export
      driverRegistry.ts
    services/                 # app services (one per domain)
    persistence/              # JsonStore, CredentialStore (safeStorage), secretCrypto
    ipc.ts                    # all IPC handlers
    index.ts                  # app bootstrap
  preload/                    # contextBridge — typed window.api
  renderer/src/
    components/               # ConnectionSidebar, ExplorerPanel, SqlEditor, ResultTable,
                              # CellEditor, CommandPalette, dialogs, toolbar, status bar
    state/                    # zustand stores (connections, editor, explorer, settings, ui)
    lib/                      # shortcuts registry, completions, api wrapper, clipboard
    styles/                   # dark/light theme, dense IDE design system
tests/
  unit/                       # splitter, classifier, planner, formatter, errors, store,
                              # secretCrypto, services — 67 tests
  integration/                # driver, readonly, edits, metadata — 37 tests vs real PG
scripts/
  dev-postgres.sh             # disposable dockerized PG 16 for integration tests
  full-app-check.js           # headless boot check (API bridge + React mount)
compose.yaml
```

## 3. Technologies

| Area | Choice |
|---|---|
| Shell / build | Electron 41, electron-vite 5, TypeScript 5.7 (strict), Vite 7 |
| UI | React 19, zustand 5, lucide-react, react-resizable-panels |
| Editor | CodeMirror 6 (`lang-sql` postgres dialect, autocomplete, lint) |
| Results grid | **react-data-grid** (virtualized, editable) |
| DB driver | `pg` (node-postgres) |
| Formatting | `sql-formatter` (postgresql dialect) |
| SSH tunnel | `ssh2` |
| DnD | `@dnd-kit` |
| Tests | Vitest 4 (unit + real-Postgres integration) |

## 4. How PostgreSQL connectivity works

- **Options:** host, port, database, user, password, SSL mode (`disable`/`prefer`/`require`/
  `verify-ca`/`verify-full` + root cert), connect timeout, optional **SSH tunnel** (password or
  key auth) — all captured in the connection form with a live **Test Connection** (latency shown).
- **Connect:** tunnel (if configured) → `pg.Pool` per connection with
  `default_transaction_read_only` injected via server options for read-only connections
  (see §5). Password is fetched from the credential store at connect time and never serialized
  over IPC to the renderer.
- **Execution:** statements are split with a quote/dollar-quote/nested-comment-aware splitter.
  SELECT/`RETURNING` results stream through a **server-side cursor** (first page ~500 rows, more
  on demand — a million-row query never loads into memory and the UI stays interactive).
  DML/DDL run directly and report `rowsAffected`.
- **Cancel:** driver runs `SELECT pg_cancel_backend(pid)` over a side connection; the running
  fetch aborts with SQLSTATE `57014` and the pool stays usable.
- **Errors:** PG fields (`SQLSTATE`, `position`, `detail`, `hint`, `context`) are surfaced in the
  result pane; `position` is underlined in the editor.

## 5. How read-only mode works (three layers)

1. **Engine guarantee (the real one):** read-only connections set
   `default_transaction_read_only=on` on the server options of every pooled client. PostgreSQL
   itself rejects INSERT/UPDATE/DELETE/TRUNCATE/DROP/ALTER/CREATE with `42501
   cannot execute … in a read-only transaction` — even if SQL arrives by any other path through
   this connection. Transactions are begun `READ ONLY` as well.
2. **Driver pre-flight:** the driver rejects obviously-mutating statements before they are sent,
   with a clear explanation. This is a UX guard, not the security boundary.
3. **UI status:** sidebar dot, tab badge, status-bar `READ ONLY` chip, and read-only result grids.
   Integration tests verify layer 1 *at the engine* (writes actually fail with 42501).

## 6. How result editing works

- **Safety plan first.** After each SELECT, the main process builds a `SafeEditPlan`: it resolves
  the single underlying table and its primary key from the catalog (CTEs/joins/aggregates/views/
  computed columns → plan rejected with an explicit reason; the grid renders read-only). Never
  guesses a target row.
- **Pending-changes model.** Cell edits (double-click; type-aware editors for boolean/numeric/
  date-time/JSON/long text; `NULL` support; Enter confirms, Esc cancels) accumulate in a diff
  panel: `name: John → John Smith`. Nothing is written until **Save Changes**.
- **Save.** Per edited row, a fully **parameterized** `UPDATE "schema"."table" SET "col"=$1, …
  WHERE "pk"=$n` executes through the driver (zero string concatenation); `rowsAffected === 1`
  is verified per row. Optionally the whole batch runs in one transaction (Commit/Rollback from
  the toolbar; transaction state always visible).

## 7. How connections/groups/tags are persisted

- All app data lives as JSON in the OS user-data dir (`app.getPath('userData')`), written
  atomically (temp file + rename) by `JsonStore`: connections, groups (unlimited nesting), tags,
  colors, UI prefs, workspace state, history, saved queries.
- **Passwords are never in that file.** `CredentialStore` encrypts via Electron
  `safeStorage` (macOS Keychain / Windows DPAPI / libsecret) and stores only `{cipher, blob, iv}`
  against a `secretId`; if no OS keychain is available the store is in-memory only and the user is
  told — there is no plaintext fallback. The abstraction is mockable (unit-tested).
- Recent connections, expanded tree state, and per-tab state (SQL, connection, results, scroll)
  are part of the same persisted workspace.

## 8. Running the app

```bash
npm install
npm run dev          # dev mode (electron-vite)
npm run build        # production bundles in out/
npm start            # run the built app
npm run typecheck    # both tsconfig.node.json + tsconfig.web.json
```

On first run, use the sidebar (**New Connection**, `Ctrl+Shift+N`) — host/port/user/password,
SSL, SSH tunnel, read-only flag, color, tags, group. Double-click a table in the explorer to
browse its data; `Ctrl+Enter` executes SQL in the active tab.

## 9. Running the tests

```bash
npm run test:unit                    # 67 unit tests (no external deps)

npm run db:up                        # dockerized PostgreSQL 16 on 127.0.0.1:54329
npm run test:integration             # 37 tests against the real server
npm run db:down

npm test                             # everything (integration auto-skips if no DB,
                                     #   override with DB_CLIENT_TEST_PG_URL)
```

Integration coverage: connect/test, cursor paging (10k rows), cancellation, read-only enforcement
*at the engine*, safe-edit save + transaction commit/rollback, export correctness, catalog
metadata, error `SQLSTATE` reporting.

Headless sanity check (CI): `xvfb-run -a electron scripts/full-app-check.js --no-sandbox` —
verifies the real main process boots, the IPC bridge is present, and React mounts.

## 10. Keyboard shortcuts

Configurable through the shortcuts registry (`src/renderer/src/lib/shortcuts.ts`); the command
palette (`Ctrl+Shift+P`) lists every action with its binding.

| Action | Keys |
|---|---|
| Execute current statement | `Ctrl+Enter` |
| Execute entire script | `Ctrl+Shift+Enter` |
| Execute selected SQL | `Ctrl+Alt+Enter` |
| EXPLAIN selected statement | `Ctrl+Shift+E` |
| EXPLAIN ANALYZE | palette action |
| Format SQL | `Ctrl+Shift+F` |
| New query tab | `Ctrl+T` |
| Close tab | `Ctrl+W` |
| Command palette | `Ctrl+Shift+P` |
| Search connections | `Ctrl+F` (sidebar) |
| New connection | `Ctrl+Shift+N` |
| Refresh explorer | `Ctrl+Shift+R` |
| Query history | `Ctrl+Shift+H` |
| Begin / Commit / Rollback | toolbar + palette |

## 11. Known limitations

- PostgreSQL only today; MySQL/SQLite/MSSQL await a driver implementation (interface is ready).
- SSH tunnels support password + key-file auth (no agent forwarding or 2FA prompts yet).
- Query cancellation uses `pg_cancel_backend` (statement-level); `pg_terminate_backend` is not
  exposed.
- Safe editing requires a single source table with a discoverable PK; CTEs/joins/aggregates/views
  render read-only with an explicit reason rather than being guessed.
- Results are page-cached in the renderer (rows fetched so far); unbounded scrolling relies on the
  cursor + "Load more" rather than one continuous infinite scroll.
- Shortcut rebinding is stored in settings but currently edited in the settings JSON, not a GUI
  editor.
- Single-window workspace (no detachable result panes).

## 12. Recommended next features

1. **MySQL driver** (+ SQLite for local files) — the registry and shared SQL utilities already
   parameterize by dialect.
2. **Table designer** (visual ALTER: columns/constraints/indexes) and a **schema diff** view.
3. **Query profiler view** — EXPLAIN/EXPLAIN ANALYZE are implemented; add plan visualization
   (tree + cost bars).
4. **Data import** (CSV/JSON → table) to mirror streaming export.
5. **GUI for keyboard-shortcut rebinding** (the registry abstraction is already in place).
6. **Connection color/tag-driven chrome** — e.g. auto-tint the whole window frame for
   production-tagged connections.
7. **Multi-statement "Run as one transaction" toggle** and savepoints per script block.
8. **Auto-update + signing** pipeline (electron-builder) for distributable installs.
