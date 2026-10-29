# Deployment / private data handoff

## Current known environment (verify before acting)

Live URL: https://salesdesk-crm.srv2101310.hstgr.cloud/ on Hostinger NEW VPS `srv2101310.hstgr.cloud`. Only this VPS is authorized for CRM work. Do not modify the old VPS, OpenClaw, WAHA or shared Traefik services.

Compose project directory: `/docker/salesdesk-crm`; file `docker-compose.yml`; service `salesdesk`; current known container `salesdesk-crm-salesdesk-1`. Persistent private host storage: `/opt/salesdesk-crm/data` -> `/app/data`. Application runs as UID 1000. Latest known image `salesdesk-crm-web:0.18.0-20261028` (verify live state). Runtime image is local to that VPS; the root Dockerfile in this branch rebuilds from upstream Node + locked packages and needs a fresh build test.

Main HTTPS router forwards to 3100; main device `/v1/` router may forward to 3101. Workspace hosts ws01–ws05 have corresponding TLS rules. Gateway host validation rejects `host:port`; reverse proxy should preserve the canonical hostname without port. Main child web3102 and dynamic tenant ports should not be published. TLS, Host, cookie and Origin settings must match.

## Runtime settings

- `CRM_DB=/app/data/crm.sqlite`
- `PUBLIC_ORIGIN=https://salesdesk-crm.srv2101310.hstgr.cloud`
- `CRM_OWNER_USER_ID`: private runtime ID of the approved Ultra Admin, obtained from existing DB/config by an authorized operator; not supplied here.
- `BIND_HOST=0.0.0.0` inside Docker; gateway controls child binding.
- `PORT` / `MOBILE_PORT` are child runtime ports; production gateway uses fixed3100/main3102/mobile3101. Do not assume changing PORT remaps all gateway listeners.

Main owner context/base domain are set by gateway for its main child. Additional tenants must not inherit main credentials. SMTP configuration is entered through UI, not environment variables in this implementation. All provider secrets belong in encrypted runtime settings.

## Access and transfer

No SSH private key, Hostinger login, CRM password, database or encryption key has been uploaded. On a new computer sign in to Hostinger yourself or create an authorized SSH key and install it on NEW VPS only. Verify SSH host fingerprint through an independent trusted channel; do not use StrictHostKeyChecking=no. An agent must not invent credentials or copy them into chat.

If continuing only source work, clone the branch; production data is not needed. If a private production backup is necessary, transfer it directly over an authenticated encrypted channel to private storage, never GitHub/issues/PRs. Include every workspace DB and companion encryption key. Keep file modes restrictive (private directories, owner-readable keys). A public code repo is not a data migration mechanism.

## Change/backup procedure

1. Read current image/Compose/service state and identify only Salesdesk resources. Review user's scope before deployment.
2. Create a private dated backup of Compose and data. Either stop Salesdesk briefly before copying the whole data directory, or use a consistent SQLite backup/VACUUM snapshot with WAL and immutable key files handled correctly. Include `data/workspaces/**`; test restoration separately.
3. Build a new uniquely tagged source image; run isolated synthetic smoke tests. Never seed synthetic records in production.
4. Update only Salesdesk image/config and `docker compose up -d --no-deps salesdesk`. Do not recreate all projects or restart Traefik.
5. Verify HTTPS, unauthenticated API denial, DB quick_check, owner role, cross-workspace isolation and existing recording playback where authorized. Check restart count and migration results without dumping customer data/secrets.
6. Keep old image + Compose + private backup for rollback. Rollback code must support the current schema/permissions; older pre-workspace images do not enforce new Viewer/Manager rules or serve tenant hosts.

Historical private backups include the user-approved demo reset and SMTP rollout under `/opt/salesdesk-crm/backups/`. Do not automatically restore the deleted demo workspace. Restoring any backup overwrites newer customer work and needs a concrete approved recovery plan.

## Android

JDK17, Android SDK36 and compatible Gradle (9.1 used previously), AGP9.0.1. No wrapper binary/signing credentials uploaded. From `android-companion/`: `gradle :app:assembleDebug -PcrmApiOrigin=https://YOUR-CRM-HOST`; optional `-PcrmPreview=true` creates the `.preview` application variant. Confirm whether the installed phone uses standard or preview ID before attempting an upgrade. Debug signing on another computer usually differs; preserve original signing material privately or use a separate test device. Never uninstall the user's app merely to bypass INSTALL_FAILED_UPDATE_INCOMPATIBLE.
