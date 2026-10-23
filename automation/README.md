# Internal source-based automation

## Paused by product decision — 23 October 2026

The user chose to avoid the inbuilt n8n feature. Do not deploy or enable this runtime without a new request. Automatic source-image builds are disabled; workflows are manual-only for retained technical reference. The running CRM has no n8n runtime enabled. Source and isolated test data are preserved, not deleted.

## Requested product

Use n8n source as the base for the Salesdesk Automation feature. Do not replace this with a link to an existing service or a separate employee portal. Employees must create workflows from the CRM. Keep required upstream license and modification notices. Do not enable paid features by changing license checks.

### Selected-user access

Automation is for selected internal users, not all employees. The CRM administrator grants or revokes access in the Automation screen. Access defaults to denied for every account, including administrators; an administrator can manage the list without receiving editor access automatically. Only active CRM accounts can be granted access.

The backend rechecks access when issuing and consuming login handoffs and on each workspace request. Revocation deletes pending handoffs and disconnects open workspace proxy streams. The engine checks the owner's current CRM grant before each new top-level manual or scheduled execution. It fails closed when CRM is unavailable. Revocation does not undo completed actions, stop a run already in progress, or delete saved workflows and credentials. Native personal-project ownership and MFA/license checks remain unchanged.

## Current state

The modified source editor and engine run behind the CRM workspace proxy. Local verification saved and executed a Manual Trigger → Edit Fields workflow successfully. A different selected user could not read it. Revoked CRM access blocked the existing workspace session. The source identity adapter and grant service have six passing unit tests. Production image build and live verification are still pending.

The standard CRM image leaves Automation disabled. The `automation` image includes both services in one container. CRM keeps Node 22; the engine uses Node 24. Neither the engine port nor its operator account is exposed to employees. Required owner setup uses the native API with a private generated operator credential. The credential and n8n encryption keys stay in persistent private data, never source or GitHub.

Initial scope: personal workflows, manual/scheduled runs, built-in integration nodes and sticky notes. Shared projects and paid features are not enabled. Public incoming webhooks and OAuth callbacks without a CRM session are not yet supported. The proxy accepts JSON writes; multipart uploads are not supported. The engine blocks private network HTTP targets and environment access in workflow expressions. Shell/local file nodes and unreviewed community packages are disabled. CRM WhatsApp remains sync-only; no CRM bulk messaging or unattended call action is added.

The upstream source is pinned in `source.lock.json`. It includes the Vue editor, core engine, server, credentials and built-in nodes. CRM is currently a vanilla JavaScript frontend with a Node 22 server. The pinned n8n source needs Node 24 and pnpm 12.4.2. Build it with separate tools; do not change the CRM runtime as a side effect.

## Reproduce the source checkout

```sh
node scripts/n8n-source.mjs prepare
node scripts/n8n-source.mjs status
node scripts/n8n-source.mjs patch
npm exec --yes --package=node@24.22.1 --package=pnpm@12.4.2 -- node scripts/n8n-source.mjs install
npm exec --yes --package=node@24.22.1 --package=pnpm@12.4.2 -- node scripts/n8n-source.mjs build
```

The checkout lives in ignored `.automation-source/n8n`. `N8N_SOURCE_DIR` can select an existing checkout at the exact pinned revision. The setup tool does not reset files, create users, start servers or deploy. Upstream AGENTS.md instructions apply when editing that checkout. Keep source patches and build inputs in this repository so they survive a new computer.

`automation/source.patch` holds all n8n modifications. Patch application is idempotent. Build inputs are in `automation/Dockerfile`. The workflow `Build source-based Automation image` publishes `ghcr.io/surjithbharathi/salesdesk-crm:automation`. The launcher is `scripts/start-with-automation.mjs`. Mount the existing CRM data directory; engine data goes in its `automation/` subdirectory. Never restore a local snapshot over production data.

## Further integration work

1. Add original Salesdesk nodes for assigned leads, tasks, notes and call events. Enforce CRM authorization in backend code.
2. Add an audited public webhook/OAuth callback design if required. Do not expose the native engine port.
3. Verify production image startup, browser save/run and resource limits before enabling live access.

The Community edition allows internal employee use under its terms. External customer workflow creation and paid features need a new license review. Keep n8n notices visible. Do not copy enterprise `.ee` implementations into original CRM code.

Sources: [upstream license](https://github.com/n8n-io/n8n/blob/master/LICENSE.md), [internal-use explanation](https://support.n8n.io/article/can-i-use-your-license-for-my-use-case), [source revision](https://github.com/n8n-io/n8n/tree/b58d9e89d60e9a3485bb511c5091d8be0d9511e4).
