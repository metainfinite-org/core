// The shell (05 §5): "a browser inside the browser". Launcher, session,
// navigation and grant handling around the engine. It owns the URL (07 §10).

import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { AppMaker } from "../makers/AppMaker";
import { TypeMaker } from "../makers/TypeMaker";
import { ConfigError, ViewHost, type RenderCtx } from "../render/blocks";
import { href, navigate, onLink, useRoute, type Route } from "../router";
import { useApp, useData } from "../state";
import { Accounts } from "./Accounts";
import { EventPage } from "./EventPage";

export function Shell() {
  const route = useRoute();
  const { session } = useApp();
  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href={href.home()} onClick={onLink(href.home())}>events<span className="muted">/{session?.deployment ?? "…"}</span></a>
        <AddressBar route={route} />
        <div className="who">
          {session?.me ? (
            <a href={href.app(session.tools.idm ?? "")} onClick={onLink(href.app(session.tools.idm ?? ""))}>{session.me.name}</a>
          ) : (
            <a href={href.login()} onClick={onLink(href.login())}>Sign in</a>
          )}
        </div>
      </header>
      <main className="page">
        <Page route={route} />
      </main>
    </div>
  );
}

/** Shows where you are, and takes an event address or app id to jump to. */
function AddressBar({ route }: { route: Route }) {
  const current = route.page === "event" ? route.address : route.page === "app" ? `app ${route.app}` : "";
  const [text, setText] = useState(current);
  useEffect(() => setText(current), [current]);
  const go = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim().replace(/^app\s+/, "");
    if (/^[0-9]+\/[0-9]+\/[0-9]+\/[0-9]+$/.test(t)) navigate(href.event(t));
    else if (/^[1-9][0-9]*$/.test(t)) navigate(href.app(t));
  };
  return (
    <form className="addressbar" onSubmit={go}>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="event address (7/42/5/1) or app id" />
    </form>
  );
}

function Page({ route }: { route: Route }) {
  switch (route.page) {
    case "home": return <Home />;
    case "login": return <Login />;
    case "app": return <AppPage app={route.app} view={route.view} props={route.props} />;
    case "event": return <EventPage address={route.address} app={route.app} exact={route.exact} />;
    case "missing": return <div className="card"><h2>Not found</h2><p className="muted">{route.path}</p></div>;
  }
}

function Home() {
  const { session } = useApp();
  const apps = useData("apps", () => api.apps());
  return (
    <div className="b-stack" style={{ gap: "20px" }}>
      <section className="intro">
        <h1>Apps</h1>
        <p className="muted">
          Every app here is an identity plus config events in the log, rendered by one engine. Make types in the Type Maker, compose them into an app in the App Maker, and open it.
          {!session?.me && <> <a href={href.login()} onClick={onLink(href.login())}>Sign in</a> to post.</>}
        </p>
      </section>
      {apps.error && <div className="error">{apps.error.message}</div>}
      <div className="launcher">
        {apps.data?.apps.map((a) => (
          <a key={a.id} className={`app-tile${a.kernel ? " tool" : ""}`} href={href.app(a.id)} onClick={onLink(href.app(a.id))}>
            <span className="app-name">{a.name}</span>
            <span className="muted small">{a.description || (a.kernel ? "tool" : `app ${a.id}`)}</span>
            <span className="tile-meta">
              <span className="muted small">#{a.id}</span>
              {a.mine && <span className="badge">yours</span>}
              {a.kernel && <span className="badge">built in</span>}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

function Login() {
  const { session, refreshSession, changed } = useApp();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (session && session.signIn !== "dev") return <div className="card"><h2>Sign in</h2><p>This deployment signs in through OIDC, which is not wired up yet.</p></div>;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.devLogin(name.trim());
      await refreshSession();
      changed();
      navigate(href.home(), true);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <div className="card narrow">
      <h2>Sign in</h2>
      <p className="muted">Dev login: type a name. The IDM finds that account, or creates a new identity it owns. No password: local use only.</p>
      <form className="form" onSubmit={submit}>
        <label className="field"><span className="label">Name</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="alice" /></label>
        {error && <div className="error">{error}</div>}
        <div className="buttons"><button type="submit" disabled={!name.trim()}>Sign in</button></div>
      </form>
    </div>
  );
}

/** Opens an app: its kernel tool if it is a genesis tool, otherwise its declarative config. */
function AppPage({ app, view, props }: { app: string; view: string | null; props: Record<string, string> }) {
  const { session } = useApp();
  const config = useData(`config:${app}`, () => api.config(app));
  const [grant, setGrant] = useState<string | null | undefined>(undefined);

  // Lazy grant (03 §4, 07 §7): the first time a user opens an app, their IDM issues a grant, auto-approved.
  useEffect(() => {
    setGrant(undefined);
    if (!session?.me || !config.data || config.data.kernel === "idm") return;
    api.ensureGrant(app).then((r) => setGrant(r.address), () => setGrant(null));
  }, [app, session?.me?.id, config.data?.app]);

  if (config.error) return <div className="card"><h2>App {app}</h2><p className="error">{config.error.message}</p></div>;
  if (!config.data) return <div className="muted">Loading…</div>;
  const cfg = config.data;

  const banner = session?.me && grant ? (
    <div className="grant-note muted small">
      {cfg.name} can post for you (grant <a href={href.event(grant)} onClick={onLink(href.event(grant))}>{grant}</a>). <a href={href.app(session.tools.idm ?? "")} onClick={onLink(href.app(session.tools.idm ?? ""))}>Manage</a>
    </div>
  ) : null;

  switch (cfg.kernel) {
    case "type-maker": return <>{banner}<TypeMaker app={app} config={cfg} /></>;
    case "app-maker": return <>{banner}<AppMaker app={app} props={props} /></>;
    case "idm": return <Accounts />;
  }

  const home = typeof (cfg.manifest.payload as { home?: unknown }).home === "string" ? (cfg.manifest.payload as { home: string }).home : null;
  const v = view ?? home;
  if (!v) return <ConfigError title={`${cfg.name} has no home view`} errors={["its manifest has no `home`"]} />;
  const ctx: RenderCtx = { app, config: cfg, view: v, nesting: 0 };
  return (
    <div className="app-frame">
      {banner}
      <ViewHost ctx={ctx} view={v} props={props} />
    </div>
  );
}
