# WhatsApp via Baileys (v0.6)

This is an opt-in local adapter, not Meta's official WhatsApp Business API. Baileys is unofficial and use may lead to account restrictions. Use a dedicated test number and comply with WhatsApp's terms. Never use this for spam or unsolicited messaging.

## Pairing

1. Run `npm ci` and `npm start`. Keep the app bound to localhost; do not expose it through a tunnel or public reverse proxy. There is no application sign-in or multi-user authorization.
2. Open Integrations, read the risks and local-storage notice, check the acknowledgement, and press **Connect / resume**.
3. Scan the private QR from WhatsApp → Linked devices → Link a device. Scanning authorizes this CRM as a linked device. Never share or commit the QR.
4. Wait for `connected`. Reconnect is attempted at most five times per connection cycle. Startup does not connect automatically: press Connect / resume after each server restart.
5. Pause stops the local socket but preserves the encrypted session. To revoke access, unlink Salesdesk/the linked device in WhatsApp on your phone.

No number was linked and no live send was performed during development; account pairing and real delivery require verification with your dedicated number.

## Messages

- New (`notify`) individual text events only. The full international sender number must match exactly one active lead. LID events are accepted only when a phone-number alternate JID is available. Unknown/ambiguous numbers are counted, not saved or turned into leads. Groups, history sync, media and unsupported events are ignored.
- Incoming messages appear in the Lead inbox and lead activity timeline. Inbox polling pauses while forms are open or inputs are focused. Incoming provider IDs/JIDs are deduplicated.
- To send, choose an active lead on Integrations, verify its full international number including country code, enter text, tick the send confirmation and press **Send WhatsApp text now**. No code sends automatically on connect or when receiving a message.
- Campaigns, auto reply rules and inbox draft composition are deliberately NOT connected to the sender. No bulk sending, message templates, media, delivery/read receipt tracking or phonebook/history import.
- A send attempt is saved before network I/O and uses a stable request ID for retry deduplication. `Sent` means the socket returned a provider message ID, not delivery or reading. Errors/timeouts become `Unknown`; a crash can leave `Sending`. Check WhatsApp before creating another request: automatic resend is disabled because it can duplicate a real message. The 20-second local timeout cannot recall a message already handed to the provider.
- Message text and contact identifiers live in the ordinary CRM database and workspace exports. Treat those as private. Encryption below protects auth secrets, not CRM message contents.

## Session storage

Baileys 7.0.0-rc14 is pinned from the upstream `baileys` npm package (MIT). The adapter uses a custom SQLite Signal-key store, not the development-only `useMultiFileAuthState` helper.

Credentials and Signal keys are serialized with Baileys BufferJSON, encrypted with AES-256-GCM and stored in a separate `whatsapp_auth` table. Key batches commit transactionally. The local encryption key is `<CRM_DB>.wa-key` (default `data/crm.sqlite.wa-key`) with mode 0600. Default `data/` is gitignored. Keys are created only when Connect is requested; they are never returned from `/api/state`, QR/status responses or exports. QR data is memory-only and provider logging is silent.

The key is stored on the same computer, so this does not protect against another process running as your OS user or a backup containing BOTH the database and key. Protect backups and the computer. Losing the key prevents restoring that session. Auth/QR secrets must not be committed. If setting `CRM_DB` outside the default folder, ensure that database and adjacent key are excluded from version control.

## API and verification

- `GET /api/whatsapp/status`: connection state and temporary private QR; no session credentials.
- `POST /api/whatsapp/connect`: `{ acknowledged: true }`.
- `POST /api/whatsapp/disconnect`: pause without deleting credentials.
- `POST /api/whatsapp/send`: `{ requestId, leadId, text, confirmed: true }`.

All mutations require a same-origin browser Origin and JSON content type in addition to the app's host validation. These protections are not a substitute for production authentication.

Unit tests simulate the socket and verify encryption/restore/tamper rejection, message parsing, explicit connection, stale-event isolation, history ignoring, request deduplication, and uncertain network outcomes. HTTP tests verify origin and consent validation without opening a provider connection. Real QR pairing and transport delivery remain unverified until a user links a number.

## Upstream evidence

- [Repository, MIT license and unofficial-client disclaimer](https://github.com/WhiskeySockets/Baileys).
- [Session management and custom key-store requirements](https://baileys.wiki/authentication/session-management).
- [Connection/message events](https://baileys.wiki/concepts/events).
- [Sending messages](https://baileys.wiki/messaging/sending-messages).
