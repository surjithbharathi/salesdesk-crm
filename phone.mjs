// One canonical form for phone numbers: digits only, with the country code.
// The Android companion applies the same rules (SyncEngine.normalize), so a lead
// stored as "98765 43210", "+91 98765 43210" or "09876543210" all compare equal.
export const DEFAULT_COUNTRY = process.env.DEFAULT_COUNTRY_CODE || "91";

export function canonicalPhone(value, country = DEFAULT_COUNTRY) {
  const raw = String(value ?? "").trim();
  let digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (raw.startsWith("+")) return digits; // explicit international number
  if (digits.startsWith("00")) return digits.slice(2); // international dial prefix
  if (digits.startsWith("0")) digits = digits.slice(1); // trunk / STD prefix
  return digits.length === 10 ? country + digits : digits;
}
