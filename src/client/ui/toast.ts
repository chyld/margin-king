// Toasts (README §3.21): bottom center, 2.5 s (errors 5 s, in red).

let host: HTMLElement | null = null;

export function toast(message: string, error = false, ms = error ? 5000 : 2500): void {
  host ??= document.querySelector<HTMLElement>(".toasts");
  if (!host) return;
  const t = document.createElement("div");
  t.className = `toast${error ? " is-error" : ""}`;
  t.setAttribute("role", error ? "alert" : "status");
  t.textContent = message;
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add("is-in"));
  if (ms > 0) {
    setTimeout(() => {
      t.classList.remove("is-in");
      setTimeout(() => t.remove(), 300);
    }, ms);
  }
}
