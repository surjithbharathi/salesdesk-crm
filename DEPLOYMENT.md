# Hostinger VPS deployment and one-button updates

GitHub source: `surjithbharathi/salesdesk-crm`, branch `main`. Hostinger project: `salesdesk-crm` alongside existing services. HTTPS endpoint: `https://salesdesk-crm.srv1696974.hstgr.cloud`.

Latest verification, 22 October 2026 about 9:14 PM IST: updated only `salesdesk-crm` through hPanel Actions → Update after successful image build `39798710184`. Live `app.js` now matches repository source and contains `refreshSyncedCalls`. HTTPS returns 200; unauthenticated protected web/device APIs return 401. Existing signed-in session, 12 leads and the test-call recording remained available; online browser playback progressed without a media error. OpenClaw, Traefik and WAHA remained Running. Hostinger connector package corruption was repaired and its MCP initialization/tool discovery passed; account-authenticated MCP access was not exercised in the stale running session, so the deployment used hPanel.

GitHub Actions **Build Salesdesk deployment image** runs tests and publishes a source-only image to `ghcr.io/surjithbharathi/salesdesk-crm:latest`, also tagged by commit SHA. `compose.yaml` uses `pull_policy: always`. After pushing code, wait for this workflow/image publish to succeed, then in Hostinger Docker Manager choose **salesdesk-crm → Actions → Update**. This is the one-click image update action; it was exercised on the initial deployment. Manage → Deploy also reapplies the Compose configuration. Hostinger's deployment does not build Git contexts; the registry image is required. The container package is public for anonymous VPS pulls, matching the source repository visibility; database/keys are never included. Failed CI leaves the previous published image unchanged. Successful updates briefly restart only Salesdesk, not Traefik/OpenClaw/WAHA. Verify live version/login afterwards; a queued build is not success. Android APK updates remain separate.

Initial deployment verified on 22 October 2026: valid HTTPS login page, migrated company configured, unauthenticated `/api/state` and `/v1/targets` return 401. Existing containers remained running. Mobile APK code 4 has the online origin compiled in and no server-link input. Real user login/call/recording sync still requires user verification. Local and VPS databases are no longer automatically synchronized; use the online workspace for new changes.

Persistent data lives in the private VPS directory `/opt/salesdesk-crm/data`, mounted separately from image source. The approved initial snapshot preserves user IDs/accounts and records but clears active sessions and pending remote-call requests. Users sign in again with existing credentials. Source archives/images and GitHub must never include the database, password hashes, session secrets or encryption keys. Data migration is one-time, not live two-way database replication: use the online workspace as the source of truth afterwards.

PUBLIC_ORIGIN enables exact HTTPS host/origin checks and Secure cookies. Public startup refuses an unconfigured account database rather than exposing first-admin registration. Only Traefik HTTPS routes expose web and authenticated `/v1/` device API; no host ports are published by Salesdesk. Main container is unprivileged, drops capabilities, has CPU/memory limits and no Docker socket. The existing Traefik configuration is reused without modification.

Android is built with `-PcrmApiOrigin=https://salesdesk-crm.srv1696974.hstgr.cloud`; end users enter username/password only. Changing endpoint requires a fresh login and pauses previous sync/calling consent. Call/recording compatibility and background calling still require permission/real-device verification. Mobile binary changes require reinstall/update of the APK; redeploying the web server alone does not update installed Android code.

Before a major upgrade, back up the SQLite database consistently plus adjacent encryption keys in private storage. Never restore a stale local snapshot over live production data during ordinary code updates. Keep past images/commits for code rollback; database rollback/migrations require a separate backup decision. No automatic rollback or GitHub Actions SSH secrets are provisioned by this flow.

## Environment settings added in Phase 0

- `TRUST_PROXY=true` — use the last `X-Forwarded-For` hop as the client address for login throttling. Set it only behind a proxy you control (Traefik in `compose.yaml`); without it every user behind the proxy shares one address.
- `DEFAULT_COUNTRY_CODE` (default `91`) — country code added to 10-digit numbers when comparing phone numbers (web, mobile sync, WhatsApp, imports). The Android app uses the country code saved in its settings.
- A public deployment (`PUBLIC_ORIGIN` set) no longer creates demo data on an empty database; it refuses to start until a company account database exists.
- Phone (device) sessions now last 30 days and remain revocable; browser sessions stay at 12 hours.

## Phase 1 data layer (new tables)

1. `node scripts/migrate.mjs <db> --dry-run`, then without `--dry-run`: creates the new tables and seed data (the old `records` data is untouched).
2. `node scripts/import-legacy.mjs <db>`: dry run that prints exactly what would be copied, with warnings (duplicates, bad phones, orphans). Add `--apply` (CRM stopped) to write a backup first and import.
3. `ENABLE_V2=true` exposes the read-only `/api/v2/*` endpoints (`meta`, `leads`, `leads/:id`, `leads/:id/activities`, `dashboard`, `reports/sources`). Off by default. Existing screens and the phone app keep using the old data until the write cut-over, so the v2 numbers are a snapshot from the last import.
