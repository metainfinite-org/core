// The shell owns the browser URL (07 §10): a single-page app on the History
// API. Everything that defines a screen is in the URL, so any screen can be
// shared, reloaded, and navigated with back/forward.
//
//   /                              launcher
//   /login                         sign in
//   /a/7                           app 7, its home view
//   /a/7/v/7/3/7/1?node=…&sort=…   a view of app 7 with its props
//   /e/7/42/5/1                    an event (latest version), in its own app
//   /e/7/42/5/1?exact              exactly that version
//   /a/9/e/7/42/5/1                the event opened inside app 9

import { useEffect, useState } from "react";

export type Route =
  | { readonly page: "home" }
  | { readonly page: "login" }
  | { readonly page: "app"; readonly app: string; readonly view: string | null; readonly props: Record<string, string> }
  | { readonly page: "event"; readonly app: string | null; readonly address: string; readonly exact: boolean }
  | { readonly page: "missing"; readonly path: string };

const N = "(0|[1-9][0-9]*)";
const ADDR = `${N}/${N}/${N}/${N}`;

export function parseRoute(pathname: string, search: string): Route {
  const q = new URLSearchParams(search);
  const props: Record<string, string> = {};
  for (const [k, v] of q) if (k !== "exact") props[k] = v;
  let m: RegExpExecArray | null;
  if (pathname === "/" || pathname === "") return { page: "home" };
  if (pathname === "/login") return { page: "login" };
  if ((m = new RegExp(`^/a/([1-9][0-9]*)/?$`).exec(pathname))) return { page: "app", app: m[1]!, view: null, props };
  if ((m = new RegExp(`^/a/([1-9][0-9]*)/v/(${ADDR})$`).exec(pathname))) return { page: "app", app: m[1]!, view: m[2]!, props };
  if ((m = new RegExp(`^/a/([1-9][0-9]*)/e/(${ADDR})$`).exec(pathname))) return { page: "event", app: m[1]!, address: m[2]!, exact: q.has("exact") };
  if ((m = new RegExp(`^/e/(${ADDR})$`).exec(pathname))) return { page: "event", app: null, address: m[1]!, exact: q.has("exact") };
  return { page: "missing", path: pathname };
}

function query(props: Record<string, string | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(props)) if (v !== undefined && v !== "") u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : "";
}

export const href = {
  home: () => "/",
  login: () => "/login",
  app: (app: string) => `/a/${app}`,
  view: (app: string, view: string, props: Record<string, string | undefined> = {}) => `/a/${app}/v/${view}${query(props)}`,
  event: (address: string, app?: string | null, exact = false) => `${app ? `/a/${app}` : ""}/e/${address}${exact ? "?exact" : ""}`,
};

const listeners = new Set<() => void>();

export function navigate(to: string, replace = false): void {
  if (to === window.location.pathname + window.location.search) return;
  if (replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.scrollTo(0, 0);
  for (const l of listeners) l();
}

export function useRoute(): Route {
  const read = () => parseRoute(window.location.pathname, window.location.search);
  const [route, setRoute] = useState<Route>(read);
  useEffect(() => {
    const on = () => setRoute(read());
    listeners.add(on);
    window.addEventListener("popstate", on);
    return () => {
      listeners.delete(on);
      window.removeEventListener("popstate", on);
    };
  }, []);
  return route;
}

/** Left-click on an internal link: navigate without a page load. */
export function onLink(to: string) {
  return (e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; preventDefault(): void }) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    navigate(to);
  };
}
