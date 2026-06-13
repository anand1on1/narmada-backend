import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// R25b — dashboard stat tile. Accent color is controlled by the surrounding
// panel's --accent token via the `accent` text/bg utility, but callers may
// override the icon tint with `tint` (a tailwind color family, e.g. "indigo").
const TINTS: Record<string, string> = {
  indigo: "bg-indigo-50 text-indigo-600",
  violet: "bg-violet-50 text-violet-600",
  orange: "bg-orange-50 text-orange-600",
  emerald: "bg-emerald-50 text-emerald-600",
  teal: "bg-teal-50 text-teal-600",
  blue: "bg-blue-50 text-blue-600",
  amber: "bg-amber-50 text-amber-600",
  rose: "bg-rose-50 text-rose-600",
  slate: "bg-slate-100 text-slate-600",
};

export function StatCard({
  label,
  value,
  icon: Icon,
  tint = "indigo",
  hint,
  className,
  onClick,
}: {
  label: ReactNode;
  value: ReactNode;
  icon?: LucideIcon;
  tint?: keyof typeof TINTS | string;
  hint?: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-start justify-between gap-3",
        onClick && "cursor-pointer hover:shadow-md hover:border-slate-300 transition-all duration-200",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</div>
        <div className="text-2xl font-bold text-slate-900 mt-1 truncate">{value}</div>
        {hint && <div className="text-xs text-slate-400 mt-1">{hint}</div>}
      </div>
      {Icon && (
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", TINTS[tint] || TINTS.indigo)}>
          <Icon className="w-5 h-5" />
        </div>
      )}
    </div>
  );
}
