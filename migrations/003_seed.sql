-- Seed reference data (docs/PHASE1_SCHEMA.md section 3). Editable by the owner afterwards.

INSERT INTO statuses (id, label, stage_group, lifecycle, sort) VALUES
  ('st_new_lead',            'New Lead',                          'FRESH',  'new',         1),
  ('st_contact_attempted',   'Contact Attempted',                 'ACTIVE', 'prospecting', 2),
  ('st_interested',          'Interested Customer',               'ACTIVE', 'opportunity', 3),
  ('st_requirement',         'Requirement Discussion',            'ACTIVE', 'prospecting', 4),
  ('st_quotation',           'Quotation Shared',                  'ACTIVE', 'opportunity', 5),
  ('st_negotiation',         'Follow-up / Negotiation',           'ACTIVE', 'opportunity', 6),
  ('st_later_purchase',      'Later Purchase',                    'ACTIVE', 'prospecting', 7),
  ('st_loan_docs',           'Loan Document Collected',           'ACTIVE', 'opportunity', 8),
  ('st_loan_process',        'Loan In Process',                   'ACTIVE', 'opportunity', 9),
  ('st_advance_pending',     'Advance Pending',                   'ACTIVE', 'opportunity', 10),
  ('st_advance_received',    'Advance Received',                  'ACTIVE', 'opportunity', 11),
  ('st_payment_received',    'Payment Received',                  'ACTIVE', 'opportunity', 12),
  ('st_dispatched',          'Machine Dispatched',                'ACTIVE', 'customer',    13),
  ('st_delivered',           'Machine Delivered - Need To Start', 'ACTIVE', 'customer',    14),
  ('st_regular_customer',    'Regular Customer',                  'ACTIVE', 'customer',    15),
  ('st_won',                 'Won',                               'WON',    'closed',      16),
  ('st_lost',                'Lost',                              'LOST',   'closed',      17);

-- Old spellings and the earlier four-stage model, so imports and migrations resolve cleanly.
INSERT INTO status_aliases (alias, status_id) VALUES
  ('Intrested Customer', 'st_interested'),
  ('Interested',         'st_interested'),
  ('Intrested',          'st_interested'),
  ('Need Discussion',    'st_requirement'),
  ('New',                'st_new_lead'),
  ('Prospecting',        'st_requirement'),
  ('Opportunity',        'st_interested'),
  ('Return Customer',    'st_regular_customer'),
  ('Machine Delivered',  'st_delivered');

INSERT INTO lost_reasons (id, label, is_default, sort) VALUES
  ('lr_no_need',           'No Need',                             0, 1),
  ('lr_no_response',       'No response after multiple attempts', 0, 2),
  ('lr_price',             'Price / budget issue',                0, 3),
  ('lr_product',           'Product not suitable',                0, 4),
  ('lr_competitor',        'Lost to competitor',                  0, 5),
  ('lr_postponed',         'Purchase postponed',                  0, 6),
  ('lr_finance',           'Finance not approved',                0, 7),
  ('lr_duplicate',         'Duplicate lead',                      0, 8),
  ('lr_manual',            'Manually closed',                     0, 9),
  ('lr_wrong_number',      'Wrong number',                        0, 10),
  ('lr_unknown',           'Unknown reason',                      1, 11);

INSERT INTO lost_reason_aliases (alias, lost_reason_id) VALUES
  ('Unable to Connect',                   'lr_no_response'),
  ('No Response After Multiple Attempts', 'lr_no_response'),
  ('Budget Issues',                       'lr_price'),
  ('Price / Budget Issue',                'lr_price'),
  ('Product does not fit need',           'lr_product'),
  ('Product Not Suitable',                'lr_product'),
  ('Purchase Postponed',                  'lr_postponed'),
  ('Finance Not Approved',                'lr_finance'),
  ('Duplicate Lead',                      'lr_duplicate'),
  ('Manually Closed',                     'lr_manual'),
  ('Unknown Reason',                      'lr_unknown');

INSERT INTO call_outcomes (id, label, polarity, effect, sort) VALUES
  ('co_interested',     'Interested',     'positive', 'open_opportunity', 1),
  ('co_call_later',     'Call later',     'neutral',  'keep_prospecting', 2),
  ('co_service_ticket', 'Service ticket', 'neutral',  'keep_prospecting', 3),
  ('co_not_interested', 'Not interested', 'negative', 'close_lead',       4),
  ('co_wrong_number',   'Wrong number',   'negative', 'close_lead',       5),
  ('co_no_answer',      'No answer',      'neutral',  'none',             6);

INSERT INTO lead_sources (id, label, kind) VALUES
  ('src_manual',            'Manual',            'manual'),
  ('src_excel',             'Excel',             'upload'),
  ('src_ivr',               'IVR',               'telephony'),
  ('src_call_logs',         'Call Logs',         'telephony'),
  ('src_website',           'Website',           'web'),
  ('src_webhook',           'Webhook',           'api'),
  ('src_wordpress',         'WordPress',         'web'),
  ('src_meta_ads',          'Meta Ads',          'ads'),
  ('src_google_ads',        'Google Ads',        'ads'),
  ('src_instagram',         'Instagram',         'social'),
  ('src_youtube',           'YouTube',           'social'),
  ('src_referral',          'Customer Referral', 'referral'),
  ('src_existing_customer', 'Existing Customer', 'referral'),
  ('src_walk_in',           'Walk-in',           'offline'),
  ('src_exhibition',        'Exhibition',        'offline'),
  ('src_dealer',            'Dealer / Reseller', 'partner'),
  ('src_indiamart',         'IndiaMart',         'marketplace'),
  ('src_tradeindia',        'TradeIndia',        'marketplace'),
  ('src_justdial',          'JustDial',          'marketplace'),
  ('src_superfone',         'Superfone',         'telephony'),
  ('src_whatsapp',          'Whatsapp',          'messaging'),
  ('src_facebook',          'Facebook',          'ads'),
  ('src_shopify',           'Shopify',           'web'),
  ('src_google_sheets',     'Google Sheets',     'upload'),
  ('src_other',             'Other',             'other');

INSERT INTO tags (id, label, color) VALUES
  ('tag_hot',  'Hot',  '#dd0081'),
  ('tag_cold', 'Cold', '#0077df');

INSERT INTO task_types (id, label) VALUES
  ('tt_call_followup',  'Call follow-up'),
  ('tt_quotation',      'Prepare quotation'),
  ('tt_send_info',      'Send information'),
  ('tt_visit',          'Site visit'),
  ('tt_payment',        'Collect payment'),
  ('tt_service',        'Service follow-up');

-- Placeholder permission trees; the full per-field/per-action matrix arrives in Phase 8.
INSERT INTO roles (id, name, permissions) VALUES
  ('role_admin',     'Admin',     '{"leads":{"view":"all","edit":"all","assign":true,"delete":true,"export":true},"recordings":{"listen":"all"},"settings":{"manage":true},"ai":{"approve":true,"configure":true}}'),
  ('role_manager',   'Manager',   '{"leads":{"view":"all","edit":"all","assign":true,"delete":false,"export":false},"recordings":{"listen":"all"},"settings":{"manage":false},"ai":{"approve":true,"configure":false}}'),
  ('role_caller',    'Caller',    '{"leads":{"view":"own","edit":"own","assign":false,"delete":false,"export":false},"recordings":{"listen":"own"},"settings":{"manage":false},"ai":{"approve":true,"configure":false}}'),
  ('role_marketing', 'Marketing', '{"leads":{"view":"all","edit":"none","assign":false,"delete":false,"export":false},"recordings":{"listen":"none"},"settings":{"manage":false},"ai":{"approve":false,"configure":false}}');

-- Agents ship disabled; owner switches them on one by one (docs/AI_ARCHITECTURE.md section 2).
INSERT INTO agents (id, name, role, enabled, autonomy, updated_at) VALUES
  ('agent_qualifier',  'Lead Qualifier',               'Capture and qualify every enquiry, route to the right person',          0, 3, '2026-01-01T00:00:00.000Z'),
  ('agent_sales',      'Sales Agent',                  'Follow-ups, quotation drafts, objection handling, daily work plan',     0, 2, '2026-01-01T00:00:00.000Z'),
  ('agent_service',    'Customer Relations / Service', 'Tickets, spares, service scheduling, post-delivery follow-up',          0, 2, '2026-01-01T00:00:00.000Z'),
  ('agent_conversion', 'Conversion Manager',           'Pipeline review, lead-source performance, lost-reason analysis',        0, 1, '2026-01-01T00:00:00.000Z'),
  ('agent_ops',        'Ops Agent',                    'Payments, dispatch, loan documents, ERP sync',                          0, 2, '2026-01-01T00:00:00.000Z'),
  ('agent_owner',      'Owner Assistant',              'Answers owner questions and prepares briefings (read-only)',            0, 1, '2026-01-01T00:00:00.000Z'),
  ('agent_voice',      'Voice Agent',                  'Outbound and inbound calls in Tamil, Hindi and English',                0, 1, '2026-01-01T00:00:00.000Z');

-- Owner-controlled switches. Values are plain text; the application interprets them.
INSERT INTO policy (key, value, updated_at) VALUES
  ('kill_switch',       '0',    '2026-01-01T00:00:00.000Z'),
  ('recording_notice',  'off',  '2026-01-01T00:00:00.000Z'),
  ('quiet_hours',       '',     '2026-01-01T00:00:00.000Z'),
  ('default_country',   '91',   '2026-01-01T00:00:00.000Z'),
  ('report_delivery',   'app',  '2026-01-01T00:00:00.000Z');
