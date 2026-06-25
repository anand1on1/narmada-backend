// PartSetu AI R27.24a3.1 — Tata catalog cover-page "Chassis Type" extractor.
//
// Every Tata Motors catalog PDF has a cover spec table with a labeled row
// `Chassis Type` holding the 6-char VDS code (e.g. 505409) — the field a
// customer types (or photographs) to identify their vehicle. This module pulls
// that value out of the first-page text so the ingest pipeline can seed the
// UVI resolver's chassis_type / vds identifiers.
//
// Pure + dependency-free so it can be unit-tested and reused by the backfill
// script.

// Label variants Tata uses across catalog generations (incl. the common
// "Chasis" misspelling). Order matters: the most specific labels are tried
// first when several appear.
const LABELS = ["chassis type", "chasis type", "chassis code", "chassis no", "chasis no"];
const LABEL_ALT = LABELS.map((l) => l.replace(/ /g, "\\s+")).join("|");
// `\s*` after the label spans an optional newline, so this single pattern
// covers both inline ("Chassis Type 505409") and own-line ("Chassis Type\n505409")
// table layouts. The value is the first 4-10 char alphanumeric run that follows.
const MATCH_RE = new RegExp(`(?:${LABEL_ALT})\\s*[:|]?\\s*([A-Z0-9]{4,10})\\b`, "ig");

function isFalsePositive(value: string): boolean {
  const v = value.toUpperCase();
  if (/^(\w)\1+$/.test(v)) return true;                 // all same char (000000, 111111)
  if (/^(?:19[5-9]\d|20\d\d)$/.test(v)) return true;     // looks like a year
  if (v.length >= 11 || /R$/.test(v) || /000R$/.test(v)) return true; // looks like a VC No
  if (/TYPE|MODEL|ENGINE/.test(v)) return true;          // captured a label word, not a value
  return false;
}

export function extractChassisType(firstPageText: string): { value: string | null; rawMatch: string | null } {
  if (!firstPageText) return { value: null, rawMatch: null };
  // Collapse runs of spaces/tabs to a single space but keep line breaks.
  const text = String(firstPageText).replace(/[ \t]+/g, " ");
  MATCH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MATCH_RE.exec(text)) !== null) {
    const candidate = (m[1] || "").toUpperCase().trim();
    if (candidate && !isFalsePositive(candidate)) {
      return { value: candidate, rawMatch: m[0].replace(/\s+/g, " ").trim() };
    }
  }
  return { value: null, rawMatch: null };
}
