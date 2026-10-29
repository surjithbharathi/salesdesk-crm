# CRM source checkpoint — 29 October 2026

Source checkpoint of the deployed 0.18.0 web release, plus current Android companion source and the external n8n custom node. Credentials, user records, audio, database snapshots, signing keys and APKs are excluded. The product name is still Salesdesk; naming discussion has not selected a replacement.

## Implemented

Workspace isolation; Ultra Admin / Super Admin / Admin / Manager / Caller hierarchy; user setup/reset links; encrypted SMTP settings with explicit test and invitation/reset email; lead phone normalization, duplicate prevention and merge; mobile call log/recording sync; WhatsApp synchronization; AI transcription/Call IQ provider configuration and encrypted key vault; scoped MCP/OAuth; external n8n API integration.

SMTP is disabled until an administrator configures a mailbox. OTP login and unauthenticated forgot-password emails are not implemented. Cross-workspace user management uses manual setup links; invitation emails are sent inside the target workspace. WhatsApp still uses the workspace connection; per-user WhatsApp is unfinished. No private production settings are supplied here.

## Continue on another computer

Use Node 22.13+ and run `npm ci`, `npm run check`, `npm test`, `npm start`. SMTP tests can use `SALESDESK_TEST_TMP=/tmp`. Docker builds from source and includes ffmpeg for audio conversion. Persist `/app/data`, including SQLite and companion encryption key files, on private storage. Never commit or overwrite a production data directory.

Gateway uses web port 3100; main mobile API 3101. Set `PUBLIC_ORIGIN` to the exact HTTPS origin and `CRM_OWNER_USER_ID` to an existing approved account ID. Additional workspace addresses require matching DNS and reverse proxy TLS routes. The current gateway supports five workspace slots. Never copy a real owner ID, API key or password into repository configuration.

Validation at checkpoint: 24 unit/regression checks and isolated HTTP tests passed. SMTP delivery was tested using a stub, not a live mailbox. Android physical-device acceptance must be repeated after rebuilding; do not uninstall to bypass a signing mismatch.

This branch is a source checkpoint, not a request to redeploy the VPS. Unrelated personal-assistant/OpenClaw work remains outside this release.
