// Moving between the page's views without reloading it.
import type { ComponentChildren } from "preact";

/** Goes to a path inside the page. */
export function navigate(path: string) {
  history.pushState(null, "", path);
  dispatchEvent(new PopStateEvent("popstate"));
}

/** A link to another view of the page. A modified click still opens a new tab. */
export function Link(
  { to, class: className, children }: {
    to: string;
    class?: string;
    children: ComponentChildren;
  },
) {
  return (
    <a
      href={to}
      class={className}
      onClick={(e) => {
        if (
          e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey
        ) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
