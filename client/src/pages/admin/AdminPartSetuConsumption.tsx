// PartSetu AI v1.4 C3 — Consumption Report upload (flexible column mapping).
import { AdminPartSetuSheet } from "./AdminPartSetuSheet";

export default function AdminPartSetuConsumption() {
  return (
    <AdminPartSetuSheet
      kind="consumption"
      title="PartSetu — Consumption Reports"
      hint="Upload parts consumption reports (.xlsx / .csv). Used to inform demand and recommendation signals."
      accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      maxMb={50}
    />
  );
}
