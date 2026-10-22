# Salesdesk internal Automation

This product includes a modified build of n8n 2.44.6 from n8n-io/n8n, commit b58d9e89d60e9a3485bb511c5091d8be0d9511e4.

n8n is source-available under the Sustainable Use License. Enterprise-designated files have separate license terms. The upstream license remains in the image at /opt/n8n/UPSTREAM-LICENSE.md. Dependency notices remain in the installed packages. Source and modification notices are retained. No enterprise license check is removed or changed.

Salesdesk modifications add a CRM navigation banner, an internal one-use login handoff, and a CRM grant check before workflow execution. The complete patch is in automation/source.patch. This build is for selected internal CRM users. External customer embedding or resale needs a separate licensing review.

Upstream source: https://github.com/n8n-io/n8n
Upstream license: https://github.com/n8n-io/n8n/blob/n8n%402.44.6/LICENSE.md
