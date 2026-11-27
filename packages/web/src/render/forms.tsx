// Forms generated from a schema (05 §4): the creation form of any type, edits,
// and app actions. Validation runs the same schema validator as the server.

import { useState, type FormEvent } from "react";
import type { JsonValue } from "@ev/core/browser";
import { payloadFromForm, type FormField, type FormValues } from "@ev/engine";
import { validate, type Schema } from "@ev/rules/schema";

export function SchemaForm(props: {
  readonly fields: readonly FormField[];
  readonly schema: Schema;
  readonly fixed?: { readonly [k: string]: unknown };
  readonly initial?: FormValues;
  readonly submitLabel: string;
  readonly onSubmit: (payload: { [k: string]: JsonValue }) => Promise<void>;
  readonly onCancel?: () => void;
  readonly compact?: boolean;
}) {
  const [values, setValues] = useState<FormValues>(props.initial ?? {});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fixed = props.fixed ?? {};
  const shown = props.fields.filter((f) => !(f.name in fixed));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const { payload, errors } = payloadFromForm(props.fields, values, fixed);
    const schemaErrors = errors.length > 0 ? [] : validate(props.schema, payload);
    if (errors.length + schemaErrors.length > 0) return setError([...errors, ...schemaErrors].join("; "));
    setBusy(true);
    setError(null);
    try {
      await props.onSubmit(payload);
      setValues(props.initial ?? {});
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const set = (name: string, v: string | boolean) => setValues((old) => ({ ...old, [name]: v }));

  return (
    <form className={props.compact ? "form compact" : "form"} onSubmit={submit}>
      {shown.map((f) => (
        <label key={f.name} className={`field field-${f.kind}`}>
          {!(props.compact && shown.length === 1) && <span className="label">{f.label}{f.required ? "" : " (optional)"}</span>}
          <FieldInput field={f} value={values[f.name]} onChange={(v) => set(f.name, v)} placeholder={props.compact && shown.length === 1 ? f.label : undefined} />
          {f.description && !props.compact && <span className="hint">{f.description}</span>}
        </label>
      ))}
      {error && <div className="error">{error}</div>}
      <div className="buttons">
        <button type="submit" disabled={busy}>{props.submitLabel}</button>
        {props.onCancel && <button type="button" className="ghost" onClick={props.onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function FieldInput({ field: f, value, onChange, placeholder }: { field: FormField; value: string | boolean | undefined; onChange: (v: string | boolean) => void; placeholder?: string | undefined }) {
  const text = typeof value === "string" ? value : "";
  switch (f.kind) {
    case "boolean":
      return <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
    case "enum":
      return (
        <select value={text} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {f.options?.map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
        </select>
      );
    case "text":
    case "json":
      return <textarea rows={f.kind === "json" ? 4 : 3} value={text} placeholder={placeholder ?? (f.kind === "json" ? "JSON" : undefined)} maxLength={f.maxLength} onChange={(e) => onChange(e.target.value)} />;
    case "integer":
      return <input inputMode="numeric" value={text} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
    case "address":
      return <input value={text} placeholder={placeholder ?? "app/batch/user/seq"} onChange={(e) => onChange(e.target.value)} />;
    case "id":
      return <input value={text} placeholder={placeholder ?? "identity id"} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <input value={text} placeholder={placeholder} maxLength={f.maxLength} onChange={(e) => onChange(e.target.value)} />;
  }
}
