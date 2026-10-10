export const initialSchema = `
CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY, mrn TEXT NOT NULL UNIQUE, name TEXT NOT NULL, date_of_birth TEXT NOT NULL,
  sex TEXT NOT NULL CHECK (sex IN ('Female','Male','Other')), phone TEXT NOT NULL, email TEXT NOT NULL DEFAULT '',
  blood_group TEXT NOT NULL DEFAULT '', emergency_contact TEXT NOT NULL DEFAULT '', registered_at TEXT NOT NULL,
  last_visit TEXT, status TEXT NOT NULL CHECK (status IN ('Active','Inactive')), created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('Clinic Administrator','Receptionist','Doctor','Pharmacist','Laboratory Technician','Patient')),
  department TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK (status IN ('Active','Inactive')),
  last_active TEXT NOT NULL DEFAULT '', patient_id TEXT UNIQUE REFERENCES patients(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  created_at TEXT, updated_at TEXT, CHECK (role = 'Patient' OR patient_id IS NULL)
);
CREATE TABLE IF NOT EXISTS credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL, failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until TEXT, token_version INTEGER NOT NULL DEFAULT 0 CHECK (token_version >= 0), password_updated_at TEXT
);
CREATE TABLE IF NOT EXISTS preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  date_format TEXT NOT NULL DEFAULT 'MMM D, YYYY' CHECK (date_format IN ('MMM D, YYYY','DD/MM/YYYY','YYYY-MM-DD')),
  compact_tables INTEGER NOT NULL DEFAULT 0 CHECK (compact_tables IN (0,1)), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  doctor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, provider TEXT NOT NULL, department TEXT NOT NULL,
  date TEXT NOT NULL, time TEXT NOT NULL, requested_date TEXT NOT NULL, requested_time TEXT NOT NULL,
  confirmed_date TEXT, confirmed_time TEXT, proposed_date TEXT, proposed_time TEXT, type TEXT NOT NULL, reason TEXT NOT NULL,
  requested_by_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, requested_by_name TEXT NOT NULL,
  requested_by_role TEXT NOT NULL CHECK (requested_by_role IN ('Clinic Administrator','Receptionist','Doctor','Pharmacist','Laboratory Technician','Patient')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, approved_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_by_name TEXT, rejection_reason TEXT, cancellation_reason TEXT, cancellation_requested_at TEXT,
  cancellation_requested_by_id TEXT REFERENCES users(id) ON DELETE SET NULL, cancellation_requested_by_name TEXT,
  cancellation_requested_by_role TEXT, reschedule_requested_at TEXT,
  reschedule_requested_by_id TEXT REFERENCES users(id) ON DELETE SET NULL, reschedule_requested_by_name TEXT,
  reschedule_requested_by_role TEXT, proposal_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  proposal_by_name TEXT, proposal_accepted_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  proposal_accepted_at TEXT, status TEXT NOT NULL CHECK (status IN ('Pending Approval','Approved','Scheduled','Checked In','In Consultation','Completed','Cancelled','Rejected','No Show','Reschedule Requested'))
);
CREATE TABLE IF NOT EXISTS availability_blocks (
  id TEXT PRIMARY KEY, target_type TEXT NOT NULL CHECK (target_type IN ('Patient','Doctor')),
  patient_id TEXT REFERENCES patients(id) ON DELETE RESTRICT, doctor_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, reason TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0,1)), created_by_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  CHECK (start_time < end_time), CHECK ((target_type='Patient' AND patient_id IS NOT NULL AND doctor_id IS NULL) OR (target_type='Doctor' AND doctor_id IS NOT NULL AND patient_id IS NULL))
);
CREATE TABLE IF NOT EXISTS consultations (
  id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE RESTRICT,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT, doctor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL, reason TEXT NOT NULL, notes TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('Waiting','In Progress','Completed')),
  date TEXT NOT NULL, created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS prescriptions (
  id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  doctor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, provider TEXT NOT NULL, date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Pending','Ready for Pickup','Dispensed','Cancelled')),
  dispensed_at TEXT, dispensed_by_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, contact TEXT NOT NULL, phone TEXT NOT NULL, email TEXT NOT NULL,
  lead_days INTEGER NOT NULL CHECK (lead_days >= 0), status TEXT NOT NULL CHECK (status IN ('Active','Inactive')),
  created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS medicines (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, form TEXT NOT NULL, strength TEXT NOT NULL,
  stock INTEGER NOT NULL CHECK (stock >= 0), minimum_stock INTEGER NOT NULL CHECK (minimum_stock >= 0), expiry TEXT NOT NULL,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT, unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise >= 0),
  active INTEGER NOT NULL CHECK (active IN (0,1)), created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS prescription_items (
  id TEXT PRIMARY KEY, prescription_id TEXT NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL CHECK (line_no >= 0), medicine_id TEXT NOT NULL REFERENCES medicines(id) ON DELETE RESTRICT,
  dose TEXT NOT NULL, quantity INTEGER NOT NULL CHECK (quantity > 0), instructions TEXT NOT NULL,
  UNIQUE (prescription_id,line_no)
);
CREATE TABLE IF NOT EXISTS lab_orders (
  id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  ordered_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, test TEXT NOT NULL, ordered_at TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('Routine','Urgent')), assigned_to TEXT NOT NULL DEFAULT '',
  assigned_to_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('Ordered','Collected','Processing','Completed','Reviewed')),
  result TEXT NOT NULL DEFAULT '', reference_range TEXT NOT NULL DEFAULT '', created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS procurement_orders (
  id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL, expected_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Draft','Submitted','Approved','Received','Cancelled')),
  total_paise INTEGER NOT NULL DEFAULT 0 CHECK (total_paise >= 0), received_at TEXT,
  received_by_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS procurement_items (
  id TEXT PRIMARY KEY, procurement_id TEXT NOT NULL REFERENCES procurement_orders(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL CHECK (line_no >= 0), medicine_id TEXT NOT NULL REFERENCES medicines(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0), unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise >= 0),
  UNIQUE (procurement_id,line_no)
);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  issued_at TEXT NOT NULL, due_at TEXT NOT NULL, description TEXT NOT NULL,
  total_paise INTEGER NOT NULL CHECK (total_paise >= 0), paid_paise INTEGER NOT NULL DEFAULT 0 CHECK (paid_paise >= 0 AND paid_paise <= total_paise),
  status TEXT NOT NULL CHECK (status IN ('Unpaid','Part Paid','Paid','Void')),
  voided_by_id TEXT REFERENCES users(id) ON DELETE SET NULL, voided_at TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL CHECK (line_no >= 0), description TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0), unit_amount_paise INTEGER NOT NULL CHECK (unit_amount_paise >= 0),
  amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0), UNIQUE (invoice_id,line_no)
);
CREATE TABLE IF NOT EXISTS invoice_payments (
  id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0), method TEXT NOT NULL DEFAULT '', reference TEXT NOT NULL DEFAULT '',
  recorded_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, recorded_at TEXT NOT NULL, entry_kind TEXT NOT NULL DEFAULT 'payment' CHECK (entry_kind IN ('opening_balance','payment'))
);
CREATE TABLE IF NOT EXISTS audit (
  id TEXT PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  role TEXT NOT NULL, action TEXT NOT NULL, area TEXT NOT NULL, record_id TEXT NOT NULL, details TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, role TEXT NOT NULL CHECK (role IN ('Clinic Administrator','Receptionist','Doctor','Pharmacist','Laboratory Technician','Patient','All staff')),
  recipient_id TEXT REFERENCES users(id) ON DELETE CASCADE, patient_id TEXT REFERENCES patients(id) ON DELETE SET NULL,
  title TEXT NOT NULL, message TEXT NOT NULL, at TEXT NOT NULL, href TEXT NOT NULL DEFAULT '', read INTEGER NOT NULL DEFAULT 0 CHECK (read IN (0,1))
);
CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY, label TEXT NOT NULL, value TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', updated_by_id TEXT REFERENCES users(id) ON DELETE SET NULL, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor_slot ON appointments(doctor_id,date,time,status);
CREATE INDEX IF NOT EXISTS idx_appointments_patient_slot ON appointments(patient_id,date,time,status);
CREATE INDEX IF NOT EXISTS idx_blocks_patient_date ON availability_blocks(patient_id,date,active,start_time,end_time);
CREATE INDEX IF NOT EXISTS idx_blocks_doctor_date ON availability_blocks(doctor_id,date,active,start_time,end_time);
CREATE INDEX IF NOT EXISTS idx_consultations_patient_date ON consultations(patient_id,date);
CREATE INDEX IF NOT EXISTS idx_prescriptions_patient_date ON prescriptions(patient_id,date,status);
CREATE INDEX IF NOT EXISTS idx_lab_patient_status ON lab_orders(patient_id,status,ordered_at);
CREATE INDEX IF NOT EXISTS idx_lab_assigned_status ON lab_orders(assigned_to_user_id,status,ordered_at);
CREATE INDEX IF NOT EXISTS idx_procurement_supplier_status ON procurement_orders(supplier_id,status);
CREATE INDEX IF NOT EXISTS idx_invoices_patient_date ON invoices(patient_id,issued_at,status);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id,recorded_at);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_read ON notifications(recipient_id,read,at);
CREATE INDEX IF NOT EXISTS idx_audit_record_time ON audit(area,record_id,at);
CREATE INDEX IF NOT EXISTS idx_audit_actor_time ON audit(actor_user_id,at);
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(name COLLATE NOCASE);
`;
