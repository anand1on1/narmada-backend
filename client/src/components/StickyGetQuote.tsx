import { useLocation } from "wouter";
import { MessageCircle, X } from "lucide-react";
import { useState } from "react";

const WHATSAPP = "917909083806";

export function StickyGetQuote() {
  const [location] = useLocation();
  const [dismissed, setDismissed] = useState(false);

  // Hide on admin and contact page
  if (location.startsWith("/admin")) return null;
  if (location === "/contact") return null;
  if (dismissed) return null;

  const message = "Hi Narmada Mobility, I'd like a quote for commercial vehicle spare parts.";
  const href = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(message)}`;

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
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2.5 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-3.5 rounded-full shadow-2xl font-bold text-sm uppercase tracking-wider transition-all hover:scale-105 active:scale-95"
        data-testid="button-sticky-quote"
      >
        <MessageCircle className="w-4 h-4" />
        <span className="hidden sm:inline">Get a Quote on WhatsApp</span>
        <span className="sm:hidden">Get Quote</span>
      </a>
    </div>
  );
}
