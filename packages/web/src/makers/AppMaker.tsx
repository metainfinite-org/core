// The App Maker (05 §7, 08 P5 "App Maker v1"): pick types, sorts and a layout
// from a fixed menu, name the app, save. Saving creates an app identity owned
// by the IDM (with custody for you), then emits the app's actions, views and
// manifest as the app itself (03 §8). The generated bundle can be edited as
// JSON before saving: anything the whitelisted blocks can express.

import { useEffect, useMemo, useState } from "react";
import type { JsonValue } from "@ev/core/browser";
import { SORT_KEYS, buildAppBundle, checkBundle, emitBundle, type AppBundle, type AppSpec, type SortKey, type TypeJson } from "@ev/engine";
import { api } from "../api";
import { href, navigate, onLink } from "../router";
import { useApp, useData } from "../state";

/** Genesis plumbing types, hidden from the type pickers unless asked for. */
const SYSTEM = new Set(["type", "integer", "string", "bytes", "boolean", "timestamp", "address", "list", "record", "decimal", "float64", "grant", "revoke", "delete", "type-view", "type-annotation", "view", "action", "manifest", "proposal", "merge"]);

function isObj(v: unknown): v is { [k: string]: JsonValue } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function extendsReaction(t: TypeJson, types: ReadonlyMap<string, TypeJson>, reaction: string | undefined): boolean {
  let cur: TypeJson | undefined = t;
  for (let i = 0; cur && i < 32; i++) {
    if (cur.versionRoot === reaction) return true;
    cur = cur.extends ? types.get(cur.extends) : undefined;
  }
  return false;
}

export function AppMaker({ props }: { app: string; props: Record<string, string> }) {
  const { session, types, typeList, changed } = useApp();
  const editId = props.edit ?? null;
  const editCfg = useData(editId ? `config:${editId}` : null, () => api.config(editId!).catch(() => null), { live: false });
  const mine = useData(session?.me ? "my-apps" : null, () => api.myApps());
  const g = session?.genesisTypes ?? {};

  const [spec, setSpec] = useState<AppSpec>({ name: "", description: "", postTypes: [], replyTypes: [], scoreType: null, sort: "hot", replySort: "top", replyLayout: "tree" });
  const [showSystem, setShowSystem] = useState(false);
  const [raw, setRaw] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Sensible defaults once the catalog is loaded: posts, comments, votes.
  useEffect(() => {
    if (editId || !g.post || spec.postTypes.length) return;
    setSpec((s) => ({ ...s, postTypes: [g.post!], replyTypes: g.comment ? [g.comment] : [], scoreType: g.vote ?? null }));
  }, [g.post]);

  // Editing: start from the spec the App Maker stored in the manifest.
  useEffect(() => {
    const m = editCfg.data?.manifest.payload;
    if (!m || !isObj(m)) return;
    const stored = isObj(m.extensions) && isObj(m.extensions["app-maker"]) ? m.extensions["app-maker"].spec : undefined;
    if (isObj(stored)) setSpec(stored as unknown as AppSpec);
    else setSpec((s) => ({ ...s, name: typeof m.name === "string" ? m.name : s.name }));
  }, [editCfg.data?.manifest.address]);

  const system = new Set(Object.entries(g).filter(([k]) => SYSTEM.has(k)).map(([, v]) => v));
  const heads = typeList.filter((t) => t.isHead && (showSystem || !system.has(t.address)));
  const reactionRoot = g.reaction ? types.get(g.reaction)?.versionRoot : undefined;
  const scoreTypes = typeList.filter((t) => t.isHead && extendsReaction(t, types, reactionRoot));

  const generated = useMemo((): { bundle?: AppBundle; error?: string } => {
    if (!spec.name.trim()) return { error: "name the app" };
    try {
      return { bundle: buildAppBundle({ ...spec, name: spec.name.trim() }, types) };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }, [spec, types]);

  const toggle = (list: readonly string[], a: string, on: boolean) => (on ? [...list, a] : list.filter((x) => x !== a));

  const save = async () => {
    setError(null);
    let bundle: AppBundle;
    if (raw !== null) {
      try {
        bundle = JSON.parse(raw) as AppBundle;
      } catch {
        return setError("the JSON doesn't parse");
      }
    } else if (generated.bundle) bundle = generated.bundle;
    else return setError(generated.error ?? "nothing to save");
    const problems = checkBundle(bundle);
    if (problems.length) return setError(problems.slice(0, 5).join("\n"));
    setBusy(true);
    try {
      const id = editId ?? (await api.createApp()).id;
      const kinds = { action: g.action!, view: g.view!, manifest: g.manifest! };
      await emitBundle(bundle, async (kind, payload, supersedes) => {
        const r = await api.post(id, { user: id, type: kinds[kind], payload, ...(supersedes ? { ref: supersedes, supersedes: true } : {}) });
        return r.address;
      }, editCfg.data?.manifest.address);
      changed();
      navigate(href.app(id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!session?.me) return <div className="card narrow"><h2>App Maker</h2><p><a href={href.login()} onClick={onLink(href.login())}>Sign in</a> to make an app.</p></div>;

  const picker = (label: string, selected: readonly string[], onChange: (next: string[]) => void) => (
    <div className="field">
      <span className="label">{label}</span>
      <div className="checks">
        {heads.map((t) => (
          <label key={t.address} className="check small">
            <input type="checkbox" checked={selected.includes(t.address)} onChange={(e) => onChange(toggle(selected, t.address, e.target.checked))} /> {t.name}
            <span className="muted"> {t.address}</span>
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <div className="maker">
      <aside className="maker-side card">
        <div className="row-between">
          <h3>Your apps</h3>
          <a className="button small" href={href.app(session.tools["app-maker"]!)} onClick={onLink(href.app(session.tools["app-maker"]!))}>New app</a>
        </div>
        <ul className="plain">
          {mine.data?.apps.map((a) => (
            <li key={a.id}>
              <a className={a.id === editId ? "active" : ""} href={`${href.app(session.tools["app-maker"]!)}?edit=${a.id}`} onClick={onLink(`${href.app(session.tools["app-maker"]!)}?edit=${a.id}`)}>{a.name ?? `app ${a.id}`}</a>
              <span className="muted small"> · <a href={href.app(a.id)} onClick={onLink(href.app(a.id))}>open</a></span>
            </li>
          ))}
        </ul>
        {mine.data?.apps.length === 0 && <p className="muted small">None yet.</p>}
      </aside>
      <section className="maker-main card">
        <h2>{editId ? `Edit ${editCfg.data?.name ?? `app ${editId}`}` : "New app"}</h2>
        <p className="muted small">
          {editId
            ? "Saving publishes new views and actions and a manifest that supersedes the current one. Old config stays in the log."
            : "Saving creates a new app identity (owned by the IDM, controlled by you) and publishes its config as the app."}
        </p>
        <div className="form">
          <label className="field"><span className="label">Name</span><input value={spec.name} onChange={(e) => setSpec({ ...spec, name: e.target.value })} placeholder="e.g. Team board" /></label>
          <label className="field"><span className="label">Description</span><input value={spec.description ?? ""} onChange={(e) => setSpec({ ...spec, description: e.target.value })} /></label>
          {picker("People post…", spec.postTypes, (postTypes) => setSpec({ ...spec, postTypes }))}
          {picker("…and reply with (nested)", spec.replyTypes, (replyTypes) => setSpec({ ...spec, replyTypes }))}
          <label className="check small"><input type="checkbox" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} /> show system types</label>
          <div className="row-wrap">
            <label className="field">
              <span className="label">Score with</span>
              <select value={spec.scoreType ?? ""} onChange={(e) => setSpec({ ...spec, scoreType: e.target.value || null })}>
                <option value="">no voting</option>
                {scoreTypes.map((t) => <option key={t.address} value={t.address}>{t.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="label">Home sort</span>
              <select value={spec.sort} onChange={(e) => setSpec({ ...spec, sort: e.target.value as SortKey })}>{SORT_KEYS.map((s) => <option key={s}>{s}</option>)}</select>
            </label>
            <label className="field">
              <span className="label">Reply sort</span>
              <select value={spec.replySort} onChange={(e) => setSpec({ ...spec, replySort: e.target.value as SortKey })}>{SORT_KEYS.map((s) => <option key={s}>{s}</option>)}</select>
            </label>
            <label className="field">
              <span className="label">Replies as</span>
              <select value={spec.replyLayout} onChange={(e) => setSpec({ ...spec, replyLayout: e.target.value as "tree" | "list" })}>
                <option value="tree">nested tree</option>
                <option value="list">flat list</option>
              </select>
            </label>
          </div>

          <details onToggle={(e) => setRaw((e.target as HTMLDetailsElement).open && generated.bundle ? JSON.stringify(generated.bundle, null, 2) : null)}>
            <summary className="small">Edit the generated config as JSON (advanced)</summary>
            <p className="muted small">Actions, then views, then the manifest. "@action:key" and "@view:key" become addresses when published. Blocks: stack, row, grid, text, list, tree, item, event, button, form, link, view.</p>
            {raw !== null && <textarea className="code" rows={24} value={raw} onChange={(e) => setRaw(e.target.value)} />}
          </details>

          {(error ?? (raw === null ? generated.error : null)) && <pre className="error">{error ?? generated.error}</pre>}
          <div className="buttons">
            <button disabled={busy || (raw === null && !generated.bundle)} onClick={() => void save()}>{editId ? "Publish new config" : "Create app"}</button>
          </div>
        </div>
      </section>
    </div>
  );
}
