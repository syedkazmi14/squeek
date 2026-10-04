// Relays messages from the content script and popup to the native handler
// (SafariWebExtensionHandler.swift), with a short cache so a page isn't checked twice.

const PAGE_CACHE_MS = 10 * 60 * 1000;
const pageCache = new Map();

async function native(message) {
  // On iOS the application id argument is ignored; the containing app answers.
  return browser.runtime.sendNativeMessage("application.id", message);
}

async function checkPage(url) {
  const key = new URL(url).origin + new URL(url).pathname;
  const hit = pageCache.get(key);
  if (hit && Date.now() - hit.at < PAGE_CACHE_MS) return hit.result;
  const result = await native({ type: "checkPage", url });
  if (!result.error) pageCache.set(key, { at: Date.now(), result });
  return result;
}

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const work =
    message.type === "checkPage" ? checkPage(message.url) : native(message);
  work.then(sendResponse).catch((error) => sendResponse({ error: String(error) }));
  return true; // keeps the channel open for the async reply
});
