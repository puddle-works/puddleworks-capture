// The read-only Capture page, rendered on the server: the request list at /
// and one request at /requests/<id>. The page's script only opens "Show
// all" and reads the page again when the data changes. Every change goes
// through the requests behavior's methods.
import { renderToString } from "npm:preact-render-to-string@6.8.2";
import { type PageData, pageView } from "./view.ts";

/**
 * The page as HTML, in the shell build.ts embeds (index.html), and its
 * status: 404 for a request there is no record of.
 */
export function renderPage(shell: string, data: PageData): {
  status: number;
  html: string;
} {
  const { title, status, page } = pageView(data);
  const root = renderToString(page);
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
