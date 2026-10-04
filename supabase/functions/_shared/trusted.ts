// What Squeek says to a trusted person (helper) and to the person they look out for.
// Plain, short and calm: these are spoken on a phone call.

/** When someone goes ahead and pays after a likely scam, their helpers hear about it. */
export function escalationText(personName: string | null, surface: string): string {
  const who = personName ?? "Someone you look out for";
  const after = surface === "call" ? "a call that looked like a scam" : "something that looked like a scam";
  return `Squeek here. ${who} is about to pay someone after ${after}. You might want to call them now.`;
}

/** A helper asked the person if they're OK. */
export function checkInText(helperName: string | null): string {
  const who = helperName ?? "Someone who looks out for you";
  const call = helperName ?? "them";
  return `Squeek here. ${who} is checking in on you. If you're OK, open Squeek and tap I'm OK. Or you could call ${call}.`;
}
