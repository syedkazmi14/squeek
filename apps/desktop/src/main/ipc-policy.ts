export function allowedFrame(url: string, mainFrame: boolean): boolean {
  return mainFrame && url === "squeek://app/index.html";
}
export function validateInput(action: unknown, value: unknown): unknown {
  if (action === "state" || action === "demo") {
    if (value !== undefined) throw Error("Invalid request");
    return undefined;
  }
  if (action === "cloud") {
    if (typeof value !== "boolean") throw Error("Invalid request");
    return value;
  }
  if (action === "check") {
    if (typeof value !== "string" || !value.trim() || value.length > 8000)
      throw Error("Invalid request");
    return value;
  }
  if (action === "monitor") {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw Error("Invalid request");
    const v = value as Record<string, unknown>;
    if (
      Object.keys(v).length !== 2 ||
      typeof v.enabled !== "boolean" ||
      !["chrome", "msedge"].includes(String(v.browser))
    )
      throw Error("Invalid request");
    return { enabled: v.enabled, browser: v.browser };
  }
  throw Error("Invalid request");
}
