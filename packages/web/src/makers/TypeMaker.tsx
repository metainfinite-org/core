// The Type Maker (05 §6, §7): a form that emits a type event, plus its
// default type view (05 §4: every new type is displayable from day one), and
// a generated creation form for any type ("create one"). A new version of a
// type is an edit of the type event; improving someone else's type means
// extending it.

import { useMemo, useState } from "react";
import type { JsonValue } from "@ev/core/browser";
import { autoLayout, formFields, type AppConfigJson, type TypeJson } from "@ev/engine";
import { extendSchema, type Schema } from "@ev/rules/schema";
import { api } from "../api";
import { ConfigError, EventCard, type RenderCtx } from "../render/widgets";
import { SchemaForm } from "../render/forms";
import { href, onLink } from "../router";
import { useApp, useData } from "../state";

type Kind = "short" | "long" | "integer" | "boolean" | "choice" | "address" | "id";
const KINDS: { kind: Kind; label: string }[] = [
  { kind: "short", label: "short text" }, { kind: "long", label: "long text" }, { kind: "integer", label: "whole number" },
  { kind: "boolean", label: "yes / no" }, { kind: "choice", label: "choice" }, { kind: "address", label: "event address" }, { kind: "id", label: "identity" },
];

interface FieldRow { name: string; kind: Kind; required: boolean; choices: string; max: string }

interface Draft {
  name: string;
  extends: string;
  fields: FieldRow[];
  template: string;
  unique: boolean;
  uniqueFamily: boolean;
  refTypes: string[];
  authorIs: boolean;
}

function isObj(v: unknown): v is { [k: string]: JsonValue } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function rowsToSchema(rows: readonly FieldRow[]): { [k: string]: JsonValue } {
  const properties: { [k: string]: JsonValue } = {};
  for (const r of rows) {
    if (!r.name.trim()) continue;
    const max = /^[1-9][0-9]*$/.test(r.max) ? Number(r.max) : undefined;
    let s: { [k: string]: JsonValue };
    switch (r.kind) {
      case "short": s = { type: "string", maxLength: max ?? 300 }; break;
      case "long": s = { type: "string", ...(max ? { maxLength: max } : { maxLength: 40000 }) }; break;
      case "integer": s = { type: "integer" }; break;
      case "boolean": s = { type: "boolean" }; break;
      case "choice": {
        const opts = r.choices.split(",").map((c) => c.trim()).filter(Boolean);
        const ints = opts.every((o) => /^-?(0|[1-9][0-9]*)$/.test(o));
        s = ints ? { type: "integer", enum: opts.map(Number) } : { type: "string", enum: opts };
        break;
      }
      case "address": s = { type: "string", format: "address" }; break;
      case "id": s = { type: "string", format: "id" }; break;
    }
    if (r.kind === "short" || r.kind === "long") s.minLength = r.required ? 1 : 0;
    properties[r.name.trim()] = s;
  }
  const required = rows.filter((r) => r.required && r.name.trim()).map((r) => r.name.trim());
  return { type: "object", ...(required.length ? { required } : {}), properties };
}

function schemaToRows(schema: JsonValue): FieldRow[] {
  if (!isObj(schema) || !isObj(schema.properties)) return [];
  const req = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  return Object.entries(schema.properties).map(([name, s]) => {
    const p = isObj(s) ? s : {};
    const kind: Kind = Array.isArray(p.enum) ? "choice" : p.type === "integer" ? "integer" : p.type === "boolean" ? "boolean"
      : p.format === "address" ? "address" : p.format === "id" ? "id" : typeof p.maxLength === "number" && p.maxLength <= 300 ? "short" : "long";
    return { name, kind, required: req.has(name), choices: Array.isArray(p.enum) ? p.enum.join(", ") : "", max: typeof p.maxLength === "number" && kind === "short" ? String(p.maxLength) : "" };
  });
}

function draftToPayload(d: Draft): { [k: string]: JsonValue } {
  const constraints: JsonValue[] = [];
  if (d.unique) constraints.push({ kind: "unique", per: ["author", "ref"], resolve: "latest", ...(d.uniqueFamily ? { scope: "family" } : {}) });
  if (d.refTypes.length) constraints.push({ kind: "ref_type", types: d.refTypes });
  if (d.authorIs) constraints.push({ kind: "author_is", path: "ref.author" });
  return {
    name: d.name.trim(),
    schema: rowsToSchema(d.fields),
    ...(d.extends ? { extends: d.extends } : {}),
    ...(constraints.length ? { constraints } : {}),
    ...(d.template.trim() ? { extensions: { hints: { display_template: d.template.trim() } } } : {}),
  };
}

function draftFrom(t: TypeJson | null, extendsAddr = ""): Draft {
  if (!t) return { name: "", extends: extendsAddr, fields: [{ name: "title", kind: "short", required: true, choices: "", max: "" }], template: "{title}", unique: false, uniqueFamily: false, refTypes: [], authorIs: false };
  const own = isObj(t.own) ? t.own : {};
  const cons = Array.isArray(own.constraints) ? own.constraints.filter(isObj) : [];
  const unique = cons.find((c) => c.kind === "unique");
  const refType = cons.find((c) => c.kind === "ref_type");
  const hints = isObj(own.extensions) && isObj(own.extensions.hints) ? own.extensions.hints : {};
  return {
    name: t.name,
    extends: typeof own.extends === "string" ? own.extends : "",
    fields: schemaToRows(own.schema ?? {}),
    template: typeof hints.display_template === "string" ? hints.display_template : "",
    unique: !!unique,
    uniqueFamily: unique?.scope === "family",
    refTypes: refType && Array.isArray(refType.types) ? refType.types.map(String) : [],
    authorIs: cons.some((c) => c.kind === "author_is"),
  };
}

type Mode = { kind: "browse"; selected: string | null } | { kind: "edit"; editing: TypeJson | null; extendsAddr: string };

export function TypeMaker({ app, config }: { app: string; config: AppConfigJson }) {
  const { typeList, nameOf } = useApp();
  const [mode, setMode] = useState<Mode>({ kind: "browse", selected: null });
  const [filter, setFilter] = useState("");
  const [showAll, setShowAll] = useState(false);
  const ctx: RenderCtx = { app, config, view: null, nesting: 0 };
  const shown = typeList.filter((t) => (showAll || t.isHead) && t.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="maker">
      <aside className="maker-side card">
        <div className="row-between">
          <h3>Types</h3>
          <button className="small" onClick={() => setMode({ kind: "edit", editing: null, extendsAddr: "" })}>New type</button>
        </div>
        <input placeholder="filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <label className="check small"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> show old versions</label>
        <ul className="type-list">
          {shown.map((t) => (
            <li key={t.address}>
              <button className={`link${mode.kind === "browse" && mode.selected === t.address ? " active" : ""}`} onClick={() => setMode({ kind: "browse", selected: t.address })}>
                {t.name}
              </button>
              <span className="muted small"> {t.usage > 0 ? `${t.usage} · ` : ""}{nameOf(t.author)}{t.isHead ? "" : " · old"}</span>
            </li>
          ))}
        </ul>
        <p className="muted small">Ranked by usage: an ecosystem converges on types people use (05 §3).</p>
      </aside>
      <section className="maker-main">
        {mode.kind === "edit"
          ? <TypeEditor key={`${mode.editing?.address ?? "new"}:${mode.extendsAddr}`} app={app} editing={mode.editing} extendsAddr={mode.extendsAddr} onDone={(a) => setMode({ kind: "browse", selected: a })} onCancel={() => setMode({ kind: "browse", selected: mode.editing?.address ?? null })} />
          : mode.selected
            ? <TypeDetail key={mode.selected} address={mode.selected} ctx={ctx} onEdit={(t) => setMode({ kind: "edit", editing: t, extendsAddr: "" })} onExtend={(t) => setMode({ kind: "edit", editing: null, extendsAddr: t.address })} />
            : <div className="card"><h2>Type Maker</h2><p className="muted">A type is an event: a name, a JSON Schema, an optional base type, constraints, and hints. Pick a type to see it and create instances, or make a new one. Its default type view is created with it.</p></div>}
      </section>
    </div>
  );
}

function TypeDetail({ address, ctx, onEdit, onExtend }: { address: string; ctx: RenderCtx; onEdit: (t: TypeJson) => void; onExtend: (t: TypeJson) => void }) {
  const { types, session, nameOf, changed } = useApp();
  const t = types.get(address);
  const instances = useData(t ? `instances:${address}` : null, () => api.events({ types: [address], sort: "new", limit: 20 }));
  const [ref, setRef] = useState("");
  if (!t) return <div className="muted">Loading…</div>;
  const base = t.extends ? types.get(t.extends) : undefined;
  const mine = session?.me?.id === t.author;
  const own = isObj(t.own) ? t.own : {};
  return (
    <div className="b-stack" style={{ gap: "16px" }}>
      <div className="card">
        <div className="row-between">
          <h2>{t.name}</h2>
          <div className="buttons">
            {mine && t.isHead && <button className="small" onClick={() => onEdit(t)}>New version</button>}
            {session?.me && <button className="small ghost" onClick={() => onExtend(t)}>Extend</button>}
          </div>
        </div>
        <dl className="facts">
          <dt>Address</dt><dd><a href={href.event(t.address)} onClick={onLink(href.event(t.address))}>{t.address}</a></dd>
          <dt>Author</dt><dd>{nameOf(t.author)}</dd>
          {base && <><dt>Extends</dt><dd>{base.name} ({base.address})</dd></>}
          <dt>Version</dt><dd>{t.isHead ? "latest" : <>old; latest is <a href={href.event(t.head)} onClick={onLink(href.event(t.head))}>{t.head}</a></>}</dd>
          <dt>Instances</dt><dd>{t.usage}</dd>
          <dt>Type view</dt><dd>{t.defaultTypeView ?? "none (the auto-renderer shows it)"}</dd>
          {Object.keys(t.hints).length > 0 && <><dt>Hints</dt><dd><code>{JSON.stringify(t.hints)}</code></dd></>}
          {Array.isArray(own.constraints) && <><dt>Constraints</dt><dd><code>{JSON.stringify(own.constraints)}</code></dd></>}
        </dl>
        <details>
          <summary className="muted small">Schema (with inherited fields)</summary>
          <pre className="raw">{JSON.stringify(t.schema, null, 2)}</pre>
        </details>
      </div>
      {session?.me && (
        <div className="card">
          <h3>Create one</h3>
          <p className="muted small">A form generated from the schema, posted through the Type Maker.</p>
          <label className="field"><span className="label">Refers to (optional)</span><input value={ref} placeholder="app/batch/user/seq" onChange={(e) => setRef(e.target.value)} /></label>
          <SchemaForm
            fields={formFields(t.schema)}
            schema={t.schema as Schema}
            submitLabel={`Create ${t.name}`}
            onSubmit={async (payload) => {
              await api.post(ctx.app, { type: t.address, ref: ref.trim() || null, payload });
              changed();
            }}
          />
        </div>
      )}
      <div className="card">
        <h3>Latest instances</h3>
        {instances.data?.items.length === 0 && <div className="muted">None yet.</div>}
        <div className="b-list">
          {instances.data?.items.map((it) => <div className="b-list-item" key={it.address}><EventCard item={it} ctx={ctx} controls /></div>)}
        </div>
      </div>
    </div>
  );
}

function TypeEditor({ app, editing, extendsAddr, onDone, onCancel }: { app: string; editing: TypeJson | null; extendsAddr: string; onDone: (a: string) => void; onCancel: () => void }) {
  const { types, typeList, session, changed } = useApp();
  const [d, setD] = useState<Draft>(() => draftFrom(editing, extendsAddr));
  const [raw, setRaw] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generated = useMemo(() => draftToPayload(d), [d]);
  const set = (patch: Partial<Draft>) => setD((old) => ({ ...old, ...patch }));
  const setRow = (i: number, patch: Partial<FieldRow>) => set({ fields: d.fields.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const heads = typeList.filter((t) => t.isHead);
  const base = d.extends ? types.get(d.extends) : undefined;

  const save = async () => {
    setError(null);
    let payload: { [k: string]: JsonValue };
    try {
      payload = raw === null ? generated : (JSON.parse(raw) as { [k: string]: JsonValue });
    } catch {
      return setError("the JSON doesn't parse");
    }
    if (!payload.name) return setError("give the type a name");
    const own = (payload.schema ?? {}) as Schema;
    const baseType = typeof payload.extends === "string" ? types.get(payload.extends) : undefined;
    const merged = baseType ? extendSchema(baseType.schema as Schema, own) : { schema: own };
    if (merged.error) return setError(merged.error);
    setBusy(true);
    try {
      const r = await api.post(app, { type: session!.genesisTypes.type!, payload, ...(editing ? { ref: editing.address, supersedes: true } : {}) });
      const template = isObj(payload.extensions) && isObj(payload.extensions.hints) && typeof payload.extensions.hints.display_template === "string"
        ? payload.extensions.hints.display_template : (baseType?.hints.display_template as string | undefined) ?? null;
      // The default type view, created together with the type (05 §4).
      await api.post(app, { type: session!.genesisTypes["type-view"]!, payload: { type: r.address, name: "default", layout: autoLayout(merged.schema!, template) as unknown as JsonValue } });
      changed();
      onDone(r.address);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!session?.me) return <ConfigError title="Sign in first" errors={["types are authored by you, through the Type Maker"]} />;

  return (
    <div className="card">
      <h2>{editing ? `New version of ${editing.name}` : base ? `New type extending ${base.name}` : "New type"}</h2>
      {editing && <p className="muted small">A new version is an edit of {editing.address}. Old events keep pointing at the old version.</p>}
      <div className="form">
        <label className="field"><span className="label">Name</span><input value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. question" /></label>
        <label className="field">
          <span className="label">Extends (is-a)</span>
          <select value={d.extends} disabled={!!editing} onChange={(e) => set({ extends: e.target.value })}>
            <option value="">nothing</option>
            {heads.map((t) => <option key={t.address} value={t.address}>{t.name} ({t.address})</option>)}
          </select>
        </label>
        {base && <p className="muted small">Inherits: {Object.keys((base.schema.properties as object) ?? {}).join(", ") || "no fields"}{base.hints.display_template ? `; template ${String(base.hints.display_template)}` : ""}</p>}

        <div className="label">Fields</div>
        <table className="table fields">
          <thead><tr><th>Name</th><th>Kind</th><th>Required</th><th>Choices / max length</th><th /></tr></thead>
          <tbody>
            {d.fields.map((r, i) => (
              <tr key={i}>
                <td><input value={r.name} onChange={(e) => setRow(i, { name: e.target.value.replace(/[^a-zA-Z0-9_]/g, "") })} /></td>
                <td><select value={r.kind} onChange={(e) => setRow(i, { kind: e.target.value as Kind })}>{KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}</select></td>
                <td><input type="checkbox" checked={r.required} onChange={(e) => setRow(i, { required: e.target.checked })} /></td>
                <td>
                  {r.kind === "choice" && <input value={r.choices} placeholder="a, b, c  or  1, -1" onChange={(e) => setRow(i, { choices: e.target.value })} />}
                  {r.kind === "short" && <input value={r.max} placeholder="300" onChange={(e) => setRow(i, { max: e.target.value })} />}
                </td>
                <td><button className="link danger" onClick={() => set({ fields: d.fields.filter((_, j) => j !== i) })}>remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div><button className="small ghost" onClick={() => set({ fields: [...d.fields, { name: "", kind: "short", required: false, choices: "", max: "" }] })}>Add field</button></div>

        <label className="field"><span className="label">Display template</span><input value={d.template} placeholder="{title} by {$author}" onChange={(e) => set({ template: e.target.value })} /></label>

        <div className="label">Constraints</div>
        <label className="check"><input type="checkbox" checked={d.unique} onChange={(e) => set({ unique: e.target.checked })} /> one per author per target (a newer one replaces the older, like changing a vote)</label>
        {d.unique && <label className="check indent"><input type="checkbox" checked={d.uniqueFamily} onChange={(e) => set({ uniqueFamily: e.target.checked })} /> across all subtypes (e.g. one emoji reaction, whichever emoji)</label>}
        <label className="check"><input type="checkbox" checked={d.authorIs} onChange={(e) => set({ authorIs: e.target.checked })} /> only the target's author may emit it (e.g. "accepted answer")</label>
        <details>
          <summary className="small">May only refer to… {d.refTypes.length ? `(${d.refTypes.map((a) => types.get(a)?.name ?? a).join(", ")})` : "(anything)"}</summary>
          <div className="checks">
            {heads.map((t) => (
              <label key={t.address} className="check small">
                <input type="checkbox" checked={d.refTypes.includes(t.address)} onChange={(e) => set({ refTypes: e.target.checked ? [...d.refTypes, t.address] : d.refTypes.filter((x) => x !== t.address) })} /> {t.name}
              </label>
            ))}
          </div>
        </details>

        <details onToggle={(e) => setRaw((e.target as HTMLDetailsElement).open ? JSON.stringify(generated, null, 2) : null)}>
          <summary className="small">Edit as JSON (advanced)</summary>
          {raw !== null && <textarea className="code" rows={14} value={raw} onChange={(e) => setRaw(e.target.value)} />}
        </details>

        {error && <div className="error">{error}</div>}
        <div className="buttons">
          <button disabled={busy} onClick={() => void save()}>{editing ? "Publish new version" : "Create type"}</button>
          <button className="ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
