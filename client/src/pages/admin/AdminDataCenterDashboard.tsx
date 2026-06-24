// PartSetu AI v1.4 F4 — Data Center landing page.
// Minimal home for the data_center role: quick links to the PartSetu data tools
// and public Products. No delete actions are offered here.
import { Link } from "wouter";
import { AdminLayout } from "./AdminLayout";
import { BookOpen, Link2, Tag, FileSpreadsheet, Sparkles, Package } from "lucide-react";

const TILES = [
  { href: "/admin/partsetu/catalogs", label: "Catalogs", desc: "Upload & index catalogue PDFs", icon: BookOpen },
  { href: "/admin/partsetu/xrefs", label: "Comparative Sheets", desc: "Cross-reference workbooks", icon: Link2 },
  { href: "/admin/partsetu/prices", label: "Price Lists", desc: "Spare-part price lists", icon: Tag },
  { href: "/admin/partsetu/consumption", label: "Consumption Reports", desc: "Parts consumption data", icon: FileSpreadsheet },
  { href: "/admin/partsetu/teach", label: "Teach", desc: "Synonyms, answers & rules", icon: Sparkles },
  { href: "/admin/products", label: "Products", desc: "Public web-shop products", icon: Package },
];

export default function AdminDataCenterDashboard() {
  return (
    <AdminLayout title="Data Center">
      <p className="text-sm text-muted-foreground mb-5">Manage PartSetu knowledge and the public product catalog. You can create, upload and edit — deletion is reserved for admins.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TILES.map((t) => {
          const Icon = t.icon;
          return (
            <Link key={t.href} href={t.href}>
              <a className="block border rounded-xl p-5 hover:bg-muted/30 transition-colors" data-testid={`tile-${t.href.replace(/\W+/g, "-")}`}>
                <Icon className="w-6 h-6 mb-3 text-blue-600" />
                <div className="font-semibold">{t.label}</div>
                <div className="text-sm text-muted-foreground">{t.desc}</div>
              </a>
            </Link>
          );
        })}
      </div>
    </AdminLayout>
  );
}
