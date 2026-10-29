# Parked: ERPNext link

Work paused on the owner's decision (core CRM first). Plan: `docs/ERP_LINK.md`.

Files here are not wired in and not run by `npm test`:

- `erp-sync.mjs`: read-only mirror of ERP quotations and invoices, matched to leads by phone, with a GET-only client.
- `erp-sync.test.mjs`: tests with a fake ERP.
- `005_erp.sql`: mirror tables. To revive, move it to `migrations/` and update the migration count in `schema.test.mjs`.

Known issue to fix when resuming: `apply()` uses `SAVEPOINT`, but `store.setStatus` runs inside `tx()`, which opens a transaction, so SQLite answers "cannot start a transaction within a transaction". Use the store's own nesting helper instead of a raw savepoint, or run `apply` inside `store.tx`.
