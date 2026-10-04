// Phone number normalization to E.164. Mirrored in Swift by PhoneNumbers.swift.

/** Returns "+<digits>" or null. Ten-digit numbers are treated as US/Canada (+1). */
export function normalizeE164(input: string, defaultCountryCode = "1"): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, "");
  let e164: string;
  if (trimmed.startsWith("+")) e164 = "+" + digits;
  else if (trimmed.startsWith("00")) e164 = "+" + digits.slice(2);
  else if (digits.length === 10) e164 = "+" + defaultCountryCode + digits;
  else if (digits.length === 11 && digits.startsWith("1")) e164 = "+" + digits;
  else e164 = "+" + digits;
  return /^\+[1-9]\d{6,14}$/.test(e164) ? e164 : null;
}
