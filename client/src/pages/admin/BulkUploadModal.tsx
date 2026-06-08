import { useState } from "react";
import { adminFetch } from "@/lib/admin-auth";
import { apiUrl } from "@/lib/queryClient";
import { X, Download, Upload, FileText, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

interface Props {
  token: string;
  onClose: () => void;
  onDone: () => void;
}

interface BulkResult {
  ok: boolean;
  summary: { total: number; created: number; updated: number; failed: number };
  created: { id: number; slug: string; name: string }[];
  updated: { id: number; slug: string; name: string }[];
  errors: { row: number; name?: string; error: string }[];
}

export function BulkUploadModal({ token, onClose, onDone }: Props) {
  const [csv, setCsv] = useState("");
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setFilename(file.name);
    const text = await file.text();
    setCsv(text);
    setResult(null);
    setError(null);
  }

  async function downloadTemplate() {
    // Direct download with auth header — fetch then trigger save
    try {
      const r = await adminFetch(token, "/api/admin/bulk-template.csv");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "narmada-bulk-upload-template.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(`Could not download template: ${e.message}`);
    }
  }

  async function submit() {
    if (!csv.trim()) {
      setError("Paste CSV content or choose a file first");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await adminFetch(token, "/api/admin/products/bulk", {
        method: "POST",
        body: JSON.stringify({ csv }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setResult(data);
      if (data.summary.created > 0 || data.summary.updated > 0) {
        onDone();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-card border rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-card z-10">
          <div>
            <h2 className="font-display text-xl font-bold flex items-center gap-2">
              <Upload className="w-5 h-5 text-accent" /> Bulk Product Upload
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Upload a CSV file to add or update many products at once
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-lg"
            data-testid="button-close-bulk"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Step 1: Download template */}
          <section>
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 bg-accent/15 text-accent border border-accent/30 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                1
              </div>
              <div className="flex-1">
                <h3 className="font-bold mb-1">Download the demo template</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  The template has 3 sample rows and the exact column headers you need.
                  Edit it in Excel or Google Sheets, then save as CSV.
                </p>
                <button
                  onClick={downloadTemplate}
                  className="px-4 py-2 border rounded-lg font-semibold inline-flex items-center gap-2 hover:bg-muted text-sm"
                  data-testid="button-download-template"
                >
                  <Download className="w-4 h-4" /> Download CSV template
                </button>
              </div>
            </div>
          </section>

          {/* Step 2: Format rules */}
          <section>
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 bg-accent/15 text-accent border border-accent/30 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                2
              </div>
              <div className="flex-1">
                <h3 className="font-bold mb-1">Format rules</h3>
                <ul className="text-sm space-y-1.5 text-muted-foreground">
                  <li>
                    <strong className="text-foreground">Required columns:</strong>{" "}
                    <code className="bg-muted px-1.5 py-0.5 rounded text-xs">name</code>,{" "}
                    <code className="bg-muted px-1.5 py-0.5 rounded text-xs">brand</code>,{" "}
                    <code className="bg-muted px-1.5 py-0.5 rounded text-xs">category</code>,{" "}
                    <code className="bg-muted px-1.5 py-0.5 rounded text-xs">price_inr</code>
                  </li>
                  <li>
                    <strong className="text-foreground">brand:</strong> one of{" "}
                    <code className="bg-muted px-1.5 py-0.5 rounded text-xs">tata, bharatbenz, ashok-leyland, eicher, volvo</code>
                  </li>
                  <li>
                    <strong className="text-foreground">image_urls:</strong> paste full https URLs separated by{" "}
                    <code className="bg-muted px-1.5 py-0.5 rounded text-xs">|</code> (pipe character)
                  </li>
                  <li>
                    <strong className="text-foreground">compatible_models:</strong> pipe-separated, e.g.{" "}
                    <code className="bg-muted px-1.5 py-0.5 rounded text-xs">Tata Prima 2523|Tata 3123</code>
                  </li>
                  <li>
                    <strong className="text-foreground">featured / active:</strong> use{" "}
                    <code className="bg-muted px-1.5 py-0.5 rounded text-xs">1</code> or{" "}
                    <code className="bg-muted px-1.5 py-0.5 rounded text-xs">0</code>
                  </li>
                  <li>
                    <strong className="text-foreground">Upsert behavior:</strong> rows with a slug that already exists will <em>update</em> the existing product, not duplicate it
                  </li>
                </ul>
              </div>
            </div>
          </section>

          {/* Step 3: Upload */}
          <section>
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 bg-accent/15 text-accent border border-accent/30 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                3
              </div>
              <div className="flex-1">
                <h3 className="font-bold mb-1">Upload your CSV</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Choose a CSV file or paste contents below.
                </p>

                <label className="block">
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFile(f);
                    }}
                    className="hidden"
                    data-testid="input-bulk-file"
                  />
                  <div className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:bg-muted/50 transition-colors">
                    <FileText className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                    <div className="font-semibold text-sm">
                      {filename || "Click to choose a CSV file"}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      or paste CSV content directly below
                    </div>
                  </div>
                </label>

                <textarea
                  value={csv}
                  onChange={(e) => setCsv(e.target.value)}
                  rows={6}
                  placeholder="name,brand,category,price_inr,description,image_urls&#10;Brake pad set,tata,brake-system,4500,OEM brake pads,https://example.com/img.jpg"
                  className="w-full mt-3 px-3 py-2 border rounded-lg bg-card font-mono text-xs"
                  data-testid="textarea-bulk-csv"
                />
              </div>
            </div>
          </section>

          {/* Error */}
          {error && (
            <div className="p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-800 dark:text-red-200">{error}</div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="p-4 bg-card border rounded-lg">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold">Upload complete</h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div className="p-3 bg-muted/50 rounded">
                  <div className="text-xs uppercase text-muted-foreground font-semibold">Total</div>
                  <div className="text-xl font-bold">{result.summary.total}</div>
                </div>
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded">
                  <div className="text-xs uppercase text-emerald-700 dark:text-emerald-400 font-semibold">Created</div>
                  <div className="text-xl font-bold text-emerald-700 dark:text-emerald-400">{result.summary.created}</div>
                </div>
                <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded">
                  <div className="text-xs uppercase text-blue-700 dark:text-blue-400 font-semibold">Updated</div>
                  <div className="text-xl font-bold text-blue-700 dark:text-blue-400">{result.summary.updated}</div>
                </div>
                <div className="p-3 bg-red-50 dark:bg-red-950/30 rounded">
                  <div className="text-xs uppercase text-red-700 dark:text-red-400 font-semibold">Failed</div>
                  <div className="text-xl font-bold text-red-700 dark:text-red-400">{result.summary.failed}</div>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div className="mt-4">
                  <div className="text-sm font-bold mb-2">Row errors</div>
                  <div className="max-h-40 overflow-y-auto text-xs space-y-1 bg-muted/30 p-3 rounded">
                    {result.errors.map((e, i) => (
                      <div key={i} className="flex gap-2">
                        <span className="text-muted-foreground">Row {e.row}:</span>
                        <span className="text-red-700 dark:text-red-400">{e.error}</span>
                        {e.name && <span className="text-muted-foreground">({e.name})</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex justify-end gap-3 sticky bottom-0 bg-card">
          <button
            onClick={onClose}
            className="px-4 py-2 border rounded-lg font-semibold hover:bg-muted"
            data-testid="button-cancel-bulk"
          >
            Close
          </button>
          <button
            onClick={submit}
            disabled={busy || !csv.trim()}
            className="px-5 py-2 bg-accent text-accent-foreground rounded-lg font-bold inline-flex items-center gap-2 hover:bg-accent/90 disabled:opacity-50"
            data-testid="button-submit-bulk"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {busy ? "Uploading..." : "Upload Products"}
          </button>
        </div>
      </div>
    </div>
  );
}
