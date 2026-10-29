-- Read-only mirror of ERPNext documents that matter to a lead: quotations and sales invoices.
-- The ERP owns these; the CRM only reads them and links them to a lead by phone number.
CREATE TABLE erp_documents (
  doctype TEXT NOT NULL CHECK (doctype IN ('Quotation','Sales Invoice')),
  name TEXT NOT NULL,
  docstatus INTEGER NOT NULL CHECK (docstatus IN (0,1,2)),
  status TEXT,
  party_name TEXT,
  mobile_raw TEXT,
  phone_e164 TEXT,
  doc_date TEXT,
  grand_total REAL NOT NULL DEFAULT 0,
  outstanding REAL,
  sales_person TEXT,
  erp_modified TEXT NOT NULL,
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  first_seen_at TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (doctype, name)
);
CREATE INDEX erp_documents_lead ON erp_documents(lead_id, doc_date DESC) WHERE lead_id IS NOT NULL;
CREATE INDEX erp_documents_unmatched ON erp_documents(phone_e164) WHERE lead_id IS NULL;

CREATE TABLE erp_sync_state (
  doctype TEXT PRIMARY KEY,
  last_modified TEXT,
  last_run_at TEXT,
  last_error TEXT
);
