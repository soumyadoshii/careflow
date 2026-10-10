export const integritySchema = `
CREATE TRIGGER IF NOT EXISTS users_patient_link_insert
BEFORE INSERT ON users
WHEN (NEW.role='Patient' AND NEW.patient_id IS NULL) OR (NEW.role<>'Patient' AND NEW.patient_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'Patient role and patient_id must match'); END;
CREATE TRIGGER IF NOT EXISTS users_patient_link_update
BEFORE UPDATE OF role, patient_id ON users
WHEN (NEW.role='Patient' AND NEW.patient_id IS NULL) OR (NEW.role<>'Patient' AND NEW.patient_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'Patient role and patient_id must match'); END;
UPDATE lab_orders
SET assigned_to_user_id=(SELECT MIN(u.id) FROM users u WHERE u.role='Laboratory Technician' AND u.status='Active' AND u.name=lab_orders.assigned_to HAVING COUNT(*)=1)
WHERE assigned_to_user_id IS NULL AND assigned_to<>'';
`;
