// The read-only Capture page for one path's data: the request list at / and
// one request at /requests/<id>, in the header and main both hosts show. The
// serve method renders it to HTML (layout.ts); the Capture app
// (extensions/apps/capture) renders it in the dashboard.
import { Fragment, h } from "preact";
import type { ComponentChildren, VNode } from "preact";
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
 * The page for a path's data, its title and status. The serve method renders
 * it to HTML; the Capture app (extensions/apps/capture) renders it in the
 * dashboard, and passes aside, which goes at the top of main.
 */
export function pageView(data: PageData, aside?: ComponentChildren): {
  title: string;
  status: number;
  page: VNode;
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
  return { title, status, page: h(Layout, null, aside, body) };
}

function Layout({ children }: {
  children?: ComponentChildren;
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
