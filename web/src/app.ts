// The page's script. The server renders every page from swamp data; this
// only opens and closes "Show all", and reads the page's HTML again when the
// event stream says the data changed, keeping what was open.

function toggle(button: HTMLButtonElement) {
  const rest = document.getElementById(
    button.getAttribute("aria-controls") ?? "",
  );
  if (!rest) return;
  const open = button.getAttribute("aria-expanded") !== "true";
  button.setAttribute("aria-expanded", String(open));
  rest.classList.toggle("open", open);
  rest.querySelector(".concertina-inner")?.toggleAttribute("inert", !open);
  const other = button.dataset.otherLabel ?? button.dataset.openLabel ?? "";
  button.dataset.otherLabel = button.textContent ?? "";
  button.textContent = other;
}

addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>(
    "button.show-all",
  );
  if (button) toggle(button);
});

/** Swaps in the page as the server renders it now, opening what was open. */
async function reread() {
  const res = await fetch(location.pathname, {
    headers: { accept: "text/html" },
  });
  const next = new DOMParser().parseFromString(await res.text(), "text/html");
  const main = next.querySelector("main");
  if (!main) return;
  const wasOpen = [...document.querySelectorAll<HTMLButtonElement>(
    'button.show-all[aria-expanded="true"]',
  )].map((b) => b.getAttribute("aria-controls"));
  const openDetails = [...document.querySelectorAll("main details")].map(
    (d) => (d as HTMLDetailsElement).open,
  );
  document.querySelector("main")?.replaceWith(main);
  document.title = next.title;
  for (const id of wasOpen) {
    const button = document.querySelector<HTMLButtonElement>(
      `button.show-all[aria-controls="${id}"]`,
    );
    if (button) toggle(button);
  }
  document.querySelectorAll("main details").forEach((d, n) => {
    if (openDetails[n]) (d as HTMLDetailsElement).open = true;
  });
}

// One read at a time; a change during a read reads again after it.
let reading: Promise<void> | null = null;
let again = false;
function changed() {
  if (reading) {
    again = true;
    return;
  }
  reading = reread().catch(() => {}).finally(() => {
    reading = null;
    if (again) {
      again = false;
      changed();
    }
  });
}

new EventSource("/events").addEventListener("message", changed);
