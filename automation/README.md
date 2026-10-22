# Internal source-based automation

## Requested product

Use n8n source as the base for the Salesdesk Automation feature. Do not replace this with a link to an existing service or a separate employee portal. Employees must create workflows from the CRM. Keep required upstream license and modification notices. Do not enable paid features by changing license checks.

### Selected-user access

Automation is for selected internal users, not all employees. The CRM administrator grants or revokes access in the Automation screen. Access defaults to denied for every account, including administrators; an administrator can manage the list without receiving editor access automatically. Only active CRM accounts can be granted access.

The backend rechecks access when issuing and consuming login handoffs and on each workspace request. Revocation deletes pending handoffs and disconnects open workspace proxy streams. It does not remove workflows, credentials, or cancel already running/scheduled engine executions: execution-level revocation remains a requirement before enabling production automation. The runtime is disabled by default and this feature is not yet deployed.

## Current state

The CRM workspace entry, one-use identity handoff, private-runtime proxy and administrator-managed selected-user access are implemented. Unit tests and the CRM regression suite pass (46 tests). The editor/engine runtime is **not ready for production and remains disabled by default**. Deploying the CRM changes does not install or enable n8n. The earlier external-instance connector experiment was removed.

The upstream source is pinned in `source.lock.json`. It includes the Vue editor, core engine, server, credentials and built-in nodes. CRM is currently a vanilla JavaScript frontend with a Node 22 server. The pinned n8n source needs Node 24 and pnpm 12.4.2. Build it with separate tools; do not change the CRM runtime as a side effect.

## Reproduce the source checkout

```sh
node scripts/n8n-source.mjs prepare
node scripts/n8n-source.mjs status
npm exec --yes --package=node@24.22.1 --package=pnpm@12.4.2 -- node scripts/n8n-source.mjs install
npm exec --yes --package=node@24.22.1 --package=pnpm@12.4.2 -- node scripts/n8n-source.mjs build
```

The checkout lives in ignored `.automation-source/n8n`. `N8N_SOURCE_DIR` can select an existing checkout at the exact pinned revision. The setup tool does not reset files, create users, start servers or deploy. Upstream AGENTS.md instructions apply when editing that checkout. Keep source patches and build inputs in this repository so they survive a new computer.

## Integration work still required

1. Add the source-built editor as the CRM Automation workspace. It is not a standalone Vue widget: it depends on n8n APIs, workflow storage and execution services.
2. Implement and test an explicit CRM identity adapter. Keep employee identities and personal workflow/credential ownership separate. Do not share an owner account or forward a blanket administrator key. Do not bypass n8n MFA, session validation or paid SSO gates.
3. Build the source engine as a private CRM-managed runtime. Backend process isolation does not mean a second user-facing product. Do not expose the runtime port directly or disable protective browser headers to make a demo work.
4. Add original Salesdesk nodes for assigned leads, tasks, notes and call events. Enforce CRM authorization in backend code, not only in the editor. Test retries, duplicates and cross-user access.
5. Preserve the existing WhatsApp sync-only boundary. Do not add bulk messaging, unattended calls or arbitrary custom-node installation for employees. Custom node packages need administrator review because they execute code.
6. Verify save/edit/run, schedules, triggers, execution logs and credential handling. Add recovery and resource limits before any VPS rollout.

The Community edition allows internal employee use under its terms. External customer workflow creation and paid features need a new license review. Keep n8n notices visible. Do not copy enterprise `.ee` implementations into original CRM code.

Sources: [upstream license](https://github.com/n8n-io/n8n/blob/master/LICENSE.md), [internal-use explanation](https://support.n8n.io/article/can-i-use-your-license-for-my-use-case), [source revision](https://github.com/n8n-io/n8n/tree/b58d9e89d60e9a3485bb511c5091d8be0d9511e4).
