/**
 * IMAP email polling service — Session C
 * Polls Gmail every 5 minutes for RFQ-related emails.
 * Saves to email_inbox table; matches known customers; creates RFQs.
 */
import Imap from "node-imap";
import { simpleParser } from "mailparser";
import * as fs from "node:fs";
import * as path from "node:path";
import { db } from "./storage";
import { emailInbox, customers, rfqs } from "@shared/schema";
import { eq, or, like } from "drizzle-orm";

const IMAP_HOST = process.env.IMAP_HOST || "imap.gmail.com";
const IMAP_PORT = parseInt(process.env.IMAP_PORT || "993", 10);
const IMAP_USER = process.env.IMAP_USER || "";
const IMAP_PASS = process.env.IMAP_PASS || "";
const IMAP_SSL = process.env.IMAP_SSL !== "false";
const IMAP_FOLDER = process.env.IMAP_FOLDER || "INBOX";
const IMAP_POLL_INTERVAL_SECONDS = parseInt(
  process.env.IMAP_POLL_INTERVAL_SECONDS || "300",
  10,
);

const ATTACHMENTS_DIR = path.join(
  process.env.DATA_DIR || ".",
  "uploads",
  "email-attachments",
);

// Subject filter — match common RFQ-related keywords or has attachment
const SUBJECT_RE = /rfq|quotation|enquiry|parts|price|quote/i;

// Track whether polling is active
let pollingActive = false;

export function isImapEnabled(): boolean {
  return !!(IMAP_USER && IMAP_PASS && IMAP_HOST && IMAP_USER !== "skip");
}

/**
 * Single poll pass: open inbox, fetch unseen RFQ-related emails, process them.
 */
async function pollOnce(): Promise<{ fetched: number; errors: number }> {
  if (!isImapEnabled()) {
    return { fetched: 0, errors: 0 };
  }

  return new Promise((resolve) => {
    let fetched = 0;
    let errors = 0;

    const imap = new Imap({
      user: IMAP_USER,
      password: IMAP_PASS,
      host: IMAP_HOST,
      port: IMAP_PORT,
      tls: IMAP_SSL,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 30000,
      authTimeout: 15000,
    });

    function done() {
      try { imap.end(); } catch {}
      resolve({ fetched, errors });
    }

    imap.once("ready", () => {
      imap.openBox(IMAP_FOLDER, false, (err, _box) => {
        if (err) {
          console.error("[imap] openBox error:", err.message);
          errors++;
          return done();
        }

        // Search for UNSEEN messages
        imap.search(["UNSEEN"], (searchErr, uids) => {
          if (searchErr) {
            console.error("[imap] search error:", searchErr.message);
            errors++;
            return done();
          }

          if (!uids || uids.length === 0) {
            return done();
          }

          const f = imap.fetch(uids, {
            bodies: "",
            markSeen: false, // we'll mark seen after processing
          });

          const promises: Promise<void>[] = [];

          f.on("message", (msg) => {
            promises.push(
              new Promise<void>((msgResolve) => {
                let rawChunks: Buffer[] = [];

                msg.on("body", (stream) => {
                  stream.on("data", (chunk: Buffer) => rawChunks.push(chunk));
                  stream.once("end", async () => {
                    try {
                      const raw = Buffer.concat(rawChunks);
                      const parsed = await simpleParser(raw);

                      const messageId =
                        parsed.messageId || `narmada-${Date.now()}-${Math.random()}`;
                      const fromEmail =
                        parsed.from?.value?.[0]?.address?.toLowerCase() || "";
                      const toEmail =
                        (parsed.to as any)?.value?.[0]?.address?.toLowerCase() || "";
                      const subject = parsed.subject || "";
                      const receivedAt = parsed.date
                        ? parsed.date.getTime()
                        : Date.now();

                      // Filter: must match subject regex OR have attachments
                      const hasAttachment =
                        parsed.attachments && parsed.attachments.length > 0;
                      if (!SUBJECT_RE.test(subject) && !hasAttachment) {
                        msgResolve();
                        return;
                      }

                      // Deduplicate by messageId
                      const existing = db
                        .select()
                        .from(emailInbox)
                        .where(eq(emailInbox.messageId, messageId))
                        .get();
                      if (existing) {
                        msgResolve();
                        return;
                      }

                      // Save attachments
                      const attachmentPaths: string[] = [];
                      if (hasAttachment) {
                        if (!fs.existsSync(ATTACHMENTS_DIR)) {
                          fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
                        }
                        for (const att of parsed.attachments || []) {
                          if (att.content) {
                            const safeName = att.filename
                              ? att.filename.replace(/[^a-zA-Z0-9._-]/g, "_")
                              : `attachment-${Date.now()}`;
                            const filePath = path.join(
                              ATTACHMENTS_DIR,
                              `${Date.now()}-${safeName}`,
                            );
                            fs.writeFileSync(filePath, att.content);
                            attachmentPaths.push(filePath);
                          }
                        }
                      }

                      // Lookup customer by from_email
                      let matchedCustomerId: number | null = null;
                      if (fromEmail) {
                        const custRow = db
                          .select()
                          .from(customers)
                          .where(
                            or(
                              eq(customers.email, fromEmail),
                              like(customers.email, `%${fromEmail}%`),
                            ),
                          )
                          .get();
                        if (custRow) matchedCustomerId = custRow.id;
                      }

                      // Determine if we should auto-create an RFQ
                      let rfqId: number | null = null;
                      if (matchedCustomerId) {
                        try {
                          const rfqRow = db
                            .insert(rfqs)
                            .values({
                              customerId: matchedCustomerId,
                              contactName: parsed.from?.value?.[0]?.name || fromEmail,
                              email: fromEmail,
                              phone: null,
                              items: JSON.stringify([
                                {
                                  description: subject,
                                  note: "Auto-created from email",
                                  attachments: attachmentPaths,
                                },
                              ]),
                              notes: `From email: ${subject}`,
                              status: "open",
                              createdAt: receivedAt,
                            } as any)
                            .returning()
                            .get();
                          if (rfqRow) rfqId = rfqRow.id;
                        } catch (rfqErr: any) {
                          console.error("[imap] RFQ create error:", rfqErr?.message);
                        }
                      }

                      // Save to email_inbox
                      db.insert(emailInbox)
                        .values({
                          messageId,
                          fromEmail,
                          toEmail,
                          subject,
                          bodyText: parsed.text || null,
                          bodyHtml: parsed.html || null,
                          receivedAt,
                          processed: matchedCustomerId !== null,
                          processedAt:
                            matchedCustomerId !== null ? Date.now() : null,
                          rfqId,
                          customerId: matchedCustomerId,
                          error: null,
                        })
                        .run();

                      fetched++;
                      console.log(
                        `[imap] Saved email: ${subject} from ${fromEmail}${rfqId ? ` (RFQ #${rfqId})` : ""}`,
                      );
                    } catch (processErr: any) {
                      console.error(
                        "[imap] process message error:",
                        processErr?.message,
                      );
                      errors++;
                    } finally {
                      msgResolve();
                    }
                  });
                });
              }),
            );
          });

          f.once("error", (fetchErr: Error) => {
            console.error("[imap] fetch error:", fetchErr.message);
            errors++;
          });

          f.once("end", async () => {
            await Promise.allSettled(promises);
            done();
          });
        });
      });
    });

    imap.once("error", (err: Error) => {
      console.error("[imap] connection error:", err.message);
      errors++;
      resolve({ fetched, errors });
    });

    imap.once("end", () => {
      // Connection ended cleanly
    });

    imap.connect();
  });
}

/**
 * Start polling on a setInterval. Called from index.ts on server startup.
 */
export function startImapPolling(): void {
  if (pollingActive) return;
  if (!isImapEnabled()) {
    console.log("[imap] IMAP not configured — polling disabled");
    return;
  }

  pollingActive = true;
  const intervalMs = IMAP_POLL_INTERVAL_SECONDS * 1000;

  console.log(
    `[imap] Starting IMAP polling every ${IMAP_POLL_INTERVAL_SECONDS}s for ${IMAP_USER}`,
  );

  // Run once after 30s delay (let server fully boot), then every interval
  setTimeout(async () => {
    try {
      const result = await pollOnce();
      console.log(
        `[imap] Poll complete: fetched=${result.fetched}, errors=${result.errors}`,
      );
    } catch (e: any) {
      console.error("[imap] poll error:", e?.message);
    }
  }, 30_000);

  setInterval(async () => {
    try {
      const result = await pollOnce();
      if (result.fetched > 0 || result.errors > 0) {
        console.log(
          `[imap] Poll: fetched=${result.fetched}, errors=${result.errors}`,
        );
      }
    } catch (e: any) {
      console.error("[imap] poll interval error:", e?.message);
    }
  }, intervalMs);
}

// Export last status for health check
export function getImapStatus(): { enabled: boolean; user: string } {
  return { enabled: isImapEnabled(), user: IMAP_USER };
}
