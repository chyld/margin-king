// The login page (README §3.18): on success, reload the same address so links land (§3.17).

const form = document.querySelector<HTMLFormElement>(".login-form")!;
const error = document.querySelector<HTMLElement>(".login-error")!;
const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  error.hidden = true;
  button.disabled = true;
  const data = new FormData(form);
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Margin": "1" },
      body: JSON.stringify({ username: String(data.get("username") ?? "").trim(), password: String(data.get("password") ?? "") }),
      credentials: "same-origin",
    });
    if (res.ok) {
      location.reload();
      return;
    }
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    error.textContent = body?.error ?? "Couldn't log in";
  } catch {
    error.textContent = "Couldn't reach Margin. Check your connection.";
  }
  error.hidden = false;
  button.disabled = false;
});
