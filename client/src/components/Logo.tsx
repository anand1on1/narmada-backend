// R28.3 — Single, self-contained wordmark.
// FIXES: R28.2 shipped two overlapping wordmarks (SiteLayout put "Narmada." into
// its own DOM node while Logo also rendered "Narmada.Mobility"), which produced
// the "N SPARTS" partial-letter overlap on the live site. This component is now
// the ONLY source of the brand mark: one icon (h-10 w-10) plus a two-line right
// column stacking "Narmada Mobility" over "GLOBAL SPARE PARTS". No parent may
// render brand text next to it.
export function Logo({ className = "", showText = true }: { className?: string; showText?: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`} data-testid="logo">
      <img
        src="/logo-header.png"
        alt="Narmada Mobility"
        className="h-10 w-10 object-contain shrink-0"
        // If logo-header.png fails to load (legacy GoDaddy upload), fall back to text-only.
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
      {showText && (
        <div className="flex flex-col leading-tight min-w-0">
          <span className="font-display font-bold text-base tracking-tight text-foreground truncate">
            Narmada Mobility
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground truncate">
            Global Spare Parts
          </span>
        </div>
      )}
    </div>
  );
}
