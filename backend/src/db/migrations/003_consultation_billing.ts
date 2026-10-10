export const consultationBillingSchema = `
ALTER TABLE invoice_items ADD COLUMN appointment_id TEXT REFERENCES appointments(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_items_appointment_unique
  ON invoice_items(appointment_id) WHERE appointment_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS clinic_billing_settings (
  setting_key TEXT PRIMARY KEY CHECK (setting_key = 'consultation-fee'),
  label TEXT NOT NULL,
  value_paise INTEGER NOT NULL CHECK (value_paise >= 0),
  description TEXT NOT NULL DEFAULT '',
  updated_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT
);
INSERT OR IGNORE INTO clinic_billing_settings(setting_key,label,value_paise,description)
VALUES ('consultation-fee','Consultation fee',50000,'Default consultation/service charge in integer paise (50000 = ₹500.00).');
`;
