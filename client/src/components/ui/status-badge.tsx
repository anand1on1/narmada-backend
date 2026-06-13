import { cn } from "@/lib/utils";

// R25b — reusable status pill. Maps a status string to a colored pill.
// Unknown statuses fall back to slate so we never crash on new values.
const STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  open: "bg-blue-100 text-blue-700",
  processed: "bg-indigo-100 text-indigo-700",
  fulfilled: "bg-emerald-100 text-emerald-700",
  dispatched: "bg-cyan-100 text-cyan-700",
  pending: "bg-amber-100 text-amber-700",
  failed: "bg-rose-100 text-rose-700",
  error: "bg-rose-100 text-rose-700",
  accepted: "bg-emerald-100 text-emerald-700",
  sent: "bg-blue-100 text-blue-700",
  cancelled: "bg-slate-100 text-slate-500",
  canceled: "bg-slate-100 text-slate-500",
};

export function StatusBadge({
  status,
  className,
  label,
}: {
  status: string;
  className?: string;
  label?: string;
}) {
  const key = (status || "").toLowerCase().trim();
  const style = STYLES[key] || "bg-slate-100 text-slate-700";
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium capitalize",
        style,
        className,
      )}
    >
      {label ?? status}
    </span>
  );
}
