import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// R28.12 — path routing. Previously we force-set window.location.hash = "#/"
// on empty hash which forced every URL through hash routing. With the new
// path-based Router hook in App.tsx, the boot redirect isn't needed:
// - Fresh /product/... URLs load naturally via .htaccess SPA fallback.
// - Legacy /#/product/... URLs are migrated on first render by readCurrentPath().
// If the hash still exists after mount (edge cases where the migration didn't
// run), the Router hook handles it.
if (window.location.hash === "#") {
  // Chrome sometimes leaves a bare "#" — clean it up.
  try { window.history.replaceState(null, "", window.location.pathname + window.location.search); } catch {}
}

createRoot(document.getElementById("root")!).render(<App />);
