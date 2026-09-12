// R28.10 Bug 2 diagnostic — do NOT delete. Verifies Tata xlsx row count.
// Run: npx tsx test-chassis-parse.ts
import * as XLSX from "xlsx";
import * as fs from "fs";

const FILE = "/home/user/workspace/uploaded_attachments/7f2e2761b10b4e4ea2ec93c43bc1c054/2089837_50138856000R_466611.xlsx";
const buf = fs.readFileSync(FILE);
const wb = XLSX.read(buf, { type: "buffer" });
const sheetName = wb.SheetNames[0];
const ws = wb.Sheets[sheetName];
console.log("[diag] sheet:", sheetName, "!ref:", ws["!ref"]);

const naive = XLSX.utils.sheet_to_json(ws, { defval: "", raw: true }) as any[];
console.log("[diag] naive sheet_to_json count:", naive.length);
console.log("[diag] naive[0] keys:", naive[0] ? Object.keys(naive[0]) : "empty");

// Walk cell keys to find true max row
const cellKeys = Object.keys(ws).filter((k) => /^[A-Z]+\d+$/.test(k));
let maxRow = 0;
for (const k of cellKeys) {
  const m = k.match(/\d+/);
  if (m) maxRow = Math.max(maxRow, parseInt(m[0], 10));
}
console.log("[diag] max cell row (1-indexed):", maxRow);

// Try expanding !ref
const range = XLSX.utils.decode_range(ws["!ref"]);
console.log("[diag] decoded range: rows", range.s.r, "to", range.e.r, "cols", range.s.c, "to", range.e.c);

if (maxRow - 1 > range.e.r) {
  console.log("[diag] BUG CONFIRMED: !ref underreports rows. Expanding to row", maxRow - 1);
  range.e.r = maxRow - 1;
  ws["!ref"] = XLSX.utils.encode_range(range);
  const fixed = XLSX.utils.sheet_to_json(ws, { defval: "", raw: true }) as any[];
  console.log("[diag] AFTER FIX naive count:", fixed.length);
}

// Walk aoa to find header row and count parts using the same logic as extractPartRows
console.log("\n--- extractPartRows equivalent ---");
const canonicalizeHeader = (raw: any): string => {
  const norm = String(raw || "").trim().toLowerCase().replace(/[.:;]+$/g, "").replace(/\s+/g, " ").trim();
  const underscored = norm.replace(/\s+/g, "_");
  if (["part_number","part number","partnumber","pn","part no","part_no","partno","part-no"].includes(norm) || ["part_number","partnumber","pn","part_no","partno","part-no"].includes(underscored)) return "part_number";
  return underscored;
};
const raw = XLSX.utils.sheet_to_json(ws, { defval: "", raw: true, header: 1 }) as any[][];
console.log("[diag] aoa row count:", raw.length);
let headerIdx = -1;
for (let i = 0; i < Math.min(raw.length, 40); i++) {
  const row = raw[i];
  if (!row) continue;
  const anyPartNumberCol = row.some((c) => canonicalizeHeader(c) === "part_number");
  if (anyPartNumberCol) { headerIdx = i; console.log("[diag] header row found at index", i, "row:", row); break; }
}
if (headerIdx < 0) {
  console.log("[diag] no header row found in first 40 rows. Sample rows:");
  for (let i = 0; i < Math.min(10, raw.length); i++) console.log(" row", i, ":", raw[i]);
} else {
  const headers = raw[headerIdx].map((c) => canonicalizeHeader(c));
  console.log("[diag] canonical headers:", headers);
  let count = 0;
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row) continue;
    const rec: any = {};
    for (let c = 0; c < headers.length; c++) {
      const k = headers[c] || `col_${c}`;
      if (rec[k] === undefined || rec[k] === "") rec[k] = row[c] ?? "";
    }
    if (rec.part_number && String(rec.part_number).trim()) count++;
  }
  console.log("[diag] parts count via aoa path:", count);
}
