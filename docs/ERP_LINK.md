# CRM to ERP link (ERPNext, deviindustries.com)

Goal: the sales person finishes a call, the CRM prepares a quotation draft, a human approves it, and it appears in ERPNext as a Draft Quotation. Later, ERP status (submitted, ordered, lost) flows back so the CRM and the reports stay accurate.

## What the ERP looks like today (read-only look, 29 Oct 2026)

- 781 Quotations. Most recent ones are **Draft**, created by the sales team (for example `SAL-QTN-2026-0772`). One was `Ordered`.
- Quotations are made **to a Customer**, never to a Lead. The ERP `Lead` doctype is empty. So the CRM must create the Customer (with Address and Contact) before the Quotation.
- A quotation carries: company `Devi Industries`, currency INR, price list `Standard Selling`, tax template (`Output GST Out-state - DI`, an in-state one for Tamil Nadu), place of supply from the customer's address, payment terms (`100% Advance`), terms `Terms and Condition - Invoice`, `valid_till` 31 days after the date, `custom_sales_person` (the user's email), `custom_type`.
- Items: 881 sales items. Only about 94 are in item group **Machines**; the rest are parts, consumables and bolts. Machines come in variants such as `-1PH` and `-3PH`, tray dryers by size and material (`10-TRAY-DRYER-FULL-SS`), expellers by HP. Most `standard_rate` values are 0, so real prices must come from **Item Price** on `Standard Selling` (to be confirmed), not from the item itself.
- Item rows hold a long description, HSN code, tax template (`GST 18% - DI`), warehouse `Stores - DI`.

## Principles

1. **ERP owns money and stock**: prices, tax, totals, numbering. The CRM never calculates a price or tax itself and never edits an existing ERP document.
2. **AI proposes, a person approves**: AI picks the machine and quantity from the call; the sales person confirms before anything is sent.
3. **Drafts only**: the CRM creates Draft Quotations (docstatus 0). Submitting stays in the ERP, with the team's current habit.
4. **Safe to repeat**: every push has an idempotency key; a retry or double click can never create two quotations.
5. **Nothing live without approval**: build and test on a copy or a test site first. No writes to the live ERP until the user says so.

## Phases

| Phase | What | ERP access |
|---|---|---|
| A. Read only | Sync item catalog and prices into `erp_items`; show on a lead which ERP customer and quotations match its phone number; show quotation status on the lead | Read |
| B. Machine mapping | Table `machine_map`: what the AI hears ("20 kg wooden", "filter press 12 plate") to ERP item codes, reviewed by a person; unmapped asks go to a human | None |
| C. Draft quotation | "Prepare quotation" button on a lead: find or create Customer, Address, Contact; build the Quotation draft; link stored in `erp_links` | Write (Draft only) |
| D. Status back | Poll or webhook: Draft, Submitted, Ordered, Lost, Expired update the lead stage and the reports; quotation value feeds the Business dashboard | Read |
| E. After the order | Sales Order, advance payment, delivery status shown on the lead | Read |

## Data and API plan

- New tables: `erp_items` (code, name, group, price, active, synced_at), `machine_map`, `erp_links` (lead id, ERP doctype, ERP name, state, idempotency key, last error), `erp_outbox` (queued pushes with retry and clear errors).
- ERP side: a dedicated user `crm-integration` with a narrow role (create Customer, Address, Contact, Quotation; read Item, Item Price). API key and secret go in server environment variables only, never in the repo (the repo is public).
- Optional ERP custom field `crm_lead_id` on Quotation and Customer, so ERP users can find the CRM lead and the link can be rebuilt. Needs the owner's OK because it changes the ERP.
- Quotation draft fields filled by the CRM: customer, items (code, qty), tax template by place of supply, payment terms and terms template from defaults, `custom_sales_person` from the lead owner. Rates come from the ERP price list, so the ERP computes totals.
- Errors are shown to the sales person in plain words ("Customer has no state, so tax cannot be chosen"), never swallowed.

## Open questions for the owner

1. Which price list and Item Price records hold the real machine prices? Many items show a rate of 0.
2. What do `custom_type` (value `Import` on a domestic quotation) and `custom_sales_person` mean in practice?
3. Is a quotation ever made without an address and GST details? The CRM needs a rule for incomplete customers.
4. Who submits a draft quotation, and does anything outside the ERP happen after submit (PDF sent on WhatsApp)?
5. Can an ERP user `crm-integration` with an API key be created, or should we first try on a copy of the ERP?

## Tests planned

- Mapping a call's machine mention to the right item, and to none when unsure.
- Idempotency: the same push twice makes one draft.
- Failure of the ERP (timeout, validation error) keeps the outbox entry and shows a readable reason.
- A member can prepare quotations only for their own leads.
- Against a mock ERP server in tests; a real ERP only on explicit approval.
