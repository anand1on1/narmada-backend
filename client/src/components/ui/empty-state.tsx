import { ReactNode } from "react";
import { LucideIcon, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

// R25b — centered empty state with icon, heading, body and optional CTA.
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-12 gap-3 text-center",
        className,
      )}
    >
      <Icon className="w-12 h-12 text-slate-300" strokeWidth={1.5} />
      <div className="text-base font-semibold text-slate-900">{title}</div>
      {description && <p className="text-sm text-slate-500 max-w-sm">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
