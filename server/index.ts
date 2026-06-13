import "dotenv/config";
import express, { Response, NextFunction } from 'express';
import type { Request } from 'express';
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "node:http";

console.log("[R22.1] AiSensy param fix loaded — batch=2, single=4, confirmed=5");

const app = express();
const httpServer = createServer(app);

// ---- CORS (allow GoDaddy frontend to call this backend) ----
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin as string | undefined;
  const allowAll = ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes("*");
  if (origin && (allowAll || ALLOWED_ORIGINS.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With, x-admin-token, x-customer-token, x-team-token",
    );
  }
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});

// Health check for Render
app.get("/healthz", (_req, res) => res.json({ ok: true, ts: Date.now() }));

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "20mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // ---- R4.4→R7: ensure additive tables + seed defaults on boot ----
  console.log("[boot] step: pre-migrations");
  try {
    const { runR4toR7Migrations, runR8Migrations, runR9Migrations, runR10Migrations, runR11Migrations, runR11_1Migrations, runR12Migrations, runR13Migrations, runR13_4Migrations, runR18Migrations, runR20Migrations, runR21Migrations, runR22Migrations, runR23Migrations, runR24Migrations, runR25Migrations, runR26Migrations, runR26_2Migrations, runR26_2bMigrations, runR26_2fCleanup } = await import("./migrations");
    runR4toR7Migrations();
    console.log("[boot] step: post-R4-R7 migrations");
    runR8Migrations();
    console.log("[boot] step: post-R8 migrations");
    runR9Migrations();
    console.log("[boot] step: post-R9 migrations");
    runR10Migrations();
    console.log("[boot] step: post-R10 migrations");
    runR11Migrations();
    console.log("[boot] step: post-R11 migrations");
    runR11_1Migrations();
    console.log("[boot] step: post-R11.1 migrations");
    runR12Migrations();
    console.log("[boot] step: post-R12 migrations");
    runR13Migrations();
    console.log("[boot] step: post-R13 migrations");
    runR13_4Migrations();
    console.log("[boot] step: post-R13.4 migrations");
    runR18Migrations();
    console.log("[boot] step: post-R18 migrations");
    runR20Migrations();
    console.log("[boot] step: post-R20 migrations");
    runR21Migrations();
    console.log("[boot] step: post-R21 migrations");
    runR22Migrations();
    console.log("[boot] step: post-R22 migrations");
    runR23Migrations();
    console.log("[boot] step: post-R23 migrations");
    runR24Migrations();
    console.log("[boot] step: post-R24 migrations");
    runR25Migrations();
    console.log("[boot] step: post-R25 migrations");
    runR26Migrations();
    console.log("[boot] step: post-R26 migrations");
    runR26_2Migrations();
    console.log("[boot] step: post-R26.2 migrations");
    runR26_2bMigrations();
    console.log("[boot] step: post-R26.2b migrations");
    runR26_2fCleanup();
    console.log("[boot] step: post-R26.2f cleanup");
    const { seedR5Defaults } = await import("./seed-r5");
    await seedR5Defaults();
    console.log("[boot] step: post-seed");
  } catch (e: any) {
    console.error("[migrations] boot setup failed:", e?.message || e);
  }

  console.log("[boot] step: pre-route-register");
  await registerRoutes(httpServer, app);
  console.log("[boot] step: post-route-register");

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      console.log(`[boot] listening on PORT ${port}`);
      log(`serving on port ${port}`);
    },
  );

  // ---- Session C: Start IMAP polling ----
  try {
    const { startImapPolling } = await import("./imap-service");
    startImapPolling();
  } catch (e: any) {
    log(`[imap] Failed to start polling: ${e?.message}`);
  }

  // ---- Session C: Nightly parts_master TATA sync placeholder ----
  const PARTS_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
  setInterval(async () => {
    try {
      log("[parts-cron] Nightly TATA parts sync placeholder — not yet implemented");
    } catch (e: any) {
      log(`[parts-cron] Error: ${e?.message}`);
    }
  }, PARTS_SYNC_INTERVAL_MS);

  // ---- PO reminder cron (daily check for POs > 3 days pending) ----
  const PO_REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
  const PO_STALE_DAYS = 3;
  const ADMIN_REMINDER_EMAIL = process.env.ADMIN_REMINDER_EMAIL || process.env.SALES_EMAIL || "sales@Narmadamobility.com";

  async function runPoReminderCheck() {
    try {
      const { getStalePurchaseOrders, incrementPoReminder, getCustomer } = await import("./storage-v2");
      const { sendGenericEmail } = await import("./notifications");
      const stale = await getStalePurchaseOrders(PO_STALE_DAYS);
      if (!stale || stale.length === 0) {
        log(`[po-reminder] No stale POs (>${PO_STALE_DAYS}d pending)`);
        return;
      }
      const rows: string[] = [];
      for (const po of stale) {
        const cust = po.customerId ? await getCustomer(po.customerId) : null;
        const ageDays = Math.floor((Date.now() - (po.createdAt || Date.now())) / 86400000);
        rows.push(`<tr><td>${po.customerPoNumber || po.id}</td><td>${cust?.name || "-"}</td><td>\u20b9${po.totalInr || 0}</td><td>${ageDays}d</td><td>${po.reminderCount || 0}</td></tr>`);
        await incrementPoReminder(po.id);
      }
      const html = `<h3>Stale Purchase Orders (>${PO_STALE_DAYS} days pending)</h3>
<table border="1" cellpadding="6" style="border-collapse:collapse">
<tr><th>PO #</th><th>Customer</th><th>Amount</th><th>Age</th><th>Reminders</th></tr>
${rows.join("\n")}
</table>
<p>Please review and approve/reject in the admin panel.</p>`;
      await sendGenericEmail({
        to: ADMIN_REMINDER_EMAIL,
        subject: `[Narmada] ${stale.length} stale PO(s) need attention`,
        html,
        text: `${stale.length} POs are pending more than ${PO_STALE_DAYS} days. Review in admin panel.`,
      });
      log(`[po-reminder] Sent reminder for ${stale.length} stale POs`);
    } catch (e: any) {
      log(`[po-reminder] Error: ${e?.message || e}`);
    }
  }

  // Run once 60s after startup, then every 24h
  setTimeout(runPoReminderCheck, 60_000);
  setInterval(runPoReminderCheck, PO_REMINDER_INTERVAL_MS);

  // ---- R5.8 Delhi dispatch reminder cron (pickups pending > 2 days) ----
  const DELHI_REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
  const DELHI_STALE_DAYS = 2;
  async function runDelhiReminderCheck() {
    try {
      const { getStaleDelhiPickups } = await import("./storage-v2");
      const { sendGenericEmail } = await import("./notifications");
      const stale = await getStaleDelhiPickups(DELHI_STALE_DAYS);
      if (!stale || stale.length === 0) {
        log(`[delhi-reminder] No stale Delhi pickups (>${DELHI_STALE_DAYS}d)`);
        return;
      }
      const rows = stale.map((it) => `<tr><td>${it.partNumber || "-"}</td><td>${it.brand || "-"}</td><td>${it.qty}</td><td>PO#${it.poId}</td></tr>`);
      const html = `<h3>Delhi warehouse — pickups pending > ${DELHI_STALE_DAYS} days</h3>
<table border="1" cellpadding="6" style="border-collapse:collapse">
<tr><th>Part</th><th>Brand</th><th>Qty</th><th>PO</th></tr>
${rows.join("\n")}
</table>
<p>These vendor-assigned items have not been collected. Please follow up.</p>`;
      await sendGenericEmail({
        to: ADMIN_REMINDER_EMAIL,
        subject: `[Narmada] ${stale.length} Delhi pickup(s) overdue`,
        html,
        text: `${stale.length} Delhi pickups overdue (>${DELHI_STALE_DAYS}d).`,
        event: "delhi_pickup_reminder",
      });
      log(`[delhi-reminder] Sent reminder for ${stale.length} stale pickups`);
    } catch (e: any) {
      log(`[delhi-reminder] Error: ${e?.message || e}`);
    }
  }
  setTimeout(runDelhiReminderCheck, 90_000);
  setInterval(runDelhiReminderCheck, DELHI_REMINDER_INTERVAL_MS);
})();
