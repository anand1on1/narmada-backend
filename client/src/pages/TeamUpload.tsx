// R28.1 — Team Upload page.
//
// Public URL: https://narmadamobility.com/#/team-upload
// The page is intentionally NOT linked from any nav — Piyush shares the URL
// + passcode with the sales team on WhatsApp. A small "Team Portal" banner
// at the top tells whoever landed here (say, via a forwarded screenshot)
// that they are in the right place.
//
// Three-step flow, all on one page:
//   1. Passcode gate    — big centred card, one input.
//   2. Chassis metadata + file — brand fixed to Tata (dropdown locked),
//      code / display name / variant / description + file dropzone.
//   3. Result           — success (counts + upload-another) or failure
//      (reason + retry).
//
// Client-side validation is defence-in-depth: the backend re-validates
// every field. The client never puts the passcode into localStorage — the
// state lives only in memory for the current tab.

import { useMemo, useRef, useState } from "react";
import { apiUrl } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Truck, Lock, Upload, CheckCircle2, AlertCircle, FileSpreadsheet, ArrowRight } from "lucide-react";

// -- Constants (mirror the backend defaults; backend still enforces) --------

const MAX_FILE_BYTES = 5 * 1024 * 1024;         // 5 MB
const ALLOWED_EXT = [".xlsx", ".xls", ".csv"];
const CHASSIS_CODE_RE = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_DISPLAY_NAME = 200;
const MAX_VARIANT = 100;
const MAX_DESCRIPTION = 1000;
const PASSCODE_HINT = "Contact Piyush for the current code.";

type Step = "passcode" | "form" | "result";

interface UploadSuccess {
  ok: true;
  chassis: { id: number; slug: string; display_name: string };
  parts: { created: number; updated: number; errors: number; error_details: { row: number; error: string }[] };
  processing_ms: number;
}
interface UploadFailure {
  ok: false;
  status: number;
  message: string;
  retryable: boolean;
}
type UploadResult = UploadSuccess | UploadFailure;

// -- Component --------------------------------------------------------------

export default function TeamUpload() {
  const [step, setStep] = useState<Step>("passcode");
  const [passcode, setPasscode] = useState("");
  const [chassisCode, setChassisCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [variant, setVariant] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Passcode step -----------------------------------------------------
  function submitPasscode(e: React.FormEvent) {
    e.preventDefault();
    if (!passcode.trim()) { setClientError("Enter the passcode to continue."); return; }
    setClientError(null);
    setStep("form");
  }

  // ---- Form step ---------------------------------------------------------
  const chassisCodeValid = useMemo(() => CHASSIS_CODE_RE.test(chassisCode), [chassisCode]);
  const displayNameValid = displayName.trim().length > 0 && displayName.length <= MAX_DISPLAY_NAME;
  const variantValid = variant.length <= MAX_VARIANT;
  const descriptionValid = description.length <= MAX_DESCRIPTION;
  const fileValid = !!file && file.size > 0 && file.size <= MAX_FILE_BYTES &&
    ALLOWED_EXT.some((e) => file.name.toLowerCase().endsWith(e));
  const canSubmit = chassisCodeValid && displayNameValid && variantValid && descriptionValid && fileValid && !submitting;

  function onFileSelected(f: File | null) {
    setClientError(null);
    if (!f) { setFile(null); return; }
    if (f.size > MAX_FILE_BYTES) {
      setClientError(`File is ${(f.size / 1024 / 1024).toFixed(2)} MB — max is 5 MB.`);
      setFile(null);
      return;
    }
    if (!ALLOWED_EXT.some((e) => f.name.toLowerCase().endsWith(e))) {
      setClientError(`File type not allowed. Use ${ALLOWED_EXT.join(", ")}.`);
      setFile(null);
      return;
    }
    setFile(f);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFileSelected(f);
  }

  async function submitUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !file) return;
    setSubmitting(true);
    setClientError(null);
    try {
      const fd = new FormData();
      fd.append("passcode", passcode);
      fd.append("chassis_code", chassisCode.trim());
      fd.append("chassis_display_name", displayName.trim());
      if (variant.trim()) fd.append("variant", variant.trim());
      if (description.trim()) fd.append("description", description.trim());
      fd.append("file", file);
      const res = await fetch(apiUrl("/api/team-upload/chassis"), { method: "POST", body: fd });
      const text = await res.text();
      let body: any = {};
      try { body = text ? JSON.parse(text) : {}; } catch { /* keep default */ }
      if (res.ok && body?.ok) {
        setResult({ ok: true, ...body } as UploadSuccess);
      } else {
        setResult(buildFailure(res.status, body));
      }
      setStep("result");
    } catch (err: any) {
      setResult(buildFailure(0, { error: "network_error", message: err?.message || "Network error" }));
      setStep("result");
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Reset for another upload ------------------------------------------
  function resetForAnother() {
    setChassisCode("");
    setDisplayName("");
    setVariant("");
    setDescription("");
    setFile(null);
    setResult(null);
    setClientError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setStep("form");
  }

  function downloadTemplate() {
    // Try the backend admin template (works if PARTS_FINDER_ENABLED served
    // it publicly). If it 401s, we fall back to a client-side minimal CSV.
    const url = apiUrl("/api/admin/chassis/parts-template.xlsx");
    // Best-effort: open in new tab; admins can also send a local template.
    window.open(url, "_blank");
  }

  // ---- Render ------------------------------------------------------------
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Team portal banner — helps landers identify the page */}
      <div className="bg-slate-900 text-white text-center text-xs sm:text-sm py-2 px-3">
        <span className="inline-flex items-center gap-2">
          <Truck className="w-4 h-4" />
          <span>Narmada Mobility &mdash; Team Portal</span>
        </span>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-2xl">
          {step === "passcode" && (
            <PasscodeStep
              passcode={passcode}
              onChange={setPasscode}
              onSubmit={submitPasscode}
              error={clientError}
            />
          )}
          {step === "form" && (
            <FormStep
              chassisCode={chassisCode}
              setChassisCode={setChassisCode}
              displayName={displayName}
              setDisplayName={setDisplayName}
              variant={variant}
              setVariant={setVariant}
              description={description}
              setDescription={setDescription}
              file={file}
              onFileSelected={onFileSelected}
              onDrop={onDrop}
              dragging={dragging}
              setDragging={setDragging}
              submitting={submitting}
              canSubmit={canSubmit}
              onSubmit={submitUpload}
              onDownloadTemplate={downloadTemplate}
              chassisCodeValid={chassisCodeValid}
              displayNameValid={displayNameValid}
              descriptionValid={descriptionValid}
              variantValid={variantValid}
              fileValid={fileValid}
              clientError={clientError}
              fileInputRef={fileInputRef}
            />
          )}
          {step === "result" && result && (
            <ResultStep result={result} onAnother={resetForAnother} onRetry={() => setStep("form")} />
          )}
        </div>
      </div>

      <footer className="text-center text-xs text-slate-500 py-4">
        &copy; {new Date().getFullYear()} Narmada Mobility &middot; Internal team upload
      </footer>
    </div>
  );
}

// -- Sub-components ---------------------------------------------------------

function PasscodeStep(props: {
  passcode: string;
  onChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  error: string | null;
}) {
  return (
    <Card className="p-6 sm:p-8">
      <div className="flex flex-col items-center text-center mb-6">
        <img src="/logo-transparent.png" alt="Narmada Mobility" className="w-16 h-16 mb-3" />
        <h1 className="text-2xl font-bold text-slate-900">Team Upload</h1>
        <p className="text-sm text-slate-600 mt-1">
          Upload a chassis catalog Excel to Narmada. Ask Piyush for the passcode if you don&apos;t have one.
        </p>
      </div>
      <form onSubmit={props.onSubmit} className="space-y-4">
        <div>
          <Label htmlFor="passcode">Team passcode</Label>
          <div className="relative mt-1">
            <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              id="passcode"
              type="password"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={props.passcode}
              onChange={(e) => props.onChange(e.target.value)}
              className="pl-9"
              placeholder="Enter passcode"
              data-testid="team-upload-passcode"
            />
          </div>
        </div>
        {props.error && (
          <p className="text-sm text-red-600" data-testid="team-upload-client-error">{props.error}</p>
        )}
        <Button type="submit" className="w-full">Continue <ArrowRight className="ml-1 w-4 h-4" /></Button>
      </form>
    </Card>
  );
}

interface FormStepProps {
  chassisCode: string; setChassisCode: (v: string) => void;
  displayName: string; setDisplayName: (v: string) => void;
  variant: string; setVariant: (v: string) => void;
  description: string; setDescription: (v: string) => void;
  file: File | null;
  onFileSelected: (f: File | null) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  dragging: boolean; setDragging: (v: boolean) => void;
  submitting: boolean; canSubmit: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onDownloadTemplate: () => void;
  chassisCodeValid: boolean;
  displayNameValid: boolean;
  descriptionValid: boolean;
  variantValid: boolean;
  fileValid: boolean;
  clientError: string | null;
  fileInputRef: React.RefObject<HTMLInputElement>;
}

function FormStep(p: FormStepProps) {
  return (
    <Card className="p-6 sm:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Upload chassis catalog</h1>
        <p className="text-sm text-slate-600 mt-1">
          Fill in the chassis details and attach an Excel or CSV of parts. Max 5 MB, up to 1000 rows.
        </p>
      </div>

      <form onSubmit={p.onSubmit} className="space-y-4">
        {/* Brand — locked to Tata */}
        <div>
          <Label htmlFor="brand">Brand</Label>
          <select
            id="brand"
            className="mt-1 w-full h-10 rounded-md border border-slate-300 bg-slate-100 text-slate-700 px-3 text-sm cursor-not-allowed"
            value="TATA"
            disabled
            data-testid="team-upload-brand"
          >
            <option value="TATA">Tata (only supported brand right now)</option>
          </select>
          <p className="text-xs text-slate-500 mt-1">More brands will be added soon.</p>
        </div>

        {/* Chassis code */}
        <div>
          <Label htmlFor="chassis_code">Chassis code *</Label>
          <Input
            id="chassis_code"
            className="mt-1"
            value={p.chassisCode}
            onChange={(e) => p.setChassisCode(e.target.value)}
            placeholder="e.g. TATA-407-EX2"
            maxLength={100}
            data-testid="team-upload-chassis-code"
          />
          <p className={`text-xs mt-1 ${p.chassisCode && !p.chassisCodeValid ? "text-red-600" : "text-slate-500"}`}>
            Alphanumeric, dashes, and underscores only. Max 100 chars.
          </p>
        </div>

        {/* Display name */}
        <div>
          <Label htmlFor="chassis_display_name">Chassis display name *</Label>
          <Input
            id="chassis_display_name"
            className="mt-1"
            value={p.displayName}
            onChange={(e) => p.setDisplayName(e.target.value)}
            placeholder="e.g. Tata 407 EX2 BS6"
            maxLength={MAX_DISPLAY_NAME}
            data-testid="team-upload-display-name"
          />
          <p className="text-xs text-slate-500 mt-1">{p.displayName.length}/{MAX_DISPLAY_NAME}</p>
        </div>

        {/* Variant */}
        <div>
          <Label htmlFor="variant">Variant (optional)</Label>
          <Input
            id="variant"
            className="mt-1"
            value={p.variant}
            onChange={(e) => p.setVariant(e.target.value)}
            placeholder="e.g. BS6"
            maxLength={MAX_VARIANT}
            data-testid="team-upload-variant"
          />
        </div>

        {/* Description */}
        <div>
          <Label htmlFor="description">Description (optional)</Label>
          <Textarea
            id="description"
            className="mt-1"
            value={p.description}
            onChange={(e) => p.setDescription(e.target.value)}
            placeholder="Notes about this chassis (engine, application, etc.)"
            rows={3}
            maxLength={MAX_DESCRIPTION}
            data-testid="team-upload-description"
          />
          <p className="text-xs text-slate-500 mt-1">{p.description.length}/{MAX_DESCRIPTION}</p>
        </div>

        {/* Template download */}
        <div>
          <button
            type="button"
            onClick={p.onDownloadTemplate}
            className="text-sm text-blue-600 underline hover:text-blue-800"
            data-testid="team-upload-download-template"
          >
            Download parts template
          </button>
        </div>

        {/* File dropzone */}
        <div>
          <Label>Parts file *</Label>
          <div
            className={`mt-1 border-2 border-dashed rounded-md p-6 text-center transition-colors ${
              p.dragging ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-slate-50"
            }`}
            onDragEnter={(e) => { e.preventDefault(); p.setDragging(true); }}
            onDragOver={(e) => { e.preventDefault(); p.setDragging(true); }}
            onDragLeave={() => p.setDragging(false)}
            onDrop={p.onDrop}
            data-testid="team-upload-dropzone"
          >
            <FileSpreadsheet className="w-8 h-8 mx-auto text-slate-400 mb-2" />
            {p.file ? (
              <div>
                <p className="text-sm font-medium text-slate-800">{p.file.name}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {(p.file.size / 1024).toFixed(1)} KB &middot; {p.file.type || "unknown type"}
                </p>
                <button
                  type="button"
                  className="text-xs text-red-600 underline mt-2"
                  onClick={() => { p.onFileSelected(null); if (p.fileInputRef.current) p.fileInputRef.current.value = ""; }}
                >
                  Remove
                </button>
              </div>
            ) : (
              <>
                <p className="text-sm text-slate-600">Drop your Excel or CSV here, or</p>
                <button
                  type="button"
                  className="text-sm text-blue-600 underline mt-1"
                  onClick={() => p.fileInputRef.current?.click()}
                >
                  browse to select
                </button>
              </>
            )}
            <input
              ref={p.fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => p.onFileSelected(e.target.files?.[0] || null)}
              data-testid="team-upload-file-input"
            />
          </div>
          <p className="text-xs text-slate-500 mt-1">.xlsx, .xls, or .csv &middot; max 5 MB, up to 1000 rows.</p>
        </div>

        {p.clientError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{p.clientError}</span>
          </div>
        )}

        <Button
          type="submit"
          disabled={!p.canSubmit}
          className="w-full"
          data-testid="team-upload-submit"
        >
          {p.submitting ? (
            <span className="inline-flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" />
              Uploading&hellip;
            </span>
          ) : (
            <span className="inline-flex items-center gap-2">
              <Upload className="w-4 h-4" />
              Upload catalog
            </span>
          )}
        </Button>
      </form>
    </Card>
  );
}

function ResultStep(p: { result: UploadResult; onAnother: () => void; onRetry: () => void }) {
  if (p.result.ok) {
    return (
      <Card className="p-6 sm:p-8 border-2 border-green-200 bg-green-50">
        <div className="flex flex-col items-center text-center">
          <CheckCircle2 className="w-12 h-12 text-green-600 mb-3" />
          <h1 className="text-2xl font-bold text-green-900">Upload complete</h1>
          <p className="text-sm text-green-800 mt-2">
            <strong>{p.result.chassis.display_name}</strong> is saved. Sales was notified by email.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center w-full max-w-md">
            <StatBox label="Created" value={p.result.parts.created} tone="green" />
            <StatBox label="Updated" value={p.result.parts.updated} tone="blue" />
            <StatBox label="Errors" value={p.result.parts.errors} tone={p.result.parts.errors > 0 ? "amber" : "slate"} />
          </div>
          {p.result.parts.errors > 0 && (
            <details className="w-full mt-4 text-left">
              <summary className="text-sm text-amber-800 cursor-pointer">
                {p.result.parts.errors} rows had errors (click to see)
              </summary>
              <ul className="mt-2 max-h-48 overflow-y-auto text-xs bg-white/60 rounded-md p-2 border border-amber-200">
                {p.result.parts.error_details.map((err, idx) => (
                  <li key={idx} className="py-0.5">
                    <span className="font-mono">row {err.row}</span>: {err.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <Button className="mt-6" onClick={p.onAnother} data-testid="team-upload-another">
            Upload another
          </Button>
        </div>
      </Card>
    );
  }
  return (
    <Card className="p-6 sm:p-8 border-2 border-red-200 bg-red-50">
      <div className="flex flex-col items-center text-center">
        <AlertCircle className="w-12 h-12 text-red-600 mb-3" />
        <h1 className="text-2xl font-bold text-red-900">Upload failed</h1>
        <p className="text-sm text-red-800 mt-2 max-w-md">{p.result.message}</p>
        {p.result.retryable && (
          <Button className="mt-6" onClick={p.onRetry} data-testid="team-upload-retry">
            Try again
          </Button>
        )}
      </div>
    </Card>
  );
}

function StatBox(p: { label: string; value: number; tone: "green" | "blue" | "amber" | "slate" }) {
  const toneClass = {
    green: "text-green-800 bg-white/70 border-green-200",
    blue: "text-blue-800 bg-white/70 border-blue-200",
    amber: "text-amber-800 bg-white/70 border-amber-200",
    slate: "text-slate-700 bg-white/60 border-slate-200",
  }[p.tone];
  return (
    <div className={`p-3 rounded-md border ${toneClass}`}>
      <div className="text-2xl font-bold">{p.value}</div>
      <div className="text-xs uppercase tracking-wide mt-1">{p.label}</div>
    </div>
  );
}

// -- Failure message mapping ------------------------------------------------

function buildFailure(status: number, body: any): UploadFailure {
  const err = String(body?.error || "").toLowerCase();
  if (status === 401 || err === "invalid_passcode") {
    return { ok: false, status, message: `Invalid passcode. ${PASSCODE_HINT}`, retryable: true };
  }
  if (status === 429 || err === "rate_limited") {
    const secs = Number(body?.retry_after_seconds || 3600);
    const mins = Math.max(1, Math.ceil(secs / 60));
    return { ok: false, status, message: `Too many uploads from your network. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`, retryable: false };
  }
  if (status === 503 || err === "feature_disabled") {
    return { ok: false, status, message: "Upload is currently paused. Try again later or contact Piyush.", retryable: false };
  }
  if (status === 413 || err === "file_too_large") {
    return { ok: false, status, message: "File is too large. Max size is 5 MB.", retryable: true };
  }
  if (status === 415 || err === "invalid_file_type" || err === "file_content_does_not_match_extension") {
    return { ok: false, status, message: "File type not allowed or file contents don't match its extension. Use a real .xlsx / .xls / .csv.", retryable: true };
  }
  if (err === "too_many_rows") {
    return { ok: false, status, message: `Too many rows. Max is ${body?.max || 1000}.`, retryable: true };
  }
  if (err === "invalid_input") {
    return { ok: false, status, message: `Invalid ${body?.field || "input"}. Check the form and try again.`, retryable: true };
  }
  if (err === "network_error" || status === 0) {
    return { ok: false, status, message: "Couldn't reach the server. Check your internet and try again.", retryable: true };
  }
  return { ok: false, status, message: body?.error ? `Upload failed: ${body.error}` : "Upload failed. Please try again.", retryable: true };
}
