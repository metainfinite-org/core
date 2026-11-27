// The IDM's screens (07 §8): your account, the grants you have given apps
// (with revocation, 03 §4), the apps you control (custody), and operator tools.

import { useState } from "react";
import { api } from "../api";
import { href, navigate, onLink } from "../router";
import { useApp, useData } from "../state";

export function Accounts() {
  const { session, nameOf, refreshSession, changed } = useApp();
  const grants = useData(session?.me ? "grants" : null, () => api.grants());
  const mine = useData(session?.me ? "my-apps" : null, () => api.myApps());
  const [rebuild, setRebuild] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!session?.me) {
    return <div className="card narrow"><h2>Accounts</h2><p><a href={href.login()} onClick={onLink(href.login())}>Sign in</a> to see your account.</p></div>;
  }

  const revoke = async (g: string) => {
    setError(null);
    try {
      await api.revoke(g);
      changed();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="b-stack" style={{ gap: "16px" }}>
      <div className="card">
        <h2>{session.me.name}</h2>
        <p className="muted">Identity #{session.me.id}, owned by this deployment's IDM (#{session.tools.idm}). Apps post for you only through grants you can revoke here.</p>
        <div className="buttons">
          <button className="ghost" onClick={async () => { await api.logout(); await refreshSession(); changed(); navigate(href.home()); }}>Sign out</button>
        </div>
      </div>

      <div className="card">
        <h3>Grants</h3>
        <p className="muted small">Issued lazily the first time you use an app. Revoking stops events posted after the revocation; earlier ones stay valid. Using the app again issues a new grant.</p>
        {error && <div className="error">{error}</div>}
        <table className="table">
          <thead><tr><th>App</th><th>Grant</th><th>Issued</th><th>Status</th><th /></tr></thead>
          <tbody>
            {grants.data?.grants.map((g) => (
              <tr key={g.address}>
                <td><a href={href.app(g.app)} onClick={onLink(href.app(g.app))}>{nameOf(g.app)}</a></td>
                <td><a href={href.event(g.address)} onClick={onLink(href.event(g.address))}>{g.address}</a></td>
                <td>block {g.issuedBlock}</td>
                <td>{g.revokedBlock ? `revoked in block ${g.revokedBlock}` : "active"}</td>
                <td>{!g.revokedBlock && <button className="small danger" onClick={() => void revoke(g.address)}>Revoke</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {grants.data?.grants.length === 0 && <div className="muted">No grants yet.</div>}
      </div>

      <div className="card">
        <h3>Apps you control</h3>
        <p className="muted small">Identities the IDM owns on-chain and lets you control (custody policy). Their config is authored by the app itself.</p>
        <ul className="plain">
          {mine.data?.apps.map((a) => (
            <li key={a.id}>
              <a href={href.app(a.id)} onClick={onLink(href.app(a.id))}>{a.name ?? `app ${a.id} (no manifest yet)`}</a>
              <span className="muted small"> #{a.id} · </span>
              <a className="small" href={`${href.app(session.tools["app-maker"]!)}?edit=${a.id}`} onClick={onLink(`${href.app(session.tools["app-maker"]!)}?edit=${a.id}`)}>edit</a>
            </li>
          ))}
        </ul>
        {mine.data?.apps.length === 0 && <div className="muted">None yet. Make one with the App Maker.</div>}
      </div>

      <div className="card">
        <h3>Operations</h3>
        <div className="buttons">
          <a className="button ghost" href="/api/export" download="log.jsonl">Export the log (JSON lines)</a>
          <button className="ghost" onClick={async () => { const r = await api.rebuild(); setRebuild(r.match ? `rebuild matches: ${r.hash.slice(0, 16)}…` : `MISMATCH: rebuilt ${r.hash.slice(0, 12)}… vs live ${r.live.slice(0, 12)}…`); }}>Rebuild projections</button>
        </div>
        {rebuild && <div className="muted small">{rebuild}</div>}
      </div>
    </div>
  );
}
