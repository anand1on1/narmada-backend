// R27.1 — E-commerce Phase 1 storage. Isolated module for the website shopper
// flow (shop_* tables). Kept separate from storage-v2.ts so the B2B portal and
// procurement code paths are untouched. All access via rawSqlite.
import { rawSqlite as sqlite } from "./storage";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// ---- password + token helpers (mirror routes-v2 scrypt salt:hash format) ----
export function hashPw(plain: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(plain, salt, 64).toString("hex")}`;
}
export function verifyPw(plain: string, stored: string): boolean {
  try {
    const [salt, hash] = String(stored).split(":");
    if (!salt || !hash) return false;
    const test = scryptSync(plain, salt, 64).toString("hex");
    return timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(test, "hex"));
  } catch { return false; }
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function publicUser(row: any) {
  if (!row) return null;
  const { password_hash, ...rest } = row;
  return {
    id: rest.id, email: rest.email, fullName: rest.full_name,
    phone: rest.phone, createdAt: rest.created_at, lastLoginAt: rest.last_login_at,
    emailVerified: rest.email_verified == null ? 1 : Number(rest.email_verified),
  };
}

// R27.1a BUG 2 — OTP helpers. 6-digit numeric code, bcrypt-style scrypt hash reusing
// the same salt:hash format as passwords, 10-minute expiry.
function genOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RESEND_MAX = 3;

// ---- auth ----
// R27.1a BUG 2 — signup no longer auto-issues a session. It creates the account with
// email_verified=0, generates an OTP, and returns the user + the plaintext otp so the
// caller (route) can email it. Login stays blocked until the OTP is verified.
export function createShopUser(email: string, password: string, fullName?: string, phone?: string) {
  const norm = String(email).trim().toLowerCase();
  const existing = sqlite.prepare(`SELECT id FROM shop_users WHERE email = ?`).get(norm);
  if (existing) throw new Error("An account with this email already exists");
  const otp = genOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
  const sentAt = new Date().toISOString();
  const info = sqlite.prepare(
    `INSERT INTO shop_users (email, password_hash, full_name, phone, email_verified, verify_otp, verify_otp_expires_at, verify_otp_sent_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?)`
  ).run(norm, hashPw(password), fullName || null, phone || null, hashPw(otp), expiresAt, sentAt);
  const user = getShopUserById(Number(info.lastInsertRowid));
  return { user, otp };
}

export function getShopUserById(id: number) {
  return publicUser(sqlite.prepare(`SELECT * FROM shop_users WHERE id = ?`).get(id));
}

// Returns either { token, user } on success, { error: "verify_required", email } if the
// account exists but is unverified, or null on bad credentials.
export function loginShopUser(email: string, password: string):
  | { token: string; user: any }
  | { error: "verify_required"; email: string }
  | null {
  const norm = String(email).trim().toLowerCase();
  const row = sqlite.prepare(`SELECT * FROM shop_users WHERE email = ?`).get(norm) as any;
  if (!row || !verifyPw(password, row.password_hash)) return null;
  if (Number(row.email_verified) !== 1) return { error: "verify_required", email: norm };
  sqlite.prepare(`UPDATE shop_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?`).run(row.id);
  const token = createShopSession(row.id);
  return { token, user: publicUser(row) };
}

// R27.1a BUG 2 — verify the signup OTP. On match within expiry: mark verified, clear otp
// fields, issue a session (auto-login). Returns { token, user } or throws a friendly error.
export function verifyShopOtp(email: string, otp: string) {
  const norm = String(email).trim().toLowerCase();
  const row = sqlite.prepare(`SELECT * FROM shop_users WHERE email = ?`).get(norm) as any;
  if (!row) throw new Error("Account not found");
  if (Number(row.email_verified) === 1) {
    // Already verified — just log them in so a double-submit isn't a dead end.
    const token = createShopSession(row.id);
    return { token, user: publicUser(row) };
  }
  if (!row.verify_otp) throw new Error("No verification code on file. Please resend.");
  if (row.verify_otp_expires_at && new Date(row.verify_otp_expires_at).getTime() < Date.now()) {
    throw new Error("Code expired. Please resend a new code.");
  }
  if (!verifyPw(String(otp).trim(), row.verify_otp)) throw new Error("Incorrect code. Please try again.");
  sqlite.prepare(
    `UPDATE shop_users SET email_verified = 1, verify_otp = NULL, verify_otp_expires_at = NULL, last_login_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(row.id);
  const token = createShopSession(row.id);
  return { token, user: getShopUserById(row.id) };
}

// R27.1a BUG 2 — regenerate + return a fresh OTP for an unverified account. Rate-limited to
// RESEND_MAX sends per RESEND_WINDOW. Returns { otp } so the route can email it.
export function resendShopOtp(email: string): { otp: string } {
  const norm = String(email).trim().toLowerCase();
  const row = sqlite.prepare(`SELECT * FROM shop_users WHERE email = ?`).get(norm) as any;
  if (!row) throw new Error("Account not found");
  if (Number(row.email_verified) === 1) throw new Error("This account is already verified. Please sign in.");
  // Crude rate limit: count sends in the last hour using sent_at. We only track the last
  // send timestamp, so enforce a minimum gap of (window / max) between resends.
  if (row.verify_otp_sent_at) {
    const since = Date.now() - new Date(row.verify_otp_sent_at).getTime();
    if (since < RESEND_WINDOW_MS / RESEND_MAX) {
      throw new Error("Please wait a few minutes before requesting another code.");
    }
  }
  const otp = genOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
  const sentAt = new Date().toISOString();
  sqlite.prepare(
    `UPDATE shop_users SET verify_otp = ?, verify_otp_expires_at = ?, verify_otp_sent_at = ? WHERE id = ?`
  ).run(hashPw(otp), expiresAt, sentAt, row.id);
  return { otp };
}

export function createShopSession(shopUserId: number): string {
  const token = randomBytes(32).toString("hex");
  sqlite.prepare(
    `INSERT INTO shop_sessions (token, shop_user_id, expires_at) VALUES (?, ?, ?)`
  ).run(token, shopUserId, Date.now() + SESSION_TTL_MS);
  return token;
}

export function getShopSession(token: string): { shopUserId: number } | null {
  if (!token) return null;
  const row = sqlite.prepare(`SELECT shop_user_id, expires_at FROM shop_sessions WHERE token = ?`).get(token) as any;
  if (!row) return null;
  if (Number(row.expires_at) < Date.now()) {
    sqlite.prepare(`DELETE FROM shop_sessions WHERE token = ?`).run(token);
    return null;
  }
  return { shopUserId: Number(row.shop_user_id) };
}

export function deleteShopSession(token: string) {
  sqlite.prepare(`DELETE FROM shop_sessions WHERE token = ?`).run(token);
}

// ---- addresses ----
function mapAddress(r: any) {
  return {
    id: r.id, label: r.label, fullName: r.full_name, phone: r.phone,
    line1: r.line1, line2: r.line2, city: r.city, state: r.state,
    pincode: r.pincode, country: r.country, isDefault: !!r.is_default, createdAt: r.created_at,
  };
}
export function listAddresses(shopUserId: number) {
  return (sqlite.prepare(
    `SELECT * FROM shop_addresses WHERE shop_user_id = ? ORDER BY is_default DESC, id DESC`
  ).all(shopUserId) as any[]).map(mapAddress);
}
export function createAddress(shopUserId: number, a: any) {
  const required = ["fullName", "phone", "line1", "city", "state", "pincode"];
  for (const k of required) if (!a?.[k]) throw new Error(`Missing field: ${k}`);
  const isDefault = a.isDefault ? 1 : 0;
  if (isDefault) sqlite.prepare(`UPDATE shop_addresses SET is_default = 0 WHERE shop_user_id = ?`).run(shopUserId);
  const count = (sqlite.prepare(`SELECT COUNT(*) c FROM shop_addresses WHERE shop_user_id = ?`).get(shopUserId) as any).c;
  const info = sqlite.prepare(
    `INSERT INTO shop_addresses (shop_user_id, label, full_name, phone, line1, line2, city, state, pincode, country, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(shopUserId, a.label || null, a.fullName, a.phone, a.line1, a.line2 || null, a.city, a.state, a.pincode,
        a.country || "IN", isDefault || (count === 0 ? 1 : 0));
  return mapAddress(sqlite.prepare(`SELECT * FROM shop_addresses WHERE id = ?`).get(info.lastInsertRowid));
}
export function updateAddress(shopUserId: number, id: number, a: any) {
  const own = sqlite.prepare(`SELECT id FROM shop_addresses WHERE id = ? AND shop_user_id = ?`).get(id, shopUserId);
  if (!own) return null;
  const fields: string[] = []; const vals: any[] = [];
  const map: Record<string, string> = { label: "label", fullName: "full_name", phone: "phone", line1: "line1", line2: "line2", city: "city", state: "state", pincode: "pincode", country: "country" };
  for (const [k, col] of Object.entries(map)) if (a[k] !== undefined) { fields.push(`${col} = ?`); vals.push(a[k]); }
  if (fields.length) { vals.push(id); sqlite.prepare(`UPDATE shop_addresses SET ${fields.join(", ")} WHERE id = ?`).run(...vals); }
  return mapAddress(sqlite.prepare(`SELECT * FROM shop_addresses WHERE id = ?`).get(id));
}
export function deleteAddress(shopUserId: number, id: number) {
  sqlite.prepare(`DELETE FROM shop_addresses WHERE id = ? AND shop_user_id = ?`).run(id, shopUserId);
}
export function setDefaultAddress(shopUserId: number, id: number) {
  const own = sqlite.prepare(`SELECT id FROM shop_addresses WHERE id = ? AND shop_user_id = ?`).get(id, shopUserId);
  if (!own) return null;
  sqlite.prepare(`UPDATE shop_addresses SET is_default = 0 WHERE shop_user_id = ?`).run(shopUserId);
  sqlite.prepare(`UPDATE shop_addresses SET is_default = 1 WHERE id = ?`).run(id);
  return listAddresses(shopUserId);
}

// ---- wishlist ----
export function listWishlist(shopUserId: number) {
  return sqlite.prepare(
    `SELECT w.id, w.product_id AS productId, w.part_number AS partNumber, w.created_at AS createdAt,
            p.slug, p.name, p.brand, p.price_inr AS priceInr, p.image_urls AS imageUrls
     FROM shop_wishlist w LEFT JOIN products p ON p.id = w.product_id
     WHERE w.shop_user_id = ? ORDER BY w.id DESC`
  ).all(shopUserId);
}
export function addWishlist(shopUserId: number, productId: number, partNumber?: string) {
  try {
    sqlite.prepare(
      `INSERT OR IGNORE INTO shop_wishlist (shop_user_id, product_id, part_number) VALUES (?, ?, ?)`
    ).run(shopUserId, productId, partNumber || null);
  } catch { /* unique conflict ignored */ }
  return listWishlist(shopUserId);
}
export function removeWishlist(shopUserId: number, id: number) {
  sqlite.prepare(`DELETE FROM shop_wishlist WHERE id = ? AND shop_user_id = ?`).run(id, shopUserId);
  return listWishlist(shopUserId);
}

// ---- freight ----
export function getFreightForPart(partNumber?: string | null): number {
  if (!partNumber) return 0;
  const row = sqlite.prepare(`SELECT freight_inr FROM freight_charges WHERE part_number = ?`).get(partNumber) as any;
  return row ? Number(row.freight_inr) || 0 : 0;
}

// ---- order number generator: NM/ORD/26/0001 ----
export function nextOrderNumber(): string {
  const fy = "26";
  const prefix = `NM/ORD/${fy}/`;
  const maxRow = sqlite.prepare(
    `SELECT order_number FROM shop_orders WHERE order_number LIKE ?
     ORDER BY CAST(SUBSTR(order_number, -4) AS INTEGER) DESC LIMIT 1`
  ).get(`${prefix}%`) as any;
  let seq = 1;
  if (maxRow?.order_number) {
    const m = String(maxRow.order_number).match(/(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  // collision guard
  for (let i = 0; i < 1000; i++) {
    const candidate = `${prefix}${String(seq).padStart(4, "0")}`;
    const clash = sqlite.prepare(`SELECT 1 FROM shop_orders WHERE order_number = ? LIMIT 1`).get(candidate);
    if (!clash) return candidate;
    seq++;
  }
  return `${prefix}${Date.now()}`;
}

// ---- settings ----
export function getShopSetting(key: string, fallback: string): string {
  const row = sqlite.prepare(`SELECT value FROM shop_settings WHERE key = ?`).get(key) as any;
  return row?.value ?? fallback;
}

// ---- orders ----
export interface ShopOrderInput {
  shopUserId: number | null;
  customerEmail: string; customerPhone?: string | null; customerName?: string | null;
  ship: { fullName: string; phone: string; line1: string; line2?: string | null; city: string; state: string; pincode: string; country?: string };
  items: { productId?: number | null; partNumber?: string | null; name: string; image?: string | null; unitPriceInr: number; qty: number }[];
  currency?: string; fxRate?: number; paymentMode?: string;
}

export function createShopOrder(input: ShopOrderInput) {
  if (!input.items?.length) throw new Error("Cart is empty");
  if (!input.ship?.line1 || !input.ship?.pincode) throw new Error("Shipping address incomplete");
  let subtotal = 0, freight = 0;
  const lineRows = input.items.map((it) => {
    const qty = Math.max(1, Number(it.qty) || 1);
    const unit = Number(it.unitPriceInr) || 0;
    const total = unit * qty;
    subtotal += total;
    freight += getFreightForPart(it.partNumber) * qty;
    return { ...it, qty, unit, total };
  });
  const total = subtotal + freight;
  const orderNumber = nextOrderNumber();
  const info = sqlite.prepare(
    `INSERT INTO shop_orders
      (order_number, shop_user_id, customer_email, customer_phone, customer_name,
       ship_full_name, ship_phone, ship_line1, ship_line2, ship_city, ship_state, ship_pincode, ship_country,
       subtotal_inr, freight_inr, total_inr, currency, fx_rate, payment_mode, payment_status, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'placed')`
  ).run(
    orderNumber, input.shopUserId, input.customerEmail, input.customerPhone || null, input.customerName || null,
    input.ship.fullName, input.ship.phone, input.ship.line1, input.ship.line2 || null,
    input.ship.city, input.ship.state, input.ship.pincode, input.ship.country || "IN",
    subtotal, freight, total, input.currency || "INR", input.fxRate || 1, input.paymentMode || "COD",
  );
  const orderId = Number(info.lastInsertRowid);
  const insItem = sqlite.prepare(
    `INSERT INTO shop_order_items (order_id, product_id, part_number, name, image, unit_price_inr, qty, total_inr)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const r of lineRows) {
    insItem.run(orderId, r.productId || null, r.partNumber || null, r.name, r.image || null, r.unit, r.qty, r.total);
  }
  addStatusHistory(orderId, "placed", "Order placed by customer", "system");
  // R27.5 #6 — customer order placed deducts stock at the fulfilling branch (Patna,
  // the customer-facing warehouse). Inlined (not importing storage-r27) to avoid a
  // module cycle. FIFO deduct from in-stock rows + append a stock_movements ledger row.
  try {
    for (const r of lineRows) {
      const qty = Math.abs(Math.trunc(r.qty));
      if (qty <= 0) continue;
      let remaining = qty;
      const rows = sqlite.prepare(
        `SELECT id, qty FROM branch_stock WHERE LOWER(TRIM(branch)) = 'patna' AND status = 'in_stock'
           AND (part_number = ? OR product_id = ?) AND qty > 0 ORDER BY id ASC`,
      ).all(r.partNumber || null, r.productId || null) as any[];
      for (const row of rows) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, row.qty);
        sqlite.prepare(`UPDATE branch_stock SET qty = qty - ? WHERE id = ?`).run(take, row.id);
        remaining -= take;
      }
      sqlite.prepare(
        `INSERT INTO stock_movements (branch, branch_key, product_id, part_number, delta, reason, reference_id, reference_table, notes, created_at)
         VALUES ('Patna', 'patna', ?, ?, ?, 'customer_order', ?, 'shop_orders', ?, CURRENT_TIMESTAMP)`,
      ).run(r.productId || null, r.partNumber || null, -qty, orderId, orderNumber);
    }
  } catch (e: any) { console.error("[R27.5 #6] stock deduction on order failed:", e?.message || e); }
  return getShopOrder(orderId);
}

export function addStatusHistory(orderId: number, status: string, note: string | null, createdBy: string) {
  sqlite.prepare(
    `INSERT INTO shop_order_status_history (order_id, status, note, created_by) VALUES (?, ?, ?, ?)`
  ).run(orderId, status, note, createdBy);
}

function mapOrder(o: any) {
  if (!o) return null;
  return {
    id: o.id, orderNumber: o.order_number, shopUserId: o.shop_user_id,
    customerEmail: o.customer_email, customerPhone: o.customer_phone, customerName: o.customer_name,
    ship: {
      fullName: o.ship_full_name, phone: o.ship_phone, line1: o.ship_line1, line2: o.ship_line2,
      city: o.ship_city, state: o.ship_state, pincode: o.ship_pincode, country: o.ship_country,
    },
    subtotalInr: o.subtotal_inr, freightInr: o.freight_inr, totalInr: o.total_inr,
    currency: o.currency, fxRate: o.fx_rate,
    paymentMode: o.payment_mode, paymentStatus: o.payment_status, status: o.status,
    dispatchedCarrier: o.dispatched_carrier, dispatchedDocket: o.dispatched_docket,
    dispatchedAt: o.dispatched_at, deliveredAt: o.delivered_at, notes: o.notes,
    procurementPoId: o.procurement_po_id, createdAt: o.created_at, updatedAt: o.updated_at,
  };
}

export function getShopOrder(id: number) {
  const o = sqlite.prepare(`SELECT * FROM shop_orders WHERE id = ?`).get(id) as any;
  if (!o) return null;
  const items = sqlite.prepare(`SELECT * FROM shop_order_items WHERE order_id = ?`).all(id) as any[];
  const history = sqlite.prepare(`SELECT * FROM shop_order_status_history WHERE order_id = ? ORDER BY id ASC`).all(id) as any[];
  return {
    ...mapOrder(o),
    items: items.map((it) => ({
      id: it.id, productId: it.product_id, partNumber: it.part_number, name: it.name,
      image: it.image, unitPriceInr: it.unit_price_inr, qty: it.qty, totalInr: it.total_inr,
    })),
    statusHistory: history.map((h) => ({ id: h.id, status: h.status, note: h.note, createdBy: h.created_by, createdAt: h.created_at })),
  };
}

export function listOrdersForUser(shopUserId: number) {
  const rows = sqlite.prepare(`SELECT * FROM shop_orders WHERE shop_user_id = ? ORDER BY id DESC`).all(shopUserId) as any[];
  return rows.map((o) => ({ ...mapOrder(o), itemCount: (sqlite.prepare(`SELECT COUNT(*) c FROM shop_order_items WHERE order_id = ?`).get(o.id) as any).c }));
}

export function getOrderForUser(shopUserId: number, id: number) {
  const o = sqlite.prepare(`SELECT shop_user_id FROM shop_orders WHERE id = ?`).get(id) as any;
  if (!o || Number(o.shop_user_id) !== shopUserId) return null;
  return getShopOrder(id);
}

// ---- admin: orders ----
export function adminListOrders(opts: { status?: string; from?: string; to?: string; q?: string; limit?: number; offset?: number }) {
  const conds: string[] = []; const params: any[] = [];
  if (opts.status && opts.status !== "all") { conds.push("status = ?"); params.push(opts.status); }
  if (opts.from) { conds.push("created_at >= ?"); params.push(opts.from); }
  if (opts.to) { conds.push("created_at <= ?"); params.push(opts.to); }
  if (opts.q) {
    conds.push("(order_number LIKE ? OR customer_name LIKE ? OR customer_email LIKE ? OR customer_phone LIKE ?)");
    const like = `%${opts.q}%`; params.push(like, like, like, like);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const total = (sqlite.prepare(`SELECT COUNT(*) c FROM shop_orders ${where}`).get(...params) as any).c;
  const limit = Math.min(200, Math.max(1, opts.limit || 50));
  const offset = Math.max(0, opts.offset || 0);
  const rows = sqlite.prepare(
    `SELECT * FROM shop_orders ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as any[];
  return {
    total, limit, offset,
    orders: rows.map((o) => ({ ...mapOrder(o), itemCount: (sqlite.prepare(`SELECT COUNT(*) c FROM shop_order_items WHERE order_id = ?`).get(o.id) as any).c })),
  };
}

export function adminUpdateOrderStatus(id: number, status: string, note: string | null, by: string) {
  const o = sqlite.prepare(`SELECT id, status FROM shop_orders WHERE id = ?`).get(id) as any;
  if (!o) return null;
  const stamp = status === "delivered" ? `, delivered_at = CURRENT_TIMESTAMP` : "";
  sqlite.prepare(`UPDATE shop_orders SET status = ?, updated_at = CURRENT_TIMESTAMP ${stamp} WHERE id = ?`).run(status, id);
  addStatusHistory(id, status, note, by);
  return getShopOrder(id);
}

export function adminUpdateDispatch(id: number, carrier: string, docket: string, dispatchedAt?: string) {
  const o = sqlite.prepare(`SELECT id FROM shop_orders WHERE id = ?`).get(id) as any;
  if (!o) return null;
  sqlite.prepare(
    `UPDATE shop_orders SET dispatched_carrier = ?, dispatched_docket = ?, dispatched_at = COALESCE(?, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(carrier || null, docket || null, dispatchedAt || null, id);
  return getShopOrder(id);
}

export function linkProcurementPo(orderId: number, poId: number) {
  sqlite.prepare(`UPDATE shop_orders SET procurement_po_id = ? WHERE id = ?`).run(poId, orderId);
}

// ---- admin: customer (web) users ----
export function adminListShopUsers(opts: { q?: string; sort?: string }) {
  let where = ""; const params: any[] = [];
  if (opts.q) { where = `WHERE (u.email LIKE ? OR u.phone LIKE ? OR u.full_name LIKE ?)`; const like = `%${opts.q}%`; params.push(like, like, like); }
  const orderBy = opts.sort === "spend" ? "total_spend DESC" : "u.id DESC";
  const rows = sqlite.prepare(
    `SELECT u.id, u.email, u.full_name AS fullName, u.phone, u.created_at AS createdAt, u.last_login_at AS lastLoginAt,
            (SELECT COUNT(*) FROM shop_orders o WHERE o.shop_user_id = u.id) AS orderCount,
            (SELECT COALESCE(SUM(o.total_inr),0) FROM shop_orders o WHERE o.shop_user_id = u.id) AS total_spend
     FROM shop_users u ${where} ORDER BY ${orderBy}`
  ).all(...params) as any[];
  return rows.map((r) => ({ ...r, totalSpend: r.total_spend }));
}

export function adminGetShopUser(id: number) {
  const u = getShopUserById(id);
  if (!u) return null;
  return { ...u, orders: listOrdersForUser(id), addresses: listAddresses(id), wishlist: listWishlist(id) };
}

// ---- freight admin ----
export function adminListFreight(opts: { q?: string; zeroOnly?: boolean; limit?: number; offset?: number }) {
  const conds: string[] = []; const params: any[] = [];
  // R27.5 #4 — search across part number, product name, AND the new route columns
  // (city / source / destination / mode) so "patna" or "by road" matches freight rows.
  if (opts.q) {
    conds.push("(f.part_number LIKE ? OR p.name LIKE ? OR f.city LIKE ? OR f.source LIKE ? OR f.destination LIKE ? OR f.mode LIKE ?)");
    const like = `%${opts.q}%`;
    params.push(like, like, like, like, like, like);
  }
  if (opts.zeroOnly) conds.push("f.freight_inr = 0");
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const total = (sqlite.prepare(`SELECT COUNT(*) c FROM freight_charges f LEFT JOIN products p ON p.part_number = f.part_number ${where}`).get(...params) as any).c;
  const limit = Math.min(500, Math.max(1, opts.limit || 100));
  const offset = Math.max(0, opts.offset || 0);
  const rows = sqlite.prepare(
    `SELECT f.id, f.part_number AS partNumber, f.freight_inr AS freightInr, f.updated_at AS updatedAt,
            f.city AS city, f.source AS source, f.destination AS destination, f.mode AS mode, p.name AS productName
     FROM freight_charges f LEFT JOIN products p ON p.part_number = f.part_number
     ${where} ORDER BY f.id DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);
  return { total, limit, offset, rows };
}

export function adminUpsertFreight(partNumber: string, freightInr: number, route?: { city?: string; source?: string; destination?: string; mode?: string }) {
  const r = route || {};
  sqlite.prepare(
    `INSERT INTO freight_charges (part_number, freight_inr, city, source, destination, mode, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(part_number) DO UPDATE SET
       freight_inr = excluded.freight_inr,
       city = COALESCE(excluded.city, freight_charges.city),
       source = COALESCE(excluded.source, freight_charges.source),
       destination = COALESCE(excluded.destination, freight_charges.destination),
       mode = COALESCE(excluded.mode, freight_charges.mode),
       updated_at = CURRENT_TIMESTAMP`
  ).run(partNumber, Number(freightInr) || 0, r.city ?? null, r.source ?? null, r.destination ?? null, r.mode ?? null);
  return sqlite.prepare(`SELECT id, part_number AS partNumber, freight_inr AS freightInr, city, source, destination, mode FROM freight_charges WHERE part_number = ?`).get(partNumber);
}

export function adminBulkFreight(partNumbers: string[], freightInr: number) {
  const tx = sqlite.transaction((pns: string[]) => { for (const pn of pns) adminUpsertFreight(pn, freightInr); });
  tx(partNumbers);
  return { updated: partNumbers.length };
}
