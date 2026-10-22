# WhatsApp via Baileys · Sync only

This is an opt-in local adapter, not Meta's official WhatsApp Business API. Baileys is unofficial and use may lead to account restrictions. Use a dedicated test number and comply with WhatsApp's terms. Never use this for spam or unsolicited messaging.

## Pairing

1. Run `npm ci` and `npm start`. Keep the app bound to localhost; do not expose it through a tunnel or public reverse proxy. Enable shared company login before team use; only the administrator manages the linked WhatsApp account. Lead ownership scopes member conversation visibility. There is currently one linked WhatsApp account per local company, not per employee.
2. Open Integrations, read the risks and local-storage notice, check the acknowledgement, and press **Connect / resume**.
3. Scan the private QR from WhatsApp → Linked devices → Link a device. Scanning authorizes this CRM as a linked device. Never share or commit the QR.
4. Wait for `connected`. Reconnect is attempted at most five times per connection cycle. Startup does not connect automatically: press Connect / resume after each server restart.
5. Pause stops the local socket but preserves the encrypted session. To revoke access, unlink Salesdesk/the linked device in WhatsApp on your phone.

No number was linked and no live send was performed during development; account pairing and real delivery require verification with your dedicated number.

## Messages

- Individual text events delivered through `notify` and `append` are accepted, including `fromMe` messages sent manually on phone/WhatsApp Web. The full international counterpart number must match exactly one active lead. LID events require a phone-number alternate JID. Unknown/ambiguous numbers are counted, not saved or turned into leads. Groups, full history sync, media and unsupported events are ignored. Limited append backlog may arrive; complete old-chat import is not promised.
- Incoming and manually outgoing messages appear in the Lead inbox and lead activity timeline with direction and original timestamp when available. Provider IDs/JIDs deduplicate repeated deliveries. Inbox polling pauses while forms are open or inputs are focused.
- To write manually, choose a lead and optional draft in Integrations → **Open WhatsApp Web — send manually**. The CRM opens `https://web.whatsapp.com/send` in a new tab with recipient/text parameters; you review and press Send yourself. No Baileys send method exists. Opening a draft does not create a sent record. Draft text is present in the URL/browser history; do not put secrets in drafts. WhatsApp Web may require login and browser popup permissions.
- Campaigns, auto reply rules and inbox draft composition are deliberately NOT connected to the sender. No bulk sending, message templates, media, delivery/read receipt tracking or phonebook/history import.
- CRM direct sending, bulk sending and auto-sending are disabled. Old `/api/whatsapp/send` requests return 405. Previous sent/uncertain records are retained, not deleted. Sync-only does **not** eliminate restriction risk from an unofficial linked-device client; bulk messaging is not the only possible cause of a ban.
- Message text and contact identifiers live in the ordinary CRM database and workspace exports. Treat those as private. Encryption below protects auth secrets, not CRM message contents.

## Session storage

Baileys 7.0.0-rc14 is pinned from the upstream `baileys` npm package (MIT). The adapter uses a custom SQLite Signal-key store, not the development-only `useMultiFileAuthState` helper.

Credentials and Signal keys are serialized with Baileys BufferJSON, encrypted with AES-256-GCM and stored in a separate `whatsapp_auth` table. Key batches commit transactionally. The local encryption key is `<CRM_DB>.wa-key` (default `data/crm.sqlite.wa-key`) with mode 0600. Default `data/` is gitignored. Keys are created only when Connect is requested; they are never returned from `/api/state`, QR/status responses or exports. QR data is memory-only and provider logging is silent.

The key is stored on the same computer, so this does not protect against another process running as your OS user or a backup containing BOTH the database and key. Protect backups and the computer. Losing the key prevents restoring that session. Auth/QR secrets must not be committed. If setting `CRM_DB` outside the default folder, ensure that database and adjacent key are excluded from version control.

## API and verification

- `GET /api/whatsapp/status`: connection state and temporary private QR; no session credentials.
- `POST /api/whatsapp/connect`: `{ acknowledged: true }`.
- `POST /api/whatsapp/disconnect`: pause without deleting credentials.
- `POST /api/whatsapp/send`: disabled (405), even with confirmation.

All mutations require a same-origin browser Origin and JSON content type in addition to the app's host validation. These protections are not a substitute for production authentication.

Unit tests simulate incoming/outgoing events and verify encryption/tamper rejection, direction/time, append/notify processing, explicit connection, stale-event isolation, no exposed send method and zero socket sends. HTTP tests verify the old send endpoint is blocked. Real QR pairing and mobile/Web round-trip sync remain unverified until a user links a number. Meta Coexistence and Twilio are not used by this selected flow.

## Upstream evidence

- [Repository, MIT license and unofficial-client disclaimer](https://github.com/WhiskeySockets/Baileys).
- [Session management and custom key-store requirements](https://baileys.wiki/authentication/session-management).
- [Connection/message events](https://baileys.wiki/concepts/events).
- [Sending messages](https://baileys.wiki/messaging/sending-messages).
