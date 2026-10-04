---
name: elevenlabs-streaming-tts
description: Implement low-latency streaming ElevenLabs text-to-speech in an Express app. Use when adding or modifying a /api/tts endpoint that proxies ElevenLabs audio to the browser, or wiring an <audio> element to play it progressively.
---

# ElevenLabs streaming TTS (Express proxy + `<audio>` client)

This is the exact implementation used in `squeek/server.js` (`handleTts`) and `squeek/index.html` (`speak`). It is a hardened port of the Agentic-Detective `/api/tts` route.

## How it works

Browser `<audio src="/api/tts?text=...">` -> Express `GET /api/tts` -> `POST https://api.elevenlabs.io/v1/text-to-speech/{voiceId}/stream` -> chunks piped back as `audio/mpeg`.

The key idea: the endpoint answers **GET**, so the browser's own media stack streams and plays the MP3 as bytes arrive. No MediaSource, no fetch-and-blob, no WebSocket.

## Setup

- Deps: `express`, `cors`, `dotenv` (Node 18+ for global `fetch`). ESM (`"type": "module"`).
- `.env`: `ELEVENLABS_API_KEY=...` (also accept `ELEVEN_LABS_API_KEY`, the name Agentic-Detective uses).
- Never expose the key to the client; the server adds the `xi-api-key` header.

## Server

```js
import express from "express";
import cors from "cors";
import "dotenv/config";

const app = express();
const PORT = process.env.PORT || 3000;

const ELEVENLABS_BASE = "https://api.elevenlabs.io";
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // Rachel
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5";
const MAX_TEXT_LENGTH = 2000;
const CONNECT_TIMEOUT_MS = 10000;

app.use(cors());
app.use(express.json({ limit: "256kb" }));

function getApiKey() {
  return process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY;
}

async function handleTts(req, res) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return res.status(500).json({ error: "ELEVENLABS_API_KEY is not set on the server" });
  }

  // GET reads the query string, POST reads the JSON body.
  const source = req.method === "GET" ? req.query : req.body || {};
  const text = typeof source.text === "string" ? source.text.trim() : "";
  const resolvedVoiceId = source.voiceId || DEFAULT_VOICE_ID;

  if (!text) return res.status(400).json({ error: "`text` is required" });
  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(413).json({ error: `\`text\` must be ${MAX_TEXT_LENGTH} characters or fewer` });
  }
  // voiceId is interpolated into the upstream URL, so validate its shape.
  if (!/^[A-Za-z0-9]{16,40}$/.test(resolvedVoiceId)) {
    return res.status(400).json({ error: "`voiceId` is not a valid ElevenLabs voice id" });
  }

  // 1. Abort upstream if the browser walks away (new request, tab closed),
  //    so an abandoned stream stops burning credits.
  const upstream = new AbortController();
  let clientGone = false;
  res.on("close", () => {
    if (!res.writableEnded) {
      clientGone = true;
      upstream.abort();
    }
  });

  // 2. Connect timeout: only covers time until ElevenLabs sends headers.
  //    Cleared right after, so long audio can keep streaming.
  const connectTimeout = setTimeout(() => upstream.abort(), CONNECT_TIMEOUT_MS);

  let elevenRes;
  try {
    elevenRes = await fetch(
      `${ELEVENLABS_BASE}/v1/text-to-speech/${resolvedVoiceId}/stream?optimize_streaming_latency=3`,
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
          voice_settings: { stability: 0.5, similarity_boost: 0.8, use_speaker_boost: true },
        }),
      }
    );
  } catch (fetchErr) {
    clearTimeout(connectTimeout);
    if (clientGone) return; // browser left; nothing to answer
    if (fetchErr.name === "AbortError") {
      return res.status(504).json({ error: "ElevenLabs timed out" });
    }
    return res.status(500).json({ error: "Failed to reach ElevenLabs" });
  }
  clearTimeout(connectTimeout);

  // 3. Check upstream status BEFORE touching the body, so errors go back as JSON
  //    instead of a corrupt "audio" stream.
  if (!elevenRes.ok) {
    const errText = await elevenRes.text().catch(() => "");
    console.error("[/api/tts] ElevenLabs error:", elevenRes.status, errText);
    return res.status(502).json({ error: "TTS request failed", detail: errText });
  }

  // 4. Stream: set headers, flush immediately, then pump chunks with backpressure.
  try {
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Accel-Buffering", "no"); // stop nginx-style proxies buffering chunks
    res.flushHeaders();

    const reader = elevenRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) return res.end();
      if (!res.write(Buffer.from(value))) {
        await new Promise((resolve) => res.once("drain", resolve)); // backpressure
      }
    }
  } catch (streamErr) {
    if (streamErr.name === "AbortError") return; // client hung up
    console.error("[/api/tts] Stream pump error:", streamErr);
    if (!res.headersSent) res.status(500).end();
    else res.end(); // headers already sent; can only close
  }
}

app.get("/api/tts", handleTts);   // for <audio src=...>
app.post("/api/tts", handleTts);  // for fetch() callers
app.listen(PORT);
```

Optional voice list for a picker: `GET {ELEVENLABS_BASE}/v1/voices` with `xi-api-key`, mapped to `{ voiceId: v.voice_id, name: v.name }`.

## Client

```js
function speak(text, voiceId) {
  // Stop current playback and drop its connection (server aborts upstream).
  player.pause();
  player.removeAttribute("src");
  player.load();

  const params = new URLSearchParams({ text });
  if (voiceId) params.set("voiceId", voiceId);

  player.src = `/api/tts?${params}`;
  player.play().catch((err) => { if (err.name !== "AbortError") console.warn(err); });
}
```

- Call `speak()` from a user gesture (keypress/click) to satisfy the browser autoplay policy.
- Measure latency: record `performance.now()` before `speak`, then read it again in the `playing` event ("first audio in N ms").
- The `<audio>` `error` event gives no detail. On error, re-`fetch(player.src)` and read the JSON `{error, detail}` to show a useful message.

## Why these choices

| Choice | Reason |
|---|---|
| `eleven_flash_v2_5` | Lowest-latency ElevenLabs model |
| `optimize_streaming_latency=3` | Trades a little quality for faster first byte |
| GET endpoint | `<audio>` streams natively; no MediaSource |
| Status check before body | Errors return as JSON, not as broken audio |
| `flushHeaders()` + `X-Accel-Buffering: no` | First chunk is not held back by Express or a proxy |
| Await `drain` | Backpressure: don't buffer unbounded audio for slow clients |
| Abort on `res` close | Stop paying for audio nobody is listening to |
| Connect-only timeout | Catches a hung upstream without cutting long audio short |
| `voiceId` regex | Prevents path injection into the upstream URL |

## Gotchas

- Distinguish a client hangup from a timeout: both abort the same controller, so track `clientGone` and return silently in that case.
- `reader.read()` yields `Uint8Array`; wrap in `Buffer.from(value)` for `res.write`.
- Once headers are flushed you cannot change the status code; just `res.end()`.
- No rate limiting is included. Agentic-Detective uses `express-rate-limit` (30/min/IP) on its `/api/tts` if you need it.

## Testing

```
npm start
curl -s -D - -o out.mp3 -w "ttfb=%{time_starttransfer}s total=%{time_total}s\n" \
  "http://localhost:3000/api/tts?text=Hello%20world"
```

Expect `200`, `Content-Type: audio/mpeg`, `Transfer-Encoding: chunked`, and `ttfb` noticeably below `total` on longer text. Bad `voiceId` or empty `text` should return 400.
