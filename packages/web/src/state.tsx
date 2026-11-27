// Client state shared by the shell, the renderer and the makers: the session,
// the type catalog, display names, and a write counter. Every successful write
// bumps the counter, and data hooks refetch when it changes: the simplest
// correct invalidation while feeds are not pushed (live updates come later, 10 §4).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SessionJson, TypeJson } from "@ev/engine";
import { api, type ExactEvent } from "./api";

interface State {
  readonly session: SessionJson | null;
  readonly refreshSession: () => Promise<void>;
  readonly types: ReadonlyMap<string, TypeJson>;
  readonly typeList: readonly TypeJson[];
  readonly version: number;
  /** Call after any write. */
  readonly changed: () => void;
  readonly nameOf: (id: string) => string;
}

const Ctx = createContext<State | null>(null);

export function useApp(): State {
  const s = useContext(Ctx);
  if (!s) throw new Error("no AppState");
  return s;
}

export function AppState({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionJson | null>(null);
  const [typeList, setTypeList] = useState<TypeJson[]>([]);
  const [version, setVersion] = useState(0);
  const [names, setNames] = useState<Record<string, string>>({});
  const wanted = useRef(new Set<string>());
  const timer = useRef<number | null>(null);

  const refreshSession = useCallback(async () => setSession(await api.session()), []);
  useEffect(() => void refreshSession(), [refreshSession]);
  useEffect(() => {
    void api.types().then((r) => setTypeList(r.types));
  }, [version]);

  const nameOf = useCallback((id: string) => {
    const n = names[id];
    if (n !== undefined) return n;
    if (!wanted.current.has(id)) {
      wanted.current.add(id);
      if (timer.current === null) {
        timer.current = window.setTimeout(() => {
          const ids = [...wanted.current];
          timer.current = null;
          void api.names(ids).then((r) => setNames((old) => ({ ...old, ...Object.fromEntries(ids.map((i) => [i, r.names[i] ?? `#${i}`])) })));
        }, 10);
      }
    }
    return `#${id}`;
  }, [names]);

  const value = useMemo<State>(() => ({
    session,
    refreshSession,
    types: new Map(typeList.map((t) => [t.address, t])),
    typeList,
    version,
    changed: () => setVersion((v) => v + 1),
    nameOf,
  }), [session, refreshSession, typeList, version, nameOf]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export type Loaded<T> = { readonly data?: T; readonly error?: Error; readonly loading: boolean };

/** Fetches with `load` whenever `key` or the write counter changes. A null key skips. */
export function useData<T>(key: string | null, load: () => Promise<T>, opts: { live?: boolean } = {}): Loaded<T> {
  const { version } = useApp();
  const live = opts.live ?? true;
  const [state, setState] = useState<Loaded<T>>({ loading: key !== null });
  useEffect(() => {
    if (key === null) return setState({ loading: false });
    let stop = false;
    setState((s) => ({ ...s, loading: true }));
    load().then(
      (data) => !stop && setState({ data, loading: false }),
      (error: Error) => !stop && setState({ error, loading: false }),
    );
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, live ? version : 0]);
  return state;
}

// Exact versions never change (07 §3), so they are cached for the session.
const exact = new Map<string, Promise<ExactEvent>>();
export function fetchExact(addr: string): Promise<ExactEvent> {
  let p = exact.get(addr);
  if (!p) {
    p = api.event(addr);
    p.catch(() => exact.delete(addr));
    exact.set(addr, p);
  }
  return p;
}
