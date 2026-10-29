# Moving from the classic screens to the new app

Nothing below happens on production without the owner's go-ahead. Rehearse on a copy of the database first.

## Today (both systems side by side)

| What | Where it is written | Where the new app sees it |
|---|---|---|
| Leads, notes, tasks added in the classic screens | old tables | copied across every minute when `V2_FOLLOW_LEGACY=true` |
| Calls from the phone app | old tables | copied across the same way |
| Anything done in the new app | new tables only | immediately |

Rules of the copy: it only adds, never edits or deletes, keeps work done in the new app, and stops (writing nothing) if its own checks fail.
**Edits to an existing lead made in the classic screens are not copied.** So during the overlap, change stages, owners and notes in one place only: the new app.

## Steps

1. Rehearse: copy `crm.sqlite`, `-wal`, `-shm` from `/opt/salesdesk-crm/data/`, run `node scripts/import-legacy.mjs <copy>` (dry run), read the report, then `--apply` on the copy.
2. Run the new image with `ENABLE_V2=true V2_FOLLOW_LEGACY=true` against the real database. The importer writes a `VACUUM INTO` backup first when run from the command line; take one by hand before the first start.
3. Team works in `/next/`. The classic screens stay for reference and the phone app keeps syncing calls.
4. When the phone app talks to the new store directly (next phase), switch the classic screens to read-only and turn the copy off.

## Not yet moved to the new store

Deals, payments, products, WhatsApp messages and call recordings still live in the old tables. The phone app's lead list also still comes from the old tables.
