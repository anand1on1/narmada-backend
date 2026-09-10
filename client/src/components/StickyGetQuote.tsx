import { Link, useLocation } from "wouter";
import { FileText, X } from "lucide-react";
import { useState } from "react";

// R28.2 — sticky CTA now points to the on-site /get-quote wizard rather than
// WhatsApp. Also hide on /get-quote itself and on the new /find-parts page.
export function StickyGetQuote() {
  const [location] = useLocation();
  const [dismissed, setDismissed] = useState(false);

  if (location.startsWith("/admin")) return null;
  if (location === "/contact") return null;
  if (location === "/get-quote") return null;
  if (dismissed) return null;

  return (
    <div className="fixed bottom-4 left-4 z-40 flex flex-col items-start gap-2" data-testid="sticky-get-quote">
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss quote button"
        className="bg-card border shadow-md w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground"
        data-testid="button-dismiss-quote"
      >
        <X className="w-3.5 h-3.5" />
      </button>
      <Link href="/get-quote">
        <a
          className="inline-flex items-center gap-2.5 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-3.5 rounded-full shadow-2xl font-bold text-sm uppercase tracking-wider transition-all hover:scale-105 active:scale-95"
          data-testid="button-sticky-quote"
        >
          <FileText className="w-4 h-4" />
          <span className="hidden sm:inline">Get Quotation</span>
          <span className="sm:hidden">Quote</span>
        </a>
      </Link>
    </div>
  );
}
