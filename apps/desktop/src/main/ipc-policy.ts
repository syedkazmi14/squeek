export function allowedFrame(url: string, mainFrame: boolean): boolean {
  return mainFrame && url === "squeek://app/index.html";
}
export function validateInput(action: unknown, value: unknown): unknown {
  if (
    typeof action === "string" &&
    ["state", "demo", "show", "hide"].includes(action)
  ) {
    if (value !== undefined) throw Error("Invalid request");
    return undefined;
  }
  if (action === "listening") {
    if (!["start", "hold", "nothing", "cancel"].includes(value as string))
      throw Error("Invalid request");
    return value;
  }
  if (action === "talk") {
    // Recorded speech from the panel's microphone, bounded like any other input.
    if (!(value instanceof Uint8Array) || !value.length || value.length > 5 * 1024 * 1024)
      throw Error("Invalid request");
    return value;
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
      typeof v.browser !== "string" ||
      !["chrome", "msedge"].includes(v.browser)
    )
      throw Error("Invalid request");
    return { enabled: v.enabled, browser: v.browser };
  }
  throw Error("Invalid request");
}
