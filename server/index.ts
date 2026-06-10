import "dotenv/config";
import express, { Response, NextFunction } from 'express';
import type { Request } from 'express';
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "node:http";

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
      "Content-Type, Authorization, X-Requested-With, x-admin-token",
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
  await registerRoutes(httpServer, app);

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
      log(`serving on port ${port}`);
    },
  );

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
        rows.push(`<tr><td>${po.poNumber || po.id}</td><td>${cust?.name || "-"}</td><td>\u20b9${po.totalInr || 0}</td><td>${ageDays}d</td><td>${po.reminderCount || 0}</td></tr>`);
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
})();
