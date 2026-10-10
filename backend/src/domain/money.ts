const decimalAmount = /^(\d+)(?:\.(\d{1,2}))?$/;
// Numeric rupee API values have a lower exactness ceiling than integer paise.
// This conservative maximum keeps every accepted cents value within double precision.
const MAX_API_PAISA = 7_000_000_000_000_000n;
function decimalToPaise(value: unknown): bigint {
  if (typeof value !== "number" && typeof value !== "string")
    throw new Error(
      "Amount must be a non-negative INR decimal with at most two fractional digits.",
    );
  const match = decimalAmount.exec(String(value).trim());
  if (!match)
    throw new Error(
      "Amount must be a non-negative INR decimal with at most two fractional digits.",
    );
  return (
    BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0")
  );
}
export function rupeesToPaise(value: unknown): number {
  const paise = decimalToPaise(value);
  if (paise > MAX_API_PAISA)
    throw new Error("Amount exceeds the supported exact INR API limit.");
  const numericRupees = Number(paise) / 100;
  if (decimalToPaise(String(numericRupees)) !== paise)
    throw new Error(
      "Amount cannot be represented exactly at the INR API boundary.",
    );
  return Number(paise);
}
export function paiseToRupees(paise: number): number {
  if (
    !Number.isSafeInteger(paise) ||
    paise < 0 ||
    BigInt(paise) > MAX_API_PAISA
  )
    throw new Error("Stored money exceeds the supported exact INR API limit.");
  const numericRupees = paise / 100;
  if (decimalToPaise(String(numericRupees)) !== BigInt(paise))
    throw new Error(
      "Stored paise cannot be represented exactly at the INR API boundary.",
    );
  return numericRupees;
}
function indianInteger(rupees: bigint): string {
  const digits = rupees.toString();
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${digits.slice(-3)}`;
}
export function formatINRPaise(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0)
    throw new Error("Money must be represented as non-negative integer paise.");
  return `₹${indianInteger(BigInt(paise) / 100n)}.${String(paise % 100).padStart(2, "0")}`;
}
