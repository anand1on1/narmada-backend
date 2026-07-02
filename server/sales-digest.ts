// R27.29 — Sales target daily digest orchestration.
// Computes per-salesperson + team-aggregate progress for the current calendar month
// and dispatches a WhatsApp message (AiSensy, simulate-able via DIGEST_MODE) plus a
// Brevo email (sendGenericEmail) to each recipient, logging every channel attempt.
// Every send is wrapped so one failure never blocks the next recipient.
import {
  getAllSalespersonProgress, getTeamAggregateProgress, getActiveSalespeople,
  getMonthlyTargetProgress, logDigest, fmtCurrency, fmtMonth, fmtDate,
  type SalespersonProgress, type TeamAggregate,
} from "./sales-progress";

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

function salespersonEmailHtml(p: SalespersonProgress, monthName: string, today: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <h1 style="font-size:20px;color:#0f172a;margin:0 0 4px">Your Sales Progress — ${monthName}</h1>
    <p style="font-size:13px;color:#64748b;margin:0 0 16px">As of ${today} · ${statusBadge(p.status)} · <b>${p.days_left}</b> day(s) left this month</p>
    ${progressCard("Payments Collected", p.payments)}
    ${progressCard("Purchase Orders", p.purchase_orders)}
    ${progressCard("Onboarding (dealers)", p.onboarding, true)}
    <p style="font-size:12px;color:#94a3b8;margin-top:16px">Narmada Mobility · <a href="https://narmadamobility.com" style="color:#2563eb">narmadamobility.com</a></p>
  </div></body></html>`;
}

function adminEmailHtml(agg: TeamAggregate, rows: SalespersonProgress[], monthName: string, today: string): string {
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
        const res = await email.sendGenericEmail({
          to: p.salesperson.email, subject: `Your Sales Progress — ${monthName}`,
          html: salespersonEmailHtml(p, monthName, today), event: "sales_digest",
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
        const res = await email.sendGenericEmail({
          to: ADMIN_DIGEST_EMAIL, subject: `Admin Daily Sales Digest — ${today}`,
          html: adminEmailHtml(agg, rows, monthName, today), event: "sales_digest_admin",
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
