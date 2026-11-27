// /e/a/b/u/s and /a/9/e/a/b/u/s (07 §10). The event's own app opens it by
// default, with the view its manifest names for the type (`open`). Without
// one: the type view chain and the auto-renderer, which works even if the
// app's servers are gone, because its config is in the log (05 §4).

import { useEffect } from "react";
import type { JsonValue } from "@ev/core/browser";
import { api } from "../api";
import { EventCard, type RenderCtx } from "../render/blocks";
import { href, navigate, onLink } from "../router";
import { useApp, useData } from "../state";

function isObj(v: unknown): v is { [k: string]: JsonValue } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function EventPage({ address, app, exact }: { address: string; app: string | null; exact: boolean }) {
  const { types, nameOf } = useApp();
  const owner = app ?? address.split("/")[0]!;
  const config = useData(`config:${owner}`, () => api.config(owner).catch(() => null));
  const status = useData(`status:${address}`, () => api.status(address, true));
  const ev = useData(`exact:${address}`, () => api.event(address));
  const item = useData(exact ? null : `item:${address}`, () => api.item(address));

  // The app's own view for this type, if its manifest names one.
  const cfg = config.data ?? null;
  const open = cfg && isObj(cfg.manifest.payload) && isObj(cfg.manifest.payload.open) ? (cfg.manifest.payload.open as Record<string, string>) : {};
  const type = ev.data ? types.get(ev.data.event.type) : undefined;
  const appView = !exact && type ? open[type.address] ?? open[type.versionRoot] : undefined;
  useEffect(() => {
    if (appView && cfg && !cfg.kernel) navigate(href.view(owner, appView, { node: item.data?.address ?? address }), true);
  }, [appView, cfg?.app, item.data?.address]);

  if (ev.error) return <div className="card"><h2>{address}</h2><p className="error">{(ev.error as { status?: number }).status === 410 ? "Deleted by its author. The event stays in the log." : ev.error.message}</p></div>;
  if (!ev.data || !status.data) return <div className="muted">Loading…</div>;
  const e = ev.data.event;
  const ctx: RenderCtx = { app: owner, config: cfg, view: null, nesting: 0 };
  const shown = exact || !item.data
    ? { address: e.address, head: e, author: e.address.split("/")[2]!, app: e.address.split("/")[0]!, block: ev.data.block, time: ev.data.time, edited: false, score: 0, votes: 0, children: 0 }
    : item.data;

  return (
    <div className="b-stack" style={{ gap: "16px" }}>
      <div className="card">
        {!ev.data.valid && <div className="error">Invalid ({ev.data.reason}): it is in the log, but every projection ignores it.</div>}
        {status.data.head !== address && (
          <div className="note">
            {exact ? "A newer version exists: " : "Showing the latest version: "}
            <a href={href.event(status.data.head, app, true)} onClick={onLink(href.event(status.data.head, app, true))}>{status.data.head}</a>
          </div>
        )}
        <EventCard item={shown} ctx={ctx} controls={!exact} />
        <dl className="facts">
          <dt>Type</dt><dd>{type ? <a href={href.event(type.address)} onClick={onLink(href.event(type.address))}>{type.name}</a> : e.type}</dd>
          <dt>Author</dt><dd>{nameOf(shown.author)} (#{shown.author})</dd>
          <dt>App</dt><dd><a href={href.app(shown.app)} onClick={onLink(href.app(shown.app))}>{cfg?.name ?? `#${shown.app}`}</a></dd>
          <dt>Block</dt><dd>{ev.data.block} · {ev.data.time}</dd>
          {e.ref && <><dt>{e.supersedes ? "Previous version" : "Refers to"}</dt><dd><a href={href.event(e.ref)} onClick={onLink(href.event(e.ref))}>{e.ref}</a></dd></>}
          {e.auth && <><dt>Grant</dt><dd><a href={href.event(e.auth)} onClick={onLink(href.event(e.auth))}>{e.auth}</a></dd></>}
        </dl>
        {status.data.history && status.data.history.length > 1 && (
          <div>
            <div className="label">Versions</div>
            <ol className="versions">
              {status.data.history.map((v) => <li key={v}><a href={href.event(v, app, true)} onClick={onLink(href.event(v, app, true))}>{v}</a></li>)}
            </ol>
          </div>
        )}
        <details>
          <summary className="muted small">Raw event</summary>
          <pre className="raw">{JSON.stringify(e, null, 2)}</pre>
        </details>
      </div>
      {!appView && <Referencing address={shown.address} ctx={ctx} />}
    </div>
  );
}

/** Events that reference this one, of any type: the event's neighbourhood in the graph. */
function Referencing({ address, ctx }: { address: string; ctx: RenderCtx }) {
  const { typeList } = useApp();
  const roots = typeList.filter((t) => t.extends === null).map((t) => t.address);
  const data = useData(roots.length ? `refs:${address}:${roots.length}` : null, () => api.events({ types: roots, ref: address, sort: "new", limit: 100 }));
  if (!data.data || data.data.items.length === 0) return null;
  return (
    <div className="card">
      <div className="label">Referenced by</div>
      <div className="b-list">
        {data.data.items.map((it) => <div className="b-list-item" key={it.address}><EventCard item={it} ctx={ctx} controls={false} /></div>)}
      </div>
    </div>
  );
}

