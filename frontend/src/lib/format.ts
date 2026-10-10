type DateFormat = "MMM D, YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD";
let activeDateFormat: DateFormat = "MMM D, YYYY";
export const setDateFormatPreference = (value: DateFormat): void => {
  activeDateFormat = value;
};
const moneyPattern = /^(\d+)(?:\.(\d{1,2}))?$/;
export const moneyToPaise = (value: number | string): number => {
  const match = moneyPattern.exec(String(value).trim());
  if (!match)
    throw new Error(
      "Enter a non-negative INR amount with at most two decimal places.",
    );
  const paise =
    BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  if (paise > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Amount exceeds the supported INR limit.");
  return Number(paise);
};
export const paiseToRupees = (paise: number): number => {
  if (!Number.isSafeInteger(paise) || paise < 0)
    throw new Error("Money must be represented as non-negative integer paise.");
  return paise / 100;
};
export const formatMoney = (amount: number): string =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(paiseToRupees(moneyToPaise(amount)));

export const formatDate = (value: string): string => {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  const format = activeDateFormat;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  if (format === "DD/MM/YYYY") return `${day}/${month}/${year}`;
  if (format === "YYYY-MM-DD") return `${year}-${month}-${day}`;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

export const dateToday = (): string => new Date().toISOString().slice(0, 10);
export const makeId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36).toUpperCase()}`;

export function lineAmountPaise(unitPrice: number, quantity: number): number {
  if (!Number.isSafeInteger(quantity) || quantity < 1)
    throw new Error("Line quantity must be a positive integer.");
  const total = BigInt(moneyToPaise(unitPrice)) * BigInt(quantity);
  if (total > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Line amount exceeds the supported INR limit.");
  return Number(total);
}
export function sumPaise(values: readonly number[]): number {
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
  if (total < 0n || total > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Total exceeds the supported INR limit.");
  return Number(total);
}
