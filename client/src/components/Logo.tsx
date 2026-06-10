// Session A V2: replaced SVG monogram with the real Narmada Mobility logo PNG.
// The PNG lives in client/public/logo-header.png so it ships as a static asset
// (no Vite bundling needed; referenced via absolute /logo-header.png path).
export function Logo({ className = "", showText = true }: { className?: string; showText?: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`} data-testid="logo">
      <img
        src="/logo-header.png"
        alt="Narmada Mobility"
        className="h-10 w-auto object-contain"
        // If logo-header.png fails to load (legacy GoDaddy upload), fall back to text-only
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
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
