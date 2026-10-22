# Combined CRM direction

Salesdesk independently combines the observed Salesmax workflow structure, Twenty-inspired saved lead views, and Frappe-inspired Kanban organization. No upstream source code was copied.

## Implemented in v0.5

- List and Kanban layouts use the same records, search, owner/source/stage filters, ordering, and saved filter definitions.
- Four lead lanes show counts and estimated values. Cards open the existing lead detail/activity timeline.
- Keyboard-accessible stage selectors persist changes through the existing validated API. Timeline entries identify the previous and new stage.
- Board layouts scroll horizontally on narrow screens. v0.5.1 adds mouse/pen card dragging between lanes, highlighted drop targets, edge scrolling, Escape/outside-drop cancellation, and guarded saves. Keyboard and touch users retain the stage selector. Configurable columns and saving the layout preference are not implemented.

## Source evidence

Reviewed Frappe CRM develop commit `56746266fc33f4750695f7feb8109d06a19cab23`:

- [Feature overview](https://github.com/frappe/crm/blob/56746266fc33f4750695f7feb8109d06a19cab23/README.md): unified lead/deal pages, Kanban, custom views, Twilio, Exotel, WhatsApp, ERPNext.
- [Telephony API](https://github.com/frappe/crm/blob/56746266fc33f4750695f7feb8109d06a19cab23/crm/integrations/twilio/api.py): caller identity mapping, access tokens, call logging and incoming call handling.
- [ERPNext sync utilities](https://github.com/frappe/crm/blob/56746266fc33f4750695f7feb8109d06a19cab23/crm/integrations/erpnext/utils.py): opt-in sync direction, linked IDs and rename conflict checks.
- [License](https://github.com/frappe/crm/blob/56746266fc33f4750695f7feb8109d06a19cab23/LICENSE): AGPL-3.0. This reference does not import that code or change Salesdesk's license.

## Remaining integration work

Production authentication and permissions must precede credentials and provider callbacks. Provider integrations require server-side secrets, provider-supported signature verification, replay protection, idempotent event processing, retryable delivery, and audit logs. ERP sync needs stable external IDs and explicit conflict handling. These are design requirements, not connected services; all current outgoing messages remain local drafts.

See [TWENTY_REFERENCE.md](TWENTY_REFERENCE.md) for the related connected-account and webhook architecture and [FEATURE_PARITY.md](FEATURE_PARITY.md) for the Salesmax evidence boundary.
