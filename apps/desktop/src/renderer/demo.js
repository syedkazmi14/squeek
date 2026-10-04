const api = window.squeek;
const form = document.getElementById("payment");
const result = document.getElementById("result");
const review = document.getElementById("review");
let id;
let version = 0;
const fields = () =>
  Object.fromEntries(
    ["message", "recipient", "amount", "destination"].map((key) => [
      key,
      document.getElementById(key).value,
    ]),
  );
form.addEventListener("input", () => {
  version++;
  id = undefined;
  review.hidden = true;
  result.textContent = "Review required";
  void api.invoke("demo-invalidate").catch(() => {});
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const current = version;
  const input = fields();
  try {
    const assessment = await api.invoke("demo-check", input);
    if (current !== version) return;
    result.textContent =
      assessment.state === "high_risk"
        ? "Hey, this is a scam, don't click on it"
        : assessment.state.replaceAll("_", " ");
    id = await api.invoke("demo-review", input);
    if (current !== version) return;
    document.getElementById("details").textContent = Object.entries(input)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    review.hidden = false;
  } catch {
    result.textContent = "Unavailable";
  }
});
document.getElementById("cancel").addEventListener("click", () => {
  version++;
  id = undefined;
  review.hidden = true;
  void api.invoke("demo-invalidate");
  result.textContent = "Cancelled";
});
document.getElementById("continue").addEventListener("click", async () => {
  const current = version;
  try {
    const approved = await api.invoke("demo-approve", { id, fields: fields() });
    if (current !== version) return;
    result.textContent = approved ? "Simulation complete" : "Review required";
  } catch {
    result.textContent = "Review required";
  }
  id = undefined;
  review.hidden = true;
});

api.onState(() => {
  version++;
  id = undefined;
  review.hidden = true;
  document.getElementById("details").textContent = "";
  result.textContent = "Review required";
});
