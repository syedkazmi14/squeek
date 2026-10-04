// Sends Squeek's alerts by phone. The iPhone app can't get push notifications on a free developer
// account, so a verdict reaches a locked phone as a short call that speaks it, or as a text once
// the Twilio number is registered for US texting (A2P 10DLC). SQUEEK_ALERT_CHANNEL picks: "call"
// (default) or "sms".

export type AlertResult = "sent" | "failed" | "disabled";

function escapeXml(text: string): string {
  return text.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));
}

/** Spoken twice, slowly, so it's easy to catch on a phone. */
export function alertTwiml(text: string): string {
  const say = `<Say voice="Polly.Joanna-Neural">${escapeXml(text)}</Say>`;
  return `<Response><Pause length="1"/>${say}<Pause length="1"/><Say voice="Polly.Joanna-Neural">Again.</Say>${say}</Response>`;
}

export async function sendAlert(to: string, from: string, text: string): Promise<AlertResult> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!sid || !token) return "disabled";
  const sms = Deno.env.get("SQUEEK_ALERT_CHANNEL") === "sms";
  const params = new URLSearchParams({ To: to, From: from });
  if (sms) {
    params.set("Body", text);
  } else {
    params.set("Twiml", alertTwiml(text));
    // Hang up before most carriers forward an unanswered call, so the alert isn't sent to voicemail
    // or back to Squeek's own line. call-webhook also ignores calls from Squeek's lines.
    params.set("Timeout", "20");
  }
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/${sms ? "Messages" : "Calls"}.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error(JSON.stringify({ twilio_status: res.status, twilio_code: body.code ?? null }));
      return "failed";
    }
    return "sent";
  } catch (err) {
    console.error(JSON.stringify({ twilio_error: String(err).slice(0, 200) }));
    return "failed";
  }
}
