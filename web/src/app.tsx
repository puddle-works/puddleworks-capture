// The read-only Capture page: the request list at / and one request at
// /requests/<id>. It reads again whenever the event stream says the data
// changed. Every change goes through the requests behavior's methods.
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import * as api from "./api.ts";
import { RequestList } from "./list.tsx";
import { Link } from "./nav.tsx";
import { RequestPage } from "./request.tsx";
import { type Route, routeOf } from "./words.ts";

function useRoute(): Route {
  const [route, setRoute] = useState(() => routeOf(location.pathname));
  useEffect(() => {
    const changed = () => {
      setRoute(routeOf(location.pathname));
      scrollTo(0, 0);
    };
    addEventListener("popstate", changed);
    return () => removeEventListener("popstate", changed);
  }, []);
  return route;
}

/** A number that goes up each time the data changes, to read again on. */
function useChanges(): number {
  const [changes, setChanges] = useState(0);
  useEffect(() => api.watch(() => setChanges((n) => n + 1)), []);
  return changes;
}

function App() {
  const route = useRoute();
  const changes = useChanges();
  return (
    <>
      <header>
        <Link class="brand" to="/">
          <svg
            width="28"
            height="28"
            viewBox="0 0 32 32"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="16" cy="7" r="3" fill="currentColor" />
            <ellipse cx="16" cy="19" rx="5" ry="2.25" fill="currentColor" />
            <ellipse
              cx="16"
              cy="19"
              rx="9"
              ry="4.5"
              stroke="currentColor"
              stroke-width="1.5"
              opacity="0.55"
            />
            <ellipse
              cx="16"
              cy="19"
              rx="14"
              ry="7"
              stroke="currentColor"
              stroke-width="1"
              opacity="0.25"
            />
          </svg>
          <span class="brand-name">
            puddle <span class="brand-accent">works</span>
          </span>
          <span class="brand-app">Capture</span>
        </Link>
        <span
          class="read-only"
          title="Changes go through the capture behavior's methods"
        >
          Read-only
        </span>
      </header>
      <main>
        {route.page === "list" && <RequestList changes={changes} />}
        {route.page === "request" && (
          <RequestPage key={route.id} id={route.id} changes={changes} />
        )}
        {route.page === "missing" && <Missing />}
      </main>
    </>
  );
}

function Missing() {
  useEffect(() => {
    document.title = "Not found — Capture";
  }, []);
  return (
    <>
      <h1>Not found</h1>
      <p>
        There is no such page. <Link to="/">See every request</Link>.
      </p>
    </>
  );
}

render(<App />, document.getElementById("root")!);
