// The read-only Capture page, rendered on the server: the request list at /
// and one request at /requests/<id>. The page's script only opens "Show
// all" and reads the page again when the data changes. Every change goes
// through the requests behavior's methods.
import { Fragment, h } from "preact";
import type { ComponentChildren } from "preact";
import { renderToString } from "npm:preact-render-to-string@6.8.2";
import type { WebOverview, WebRequest } from "../../capture/view_types.ts";
import { RequestList } from "./list.ts";
import { RequestPage } from "./request.ts";
import { numbered } from "./words.ts";

/** What a page path shows, read from swamp data. */
export type PageData = {
  page: "list";
  overview: WebOverview;
} | {
  page: "request";
  request: WebRequest | undefined;
};

/**
 * The page as HTML, in the shell build.ts embeds (index.html), and its
 * status: 404 for a request there is no record of.
 */
export function renderPage(shell: string, data: PageData): {
  status: number;
  html: string;
} {
  let title: string;
  let status = 200;
  let body: ComponentChildren;
  if (data.page === "list") {
    title = "Requests";
    body = h(RequestList, { data: data.overview });
  } else if (data.request) {
    title = numbered(data.request);
    body = h(RequestPage, { request: data.request });
  } else {
    title = "Not found";
    status = 404;
    body = h(Missing, null);
  }
  const root = renderToString(h(Layout, null, body));
  const html = shell
    .replace(
      "<title>Capture</title>",
      `<title>${escape(title)} — Capture</title>`,
    )
    .replace('<div id="root"></div>', () => `<div id="root">${root}</div>`);
  return { status, html };
}

const escape = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function Layout({ children }: {
  children: ComponentChildren;
}) {
  return h(
    Fragment,
    null,
    h(
      "header",
      null,
      h(
        "a",
        { class: "brand", href: "/" },
        h(
          "svg",
          {
            width: "28",
            height: "28",
            viewBox: "0 0 32 32",
            fill: "none",
            "aria-hidden": "true",
          },
          h("circle", { cx: "16", cy: "7", r: "3", fill: "currentColor" }),
          h("ellipse", {
            cx: "16",
            cy: "19",
            rx: "5",
            ry: "2.25",
            fill: "currentColor",
          }),
          h("ellipse", {
            cx: "16",
            cy: "19",
            rx: "9",
            ry: "4.5",
            stroke: "currentColor",
            "stroke-width": "1.5",
            opacity: "0.55",
          }),
          h("ellipse", {
            cx: "16",
            cy: "19",
            rx: "14",
            ry: "7",
            stroke: "currentColor",
            "stroke-width": "1",
            opacity: "0.25",
          }),
        ),
        h(
          "span",
          { class: "brand-name" },
          "puddle ",
          h("span", { class: "brand-accent" }, "works"),
        ),
        h("span", { class: "brand-app" }, "Capture"),
      ),
      h("span", {
        class: "read-only",
        title: "Changes go through the capture behavior's methods",
      }, "Read-only"),
    ),
    h("main", null, children),
  );
}

function Missing() {
  return h(
    Fragment,
    null,
    h("a", { class: "back-link", href: "/" }, "All requests"),
    h(
      "p",
      { role: "alert", class: "flash-alert" },
      "There is no such request.",
    ),
  );
}
