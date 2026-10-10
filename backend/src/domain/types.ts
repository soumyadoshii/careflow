export const CAREFLOW_ROLES = [
  "Clinic Administrator",
  "Receptionist",
  "Doctor",
  "Pharmacist",
  "Laboratory Technician",
  "Patient",
] as const;

export type Role = (typeof CAREFLOW_ROLES)[number];
export type Status =
  | "Active"
  | "Inactive"
  | "Pending"
  | "Completed"
  | "Cancelled"
  | "In Progress"
  | "Paid"
  | "Part Paid"
  | "Unpaid"
  | "Draft"
  | "Approved"
  | "Received"
  | "Archived";

export interface Patient {
  id: string;
  mrn: string;
  name: string;
  dateOfBirth: string;
  sex: "Female" | "Male" | "Other";
  phone: string;
  email: string;
  bloodGroup: string;
  emergencyContact: string;
  registeredAt: string;
  lastVisit: string;
  status: "Active" | "Inactive";
}

export type AppointmentStatus =
  | "Pending Approval"
  | "Approved"
  | "Scheduled"
  | "Checked In"
  | "In Consultation"
  | "Completed"
  | "Cancelled"
  | "Rejected"
  | "No Show"
  | "Reschedule Requested";

export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string;
  provider: string;
  department: string;
  date: string;
  time: string;
  requestedDate: string;
  requestedTime: string;
  confirmedDate?: string;
  confirmedTime?: string;
  proposedDate?: string;
  proposedTime?: string;
  type: string;
  reason: string;
  requestedById: string;
  requestedByName: string;
  requestedByRole: Role;
  createdAt: string;
  updatedAt: string;
  approvedById?: string;
  approvedByName?: string;
  rejectionReason?: string;
  cancellationReason?: string;
  cancellationRequestedAt?: string;
  cancellationRequestedById?: string;
  cancellationRequestedByName?: string;
  cancellationRequestedByRole?: Role;
  rescheduleRequestedAt?: string;
  rescheduleRequestedById?: string;
  rescheduleRequestedByName?: string;
  rescheduleRequestedByRole?: Role;
  proposalById?: string;
  proposalByName?: string;
  proposalAcceptedById?: string;
  proposalAcceptedAt?: string;
  status: AppointmentStatus;
}

export interface AvailabilityBlock {
  id: string;
  targetType: "Patient" | "Doctor";
  targetId: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
  active: boolean;
  createdById: string;
}

export interface Consultation {
  id: string;
  appointmentId: string;
  patientId: string;
  provider: string;
  reason: string;
  notes: string;
  status: "Waiting" | "In Progress" | "Completed";
  date: string;
}

export interface PrescriptionLine {
  medicineId: string;
  dose: string;
  quantity: number;
  instructions: string;
}

export interface Prescription {
  id: string;
  patientId: string;
  provider: string;
  date: string;
  items: PrescriptionLine[];
  status: "Pending" | "Ready for Pickup" | "Dispensed" | "Cancelled";
}

export interface LabOrder {
  id: string;
  patientId: string;
  test: string;
  orderedAt: string;
  priority: "Routine" | "Urgent";
  assignedTo: string;
  status: "Ordered" | "Collected" | "Processing" | "Completed" | "Reviewed";
  result: string;
  referenceRange: string;
}

export interface Supplier {
  id: string;
  name: string;
  contact: string;
  phone: string;
  email: string;
  leadDays: number;
  status: "Active" | "Inactive";
}

export interface Medicine {
  id: string;
  code: string;
  name: string;
  form: string;
  strength: string;
  stock: number;
  minimumStock: number;
  expiry: string;
  supplierId: string;
  unitPrice: number;
  active: boolean;
}

export interface ProcurementLine {
  medicineId: string;
  quantity: number;
}

export interface ProcurementOrder {
  id: string;
  supplierId: string;
  createdAt: string;
  expectedAt: string;
  items: ProcurementLine[];
  status: "Draft" | "Submitted" | "Approved" | "Received" | "Cancelled";
  total: number;
}

export interface Invoice {
  id: string;
  patientId: string;
  issuedAt: string;
  dueAt: string;
  description: string;
  total: number;
  paid: number;
  status: "Unpaid" | "Part Paid" | "Paid" | "Void";
}

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  role: Role;
  department: string;
  status: "Active" | "Inactive";
  lastActive: string;
  patientId?: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  role: Role | "System";
  action: string;
  area: string;
  recordId: string;
  details: string;
}

export interface NotificationRecord {
  id: string;
  role: Role | "All staff";
  title: string;
  message: string;
  at: string;
  href: string;
  read: boolean;
  recipientId?: string;
  patientId?: string;
}

export interface SystemSetting {
  id: string;
  label: string;
  value: string;
  description: string;
}

export interface EntityMap {
  patients: Patient;
  appointments: Appointment;
  availabilityBlocks: AvailabilityBlock;
  consultations: Consultation;
  prescriptions: Prescription;
  labOrders: LabOrder;
  medicines: Medicine;
  suppliers: Supplier;
  procurement: ProcurementOrder;
  invoices: Invoice;
  users: UserAccount;
  audit: AuditEvent;
  notifications: NotificationRecord;
  settings: SystemSetting;
}

export type CollectionName = keyof EntityMap;
export type EntityOf<K extends CollectionName> = EntityMap[K];
export type NewEntity<T extends { id: string }> = Omit<T, "id"> & {
  id?: string;
};

export interface DemoSession {
  userId: string;
  name: string;
  role: Role;
  patientId?: string;
}
