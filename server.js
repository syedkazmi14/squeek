import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ELEVENLABS_BASE = "https://api.elevenlabs.io";
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // Rachel
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5";
const MAX_TEXT_LENGTH = 2000;
const CONNECT_TIMEOUT_MS = 10000;

app.use(cors());
app.use(express.json({ limit: "256kb" }));
app.use(express.static(__dirname));

function getApiKey() {
  return process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY;
}

app.get("/api/config", (req, res) => {
  res.json({
    modelId: MODEL_ID,
    defaultVoiceId: DEFAULT_VOICE_ID,
    maxTextLength: MAX_TEXT_LENGTH,
    hasApiKey: Boolean(getApiKey()),
  });
});

app.get("/api/voices", async (req, res) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    return res.status(500).json({ error: "ELEVENLABS_API_KEY is not set on the server" });
  }

  try {
    const elevenRes = await fetch(`${ELEVENLABS_BASE}/v1/voices`, {
      headers: { "xi-api-key": apiKey },
    });

    if (!elevenRes.ok) {
      const detail = await elevenRes.text().catch(() => "");
      console.error("[/api/voices] ElevenLabs error:", elevenRes.status, detail);
      return res.status(502).json({ error: "Could not load voices", detail });
    }

    const data = await elevenRes.json();
    res.json({
      voices: (data.voices || []).map((v) => ({
        voiceId: v.voice_id,
        name: v.name,
        category: v.category,
      })),
    });
  } catch (err) {
    console.error("[/api/voices] Fetch failed:", err.message);
    res.status(502).json({ error: "Failed to reach ElevenLabs" });
  }
});

/**
 * Streams MP3 straight through from ElevenLabs.
 *
 * Answers both GET (text/voiceId in the query string) and POST (JSON body).
 * The GET form is what makes instant playback easy: the browser can point an
 * <audio> element at this URL and its own media stack plays the MP3
 * progressively as bytes land, with no MediaSource juggling on our side.
 */
async function handleTts(req, res) {
  const apiKey = getApiKey();

  if (!apiKey) {
    console.error("[/api/tts] ELEVENLABS_API_KEY is not set");
    return res.status(500).json({ error: "ELEVENLABS_API_KEY is not set on the server" });
  }

  const source = req.method === "GET" ? req.query : req.body || {};
  const text = typeof source.text === "string" ? source.text.trim() : "";
  const resolvedVoiceId = source.voiceId || DEFAULT_VOICE_ID;

  if (!text) {
    return res.status(400).json({ error: "`text` is required" });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(413).json({ error: `\`text\` must be ${MAX_TEXT_LENGTH} characters or fewer` });
  }
  if (!/^[A-Za-z0-9]{16,40}$/.test(resolvedVoiceId)) {
    return res.status(400).json({ error: "`voiceId` is not a valid ElevenLabs voice id" });
  }

  // Hang up on ElevenLabs if the browser walks away mid-sentence (new request,
  // tab closed) so an abandoned stream stops burning credits.
  const upstream = new AbortController();
  let clientGone = false;
  res.on("close", () => {
    if (!res.writableEnded) {
      clientGone = true;
      upstream.abort();
    }
  });

  // Bail if ElevenLabs hasn't even sent headers in time. Cleared as soon as
  // they land, so a long sentence is free to keep streaming after that.
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
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.8,
            use_speaker_boost: true,
          },
        }),
      }
    );
  } catch (fetchErr) {
    clearTimeout(connectTimeout);
    if (clientGone) return;
    if (fetchErr.name === "AbortError") {
      console.error("[/api/tts] ElevenLabs did not respond within", CONNECT_TIMEOUT_MS, "ms");
      return res.status(504).json({ error: "ElevenLabs timed out" });
    }
    console.error("[/api/tts] Fetch failed:", fetchErr.message);
    return res.status(500).json({ error: "Failed to reach ElevenLabs" });
  }

  clearTimeout(connectTimeout);

  // Check status before touching body
  if (!elevenRes.ok) {
    try {
      const errText = await elevenRes.text();
      console.error("[/api/tts] ElevenLabs error:", elevenRes.status, errText);
      return res.status(502).json({ error: "TTS request failed", detail: errText });
    } catch (readErr) {
      console.error("[/api/tts] Could not read error body:", readErr.message);
      return res.status(502).json({ error: "TTS request failed" });
    }
  }

  // Success path - stream the audio
  try {
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Accel-Buffering", "no"); // don't let a proxy sit on the chunks
    res.flushHeaders();

    const reader = elevenRes.body.getReader();

    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            res.end();
            return;
          }
          if (!res.write(Buffer.from(value))) {
            await new Promise((resolve) => res.once("drain", resolve));
          }
        }
      } catch (streamErr) {
        if (streamErr.name === "AbortError") return;
        console.error("[/api/tts] Stream pump error:", streamErr);
        if (!res.headersSent) {
          res.status(500).end();
        } else {
          res.end();
        }
      }
    };

    await pump();
  } catch (err) {
    console.error("[/api/tts] Stream setup error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "Stream failed" });
    }
  }
}

app.get("/api/tts", handleTts);
app.post("/api/tts", handleTts);

// Kept so the older client path keeps working.
app.post("/api/stream", handleTts);

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Streaming audio/mpeg via ${MODEL_ID}`);
  if (!getApiKey()) {
    console.warn("WARNING: ELEVENLABS_API_KEY is not set — /api/tts will fail");
  }
});
