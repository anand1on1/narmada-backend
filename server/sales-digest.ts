// R27.29 — Sales target daily digest orchestration.
// Computes per-salesperson + team-aggregate progress for the current calendar month
// and dispatches a WhatsApp message (AiSensy, simulate-able via DIGEST_MODE) plus a
// Brevo email (sendGenericEmail) to each recipient, logging every channel attempt.
// Every send is wrapped so one failure never blocks the next recipient.
import {
  getAllSalespersonProgress, getTeamAggregateProgress, getActiveSalespeople,
  getMonthlyTargetProgress, logDigest, fmtCurrency, fmtMonth, fmtDate,
  getSalespersonClientBreakdown,
  type SalespersonProgress, type TeamAggregate, type ClientBreakdownRow,
} from "./sales-progress";

// Indian-grouped money with a space after the symbol: "₹ 1,23,456".
function fmtMoney(n: number): string {
  return "₹ " + Math.round(Number(n) || 0).toLocaleString("en-IN");
}
function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Table 1: Payments — Client Breakdown. Rows with any collected or pending only,
// sorted pending desc then collected desc; amber if pending>0, green if paid-only.
function paymentsTableHtml(clients: ClientBreakdownRow[]): string {
  const rows = clients
    .filter((c) => c.paymentsCollected > 0 || c.paymentsPending > 0)
    .sort((a, b) => (b.paymentsPending - a.paymentsPending) || (b.paymentsCollected - a.paymentsCollected));
  if (!rows.length) {
    return `<p style="font-size:13px;color:#94a3b8;margin:4px 0 16px">No client payment activity this month</p>`;
  }
  const body = rows.map((c) => {
    const bg = c.paymentsPending > 0 ? "#fff8e1" : (c.paymentsCollected > 0 ? "#e8f5e9" : "#ffffff");
    return `<tr style="background:${bg}">
      <td style="padding:8px;border-bottom:1px solid #e2e8f0">${esc(c.customerName)}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right">${fmtMoney(c.paymentsCollected)}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right">${fmtMoney(c.paymentsPending)}</td>
    </tr>`;
  }).join("");
  return `<table style="width:100%;border-collapse:collapse;font-size:12px;margin:4px 0 16px">
    <thead><tr style="text-align:left;color:#64748b">
      <th style="padding:8px">Client</th>
      <th style="padding:8px;text-align:right">Collected (₹)</th>
      <th style="padding:8px;text-align:right">Pending (₹)</th>
    </tr></thead><tbody>${body}</tbody></table>`;
}

// Table 2: Purchase Orders — Client Breakdown. Rows with any PO activity only,
// sorted openPosValue desc then posThisMonthValue desc; amber if open POs exist.
function posTableHtml(clients: ClientBreakdownRow[]): string {
  const rows = clients
    .filter((c) => c.posThisMonthCount > 0 || c.openPosCount > 0)
    .sort((a, b) => (b.openPosValue - a.openPosValue) || (b.posThisMonthValue - a.posThisMonthValue));
  if (!rows.length) {
    return `<p style="font-size:13px;color:#94a3b8;margin:4px 0 16px">No client PO activity this month</p>`;
  }
  const body = rows.map((c) => {
    const bg = c.openPosCount > 0 ? "#fff8e1" : "#ffffff";
    return `<tr style="background:${bg}">
      <td style="padding:8px;border-bottom:1px solid #e2e8f0">${esc(c.customerName)}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right">${c.posThisMonthCount} / ${fmtMoney(c.posThisMonthValue)}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right">${c.openPosCount} / ${fmtMoney(c.openPosValue)}</td>
    </tr>`;
  }).join("");
  return `<table style="width:100%;border-collapse:collapse;font-size:12px;margin:4px 0 16px">
    <thead><tr style="text-align:left;color:#64748b">
      <th style="padding:8px">Client</th>
      <th style="padding:8px;text-align:right">POs This Month (# / ₹)</th>
      <th style="padding:8px;text-align:right">Open POs (# / ₹)</th>
    </tr></thead><tbody>${body}</tbody></table>`;
}

function clientBreakdownSectionHtml(clients: ClientBreakdownRow[]): string {
  return `
    <h2 style="font-size:15px;color:#0f172a;margin:20px 0 6px">Payments — Client Breakdown</h2>
    ${paymentsTableHtml(clients)}
    <h2 style="font-size:15px;color:#0f172a;margin:20px 0 6px">Purchase Orders — Client Breakdown</h2>
    ${posTableHtml(clients)}`;
}

const ADMIN_DIGEST_MOBILE = "+917909083806";
const ADMIN_DIGEST_EMAIL = process.env.ADMIN_DIGEST_EMAIL || "sales@Narmadamobility.com";

function statusBadge(status: string): string {
  return status === "on_track"
    ? `<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:9999px;font-size:12px;font-weight:700">On track</span>`
    : `<span style="background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:9999px;font-size:12px;font-weight:700">Behind</span>`;
}

function progressCard(title: string, c: { target: number; achieved: number; remaining: number; pct: number }, isCount = false): string {
  const val = (n: number) => (isCount ? String(n) : fmtCurrency(n));
  const barPct = Math.min(100, Math.max(0, c.pct));
  return `
    <div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:12px">
      <div style="font-size:13px;color:#64748b;font-weight:600;margin-bottom:6px">${title}</div>
      <div style="font-size:20px;font-weight:800;color:#0f172a">${val(c.achieved)} <span style="font-size:13px;color:#94a3b8;font-weight:600">/ ${val(c.target)} (${c.pct}%)</span></div>
      <div style="background:#f1f5f9;border-radius:9999px;height:8px;margin-top:8px;overflow:hidden">
        <div style="background:${barPct >= 90 ? "#16a34a" : "#f59e0b"};height:8px;width:${barPct}%"></div>
      </div>
      <div style="font-size:12px;color:#64748b;margin-top:6px">Remaining: ${val(c.remaining)}</div>
    </div>`;
}

function salespersonEmailHtml(p: SalespersonProgress, clients: ClientBreakdownRow[], monthName: string, today: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <h1 style="font-size:20px;color:#0f172a;margin:0 0 4px">Your Sales Progress — ${monthName}</h1>
    <p style="font-size:13px;color:#64748b;margin:0 0 16px">As of ${today} · ${statusBadge(p.status)} · <b>${p.days_left}</b> day(s) left this month</p>
    ${progressCard("Payments Collected", p.payments)}
    ${progressCard("Purchase Orders", p.purchase_orders)}
    ${progressCard("Onboarding (dealers)", p.onboarding, true)}
    ${clientBreakdownSectionHtml(clients)}
    <p style="font-size:12px;color:#94a3b8;margin-top:16px">Narmada Mobility · <a href="https://narmadamobility.com" style="color:#2563eb">narmadamobility.com</a></p>
  </div></body></html>`;
}

// R27.29a: "Team Client Activity" — one sub-section per rep that has any active
// client row, ordered by (openPosValue + paymentsPending) total desc. Reps with
// zero client activity are skipped entirely.
interface AdminBreakdown { salespersonId: number; salespersonName: string; clients: ClientBreakdownRow[]; }
function teamClientActivityHtml(breakdowns: AdminBreakdown[], monthName: string): string {
  const active = breakdowns
    .map((b) => ({
      ...b,
      outstanding: b.clients.reduce((a, c) => a + c.openPosValue + c.paymentsPending, 0),
      hasActivity: b.clients.some(
        (c) => c.paymentsCollected > 0 || c.paymentsPending > 0 || c.posThisMonthCount > 0 || c.openPosCount > 0,
      ),
    }))
    .filter((b) => b.hasActivity)
    .sort((a, b) => b.outstanding - a.outstanding);
  if (!active.length) return "";
  const sections = active.map((b) => `
    <h2 style="font-size:16px;color:#0f172a;margin:24px 0 4px">${esc(b.salespersonName)}</h2>
    <div style="font-size:13px;color:#334155;font-weight:600;margin:8px 0 2px">Payments — Client Breakdown</div>
    ${paymentsTableHtml(b.clients)}
    <div style="font-size:13px;color:#334155;font-weight:600;margin:8px 0 2px">Purchase Orders — Client Breakdown</div>
    ${posTableHtml(b.clients)}`).join("");
  return `<h1 style="font-size:18px;color:#0f172a;margin:28px 0 4px">Team Client Activity — ${monthName}</h1>${sections}`;
}

function adminEmailHtml(agg: TeamAggregate, rows: SalespersonProgress[], breakdowns: AdminBreakdown[], monthName: string, today: string): string {
  const tr = rows.map((p) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0">${p.salesperson.name}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0">${fmtCurrency(p.payments.achieved)} / ${fmtCurrency(p.payments.target)} (${p.payments.pct}%)</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0">${fmtCurrency(p.purchase_orders.achieved)} / ${fmtCurrency(p.purchase_orders.target)} (${p.purchase_orders.pct}%)</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0">${p.onboarding.achieved} / ${p.onboarding.target} (${p.onboarding.pct}%)</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0">${statusBadge(p.status)}</td>
    </tr>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <h1 style="font-size:20px;color:#0f172a;margin:0 0 4px">Admin Daily Sales Digest — ${today}</h1>
    <p style="font-size:13px;color:#64748b;margin:0 0 16px">${monthName} · <b>${agg.days_left}</b> day(s) left · ${agg.count} salesperson(s)</p>
    <div style="font-size:13px;color:#334155;margin-bottom:12px">
      Payments: <b>${fmtCurrency(agg.payments.achieved)}</b> / ${fmtCurrency(agg.payments.target)} ·
      PO: <b>${fmtCurrency(agg.purchase_orders.achieved)}</b> / ${fmtCurrency(agg.purchase_orders.target)} ·
      Onboarding: <b>${agg.onboarding.achieved}</b> / ${agg.onboarding.target}
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="text-align:left;color:#64748b">
        <th style="padding:8px">Salesperson</th><th style="padding:8px">Payments</th>
        <th style="padding:8px">PO</th><th style="padding:8px">Onboarding</th><th style="padding:8px">Status</th>
      </tr></thead>
      <tbody>${tr}</tbody>
    </table>
    ${teamClientActivityHtml(breakdowns, monthName)}
    <p style="font-size:12px;color:#94a3b8;margin-top:16px">Narmada Mobility internal report.</p>
  </div></body></html>`;
}

// Run the digest for the given month (defaults to the current calendar month).
// Returns a summary of attempts. Never throws.
export async function runSalesDigest(opts: { year?: number; month?: number; now?: number } = {}): Promise<{ digest_date: string; salespeople: number; sent: number; failed: number; simulated: number }> {
  const now = opts.now ?? Date.now();
  const d = new Date(now);
  const year = opts.year ?? d.getUTCFullYear();
  const month = opts.month ?? d.getUTCMonth() + 1;
  const digestDate = new Date(now).toISOString().slice(0, 10);
  const monthName = fmtMonth(year, month);
  const today = fmtDate(now);

  const counters = { sent: 0, failed: 0, simulated: 0 };
  const bump = (status: string) => {
    if (status === "simulated") counters.simulated++;
    else if (status === "sent") counters.sent++;
    else counters.failed++;
  };

  let wa: typeof import("./whatsapp");
  let email: typeof import("./notifications");
  try { wa = await import("./whatsapp"); } catch (e: any) { console.error("[R27.29] whatsapp import failed:", e?.message); return { digest_date: digestDate, salespeople: 0, sent: 0, failed: 0, simulated: 0 }; }
  try { email = await import("./notifications"); } catch (e: any) { console.error("[R27.29] email import failed:", e?.message); email = null as any; }

  const rows = getAllSalespersonProgress(year, month, now);

  // Client breakdown window: current calendar month, end capped at "now" (mirrors
  // the aggregate cards so email totals reconcile).
  const monthStartMs = Date.UTC(year, month - 1, 1, 0, 0, 0, 0);
  const monthEndMs = Date.UTC(year, month, 0, 23, 59, 59, 999);
  const monthStart = new Date(monthStartMs);
  const monthEnd = new Date(Math.min(monthEndMs, now));

  for (const p of rows) {
    // WhatsApp — 14 params
    try {
      const params = [
        p.salesperson.name, monthName, today,
        fmtCurrency(p.payments.target), fmtCurrency(p.payments.achieved), fmtCurrency(p.payments.remaining),
        fmtCurrency(p.purchase_orders.target), fmtCurrency(p.purchase_orders.achieved), fmtCurrency(p.purchase_orders.remaining),
        String(p.onboarding.target), String(p.onboarding.achieved), String(p.onboarding.remaining),
        String(p.days_left), p.status === "on_track" ? "On track" : "Behind",
      ];
      if (!p.salesperson.mobile) {
        logDigest({ digest_date: digestDate, recipient_type: "salesperson", recipient_user_id: p.salesperson.id, recipient_mobile: null, channel: "whatsapp", status: "skipped_no_mobile" });
        bump("failed");
      } else {
        const r = await wa.sendSalesDigestWhatsApp(p.salesperson.mobile, params);
        logDigest({ digest_date: digestDate, recipient_type: "salesperson", recipient_user_id: p.salesperson.id, recipient_mobile: p.salesperson.mobile, channel: "whatsapp", status: r.status, error: r.error ?? null, payload_summary: `pay ${p.payments.pct}% po ${p.purchase_orders.pct}% ob ${p.onboarding.pct}%` });
        bump(r.status);
      }
    } catch (e: any) {
      logDigest({ digest_date: digestDate, recipient_type: "salesperson", recipient_user_id: p.salesperson.id, channel: "whatsapp", status: "failed", error: e?.message });
      bump("failed");
    }

    // Email — Brevo (always live; skipped if no address)
    try {
      if (!p.salesperson.email) {
        logDigest({ digest_date: digestDate, recipient_type: "salesperson", recipient_user_id: p.salesperson.id, recipient_email: null, channel: "email", status: "skipped_no_email" });
      } else if (email) {
        const clients = getSalespersonClientBreakdown(p.salesperson.id, monthStart, monthEnd).clients;
        const res = await email.sendGenericEmail({
          to: p.salesperson.email, subject: `Your Sales Progress — ${monthName}`,
          html: salespersonEmailHtml(p, clients, monthName, today), event: "sales_digest",
        });
        logDigest({ digest_date: digestDate, recipient_type: "salesperson", recipient_user_id: p.salesperson.id, recipient_email: p.salesperson.email, channel: "email", status: res.ok ? "sent" : "failed", error: res.error ?? null });
      }
    } catch (e: any) {
      logDigest({ digest_date: digestDate, recipient_type: "salesperson", recipient_user_id: p.salesperson.id, recipient_email: p.salesperson.email, channel: "email", status: "failed", error: e?.message });
    }
  }

  // Team aggregate → admin recipient
  try {
    const agg = getTeamAggregateProgress(year, month, now);
    const behindList = agg.behind.length ? agg.behind.map((b) => b.name).join(", ") : "None";
    const adminParams = [
      monthName, today, String(agg.days_left),
      fmtCurrency(agg.payments.achieved), fmtCurrency(agg.payments.target),
      fmtCurrency(agg.purchase_orders.achieved), fmtCurrency(agg.purchase_orders.target),
      String(agg.onboarding.achieved), String(agg.onboarding.target), behindList,
    ];
    try {
      const r = await wa.sendAdminDigestWhatsApp(ADMIN_DIGEST_MOBILE, adminParams);
      logDigest({ digest_date: digestDate, recipient_type: "admin", recipient_mobile: ADMIN_DIGEST_MOBILE, channel: "whatsapp", status: r.status, error: r.error ?? null, payload_summary: `behind: ${behindList}` });
      bump(r.status);
    } catch (e: any) {
      logDigest({ digest_date: digestDate, recipient_type: "admin", recipient_mobile: ADMIN_DIGEST_MOBILE, channel: "whatsapp", status: "failed", error: e?.message });
      bump("failed");
    }
    try {
      if (email) {
        const breakdowns = rows.map((p) => ({
          salespersonId: p.salesperson.id,
          salespersonName: p.salesperson.name,
          clients: getSalespersonClientBreakdown(p.salesperson.id, monthStart, monthEnd).clients,
        }));
        const res = await email.sendGenericEmail({
          to: ADMIN_DIGEST_EMAIL, subject: `Admin Daily Sales Digest — ${today}`,
          html: adminEmailHtml(agg, rows, breakdowns, monthName, today), event: "sales_digest_admin",
        });
        logDigest({ digest_date: digestDate, recipient_type: "admin", recipient_email: ADMIN_DIGEST_EMAIL, channel: "email", status: res.ok ? "sent" : "failed", error: res.error ?? null });
      }
    } catch (e: any) {
      logDigest({ digest_date: digestDate, recipient_type: "admin", recipient_email: ADMIN_DIGEST_EMAIL, channel: "email", status: "failed", error: e?.message });
    }
  } catch (e: any) {
    console.error("[R27.29] admin digest failed:", e?.message);
  }

  console.log(`[R27.29] digest ${digestDate}: ${rows.length} salespeople, sent=${counters.sent} failed=${counters.failed} simulated=${counters.simulated}`);
  return { digest_date: digestDate, salespeople: rows.length, ...counters };
}

// Export for tests / reuse.
export { getMonthlyTargetProgress, getActiveSalespeople };
export {
  salespersonEmailHtml, adminEmailHtml, paymentsTableHtml, posTableHtml,
  teamClientActivityHtml, fmtMoney, getSalespersonClientBreakdown,
};
