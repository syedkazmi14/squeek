import { createOpenAI } from "@ai-sdk/openai";
import {
  experimental_transcribe as transcribe,
  generateText,
  type ModelMessage,
} from "ai";

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-5.4-mini";
const TRANSCRIBE_MODEL =
  process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
// A conversation that has gone quiet this long starts fresh.
const FORGET_AFTER_MS = 5 * 60 * 1000;
// Older turns are dropped so each request stays small and fast.
const MAX_TURNS = 8;
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

const SYSTEM = `You are Squeek, a small friendly ghost who floats next to the user's mouse cursor on their computer and helps them stay safe from online scams. Many users are older and not technical.

You are speaking out loud, so:
- Answer in one to three short, plain sentences, under 40 words in all. No lists, markdown, emoji, or web addresses spelled out character by character.
- Be warm and calm, never alarming for no reason, but be clear and direct when something looks like a scam.

What you know and do:
- You watch the page the user is looking at for scam warning signs, and you check links when they hover over them. A summary of what you currently see is given to you below; use it when they ask about "this", "this page" or "this link". If it doesn't cover what they ask, say you can't see that.
- Never ask for or repeat passwords, codes, bank or card numbers. If they start to share one, tell them to stop.
- If someone is pressuring them to pay with gift cards, crypto or wire transfers, to install remote-access software, or to keep it secret, tell them it is a scam and to stop and talk to someone they trust.
- If you are not sure, say so and suggest checking with the company directly using a phone number or website they already know, not one from the message.`;

export interface Turn {
  heard: string;
  reply: string;
}

/**
 * Voice conversation with the ghost: speech in, text reply out (the panel speaks it).
 * `fetchImpl` should be Electron's `net.fetch` so the OpenAI connection stays open
 * between turns.
 */
export function createConversation(
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
) {
  const openai = apiKey ? createOpenAI({ apiKey, fetch: fetchImpl }) : undefined;
  let history: ModelMessage[] = [];
  let lastAt = 0;

  async function respond(
    audio: Uint8Array,
    context: string,
    signal: AbortSignal,
  ): Promise<Turn> {
    if (!openai) throw new Error("Conversation is not configured");
    const { text } = await transcribe({
      model: openai.transcription(TRANSCRIBE_MODEL),
      audio,
      abortSignal: signal,
    });
    const heard = text.trim();
    if (!heard) return { heard: "", reply: "" };
    if (now() - lastAt > FORGET_AFTER_MS) history = [];
    const question: ModelMessage = { role: "user", content: heard };
    const result = await generateText({
      model: openai(CHAT_MODEL),
      system: `${SYSTEM}\n\nWhat you can see right now:\n${context}`,
      messages: [...history, question],
      maxOutputTokens: 300,
      abortSignal: signal,
    });
    const reply = result.text.trim();
    history = [
      ...history,
      question,
      { role: "assistant", content: reply } satisfies ModelMessage,
    ].slice(-MAX_TURNS * 2);
    lastAt = now();
    return { heard, reply };
  }

  /** Opens the connection ahead of the first question; spends nothing. */
  function warm(): void {
    if (!apiKey) return;
    void fetchImpl("https://api.openai.com/v1/models/" + CHAT_MODEL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
      .then((response) => response.arrayBuffer())
      .catch(() => {});
  }

  function forget(): void {
    history = [];
  }

  return { configured: Boolean(openai), respond, warm, forget };
}
