export function allowedFrame(url: string, mainFrame: boolean): boolean {
  return mainFrame && url === "squeek://app/index.html";
}
export function validateInput(action: unknown, value: unknown): unknown {
  if (
    typeof action === "string" &&
    ["state", "demo", "show", "hide", "sync-signout"].includes(action)
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
  if (action === "sync-signin") {
    // The email the iPhone account uses, so the PC opens the same account.
    if (
      typeof value !== "string" ||
      value.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
    )
      throw Error("Invalid request");
    return value.trim();
  }
  if (action === "profile") {
    // A short note about the user, kept on this computer.
    if (typeof value !== "string" || value.length > 300) throw Error("Invalid request");
    return value.trim();
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
