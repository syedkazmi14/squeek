const ELEVENLABS_BASE = "https://api.elevenlabs.io";
// Same voice the local TTS server (server.js) uses.
const VOICE_ID = "s3TPKV1kjDlVtZbl4Ksh";
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5";
const MAX_TEXT_LENGTH = 700;
const CONNECT_TIMEOUT_MS = 10000;
// Enough for Replay of recent warnings without holding every message's audio.
const CACHE_SIZE = 8;
// Opening a connection to ElevenLabs costs ~250 ms. Chromium keeps an idle
// connection for minutes, so touching it this often keeps it ready.
const KEEP_WARM_MS = 60000;

/**
 * Streams ElevenLabs MP3 for `squeek://app/tts?text=...` so an <audio> element
 * starts playing as the first bytes arrive. Recent clips are kept in memory,
 * so Replay neither waits nor spends credits again.
 *
 * `fetchImpl` should be Electron's `net.fetch`: unlike Node's fetch, which
 * drops idle connections after a few seconds, it keeps them open for reuse.
 */
export function createTts(
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
) {
  const cache = new Map<string, Uint8Array<ArrayBuffer>>();
  let warmTimer: ReturnType<typeof setInterval> | undefined;

  async function handle(request: Request): Promise<Response> {
    if (!apiKey) return new Response("", { status: 503 });
    const text = new URL(request.url).searchParams.get("text")?.trim() ?? "";
    if (!text || text.length > MAX_TEXT_LENGTH)
      return new Response("", { status: 400 });
    const headers = { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" };
    const cached = cache.get(text);
    if (cached) return new Response(cached, { headers });

    // Covers only the wait for ElevenLabs' headers; long audio keeps streaming.
    const upstream = new AbortController();
    const connectTimeout = setTimeout(() => upstream.abort(), CONNECT_TIMEOUT_MS);
    let elevenRes: Response;
    try {
      elevenRes = await fetchImpl(
        `${ELEVENLABS_BASE}/v1/text-to-speech/${VOICE_ID}/stream?optimize_streaming_latency=3`,
        {
          method: "POST",
          signal: upstream.signal,
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": apiKey,
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text,
            model_id: MODEL_ID,
            voice_settings: {
              stability: 0.7,
              similarity_boost: 0.8,
              use_speaker_boost: true,
              // Slow, steady delivery: many listeners are older adults.
              speed: 0.8,
            },
          }),
        },
      );
    } catch {
      return new Response("", { status: 504 });
    } finally {
      clearTimeout(connectTimeout);
    }
    // Check status before the body so errors never reach <audio> as "audio".
    if (!elevenRes.ok || !elevenRes.body) {
      await elevenRes.body?.cancel().catch(() => {});
      return new Response("", { status: 502 });
    }

    // Pass chunks through as they arrive and keep a copy for the cache.
    const chunks: Uint8Array[] = [];
    const reader = elevenRes.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            remember(text, concat(chunks));
            return;
          }
          chunks.push(value);
          controller.enqueue(value);
        } catch (error) {
          controller.error(error);
        }
      },
      // The player stopped or moved on: stop paying for unheard audio.
      cancel(reason) {
        upstream.abort();
        return reader.cancel(reason);
      },
    });
    return new Response(body, { headers });
  }

  function remember(text: string, audio: Uint8Array<ArrayBuffer>): void {
    cache.delete(text);
    cache.set(text, audio);
    for (const oldest of cache.keys()) {
      if (cache.size <= CACHE_SIZE) break;
      cache.delete(oldest);
    }
  }

  /** Opens (or reuses) the connection with a free request; spends no credits. */
  function warm(): void {
    if (!apiKey) return;
    void fetchImpl(`${ELEVENLABS_BASE}/v1/voices/${VOICE_ID}`, {
      headers: { "xi-api-key": apiKey },
    })
      .then((response) => response.arrayBuffer())
      .catch(() => {});
  }

  /** Keeps the connection ready while a warning could be spoken at any moment. */
  function keepWarm(on: boolean): void {
    if (on && !warmTimer && apiKey) {
      warm();
      warmTimer = setInterval(warm, KEEP_WARM_MS);
    } else if (!on && warmTimer) {
      clearInterval(warmTimer);
      warmTimer = undefined;
    }
  }

  return { configured: Boolean(apiKey), handle, warm, keepWarm };
}

function concat(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
