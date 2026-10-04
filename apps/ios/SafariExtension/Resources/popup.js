const headline = document.getElementById("headline");
const detail = document.getElementById("detail");
const reasons = document.getElementById("reasons");
const button = document.getElementById("check");

async function showStatus() {
  const status = await browser.runtime.sendMessage({ type: "status" }).catch(() => null);
  if (status && !status.error && !status.signedIn) {
    detail.textContent = "Open the Clickey app and sign in for the full check, including Google Safe Browsing.";
  }
}

button.addEventListener("click", async () => {
  button.disabled = true;
  button.textContent = "Checking…";
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:/.test(tab.url)) {
    headline.textContent = "Nothing to check here";
    detail.textContent = "Open a website first.";
  } else {
    const result = await browser.runtime.sendMessage({ type: "checkPage", url: tab.url });
    if (result?.error) {
      headline.textContent = "Couldn't check this page";
      detail.textContent = "Please treat it carefully.";
    } else {
      headline.textContent = result.headline;
      detail.textContent = result.speech;
      reasons.replaceChildren(...(result.reasons ?? []).slice(0, 4).map((r) => {
        const li = document.createElement("li");
        li.textContent = r;
        return li;
      }));
    }
  }
  button.disabled = false;
  button.textContent = "Check again";
});

showStatus();
