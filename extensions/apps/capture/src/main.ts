// The Capture app: the web behavior's read-only page, in the swamp dashboard.
// It reads Capture's data through the dashboard (data:read), shows the list
// at / and one request at /requests/<id>, and reads again as the data
// changes. It changes nothing and calls no site: every change goes through
// the requests behavior's methods.
import { connectApp, followDataChanges } from "@swamp-club/app-sdk";
import { h, render } from "preact";
import type { PageData } from "../../../models/_lib/web/page/view.ts";
import { pageView } from "../../../models/_lib/web/page/view.ts";
import "../../../../web/src/web.css";
import "./app.css";
import { openCapture, REQUESTS_TYPE } from "./capture_data.ts";
import { StepsPanel } from "./steps.ts";

const root = document.getElementById("root")!;

function fail(message: string) {
  root.replaceChildren();
  const p = document.createElement("p");
  p.setAttribute("role", "alert");
  p.className = "flash-alert";
  p.textContent = message;
  root.append(p);
}

/** The page path's parts, or null for one that doesn't decode. */
function segments(path: string): string[] | null {
  try {
    return path.split("/").filter((p) => p !== "").map(decodeURIComponent);
  } catch {
    return null;
  }
}

/** Opens or closes a "Show all", as the served page's script does. */
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

async function main() {
  let path = "/";
  let shown: string | null = null;
  let show = () => {};
  // Who the person viewing says they are: for their steps only. The sandbox
  // keeps no storage, so it lasts until the app reloads.
  let viewerEmail = "";
  let changed = () => {};
  // Under swamp serve the dashboard connects to serve after the app opens,
  // and refuses a request sent while it isn't connected, so reads wait.
  let up = false;
  let waiting: (() => void)[] = [];
  const whenConnected = () =>
    up ? Promise.resolve() : new Promise<void>((r) => waiting.push(r));
  const { client, session, transport } = await connectApp({
    onPath: (next) => {
      path = next;
      show();
    },
    onConnection: (next) => {
      up = next;
      if (!up) return;
      const resolve = waiting;
      waiting = [];
      resolve.forEach((r) => r());
      // Back after a drop: what changed meanwhile is unknown.
      changed();
    },
  });
  path = session.path;
  up = session.connected;
  // The first read fails if serve drops mid-read or the data is mid-write;
  // it tries again rather than leaving the page on the error.
  let opened: Awaited<ReturnType<typeof openCapture>> | null = null;
  while (opened === null) {
    await whenConnected();
    try {
      opened = await openCapture(client);
    } catch (reason) {
      fail(
        `${
          reason instanceof Error ? reason.message : String(reason)
        } Trying again…`,
      );
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
  const { behavior, source } = opened;

  show = () => {
    const parts = segments(path) ?? ["not", "found"];
    const data: PageData = parts.length === 0
      ? { page: "list", overview: source.overview() }
      : {
        page: "request",
        request: parts.length === 2 && parts[0] === "requests"
          ? source.request(parts[1])
          : undefined,
      };
    const { requests, people } = source.records();
    const current = data.page === "request" && data.request
      ? requests.find((s) => s.request.id === data.request!.id) ?? null
      : null;
    const showPanel = data.page === "list" || current !== null;
    const { title, page } = pageView(
      data,
      showPanel &&
        h(StepsPanel, {
          behavior,
          requests,
          people,
          current,
          viewer: people.find((p) => p.email === viewerEmail) ?? null,
          onViewer: (email: string) => {
            viewerEmail = email;
            show();
          },
        }),
    );
    // A re-read keeps what was open on the same page.
    const same = shown === path;
    const wasOpen = same
      ? [...root.querySelectorAll<HTMLButtonElement>(
        'button.show-all[aria-expanded="true"]',
      )].map((b) => b.getAttribute("aria-controls"))
      : [];
    const openDetails = same
      ? [...root.querySelectorAll("main details")].map((d) =>
        (d as HTMLDetailsElement).open
      )
      : [];
    // Re-rendering replaces the picker, so focus goes back to it.
    const picking = document.activeElement?.matches(".view-as select");
    render(null, root);
    root.replaceChildren();
    render(page, root);
    if (picking) root.querySelector<HTMLElement>(".view-as select")?.focus();
    document.title = `${title} — Capture`;
    for (const id of wasOpen) {
      const button = root.querySelector<HTMLButtonElement>(
        `button.show-all[aria-controls="${id}"]`,
      );
      if (button) toggle(button);
    }
    root.querySelectorAll("main details").forEach((d, n) => {
      if (openDetails[n]) (d as HTMLDetailsElement).open = true;
    });
    if (!same) scrollTo(0, 0);
    shown = path;
  };

  root.addEventListener("click", (event) => {
    const target = event.target as Element;
    const button = target.closest<HTMLButtonElement>("button.show-all");
    if (button) {
      toggle(button);
      return;
    }
    const link = target.closest<HTMLAnchorElement>("a[href]");
    if (!link) return;
    const href = link.getAttribute("href") ?? "";
    if (href.startsWith("/") && !href.startsWith("//")) {
      // The page's own addresses are the dashboard's, which shows this one.
      event.preventDefault();
      path = href;
      transport.post({ kind: "navigate", path });
      show();
    } else if (!link.href.startsWith("https:")) {
      event.preventDefault();
    } else {
      // A link in a request, such as a build's pull request, opens in a
      // new tab when the person follows it; the app itself loads nothing.
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
  });

  show();

  // One read at a time; a change during a read reads again after it.
  let reading: Promise<void> | null = null;
  let again = false;
  changed = () => {
    if (reading) {
      again = true;
      return;
    }
    reading = source.refresh().then((fresh) => {
      if (fresh) show();
    }).catch(() => {
      // Data mid-write; the next change reads it whole.
    }).finally(() => {
      reading = null;
      if (again) {
        again = false;
        changed();
      }
    });
  };
  const stop = new AbortController();
  await followDataChanges({
    filter: { behaviors: [behavior], types: [REQUESTS_TYPE] },
    signal: stop.signal,
    pollMs: 3_000,
    subscribe: (payload, signal) =>
      client.dataSubscribeStream(payload, { signal }),
    onChanges: changed,
    onStale: changed,
    onMode: () => {},
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
}

main().catch((reason: unknown) =>
  fail(reason instanceof Error ? reason.message : String(reason))
);
