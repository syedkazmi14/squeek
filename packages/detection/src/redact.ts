export function redact(text: string): string {
  return text
    .slice(0, 8000)
    .replace(/\b(?:0x)?[a-f0-9]{64}\b/gi, "[REDACTED]")
    .replace(
      /\b(?:private\s+key|recovery\s+phrase|seed\s+phrase)\s*[:=][^\n]*/gi,
      "[REDACTED]",
    )
    .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, "[REDACTED]")
    .replace(
      /https?:\/\/[^\s]+/gi,
      (url) => url.split(/[?#]/)[0] ?? "[REDACTED]",
    )
    .replace(/\b(?:\d[ -]?){6,}\d?\b/g, "[REDACTED]")
    .replace(
      /\b(?:code|pin|password|account)\s*[:=]?\s*[a-z0-9-]+/gi,
      (match) => `${match.split(/[ :=]/)[0]} [REDACTED]`,
    )
    .slice(0, 8000);
}
