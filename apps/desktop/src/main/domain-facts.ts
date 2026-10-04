import { resolveMx } from "node:dns/promises";
import { FREE_MAIL, type SenderCheck } from "../../../../packages/detection/src/sender.ts";

const TIMEOUT_MS = 4000;
const DAY = 24 * 60 * 60 * 1000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(Error("timeout")), ms)),
  ]);
}

/**
 * Public facts about a sender's domain: when it was registered (RDAP, the
 * registries' public record) and whether it receives email. Only the domain
 * name is sent, never the address or the email. Personal mail services are
 * skipped; their age says nothing about the sender.
 */
export function createDomainFacts(fetchImpl: typeof fetch = fetch, now: () => number = Date.now) {
  const cache = new Map<string, Promise<SenderCheck[]>>();
  let servers: Promise<Map<string, string>> | undefined;

  /** IANA's list of each top-level domain's registry server. */
  function registries(): Promise<Map<string, string>> {
    servers ??= fetchImpl("https://data.iana.org/rdap/dns.json", { signal: AbortSignal.timeout(TIMEOUT_MS) })
      .then((response) => response.json() as Promise<{ services: [string[], string[]][] }>)
      .then((data) => {
        const map = new Map<string, string>();
        for (const [tlds, urls] of data.services)
          for (const tld of tlds) if (urls[0]) map.set(tld, urls[0].replace(/\/?$/, "/"));
        return map;
      })
      .catch((error) => {
        servers = undefined;
        throw error;
      });
    return servers;
  }

  async function age(domain: string): Promise<SenderCheck | undefined> {
    const server = (await registries()).get(domain.split(".").at(-1)!);
    if (!server) return undefined;
    const response = await fetchImpl(`${server}domain/${encodeURIComponent(domain)}`, {
      headers: { Accept: "application/rdap+json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    const data = (await response.json()) as { events?: { eventAction?: string; eventDate?: string }[] };
    const registered = Date.parse(
      data.events?.find((e) => e.eventAction === "registration")?.eventDate ?? "",
    );
    if (!Number.isFinite(registered)) return undefined;
    const days = Math.floor((now() - registered) / DAY);
    if (days < 30)
      return { id: "new_domain", tone: "warn", text: `The address's website (${domain}) was set up only ${days === 1 ? "1 day" : `${days} days`} ago. Scammers often use brand-new addresses.` };
    if (days < 365)
      return { id: "young_domain", tone: "info", text: `The address's website (${domain}) is less than a year old.` };
    return { id: "established_domain", tone: "ok", text: `The address's website (${domain}) has existed since ${new Date(registered).getFullYear()}.` };
  }

  async function mail(domain: string): Promise<SenderCheck | undefined> {
    try {
      const records = await withTimeout(resolveMx(domain), TIMEOUT_MS);
      if (records.length) return undefined;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "ENODATA" && code !== "ENOTFOUND") return undefined;
    }
    return { id: "no_mail", tone: "warn", text: `${domain} isn't set up to receive email, so replies may go nowhere.` };
  }

  function lookup(domain: string): Promise<SenderCheck[]> {
    if (FREE_MAIL.has(domain)) return Promise.resolve([]);
    let facts = cache.get(domain);
    if (!facts) {
      facts = Promise.all([age(domain).catch(() => undefined), mail(domain)]).then(
        (found) => found.filter((f): f is SenderCheck => !!f),
      );
      cache.set(domain, facts);
      if (cache.size > 200) cache.delete(cache.keys().next().value!);
    }
    return facts;
  }

  return { lookup };
}
