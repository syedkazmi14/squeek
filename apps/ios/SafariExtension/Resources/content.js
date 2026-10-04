// Clickey in Safari: checks the page you're on, marks risky links, and asks before you open one.
// All UI lives in a shadow root so page styles can't change it; page text is only ever set as text.

(() => {
  if (window.top !== window) return; // top frame only
  const flagged = new Map(); // href -> { verdict, reasons }
  const allowed = new Set(); // hrefs the person chose to open anyway
  let host = null;

  const send = (message) => browser.runtime.sendMessage(message).catch(() => ({ error: "unavailable" }));

  // ---------------------------------------------------------------------------
  // Overlay UI
  // ---------------------------------------------------------------------------

  const STYLE = `
    :host { all: initial; }
    .backdrop { position: fixed; inset: 0; z-index: 2147483647; background: rgba(20, 20, 18, 0.55);
      display: flex; align-items: flex-end; justify-content: center; font: 18px/1.4 -apple-system, system-ui, sans-serif; }
    .panel { background: #FAF6EE; color: #1C1B19; width: 100%; max-width: 560px; box-sizing: border-box;
      border-radius: 16px 16px 0 0; padding: 24px 20px calc(24px + env(safe-area-inset-bottom)); }
    .rule { width: 48px; height: 3px; background: #9A6A1E; margin-bottom: 14px; }
    .danger .rule { background: #9B2C2C; }
    .brand { font: 600 15px -apple-system, system-ui; color: #1F4D3A; margin-bottom: 8px; }
    h1 { font-size: 27px; font-weight: 500; margin: 0 0 10px; line-height: 1.25; }
    p { margin: 0 0 12px; }
    ul { margin: 0 0 18px; padding-left: 22px; }
    li { margin-bottom: 6px; }
    .domain { font-weight: 600; word-break: break-all; }
    button { display: block; width: 100%; min-height: 56px; border-radius: 12px; font: 600 19px -apple-system, system-ui;
      margin-top: 10px; cursor: pointer; }
    .primary { background: #1F4D3A; color: #fff; border: none; }
    .secondary { background: #fff; color: #1C1B19; border: 1.5px solid #DCD5C8; font-weight: 400; }
    .banner { position: fixed; left: 8px; right: 8px; top: 8px; z-index: 2147483647; background: #FAF6EE; color: #1C1B19;
      border: 1.5px solid #9A6A1E; border-radius: 12px; padding: 12px 14px; font: 17px/1.35 -apple-system, system-ui;
      display: flex; gap: 12px; align-items: center; box-shadow: 0 4px 16px rgba(0,0,0,.18); }
    .banner button { width: auto; min-height: 44px; margin: 0; padding: 0 16px; font-size: 17px; }
    @media (prefers-color-scheme: dark) {
      .panel, .banner { background: #1B1C1A; color: #F2EEE6; }
      .secondary { background: #262724; color: #F2EEE6; border-color: #3C3D39; }
      .primary { background: #7BC09F; color: #0E1F17; }
      .brand { color: #7BC09F; }
    }
  `;

  function root() {
    if (host) return host.shadowRoot;
    host = document.createElement("clickey-warning");
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    shadow.appendChild(style);
    document.documentElement.appendChild(host);
    return shadow;
  }

  function clearUI() {
    const shadow = host?.shadowRoot;
    if (!shadow) return;
    [...shadow.children].forEach((el) => { if (el.tagName !== "STYLE") el.remove(); });
  }

  function el(tag, attrs = {}, text) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = text; // never innerHTML: page data stays text
    return node;
  }

  /** Full warning sheet. Resolves true if the person chooses to continue. */
  function showWarning({ headline, body, reasons, domain, level, continueLabel, stayLabel }) {
    return new Promise((resolve) => {
      clearUI();
      const backdrop = el("div", { class: `backdrop ${level}`, role: "alertdialog", "aria-modal": "true", "aria-label": headline });
      const panel = el("div", { class: "panel" });
      panel.append(el("div", { class: "rule" }), el("div", { class: "brand" }, "Clickey"), el("h1", {}, headline));
      if (domain) {
        const p = el("p", {}, "Website: ");
        p.append(el("span", { class: "domain" }, domain));
        panel.append(p);
      }
      if (body) panel.append(el("p", {}, body));
      if (reasons?.length) {
        const list = el("ul");
        reasons.slice(0, 4).forEach((r) => list.append(el("li", {}, r)));
        panel.append(list);
      }
      const stay = el("button", { class: "primary" }, stayLabel);
      const go = el("button", { class: "secondary" }, continueLabel);
      stay.onclick = () => { clearUI(); resolve(false); };
      go.onclick = () => { clearUI(); resolve(true); };
      panel.append(stay, go);
      backdrop.append(panel);
      root().append(backdrop);
      stay.focus();
    });
  }

  function showBanner(text) {
    clearUI();
    const banner = el("div", { class: "banner", role: "status" });
    banner.append(el("div", {}, text));
    const close = el("button", { class: "secondary" }, "OK");
    close.onclick = clearUI;
    banner.append(close);
    root().append(banner);
  }

  // ---------------------------------------------------------------------------
  // The page itself
  // ---------------------------------------------------------------------------

  async function checkCurrentPage() {
    const result = await send({ type: "checkPage", url: location.href });
    if (!result || result.error) return;
    if (result.level === "danger") {
      const proceed = await showWarning({
        level: "danger",
        headline: result.headline,
        body: result.speech,
        reasons: result.reasons,
        domain: result.domain,
        stayLabel: "Leave this website",
        continueLabel: "Stay anyway",
      });
      if (!proceed) {
        if (history.length > 1) history.back();
        else location.replace("about:blank");
      }
    } else if (result.level === "caution") {
      showBanner(`Clickey: ${result.headline}. ${result.reasons?.[0] ?? ""}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Links on the page
  // ---------------------------------------------------------------------------

  const seen = new Set();

  async function scanLinks() {
    const fresh = [];
    for (const a of document.querySelectorAll("a[href]")) {
      const href = a.href;
      if (!/^https?:/i.test(href) || seen.has(href)) continue;
      try {
        if (new URL(href).hostname === location.hostname) continue; // same-site links aren't checked
      } catch { continue; }
      seen.add(href);
      fresh.push(href);
      if (fresh.length >= 300) break;
    }
    if (fresh.length === 0) return;
    const reply = await send({ type: "checkLinks", urls: fresh });
    for (const [href, info] of Object.entries(reply?.results ?? {})) {
      flagged.set(href, info);
      document.querySelectorAll(`a[href="${CSS.escape(href)}"]`).forEach((a) => {
        a.style.outline = info.verdict === "malicious" ? "2px solid #9B2C2C" : "2px solid #9A6A1E";
        a.style.outlineOffset = "2px";
        a.title = "Clickey: this link has warning signs";
      });
    }
  }

  document.addEventListener(
    "click",
    async (event) => {
      const a = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!a || allowed.has(a.href)) return;
      const info = flagged.get(a.href);
      if (!info) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const malicious = info.verdict === "malicious";
      const proceed = await showWarning({
        level: malicious ? "danger" : "caution",
        headline: malicious ? "Don't open this link" : "This link looks suspicious",
        reasons: info.reasons,
        domain: info.domain,
        stayLabel: "Don't open it",
        continueLabel: "Open anyway",
      });
      if (proceed) {
        allowed.add(a.href);
        if (a.target === "_blank") window.open(a.href, "_blank", "noopener");
        else location.href = a.href;
      }
    },
    true,
  );

  let pending = null;
  new MutationObserver(() => {
    clearTimeout(pending);
    pending = setTimeout(scanLinks, 800);
  }).observe(document.documentElement, { childList: true, subtree: true });

  checkCurrentPage();
  scanLinks();
})();
