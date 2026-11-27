// The engine's renderer (05 §4): interprets view config, a component tree of
// whitelisted blocks, with React. Config comes from the log, so it is parsed
// (parseBlock/parseView) before anything renders, and errors are shown, not thrown.

import { useState, type CSSProperties, type ReactNode } from "react";
import type { JsonValue } from "@ev/core/browser";
import {
  LIMITS,
  autoLayout,
  formFields,
  formFromPayload,
  isSortKey,
  parseAction,
  parseBlock,
  parseView,
  renderTemplate,
  resolveRendering,
  resolveValue,
  type AppConfigJson,
  type Block,
  type ItemJson,
  type Scope,
} from "@ev/engine";
import type { Schema } from "@ev/rules/schema";
import { api } from "../api";
import { href, onLink } from "../router";
import { fetchExact, useApp, useData } from "../state";
import { SchemaForm } from "./forms";

export interface RenderCtx {
  readonly app: string;
  readonly config: AppConfigJson | null;
  /** The view being shown, for links that only change props. */
  readonly view: string | null;
  /** How many views deep we are (view blocks can nest). */
  readonly nesting: number;
}

function isObj(v: unknown): v is { [k: string]: JsonValue } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function ConfigError({ title, errors }: { title: string; errors: readonly string[] }) {
  return (
    <div className="config-error">
      <strong>{title}</strong>
      <ul>{errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}</ul>
    </div>
  );
}

/** Renders a view of an app with its props (defaults overlaid by the URL). */
export function ViewHost({ ctx, view, props }: { ctx: RenderCtx; view: string; props: Record<string, string> }) {
  const { session } = useApp();
  const ev = ctx.config?.views[view];
  if (!ev) return <ConfigError title="Unknown view" errors={[`${view} is not part of this app's config`]} />;
  if (ctx.nesting > LIMITS.viewNesting) return <ConfigError title="Too deep" errors={["views nest more than 8 levels"]} />;
  const parsed = parseView(ev.payload);
  if (!parsed.value) return <ConfigError title={`View ${view} has errors`} errors={parsed.errors} />;
  const resolved: Record<string, string> = {};
  for (const [k, d] of Object.entries(parsed.value.props)) if (d.default !== undefined) resolved[k] = d.default;
  Object.assign(resolved, props);
  const scope: Scope = { app: ctx.app, props: resolved, ...(session?.me ? { session: session.me.id } : {}) };
  return <BlockView block={parsed.value.root} scope={scope} ctx={{ ...ctx, view, nesting: ctx.nesting + 1 }} />;
}

const gapStyle = (gap: number | undefined, def: number): CSSProperties => ({ gap: `${gap ?? def}px` });

export function BlockView({ block, scope, ctx }: { block: Block; scope: Scope; ctx: RenderCtx }): ReactNode {
  const { nameOf } = useApp();
  const kids = (children: readonly Block[]) => children.map((c, i) => <BlockView key={i} block={c} scope={scope} ctx={ctx} />);
  switch (block.block) {
    case "stack":
      return <div className="b-stack" style={gapStyle(block.gap, 8)}>{kids(block.children)}</div>;
    case "row":
      return <div className={`b-row align-${block.align ?? "center"}${block.wrap ? " wrap" : ""}`} style={gapStyle(block.gap, 8)}>{kids(block.children)}</div>;
    case "grid":
      return <div className="b-grid" style={{ ...gapStyle(block.gap, 12), gridTemplateColumns: `repeat(${block.columns}, minmax(0, 1fr))` }}>{kids(block.children)}</div>;
    case "text": {
      const text = renderTemplate(block.text, scope, { nameOf });
      const style = block.style ?? "body";
      if (style === "heading") return <h2 className="b-text heading">{text}</h2>;
      return <div className={`b-text ${style}`}>{text}</div>;
    }
    case "list":
      return <ListBlock block={block} scope={scope} ctx={ctx} />;
    case "tree":
      return <TreeBlock block={block} scope={scope} ctx={ctx} />;
    case "item":
      return <ItemBlock block={block} scope={scope} ctx={ctx} />;
    case "event":
      return <EventBlock block={block} scope={scope} ctx={ctx} />;
    case "button":
      return <ActionButton action={block.action} label={block.label} scope={scope} ctx={ctx} />;
    case "form":
      return <ActionForm action={block.action} label={block.label} collapsed={block.collapsed ?? false} scope={scope} ctx={ctx} />;
    case "link": {
      const to = linkTarget(block, scope, ctx);
      const text = renderTemplate(block.text, scope, { nameOf });
      if (!to) return <span className="b-link disabled">{text}</span>;
      const active = to === window.location.pathname + window.location.search;
      return <a className={`b-link${active ? " active" : ""}`} href={to} onClick={onLink(to)}>{text}</a>;
    }
    case "view": {
      const props: Record<string, string> = {};
      for (const [k, v] of Object.entries(block.props ?? {})) {
        const r = resolveValue(v, scope);
        if (r !== undefined) props[k] = r;
      }
      return <ViewHost ctx={ctx} view={block.view} props={props} />;
    }
  }
}

function linkTarget(block: Extract<Block, { block: "link" }>, scope: Scope, ctx: RenderCtx): string | null {
  const props: Record<string, string> = {};
  for (const [k, v] of Object.entries(block.props ?? {})) {
    const r = resolveValue(v, scope);
    if (r === undefined) return null;
    props[k] = r;
  }
  if (block.event) {
    const e = resolveValue(block.event, scope);
    return e ? href.event(e, ctx.app) : null;
  }
  if (block.view) return href.view(ctx.app, block.view, props);
  if (block.home) return href.app(ctx.app);
  // Same view, other props (e.g. a sort): keep the current ones.
  const home = ctx.config && typeof (ctx.config.manifest.payload as { home?: unknown }).home === "string" ? ((ctx.config.manifest.payload as { home: string }).home) : null;
  const view = ctx.view ?? home;
  return view ? href.view(ctx.app, view, { ...scope.props, ...props }) : null;
}

function sortOf(ref: string | undefined, scope: Scope, def: string): string {
  const s = resolveValue(ref, scope) ?? def;
  return isSortKey(s) ? s : def;
}

function ListBlock({ block, scope, ctx }: { block: Extract<Block, { block: "list" }>; scope: Scope; ctx: RenderCtx }) {
  const ref = block.query.ref === undefined ? undefined : block.query.ref === "none" ? "none" : resolveValue(block.query.ref, scope);
  const author = block.query.author === undefined ? undefined : resolveValue(block.query.author, scope);
  const sort = sortOf(block.sort, scope, "new");
  const blocked = (block.query.ref !== undefined && ref === undefined) || (block.query.author !== undefined && author === undefined);
  const q = { types: block.query.types, sort, limit: block.limit ?? 50, ...(ref ? { ref } : {}), ...(author ? { author } : {}), ...(block.score ? { score: block.score } : {}) };
  const data = useData(blocked ? null : `list:${JSON.stringify(q)}`, () => api.events(q));
  if (blocked) return null;
  if (data.error) return <div className="error">{data.error.message}</div>;
  if (!data.data) return <div className="muted">Loading…</div>;
  if (data.data.items.length === 0) return <div className="muted empty">{block.empty ?? "Nothing yet."}</div>;
  const item = block.item ?? { block: "event" as const };
  return (
    <div className="b-list">
      {data.data.items.map((it) => (
        <div className="b-list-item" key={it.address}>
          <BlockView block={item} scope={{ ...scope, item: it }} ctx={ctx} />
        </div>
      ))}
    </div>
  );
}

function TreeBlock({ block, scope, ctx }: { block: Extract<Block, { block: "tree" }>; scope: Scope; ctx: RenderCtx }) {
  const root = resolveValue(block.root, scope);
  const sort = sortOf(block.sort, scope, "top");
  const q = { root: root ?? "", types: block.types, sort, depth: block.depth ?? 6, ...(block.score ? { score: block.score } : {}) };
  const data = useData(root ? `tree:${JSON.stringify(q)}` : null, () => api.tree(q));
  if (!root) return null;
  if (data.error) return <div className="error">{data.error.message}</div>;
  if (!data.data) return <div className="muted">Loading…</div>;
  if (data.data.items.length === 0) return <div className="muted empty">{block.empty ?? "Nothing yet."}</div>;
  const item = block.item ?? { block: "event" as const };
  const level = (items: readonly ItemJson[]): ReactNode => (
    <div className="b-tree">
      {items.map((it) => (
        <div className="b-tree-node" key={it.address}>
          <BlockView block={item} scope={{ ...scope, item: it }} ctx={ctx} />
          {it.replies && it.replies.length > 0 && level(it.replies)}
        </div>
      ))}
    </div>
  );
  return level(data.data.items);
}

function ItemBlock({ block, scope, ctx }: { block: Extract<Block, { block: "item" }>; scope: Scope; ctx: RenderCtx }) {
  const of = resolveValue(block.of, scope);
  const data = useData(of ? `item:${of}:${block.score ?? ""}` : null, () => api.item(of!, block.score));
  if (!of) return null;
  if (data.error) return <div className="error">{(data.error as { status?: number }).status === 410 ? "This was deleted by its author." : data.error.message}</div>;
  if (!data.data) return <div className="muted">Loading…</div>;
  const inner = { ...scope, item: data.data };
  return <div className="b-stack" style={{ gap: "8px" }}>{block.children.map((c, i) => <BlockView key={i} block={c} scope={inner} ctx={ctx} />)}</div>;
}

function EventBlock({ block, scope, ctx }: { block: Extract<Block, { block: "event" }>; scope: Scope; ctx: RenderCtx }) {
  const of = block.of === undefined || block.of === "$item" ? scope.item?.address : resolveValue(block.of, scope);
  const inScope = scope.item && scope.item.address === of ? scope.item : undefined;
  const data = useData(of && !inScope ? `item:${of}` : null, () => api.item(of!));
  const item = inScope ?? data.data;
  if (!of) return null;
  if (data.error) return <div className="error">{(data.error as { status?: number }).status === 410 ? "This was deleted by its author." : data.error.message}</div>;
  if (!item) return <div className="muted">Loading…</div>;
  return <EventCard item={item} ctx={ctx} typeView={block.typeView} controls={block.controls ?? false} />;
}

/** One event, rendered through the type-view fallback chain (05 §4), with author controls. */
export function EventCard({ item, ctx, typeView, controls }: { item: ItemJson; ctx: RenderCtx; typeView?: string | undefined; controls: boolean }) {
  const { types, session, changed } = useApp();
  const [editing, setEditing] = useState(false);
  const appTypeViews = ctx.config && isObj(ctx.config.manifest.payload) && isObj(ctx.config.manifest.payload.typeViews) ? (ctx.config.manifest.payload.typeViews as Record<string, string>) : undefined;
  const r = typeView ? ({ kind: "typeView", address: typeView, via: item.head.type } as const) : resolveRendering(item.head.type, { types, ...(appTypeViews ? { appTypeViews } : {}) });
  const type = types.get(item.head.type);
  const mine = session?.me?.id === item.author;
  const scope: Scope = { app: ctx.app, props: {}, item, ...(session?.me ? { session: session.me.id } : {}) };

  let body: ReactNode;
  switch (r.kind) {
    case "typeView": body = <TypeViewBody address={r.address} scope={scope} ctx={ctx} schema={type?.schema} />; break;
    case "template": body = <div className="b-text title">{renderTemplate(r.template, scope)}</div>; break;
    case "auto": body = <BlockView block={autoLayout(r.schema, null)} scope={scope} ctx={ctx} />; break;
    case "raw": body = <pre className="raw">{JSON.stringify(item.head.payload, null, 2)}</pre>; break;
  }

  const del = async () => {
    if (!session || !window.confirm("Delete this? Every version of it is hidden; the log keeps the event.")) return;
    await api.post(ctx.app, { type: session.genesisTypes.delete!, ref: item.address, payload: {} });
    changed();
  };

  return (
    <div className="event-card">
      {editing && type ? (
        <SchemaForm
          fields={formFields(type.schema)}
          schema={type.schema as Schema}
          initial={formFromPayload(formFields(type.schema), item.head.payload)}
          submitLabel="Save new version"
          onCancel={() => setEditing(false)}
          onSubmit={async (payload) => {
            await api.post(ctx.app, { type: item.head.type, ref: item.head.address, supersedes: true, payload });
            setEditing(false);
            changed();
          }}
        />
      ) : body}
      <div className="event-meta">
        {item.edited && <span className="badge">edited</span>}
        <Unpublished published />
        <a className="muted small" href={href.event(item.address, ctx.app)} onClick={onLink(href.event(item.address, ctx.app))}>{type?.name ?? "event"} {item.address}</a>
        {controls && mine && !editing && type && <button className="link" onClick={() => setEditing(true)}>edit</button>}
        {controls && mine && !editing && <button className="link danger" onClick={() => void del()}>delete</button>}
      </div>
    </div>
  );
}

/** The "unpublished" marker (07 §2). Instant batching never shows it; the component stays for later batching. */
export function Unpublished({ published }: { published: boolean }) {
  return published ? null : <span className="badge warn" title="Its batch is not published yet">unpublished</span>;
}

function TypeViewBody({ address, scope, ctx, schema }: { address: string; scope: Scope; ctx: RenderCtx; schema: { readonly [k: string]: JsonValue } | undefined }) {
  const data = useData(`exact:${address}`, () => fetchExact(address), { live: false });
  if (data.error || (data.data && !data.data.valid)) return schema ? <BlockView block={autoLayout(schema, null)} scope={scope} ctx={ctx} /> : null;
  if (!data.data) return <div className="muted">…</div>;
  const p = data.data.event.payload;
  const parsed = parseBlock(isObj(p) ? p.layout : undefined);
  if (!parsed.value) return <ConfigError title={`Type view ${address} has errors`} errors={parsed.errors} />;
  return <BlockView block={parsed.value} scope={scope} ctx={ctx} />;
}

function useAction(action: string, ctx: RenderCtx) {
  const ev = ctx.config?.actions[action];
  const parsed = ev ? parseAction(ev.payload) : { errors: [`${action} is not part of this app's config`] };
  return parsed;
}

function refOf(ref: string, scope: Scope): { ref: string | null; ok: boolean } {
  if (ref === "none") return { ref: null, ok: true };
  const r = resolveValue(ref, scope);
  return { ref: r ?? null, ok: r !== undefined };
}

function ActionButton({ action, label, scope, ctx }: { action: string; label?: string | undefined; scope: Scope; ctx: RenderCtx }) {
  const { session, changed } = useApp();
  const parsed = useAction(action, ctx);
  const [error, setError] = useState<string | null>(null);
  if (!parsed.value) return <ConfigError title="Action has errors" errors={parsed.errors} />;
  const a = parsed.value;
  const { ref, ok } = refOf(a.ref, scope);
  const click = async () => {
    setError(null);
    try {
      await api.post(ctx.app, { type: a.creates, ref, payload: a.fixed as JsonValue });
      changed();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <span className="b-button">
      <button className="small" disabled={!session?.me || !ok} title={session?.me ? a.name : "Sign in first"} onClick={() => void click()}>{label ?? a.label}</button>
      {error && <span className="error small">{error}</span>}
    </span>
  );
}

function ActionForm({ action, label, collapsed, scope, ctx }: { action: string; label?: string | undefined; collapsed: boolean; scope: Scope; ctx: RenderCtx }) {
  const { session, types, changed } = useApp();
  const parsed = useAction(action, ctx);
  const [open, setOpen] = useState(!collapsed);
  if (!parsed.value) return <ConfigError title="Action has errors" errors={parsed.errors} />;
  const a = parsed.value;
  const type = types.get(a.creates);
  if (!type) return <div className="muted">Loading…</div>;
  if (!session?.me) return collapsed ? null : <div className="muted small"><a href={href.login()} onClick={onLink(href.login())}>Sign in</a> to {a.label.toLowerCase()}.</div>;
  const { ref, ok } = refOf(a.ref, scope);
  if (!ok) return null;
  if (!open) return <button className="link" onClick={() => setOpen(true)}>{label ?? a.label}</button>;
  return (
    <div className="b-form">
      <SchemaForm
        fields={formFields(type.schema, a.fields)}
        schema={type.schema as Schema}
        fixed={a.fixed}
        compact={collapsed}
        submitLabel={label && !collapsed ? label : a.label}
        {...(collapsed ? { onCancel: () => setOpen(false) } : {})}
        onSubmit={async (payload) => {
          await api.post(ctx.app, { type: a.creates, ref, payload });
          if (collapsed) setOpen(false);
          changed();
        }}
      />
    </div>
  );
}
