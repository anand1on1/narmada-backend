export function Logo({ className = "", showText = true }: { className?: string; showText?: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`} data-testid="logo">
      {/* Geometric monogram: angular "N" enclosed in a hexagonal frame with cyan signal accent */}
      <svg viewBox="0 0 40 40" className="h-9 w-9" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Narmada Mobility logo">
        <path d="M20 2 L36 11 L36 29 L20 38 L4 29 L4 11 Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="miter" />
        <path d="M13 28 L13 12 L27 28 L27 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter" fill="none" />
        <circle cx="30.5" cy="9.5" r="2.5" fill="hsl(212 95% 55%)" />
      </svg>
      {showText && (
        <div className="flex flex-col leading-none">
          <span className="font-display font-semibold text-[15px] tracking-tight text-foreground">
            Narmada<span className="text-[hsl(212_95%_55%)]">.</span>Mobility
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground mt-1">Global Spare Parts</span>
        </div>
      )}
    </div>
  );
}
