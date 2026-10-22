# Hostinger VPS deployment and one-button updates

GitHub source: `surjithbharathi/salesdesk-crm`, branch `main`. Hostinger project: `salesdesk-crm` alongside existing services. HTTPS endpoint: `https://salesdesk-crm.srv1696974.hstgr.cloud`.

`compose.yaml` builds directly from GitHub main and uses `pull_policy: build`, so redeploying the project rebuilds the source rather than reusing an old application image. In Hostinger Docker Manager, choose Salesdesk → Manage → Deploy to update after GitHub changes. Build failure should leave the existing running container intact. Successful updates briefly restart only Salesdesk, not Traefik/OpenClaw/WAHA. Verify the live version/login afterwards; do not claim an update just because it was queued.

Persistent data lives in the private VPS directory `/opt/salesdesk-crm/data`, mounted separately from image source. The approved initial snapshot preserves user IDs/accounts and records but clears active sessions and pending remote-call requests. Users sign in again with existing credentials. Source archives/images and GitHub must never include the database, password hashes, session secrets or encryption keys. Data migration is one-time, not live two-way database replication: use the online workspace as the source of truth afterwards.

PUBLIC_ORIGIN enables exact HTTPS host/origin checks and Secure cookies. Public startup refuses an unconfigured account database rather than exposing first-admin registration. Only Traefik HTTPS routes expose web and authenticated `/v1/` device API; no host ports are published by Salesdesk. Main container is unprivileged, drops capabilities, has CPU/memory limits and no Docker socket. The existing Traefik configuration is reused without modification.

Android is built with `-PcrmApiOrigin=https://salesdesk-crm.srv1696974.hstgr.cloud`; end users enter username/password only. Changing endpoint requires a fresh login and pauses previous sync/calling consent. Call/recording compatibility and background calling still require permission/real-device verification. Mobile binary changes require reinstall/update of the APK; redeploying the web server alone does not update installed Android code.

Before a major upgrade, back up the SQLite database consistently plus adjacent encryption keys in private storage. Never restore a stale local snapshot over live production data during ordinary code updates. Keep past images/commits for code rollback; database rollback/migrations require a separate backup decision. No automatic rollback or GitHub Actions SSH secrets are provisioned by this flow.
