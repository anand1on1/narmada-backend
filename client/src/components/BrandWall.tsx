import { BRAND_WALL } from "@/data/brands";
import { Link } from "wouter";

// Bundle every brand SVG with a hashed URL via Vite's glob import.
const logoModules = import.meta.glob("@/assets/brands/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function resolveLogo(filename: string): string | undefined {
  const match = Object.entries(logoModules).find(([k]) => k.endsWith(`/${filename}`));
  return match?.[1];
}

export function BrandWall() {
  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-px bg-[hsl(220_45%_20%)]/10 border border-[hsl(220_45%_20%)]/10 rounded-2xl overflow-hidden"
      data-testid="brand-wall"
    >
      {BRAND_WALL.map((b) => {
        const logo = resolveLogo(b.logoFile);
        return (
          <Link key={b.name} href={`/brand/${b.slug}`}>
            <a
              className="group relative bg-[hsl(210_28%_94%)] hover:bg-[hsl(210_25%_89%)] transition-colors duration-300 aspect-[4/3] flex flex-col items-center justify-center p-5 gap-3 cursor-pointer"
              data-testid={`brand-${b.slug}`}
            >
              <div className="h-10 md:h-12 w-full flex items-center justify-center">
                {logo ? (
                  <img
                    src={logo}
                    alt={`${b.name} logo`}
                    loading="lazy"
                    className="max-h-full max-w-[80%] object-contain transition-all duration-300 opacity-85 group-hover:opacity-100 group-hover:scale-105"
                    style={{ filter: "brightness(0) opacity(0.9)" }}
                  />
                ) : (
                  <div className="h-10 w-10 rounded-md bg-[hsl(220_45%_20%)]/10 border border-[hsl(220_45%_20%)]/15 flex items-center justify-center font-black text-[hsl(220_60%_12%)]">
                    {b.name.charAt(0)}
                  </div>
                )}
              </div>
              <div className="text-center">
                <div className="text-[12px] md:text-[13px] font-bold text-[hsl(220_60%_12%)] tracking-tight leading-tight group-hover:text-[hsl(212_95%_45%)] transition-colors">
                  {b.name}
                </div>
                <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-[hsl(220_60%_12%)]/75 mt-1 font-semibold">
                  {b.category === "truck" ? "Trucks · Buses" : "Construction"}
                </div>
              </div>
              <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[hsl(212_95%_55%)]/0 to-transparent group-hover:via-[hsl(212_95%_55%)] transition-all duration-500" />
            </a>
          </Link>
        );
      })}
    </div>
  );
}
