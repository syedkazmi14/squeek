import type { Observation } from "../../contracts/src/observation.ts";
import { BRANDS, RISKY_ENDINGS, belongsTo, registrableDomain } from "./link.ts";

/**
 * Who an opened email claims to be from, and local checks on that claim.
 * Nothing here touches the network; domain age and mail records are looked
 * up by the caller.
 */
export interface Sender {
  name: string;
  /** Empty when the page shows only a name (Gmail hides known senders' addresses). */
  address: string;
  /** The registered domain of the address ("mail.paypal.com" -> "paypal.com"). */
  domain: string;
}
export interface SenderCheck {
  id: string;
  tone: "ok" | "warn" | "info";
  text: string;
}
/** Display names Squeek has seen, each with the addresses it wrote from. */
export type KnownSenders = Record<string, string[]>;

export const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com", "hotmail.com", "live.com",
  "msn.com", "aol.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "gmx.com", "gmx.net",
  "mail.com", "yandex.com", "zoho.com", "comcast.net", "att.net", "verizon.net",
]);
// Words that make a display name an organisation rather than a person.
const ORG_WORDS = /\b(support|team|department|dept|bank|security|service|services|billing|account|accounts|verification|government|police|official|customer|help|helpdesk|admin|notification|alert|alerts|refund|claims|office|agency|inc|llc|ltd|corp)\b/i;

const ADDRESS = /[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)+[a-z]{2,}/i;
// "Name <a@b.com>", "<a@b.com>" or a bare "a@b.com": an address that is the whole label,
// not one mentioned inside a sentence.
const LABEL = new RegExp(`^\\s*(?:(.{0,80}?)\\s*)?<(${ADDRESS.source})>\\s*$|^\\s*(${ADDRESS.source})\\s*$`, "i");

function sameLine(a: Observation["spans"][number], b: Observation["spans"][number]): boolean {
  const overlap = Math.min(a.rect.y + a.rect.height, b.rect.y + b.rect.height) - Math.max(a.rect.y, b.rect.y);
  return overlap >= Math.min(a.rect.height, b.rect.height) / 2;
}

// The recipient line under the sender's name in an opened email ("to me", "to Ryan, Ann").
const RECIPIENTS = /^to\s+(?:me|you|[\w .,'-]{1,80})$/i;

/**
 * The sender of the opened email: an address label if the page shows one
 * (an email header or a contact card), otherwise the name above "to me".
 */
export function extractSender(observation: Observation): Sender | undefined {
  const spans = observation.spans;
  const labelled = labelledSender(spans);
  if (labelled) return labelled;
  for (let i = 1; i < spans.length; i++) {
    const name = spans[i - 1]!;
    if (!RECIPIENTS.test(spans[i]!.text.trim()) || name.text.includes("@") || name.text.length > 80) continue;
    const below = spans[i]!.rect.y >= name.rect.y + name.rect.height / 2;
    if (below && Math.abs(name.rect.x - spans[i]!.rect.x) < 40)
      return { name: name.text.trim(), address: "", domain: "" };
  }
  return undefined;
}

function labelledSender(spans: Observation["spans"]): Sender | undefined {
  for (let i = 0; i < spans.length; i++) {
    const match = LABEL.exec(spans[i]!.text);
    if (!match) continue;
    const address = (match[2] ?? match[3])!.toLowerCase();
    let name = match[1]?.replace(/["']/g, "").trim() ?? "";
    const before = spans[i - 1];
    if (!name && before && sameLine(before, spans[i]!) && !before.text.includes("@") && before.text.length <= 80)
      name = before.text.trim();
    // A card may show the name on the line above the address.
    if (!name && before && !before.text.includes("@") && before.text.length <= 80 &&
        Math.abs(before.rect.x - spans[i]!.rect.x) < 20 && spans[i]!.rect.y - (before.rect.y + before.rect.height) < 16)
      name = before.text.trim();
    return { name, address, domain: registrableDomain(address.split("@")[1]!) };
  }
  return undefined;
}

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** A display name that reads as a person ("Rishi Golla"), not a company or a team. */
export function looksLikePerson(name: string): boolean {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2 && parts.length <= 4 && parts.every(p => /^[\p{L}][\p{L}'.-]*$/u.test(p)) &&
    !ORG_WORDS.test(name) && !claimedBrand(name);
}

/** Which brand a display name claims to be, if any. */
function claimedBrand(name: string) {
  const compact = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const tokens = words(name);
  return Object.entries(BRANDS).find(([token, brand]) =>
    tokens.includes(token) || (brand.name.includes(" ") && compact.includes(brand.name.toLowerCase().replace(/[^a-z0-9]/g, ""))))?.[1];
}

export function senderChecks(sender: Sender, known: KnownSenders = {}): SenderCheck[] {
  const checks: SenderCheck[] = [];
  const add = (id: string, tone: SenderCheck["tone"], text: string) => checks.push({ id, tone, text });
  if (!sender.address) {
    const seen = known[sender.name.trim().toLowerCase()] ?? [];
    add("address_hidden", "info", seen.length
      ? `Squeek has seen ${sender.name} write from ${seen[0]} before. Point at their name to show this email's address and compare.`
      : "The email address is hidden. Point at the sender's name to show it, and Squeek will check it.");
    return checks;
  }
  const host = sender.address.split("@")[1]!;
  const free = FREE_MAIL.has(sender.domain);
  const brand = claimedBrand(sender.name);

  if (brand && !belongsTo(host, brand.domains))
    add("brand_mismatch", "warn", `It says it's from ${brand.name}, but the address ends in @${host}, not ${brand.domains[0]}.`);
  else if (brand)
    add("brand_match", "ok", `The address really is ${brand.name}'s (${sender.domain}).`);

  // An address that borrows a brand name without belonging to it ("paypal-help.com").
  const lookalike = Object.entries(BRANDS).find(([token, b]) => host.split(/[.-]/).includes(token) && !belongsTo(host, b.domains));
  if (lookalike && !checks.some(c => c.id === "brand_mismatch"))
    add("lookalike_domain", "warn", `The address uses the name ${lookalike[1].name}, but ${sender.domain} isn't ${lookalike[1].name}'s.`);
  if (host.split(".").some(label => label.startsWith("xn--")))
    add("lookalike_letters", "warn", "The address uses lookalike letters to copy a real name.");
  if (RISKY_ENDINGS.has(host.split(".").at(-1) ?? ""))
    add("risky_ending", "warn", `The address ends in .${host.split(".").at(-1)}, which scammers often use.`);

  if (free && (brand || ORG_WORDS.test(sender.name)))
    add("org_on_free_mail", "warn", `It uses a company-style name but comes from a personal ${sender.domain} address. Real companies use their own address.`);
  else if (free)
    add("free_mail", "info", `Sent from a personal ${sender.domain} account.`);

  // A person's name that appears nowhere in their address.
  const nameWords = words(sender.name).filter(w => w.length >= 3);
  if (free && !brand && !ORG_WORDS.test(sender.name) && nameWords.length >= 2 &&
      !nameWords.some(w => sender.address.includes(w)))
    add("name_not_in_address", "info", `The name "${sender.name}" doesn't appear in the address.`);

  const key = sender.name.trim().toLowerCase();
  const seen = key ? known[key] ?? [] : [];
  const everSeen = Object.values(known).some(list => list.includes(sender.address));
  if (seen.length && !seen.includes(sender.address))
    add("new_address_for_name", "warn", `${sender.name} has written to you before from ${seen[0]}. This is a different address, so check with them another way before replying.`);
  else if (everSeen)
    add("known_sender", "ok", "You've had email from this address before.");
  else if (Object.keys(known).length >= 10)
    add("first_contact", "info", "This is the first email Squeek has seen from this address.");
  return checks;
}

/** Remembers a sender, bounded so the file stays small. */
export function rememberSender(known: KnownSenders, sender: Sender, limit = 2000): KnownSenders {
  const key = sender.name.trim().toLowerCase() || sender.address;
  const list = known[key] ?? [];
  const next = { ...known, [key]: list.includes(sender.address) ? list : [...list, sender.address].slice(-5) };
  const keys = Object.keys(next);
  for (const old of keys.slice(0, Math.max(0, keys.length - limit))) delete next[old];
  return next;
}
