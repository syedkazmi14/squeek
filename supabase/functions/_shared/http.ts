// Small HTTP helpers shared by every function. Request bodies are never logged.

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function readJson<T>(req: Request, maxBytes = 32_000): Promise<T> {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "request too large");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

/** Wraps a handler with CORS, method checks and sanitized error responses. */
export function serve(name: string, handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    const started = Date.now();
    try {
      const res = await handler(req);
      console.log(JSON.stringify({ fn: name, status: res.status, ms: Date.now() - started }));
      return res;
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof HttpError ? err.message : "internal error";
      console.error(JSON.stringify({ fn: name, status, ms: Date.now() - started, error: String(err).slice(0, 200) }));
      return json({ error: message }, status);
    }
  });
}

export function requireString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new HttpError(400, `${field} is required`);
  if (value.length > maxLength) throw new HttpError(413, `${field} is too long`);
  return value;
}

export function optionalUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
