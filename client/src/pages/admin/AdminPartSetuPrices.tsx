// PartSetu AI v1.4 C2 — Price List upload (flexible column mapping).
import { AdminPartSetuSheet } from "./AdminPartSetuSheet";

export default function AdminPartSetuPrices() {
  return (
    <AdminPartSetuSheet
      kind="prices"
      title="PartSetu — Price Lists"
      hint="Upload spare-part price lists (.xlsx / .csv). PartSetu pricing is sourced only from these lists and the Narmada price master."
      accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      maxMb={50}
    />
  );
}
