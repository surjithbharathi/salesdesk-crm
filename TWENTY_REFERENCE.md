# Twenty reference and integration design

Reviewed 22 October 2026 at commit `689615f3dac44221eeab0413378fb60b4c95f913`. Salesmax remains the workflow reference; Twenty supplies additional extensibility and integration patterns. Salesdesk remains independently implemented. No Twenty code or assets were copied or vendored.

## Reviewed sources

- [README](https://github.com/twentyhq/twenty/tree/689615f3dac44221eeab0413378fb60b4c95f913): objects, fields, views, workflows, SDKs, REST/GraphQL and the larger NestJS/PostgreSQL/Redis stack.
- [ViewFilter type](https://github.com/twentyhq/twenty/blob/689615f3dac44221eeab0413378fb60b4c95f913/packages/twenty-front/src/modules/views/types/ViewFilter.ts): persisted field filters, operands, values and groups. This informed the independent saved lead views feature.
- [Webhook service](https://github.com/twentyhq/twenty/blob/689615f3dac44221eeab0413378fb60b4c95f913/packages/twenty-server/src/engine/metadata-modules/webhook/webhook.service.ts): workspace-scoped validated configuration and cache refreshes. This establishes configuration architecture, not verified delivery behavior.
- [Connected account module](https://github.com/twentyhq/twenty/blob/689615f3dac44221eeab0413378fb60b4c95f913/packages/twenty-server/src/modules/connected-account/connected-account.module.ts): distinct account listeners and reconnection services.
- [Granola signature verifier](https://github.com/twentyhq/twenty/blob/689615f3dac44221eeab0413378fb60b4c95f913/packages/twenty-apps/public/granola/src/logic-functions/utils/verify-standard-webhook-signature.util.ts): timestamped raw-body HMAC verification. Future receivers must follow the selected provider's actual signing protocol.

## Delivered in Salesdesk v0.4

Saved lead views persist a name, search, stage, owner, source, active/archive scope, sort key and direction in SQLite. Applying a view restores filters and ordering. Custom changes can be saved as another view. Clear work-queue filters before saving; they are not silently omitted. Tests cover composed filters, sorting, validation and restart persistence.

The concept is independently implemented. Arbitrary custom objects, nested Boolean filter groups and Twenty-compatible schemas are not implemented.

## Integration order

| Priority | Component                       | Needed                                                                       | Status            |
| -------- | ------------------------------- | ---------------------------------------------------------------------------- | ----------------- |
| 1        | Auth/workspace isolation        | Users, permissions, scoped records/credentials                               | Unimplemented     |
| 2        | Connector ownership             | Connection state, encrypted credentials, reconnect/disconnect                | Design only       |
| 3        | Webhooks                        | Provider signatures, replay protection, event IDs, deduplication, validation | Design only       |
| 4        | Delivery outbox                 | Durable actions, retries, accepted/sent/delivered/read/failed states         | Local drafts only |
| 5        | Mail/calendar                   | OAuth checks, refresh, pagination, sync checkpoints/deletion                 | Unconnected       |
| 6        | WhatsApp/telephony/lead sources | Authorized APIs and verified callbacks                                       | Unconnected       |
| 7        | Twenty connector                | Selected base URL, credentials, field mappings, paginated API sync/conflicts | Unconnected       |

The local server binds to loopback and cannot receive public webhooks. Deployment, HTTPS, authentication and credential storage precede live integrations. No outbound connector requests, account links or messages are initiated by this change.

## License boundary

The reviewed [root license](https://github.com/twentyhq/twenty/blob/689615f3dac44221eeab0413378fb60b4c95f913/LICENSE) says most code is AGPLv3, marked Enterprise files have separate commercial terms, and identified toolkit/UI/app packages are MIT; it also describes an application-interface exception. Before copying code, check its specific file/package terms and preserve required notices. Salesdesk's license is not selected or changed by this work; no upstream implementation was copied.
