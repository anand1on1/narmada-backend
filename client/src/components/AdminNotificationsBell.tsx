import { useEffect, useState } from "react";
import { adminFetch } from "@/lib/admin-auth";
import { apiUrl } from "@/lib/queryClient";
import NotificationsBell from "./NotificationsBell";

// R26.5 (H) — admin wrapper around NotificationsBell. The notifications feed is
// served behind requireDataTeamRole(), so an admin first exchanges the admin token
// for a Data Team SSO session (POST /api/team/login-as-admin) and then queries with
// that team token. The admin role query branch surfaces admin-targeted events.
export default function AdminNotificationsBell({ adminToken }: { adminToken: string | null }) {
  const [teamToken, setTeamToken] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!adminToken) { setTeamToken(null); return; }
    (async () => {
      try {
        const r = await adminFetch(adminToken, "/api/team/login-as-admin", { method: "POST" });
        if (!r.ok || !alive) return;
        const j = await r.json();
        if (alive && j?.token) setTeamToken(j.token);
      } catch { /* ignore — bell simply won't render */ }
    })();
    return () => { alive = false; };
  }, [adminToken]);

  // roleFetch attaches the team token and asks the backend for the admin-scoped feed.
  const roleFetch = async (token: string | null, url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    const t = token || teamToken;
    if (t) headers.set("x-team-token", t);
    if (init.body && typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const sep = url.includes("?") ? "&" : "?";
    const scoped = url.startsWith("/api/notifications") ? `${url}${sep}role=admin` : url;
    return fetch(apiUrl(scoped), { ...init, headers });
  };

  if (!teamToken) return null;
  return <NotificationsBell roleFetch={roleFetch} token={teamToken} />;
}
