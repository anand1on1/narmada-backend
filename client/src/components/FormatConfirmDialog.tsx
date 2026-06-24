// PartSetu R27.22 — confirm dialog for AI-driven format detection.
// One component, two modes:
//   • mode="xref"    — edit the per-sheet column mapping plan before ingest.
//   • mode="catalog" — edit the extracted catalog metadata before ingest.
// Tabs: "Detected Mapping" (editable) | "Raw Preview" (the parsed file preview).
// Footer: Confirm & Ingest (green) | Cancel | Skip Detection (legacy handlers).
// Plain Tailwind (matching the admin pages) — no shadcn primitives.
import { useState } from "react";
import { X, CheckCircle2, AlertTriangle } from "lucide-react";

// ---- Shared types (mirror the server detector responses) ----
export interface XrefSheetPlan {
  name: string; action: "ingest" | "skip"; source_brand?: string;
  source_col?: number; customer_col?: number; desc_col?: number; header_row?: number; reason?: string;
}
export interface XrefMappingPlan { file_brand: string; layout?: string; confidence?: number; sheets: XrefSheetPlan[]; }
export interface XrefSheetPreview { sheet: string; rows: string[][]; }

export interface CatalogMetadata {
  oem?: string | null; model?: string | null; variant?: string | null;
  chassis_no?: string | null; vc_no?: string | null;
  emission_stage?: string | null; body_type?: string | null; drive_type?: string | null;
  tyre_count?: number | null; fuel_type?: string | null; engine_family?: string | null;
  short_desc?: string | null; long_desc?: string | null;
}

const BRANDS = ["", "TML", "AL", "Eicher", "BharatBenz", "Volvo", "SML", "AMW", "BEML", "Caterpillar", "Escorts", "ManForce", "FML", "EML", "OEM"];

function confidenceBadge(conf: number | null | undefined) {
  if (conf == null) return { cls: "bg-slate-500/15 text-slate-700", label: "No confidence" };
  if (conf >= 0.9) return { cls: "bg-emerald-500/15 text-emerald-700", label: `High (${conf.toFixed(2)})` };
  if (conf >= 0.7) return { cls: "bg-amber-500/15 text-amber-700", label: `Medium (${conf.toFixed(2)})` };
  return { cls: "bg-rose-500/15 text-rose-700", label: `Low (${conf.toFixed(2)})` };
}

type Tab = "mapping" | "preview";

interface BaseProps {
  busy?: boolean;
  cached?: boolean;
  onCancel: () => void;
  onSkip: () => void;
}

interface XrefProps extends BaseProps {
  mode: "xref";
  plan: XrefMappingPlan | null;
  preview: XrefSheetPreview[];
  confidence?: number | null;
  onConfirm: (plan: XrefMappingPlan, edited: boolean) => void;
}

interface CatalogProps extends BaseProps {
  mode: "catalog";
  metadata: CatalogMetadata | null;
  snippets: string[];
  confidence?: number | null;
  onConfirm: (metadata: CatalogMetadata, edited: boolean) => void;
}

export type FormatConfirmDialogProps = XrefProps | CatalogProps;

export default function FormatConfirmDialog(props: FormatConfirmDialogProps) {
  const [tab, setTab] = useState<Tab>("mapping");
  const [edited, setEdited] = useState(false);

  const confidence = props.confidence ?? (props.mode === "xref" ? props.plan?.confidence : null) ?? null;
  const badge = confidenceBadge(confidence);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" data-testid="format-confirm-dialog">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col border">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold">
              {props.mode === "xref" ? "Confirm cross-reference mapping" : "Confirm catalog metadata"}
            </h2>
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${badge.cls}`} data-testid="confidence-badge">{badge.label}</span>
            {props.cached && <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-500/15 text-blue-700">Cached</span>}
          </div>
          <button onClick={props.onCancel} className="text-muted-foreground hover:text-foreground" data-testid="dialog-close"><X className="w-5 h-5" /></button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-3 border-b">
          <button
            onClick={() => setTab("mapping")}
            className={`px-3 py-1.5 text-sm font-medium rounded-t-lg ${tab === "mapping" ? "bg-muted text-foreground" : "text-muted-foreground"}`}
            data-testid="tab-mapping"
          >Detected Mapping</button>
          <button
            onClick={() => setTab("preview")}
            className={`px-3 py-1.5 text-sm font-medium rounded-t-lg ${tab === "preview" ? "bg-muted text-foreground" : "text-muted-foreground"}`}
            data-testid="tab-preview"
          >Raw Preview</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-5">
          {props.mode === "xref"
            ? <XrefBody {...props} tab={tab} markEdited={() => setEdited(true)} />
            : <CatalogBody {...props} tab={tab} markEdited={() => setEdited(true)} />}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t gap-2">
          <button
            onClick={props.onSkip}
            disabled={props.busy}
            className="text-sm text-muted-foreground hover:underline disabled:opacity-50"
            data-testid="button-skip-detection"
          >Skip Detection (use legacy handlers)</button>
          <div className="flex items-center gap-2">
            <button
              onClick={props.onCancel}
              disabled={props.busy}
              className="px-3 py-1.5 rounded-lg border text-sm font-medium disabled:opacity-50"
              data-testid="button-cancel"
            >Cancel</button>
            <button
              onClick={() => props.mode === "xref"
                ? (props.plan && props.onConfirm(props.plan, edited))
                : props.onConfirm((props as CatalogProps).metadata || {}, edited)}
              disabled={props.busy || (props.mode === "xref" && !props.plan)}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50"
              data-testid="button-confirm-ingest"
            >
              <CheckCircle2 className="w-4 h-4" /> {props.busy ? "Ingesting…" : "Confirm & Ingest"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Xref editable mapping ----
function XrefBody(props: XrefProps & { tab: Tab; markEdited: () => void }) {
  const { plan, preview, tab, markEdited } = props;
  // Local mutation: mutate the plan object in place (parent holds the same ref it
  // passed to onConfirm). We force a re-render via a tick counter.
  const [, setTick] = useState(0);
  const bump = () => { markEdited(); setTick((t) => t + 1); };

  if (tab === "preview") return <RawPreview preview={preview} />;

  if (!plan) {
    return (
      <div className="flex items-start gap-2 text-sm text-amber-700">
        <AlertTriangle className="w-4 h-4 mt-0.5" />
        <span>No mapping could be detected (AI unavailable or low confidence). Use "Skip Detection" to fall back to the deterministic handlers.</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="font-medium">File brand (seller):</label>
        <input
          value={plan.file_brand}
          onChange={(e) => { plan.file_brand = e.target.value; bump(); }}
          className="border rounded-lg px-2 py-1 bg-background w-40"
          data-testid="input-file-brand"
        />
        {plan.layout && <span className="text-xs text-muted-foreground">Layout: {plan.layout}</span>}
      </div>
      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-2 py-1.5 font-semibold">Sheet</th>
              <th className="px-2 py-1.5 font-semibold">Action</th>
              <th className="px-2 py-1.5 font-semibold">Source brand</th>
              <th className="px-2 py-1.5 font-semibold">Source col</th>
              <th className="px-2 py-1.5 font-semibold">Seller col</th>
              <th className="px-2 py-1.5 font-semibold">Desc col</th>
              <th className="px-2 py-1.5 font-semibold">Header row</th>
              <th className="px-2 py-1.5 font-semibold">Reason</th>
            </tr>
          </thead>
          <tbody>
            {plan.sheets.map((s, i) => (
              <tr key={i} className="border-t" data-testid={`mapping-row-${i}`}>
                <td className="px-2 py-1.5 font-medium">{s.name}</td>
                <td className="px-2 py-1.5">
                  <select
                    value={s.action}
                    onChange={(e) => { s.action = e.target.value as "ingest" | "skip"; bump(); }}
                    className="border rounded px-1 py-0.5 bg-background"
                    data-testid={`select-action-${i}`}
                  >
                    <option value="ingest">ingest</option>
                    <option value="skip">skip</option>
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <select
                    value={s.source_brand ?? ""}
                    onChange={(e) => { s.source_brand = e.target.value || undefined; bump(); }}
                    className="border rounded px-1 py-0.5 bg-background"
                    data-testid={`select-brand-${i}`}
                  >
                    {BRANDS.map((b) => <option key={b} value={b}>{b || "(auto)"}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1.5"><NumCell value={s.source_col} onChange={(v) => { s.source_col = v; bump(); }} testid={`num-source-${i}`} /></td>
                <td className="px-2 py-1.5"><NumCell value={s.customer_col} onChange={(v) => { s.customer_col = v; bump(); }} testid={`num-customer-${i}`} /></td>
                <td className="px-2 py-1.5"><NumCell value={s.desc_col} onChange={(v) => { s.desc_col = v; bump(); }} testid={`num-desc-${i}`} /></td>
                <td className="px-2 py-1.5"><NumCell value={s.header_row} onChange={(v) => { s.header_row = v; bump(); }} testid={`num-header-${i}`} /></td>
                <td className="px-2 py-1.5 text-muted-foreground max-w-[12rem] truncate" title={s.reason || ""}>{s.reason || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NumCell(props: { value?: number; onChange: (v: number | undefined) => void; testid: string }) {
  return (
    <input
      type="number"
      value={props.value ?? ""}
      onChange={(e) => props.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
      className="border rounded px-1 py-0.5 bg-background w-16"
      data-testid={props.testid}
    />
  );
}

// ---- Catalog editable metadata ----
const CATALOG_FIELDS: Array<{ key: keyof CatalogMetadata; label: string; numeric?: boolean }> = [
  { key: "oem", label: "OEM" },
  { key: "model", label: "Model" },
  { key: "variant", label: "Variant" },
  { key: "vc_no", label: "VC No" },
  { key: "chassis_no", label: "Chassis No" },
  { key: "emission_stage", label: "Emission stage" },
  { key: "body_type", label: "Body type" },
  { key: "drive_type", label: "Drive type" },
  { key: "tyre_count", label: "Tyre count", numeric: true },
  { key: "fuel_type", label: "Fuel type" },
  { key: "engine_family", label: "Engine family" },
];

function CatalogBody(props: CatalogProps & { tab: Tab; markEdited: () => void }) {
  const { metadata, snippets, tab, markEdited } = props;
  const [, setTick] = useState(0);
  const m = metadata || {};
  const bump = () => { markEdited(); setTick((t) => t + 1); };

  if (tab === "preview") {
    return (
      <div className="text-xs font-mono whitespace-pre-wrap leading-relaxed" data-testid="catalog-snippets">
        {snippets && snippets.length ? snippets.join("\n") : "No preview text extracted."}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {CATALOG_FIELDS.map((f) => (
        <div key={String(f.key)} className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">{f.label}</label>
          <input
            type={f.numeric ? "number" : "text"}
            value={(m[f.key] as any) ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              (m as any)[f.key] = f.numeric ? (v === "" ? null : Number(v)) : (v === "" ? null : v);
              bump();
            }}
            className="border rounded-lg px-2 py-1 bg-background text-sm"
            data-testid={`catalog-field-${String(f.key)}`}
          />
        </div>
      ))}
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label className="text-xs font-medium text-muted-foreground">Short description</label>
        <input
          value={m.short_desc ?? ""}
          onChange={(e) => { (m as any).short_desc = e.target.value || null; bump(); }}
          className="border rounded-lg px-2 py-1 bg-background text-sm"
          data-testid="catalog-field-short_desc"
        />
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label className="text-xs font-medium text-muted-foreground">Long description</label>
        <textarea
          value={m.long_desc ?? ""}
          onChange={(e) => { (m as any).long_desc = e.target.value || null; bump(); }}
          rows={3}
          className="border rounded-lg px-2 py-1 bg-background text-sm"
          data-testid="catalog-field-long_desc"
        />
      </div>
    </div>
  );
}

function RawPreview({ preview }: { preview: XrefSheetPreview[] }) {
  if (!preview || !preview.length) return <div className="text-sm text-muted-foreground">No preview available.</div>;
  return (
    <div className="space-y-4">
      {preview.map((p, i) => (
        <div key={i} data-testid={`preview-sheet-${i}`}>
          <div className="text-xs font-semibold mb-1">{p.sheet}</div>
          <div className="overflow-x-auto border rounded-lg">
            <table className="text-xs">
              <tbody>
                {p.rows.map((row, ri) => (
                  <tr key={ri} className={ri === 0 ? "bg-muted/40 font-medium" : "border-t"}>
                    {row.map((cell, ci) => <td key={ci} className="px-2 py-1 whitespace-nowrap max-w-[12rem] truncate" title={cell}>{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
