/**
 * PDF generation service — Round 4 elegant redesign
 * Uses pdf-lib to generate quotation PDFs.
 *
 * Design language (Round 4):
 *   - Deep navy primary  (#1a2540)
 *   - Narmada red accent (#c8102e) — used as thin strips, never as fills behind text
 *   - Warm off-white card backgrounds for BILL TO / SHIP TO / TOTALS
 *   - Generous 50pt margins, 13pt row height, larger fonts (8.5pt body)
 *   - All red strips are SEPARATED from text by padding — guaranteed no overlap
 *   - Signature block, footer with page numbers, soft horizontal dividers
 *
 * Font: NotoSans-Regular.ttf (Unicode, full embed) so ₹ U+20B9 renders correctly.
 */
import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import * as fs from "node:fs";
import * as path from "node:path";

const DATA_DIR = process.env.DATA_DIR || ".";
const QUOTATIONS_DIR = path.join(DATA_DIR, "uploads", "quotations");

function resolveFontPath(): string | null {
  const candidates = [
    path.join(__dirname, "assets", "fonts", "NotoSans-Regular.ttf"),
    path.join(process.cwd(), "server", "assets", "fonts", "NotoSans-Regular.ttf"),
    path.join(process.cwd(), "dist", "assets", "fonts", "NotoSans-Regular.ttf"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ── Colour palette (Round 4 — refined) ──────────────────────────────────────
const COLOR_NAVY        = rgb(0.102, 0.145, 0.251);  // #1A2540 — primary
const COLOR_NAVY_SOFT   = rgb(0.16, 0.21, 0.32);     // slightly lighter navy
const COLOR_RED         = rgb(0.784, 0.063, 0.180);  // #C8102E — Narmada red
const COLOR_RED_SOFT    = rgb(0.96, 0.92, 0.93);     // for subtle red wash
const COLOR_WHITE       = rgb(1, 1, 1);
const COLOR_CREAM       = rgb(0.976, 0.973, 0.969);  // #F9F8F7 — card background
const COLOR_BORDER      = rgb(0.86, 0.86, 0.88);     // soft grey border
const COLOR_TEXT        = rgb(0.118, 0.137, 0.18);   // near-black with navy tint
const COLOR_TEXT_MUTED  = rgb(0.45, 0.47, 0.52);
const COLOR_TEXT_LIGHT  = rgb(0.62, 0.64, 0.68);
const COLOR_ZEBRA       = rgb(0.985, 0.985, 0.99);

export interface QuotationForPdf {
  id: number;
  quoteNo: string;
  currency: string;
  fxRate: number | null;
  subtotal: number | null;
  totalDiscount: number | null;
  totalTax: number | null;
  grandTotal: number | null;
  validUntil: number | null;
  notes: string | null;
  terms: string | null;
  createdAt: number;
  shippingName?: string | null;
  shippingAddress?: string | null;
  shippingCity?: string | null;
  shippingState?: string | null;
  shippingPincode?: string | null;
  shippingPhone?: string | null;
}

export interface QuotationItemForPdf {
  lineNo: number;
  partNumber: string | null;
  productName: string;
  hsn: string | null;
  brand: string | null;
  qty: number;
  mrp: number;
  discount: number | null;
  gstPct: number | null;
  lineTotal: number | null;
}

export interface CompanyForPdf {
  name: string;
  gstin: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  bankName: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
}

export interface CustomerForPdf {
  name: string;
  gstNumber: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
}

function fmtCurrency(amount: number | null | undefined, currency = "INR", useUnicode = true): string {
  if (amount === null || amount === undefined) return "0.00";
  const sym = currency === "USD" ? "$" :
    currency === "EUR" ? (useUnicode ? "€" : "EUR ") :
    currency === "AED" ? "AED " :
    (useUnicode ? "₹" : "Rs. ");
  // Indian-style grouping for INR; western for others
  const formatted = currency === "INR"
    ? amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : amount.toFixed(2);
  return `${sym}${formatted}`;
}

function fmtDate(ts: number | null | undefined): string {
  if (!ts) return "-";
  return new Date(ts).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function drawText(page: PDFPage, text: string, x: number, y: number, font: PDFFont, size: number, color = COLOR_TEXT): void {
  page.drawText(String(text || ""), { x, y, font, size, color });
}
function drawRect(page: PDFPage, x: number, y: number, w: number, h: number, color: ReturnType<typeof rgb>): void {
  page.drawRectangle({ x, y, width: w, height: h, color });
}
function drawRectBorder(page: PDFPage, x: number, y: number, w: number, h: number, fill: ReturnType<typeof rgb> | null, border: ReturnType<typeof rgb>, borderWidth = 0.5): void {
  if (fill) page.drawRectangle({ x, y, width: w, height: h, color: fill });
  page.drawRectangle({ x, y, width: w, height: h, borderColor: border, borderWidth, color: undefined as any });
}

// Number-to-words for grand total (English Indian system)
function numberToWordsIndian(n: number): string {
  if (n === 0) return "Zero";
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  function inWords(num: number): string {
    if (num < 20) return a[num];
    if (num < 100) return b[Math.floor(num / 10)] + (num % 10 ? " " + a[num % 10] : "");
    if (num < 1000) return a[Math.floor(num / 100)] + " Hundred" + (num % 100 ? " " + inWords(num % 100) : "");
    return "";
  }
  const rupees = Math.floor(n);
  const paise = Math.round((n - rupees) * 100);
  let out = "";
  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const remainder = rupees % 1000;
  if (crore) out += inWords(crore) + " Crore ";
  if (lakh) out += inWords(lakh) + " Lakh ";
  if (thousand) out += inWords(thousand) + " Thousand ";
  if (remainder) out += inWords(remainder);
  out = out.trim() + " Rupees";
  if (paise) out += " and " + inWords(paise) + " Paise";
  return out + " Only";
}

/**
 * Generate a quotation PDF — Round 4 elegant edition.
 */
export async function generateQuotationPDF(
  quotation: QuotationForPdf,
  items: QuotationItemForPdf[],
  company: CompanyForPdf,
  customer: CustomerForPdf,
): Promise<Buffer> {
  if (!fs.existsSync(QUOTATIONS_DIR)) {
    fs.mkdirSync(QUOTATIONS_DIR, { recursive: true });
  }

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit as any);
  const PAGE_W = 595, PAGE_H = 842; // A4
  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);

  // Fonts
  const fontPath = resolveFontPath();
  let useUnicodeFont = fontPath !== null;
  let fontBold: PDFFont;
  let fontRegular: PDFFont;
  if (useUnicodeFont) {
    try {
      const notoBytes = fs.readFileSync(fontPath!);
      if (notoBytes.length < 100000) {
        throw new Error(`Font file suspiciously small (${notoBytes.length} bytes) — likely corrupt`);
      }
      fontRegular = await pdfDoc.embedFont(notoBytes, { subset: false });
      fontBold = fontRegular;
      console.log("[PDF] using font: NotoSans (Unicode, full embed)");
    } catch (err) {
      console.error("[PDF] NotoSans embed failed, falling back to Helvetica:", err);
      useUnicodeFont = false;
      fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    }
  } else {
    fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  }

  const fmt = (amount: number | null | undefined, cur = quotation.currency) =>
    fmtCurrency(amount, cur, useUnicodeFont);

  // ── Layout constants ────────────────────────────────────────────────────
  const MARGIN_L = 40;
  const MARGIN_R = PAGE_W - 40;
  const CONTENT_W = MARGIN_R - MARGIN_L;
  const HEADER_H = 92;            // taller, more breathing room
  const FOOTER_H = 32;

  // ── Helper: draw page header (title bar + accent strip) ─────────────────
  function drawPageHeader(p: PDFPage, isContinuation = false) {
    // Top navy band
    drawRect(p, 0, PAGE_H - HEADER_H, PAGE_W, HEADER_H, COLOR_NAVY);
    // Thin red accent strip below it (cleanly separated from text above)
    drawRect(p, 0, PAGE_H - HEADER_H - 4, PAGE_W, 4, COLOR_RED);

    // Logo placeholder (left) — circle with first letter
    const logoR = 22;
    const logoCx = MARGIN_L + logoR;
    const logoCy = PAGE_H - 40;
    p.drawCircle({ x: logoCx, y: logoCy, size: logoR, color: COLOR_RED });
    const initial = (company.name?.[0] || "N").toUpperCase();
    const initW = fontBold.widthOfTextAtSize(initial, 22);
    drawText(p, initial, logoCx - initW / 2, logoCy - 8, fontBold, 22, COLOR_WHITE);

    // Company name (right of logo)
    const nameX = logoCx + logoR + 12;
    drawText(p, company.name.toUpperCase(), nameX, PAGE_H - 32, fontBold, 17, COLOR_WHITE);
    // Address line (small)
    const addrLine = [company.address, company.city, company.state].filter(Boolean).join(", ");
    if (addrLine) {
      const truncated = addrLine.length > 80 ? addrLine.slice(0, 78) + "…" : addrLine;
      drawText(p, truncated, nameX, PAGE_H - 50, fontRegular, 8, rgb(0.85, 0.87, 0.92));
    }
    const contactLine = [
      company.phone ? "Phone: " + company.phone : null,
      company.email,
      company.gstin ? "GSTIN: " + company.gstin : null,
    ].filter(Boolean).join("   ·   ");
    if (contactLine) {
      drawText(p, contactLine, nameX, PAGE_H - 64, fontRegular, 7.5, rgb(0.78, 0.80, 0.86));
    }

    // Right side — QUOTATION label + quote no
    const labelText = isContinuation ? "QUOTATION (cont.)" : "QUOTATION";
    const labelW = fontBold.widthOfTextAtSize(labelText, 11);
    drawText(p, labelText, MARGIN_R - labelW, PAGE_H - 32, fontBold, 11, rgb(0.95, 0.65, 0.65));
    const quoteW = fontBold.widthOfTextAtSize(quotation.quoteNo, 13);
    drawText(p, quotation.quoteNo, MARGIN_R - quoteW, PAGE_H - 50, fontBold, 13, COLOR_WHITE);
    const dateStr = "Date: " + fmtDate(quotation.createdAt);
    const dateW = fontRegular.widthOfTextAtSize(dateStr, 8);
    drawText(p, dateStr, MARGIN_R - dateW, PAGE_H - 65, fontRegular, 8, rgb(0.85, 0.87, 0.92));
  }

  // ── Helper: draw page footer ────────────────────────────────────────────
  function drawPageFooter(p: PDFPage, pageNum: number, totalPages: number) {
    // Thin red accent above footer
    drawRect(p, 0, FOOTER_H, PAGE_W, 1.5, COLOR_RED);
    // Footer text
    drawText(p, "This is a computer-generated quotation. Subject to terms and conditions.", MARGIN_L, FOOTER_H - 14, fontRegular, 7, COLOR_TEXT_LIGHT);
    const pageLabel = `Page ${pageNum} of ${totalPages}`;
    const plw = fontRegular.widthOfTextAtSize(pageLabel, 7);
    drawText(p, pageLabel, MARGIN_R - plw, FOOTER_H - 14, fontRegular, 7, COLOR_TEXT_LIGHT);
    // Company tag (center)
    const tag = company.name;
    const tw = fontRegular.widthOfTextAtSize(tag, 7);
    drawText(p, tag, (PAGE_W - tw) / 2, FOOTER_H - 14, fontRegular, 7, COLOR_TEXT_MUTED);
  }

  drawPageHeader(page, false);

  // Body cursor starts below header + small breathing space
  let y = PAGE_H - HEADER_H - 18;

  // ── BILL TO / SHIP TO card row ──────────────────────────────────────────
  const hasShipping = !!(
    quotation.shippingName ||
    quotation.shippingAddress ||
    quotation.shippingCity ||
    quotation.shippingState ||
    quotation.shippingPincode ||
    quotation.shippingPhone
  );

  const CARD_GAP = 12;
  const cardW = hasShipping ? (CONTENT_W - CARD_GAP) / 2 : CONTENT_W;
  const cardX_left = MARGIN_L;
  const cardX_right = MARGIN_L + cardW + CARD_GAP;

  // Determine card height by measuring content lines
  const billLines: { text: string; bold?: boolean; muted?: boolean }[] = [
    { text: customer.name, bold: true },
  ];
  if (customer.address) billLines.push({ text: customer.address });
  const cityState = [customer.city, customer.state].filter(Boolean).join(", ");
  if (cityState) billLines.push({ text: cityState });
  if (customer.gstNumber) billLines.push({ text: "GSTIN: " + customer.gstNumber, muted: true });
  if (customer.phone) billLines.push({ text: "Phone: " + customer.phone, muted: true });
  if (customer.email) billLines.push({ text: customer.email, muted: true });

  const shipLines: { text: string; bold?: boolean; muted?: boolean }[] = [];
  if (hasShipping) {
    const shipName = quotation.shippingName || customer.name;
    shipLines.push({ text: shipName, bold: true });
    if (quotation.shippingAddress) shipLines.push({ text: quotation.shippingAddress });
    const shipCS = [quotation.shippingCity, quotation.shippingState].filter(Boolean).join(", ");
    const shipFull = quotation.shippingPincode
      ? (shipCS ? shipCS + " - " + quotation.shippingPincode : "PIN: " + quotation.shippingPincode)
      : shipCS;
    if (shipFull) shipLines.push({ text: shipFull });
    if (quotation.shippingPhone) shipLines.push({ text: "Phone: " + quotation.shippingPhone, muted: true });
  }

  const maxLines = Math.max(billLines.length, shipLines.length);
  const LABEL_BAR_H = 18;
  const LINE_H = 13;
  const CARD_PAD_Y = 10;
  const cardH = LABEL_BAR_H + CARD_PAD_Y + maxLines * LINE_H + 4;

  // Card backgrounds (cream + soft border)
  drawRectBorder(page, cardX_left, y - cardH, cardW, cardH, COLOR_CREAM, COLOR_BORDER);
  if (hasShipping) {
    drawRectBorder(page, cardX_right, y - cardH, cardW, cardH, COLOR_CREAM, COLOR_BORDER);
  }

  // Label bars (navy for BILL TO, red for SHIP TO — clearly distinct)
  drawRect(page, cardX_left, y - LABEL_BAR_H, cardW, LABEL_BAR_H, COLOR_NAVY);
  drawText(page, "BILL TO", cardX_left + 10, y - LABEL_BAR_H + 5, fontBold, 9, COLOR_WHITE);
  if (hasShipping) {
    drawRect(page, cardX_right, y - LABEL_BAR_H, cardW, LABEL_BAR_H, COLOR_RED);
    drawText(page, "SHIP TO", cardX_right + 10, y - LABEL_BAR_H + 5, fontBold, 9, COLOR_WHITE);
  }

  // Card bodies
  let cardLineY = y - LABEL_BAR_H - CARD_PAD_Y;
  for (const ln of billLines) {
    drawText(
      page,
      ln.text.length > 80 ? ln.text.slice(0, 78) + "…" : ln.text,
      cardX_left + 10,
      cardLineY,
      ln.bold ? fontBold : fontRegular,
      ln.bold ? 10 : 8.5,
      ln.muted ? COLOR_TEXT_MUTED : COLOR_TEXT,
    );
    cardLineY -= LINE_H;
  }

  if (hasShipping) {
    let shipLineY = y - LABEL_BAR_H - CARD_PAD_Y;
    for (const ln of shipLines) {
      drawText(
        page,
        ln.text.length > 80 ? ln.text.slice(0, 78) + "…" : ln.text,
        cardX_right + 10,
        shipLineY,
        ln.bold ? fontBold : fontRegular,
        ln.bold ? 10 : 8.5,
        ln.muted ? COLOR_TEXT_MUTED : COLOR_TEXT,
      );
      shipLineY -= LINE_H;
    }
  }

  y -= cardH + 8;

  // Valid until — small right-aligned chip below cards
  if (quotation.validUntil) {
    const chipText = "Valid Until: " + fmtDate(quotation.validUntil);
    const cw = fontBold.widthOfTextAtSize(chipText, 8.5) + 16;
    const chipX = MARGIN_R - cw;
    drawRectBorder(page, chipX, y - 16, cw, 16, COLOR_RED_SOFT, COLOR_RED, 0.8);
    drawText(page, chipText, chipX + 8, y - 12, fontBold, 8.5, COLOR_RED);
    y -= 22;
  } else {
    y -= 4;
  }

  // ── Compute totals from items (live) ────────────────────────────────────
  const itemTotals = items.reduce((acc, it) => {
    const qty = it.qty || 0;
    const mrp = it.mrp || 0;
    const disc = (it.discount || 0) / 100;
    const gst = (it.gstPct || 0) / 100;
    const lineNet = qty * mrp * (1 - disc);
    const lineTax = lineNet * gst;
    const lineGross = lineNet + lineTax;
    acc.subtotal += lineNet;
    acc.totalDiscount += qty * mrp * disc;
    acc.totalTax += lineTax;
    acc.grandTotal += lineGross;
    return acc;
  }, { subtotal: 0, totalDiscount: 0, totalTax: 0, grandTotal: 0 });
  const computedSubtotal = (quotation.subtotal && quotation.subtotal > 0) ? quotation.subtotal : itemTotals.subtotal;
  const computedDiscount = (quotation.totalDiscount && quotation.totalDiscount > 0) ? quotation.totalDiscount : itemTotals.totalDiscount;
  const computedTax = (quotation.totalTax && quotation.totalTax > 0) ? quotation.totalTax : itemTotals.totalTax;
  const computedGrand = (quotation.grandTotal && quotation.grandTotal > 0) ? quotation.grandTotal : itemTotals.grandTotal;

  // ── ITEMS TABLE ─────────────────────────────────────────────────────────
  // Carefully measured columns with breathing room. Net rate after discount + tax shown.
  const cols = {
    no:     MARGIN_L + 6,
    partNo: MARGIN_L + 26,
    desc:   MARGIN_L + 90,
    brand:  MARGIN_L + 220,
    hsn:    MARGIN_L + 268,
    qty:    MARGIN_L + 308,
    mrp:    MARGIN_L + 340,
    disc:   MARGIN_L + 388,
    gst:    MARGIN_L + 420,
    total:  MARGIN_L + 452,
  };
  const HEADER_BAR_H = 20;
  const ROW_H = 18;

  function drawTableHeaderAt(p: PDFPage, yTop: number): number {
    // Navy header bar
    drawRect(p, MARGIN_L, yTop - HEADER_BAR_H, CONTENT_W, HEADER_BAR_H, COLOR_NAVY);
    const ty = yTop - HEADER_BAR_H + 6;
    drawText(p, "#",        cols.no,     ty, fontBold, 7.5, COLOR_WHITE);
    drawText(p, "Part No.", cols.partNo, ty, fontBold, 7.5, COLOR_WHITE);
    drawText(p, "Description", cols.desc, ty, fontBold, 7.5, COLOR_WHITE);
    drawText(p, "Brand",    cols.brand,  ty, fontBold, 7.5, COLOR_WHITE);
    drawText(p, "HSN",      cols.hsn,    ty, fontBold, 7.5, COLOR_WHITE);
    drawText(p, "Qty",      cols.qty,    ty, fontBold, 7.5, COLOR_WHITE);
    drawText(p, "MRP",      cols.mrp,    ty, fontBold, 7.5, COLOR_WHITE);
    drawText(p, "Disc%",    cols.disc,   ty, fontBold, 7.5, COLOR_WHITE);
    drawText(p, "GST%",     cols.gst,    ty, fontBold, 7.5, COLOR_WHITE);
    // Total label right-aligned in its column
    const tlabel = "Total";
    const tw = fontBold.widthOfTextAtSize(tlabel, 7.5);
    drawText(p, tlabel, MARGIN_R - tw - 6, ty, fontBold, 7.5, COLOR_WHITE);
    return yTop - HEADER_BAR_H - 10;
  }

  // Truncation helpers per column width
  function truncTo(text: string, font: PDFFont, size: number, maxW: number): string {
    if (!text) return "";
    if (font.widthOfTextAtSize(text, size) <= maxW) return text;
    let s = text;
    while (s.length > 0 && font.widthOfTextAtSize(s + "…", size) > maxW) {
      s = s.slice(0, -1);
    }
    return s + "…";
  }

  let curPage: PDFPage = page;
  y -= 2;
  y = drawTableHeaderAt(curPage, y);
  const allPages: PDFPage[] = [page];
  const BOTTOM_THRESHOLD = FOOTER_H + 220; // leave room for totals + signature

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (y < BOTTOM_THRESHOLD) {
      const newPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
      allPages.push(newPage);
      curPage = newPage;
      drawPageHeader(newPage, true);
      y = PAGE_H - HEADER_H - 18;
      y = drawTableHeaderAt(curPage, y);
    }

    const rowY = y;
    const rowTopY = rowY - ROW_H + 12; // top of row band
    // Zebra
    if (i % 2 === 1) {
      drawRect(curPage, MARGIN_L, rowY - 4, CONTENT_W, ROW_H, COLOR_ZEBRA);
    }
    // Subtle row separator
    drawRect(curPage, MARGIN_L, rowY - 4, CONTENT_W, 0.3, COLOR_BORDER);

    const descMaxW = cols.brand - cols.desc - 4;
    const partNoMaxW = cols.desc - cols.partNo - 4;
    const brandMaxW = cols.hsn - cols.brand - 4;

    const textY = rowY + 1; // mid-row

    drawText(curPage, String(item.lineNo), cols.no, textY, fontRegular, 8, COLOR_TEXT);
    drawText(curPage, truncTo(item.partNumber || "-", fontRegular, 8, partNoMaxW), cols.partNo, textY, fontRegular, 8, COLOR_TEXT);
    drawText(curPage, truncTo(item.productName, fontRegular, 8, descMaxW), cols.desc, textY, fontRegular, 8, COLOR_TEXT);
    drawText(curPage, truncTo(item.brand || "-", fontRegular, 7.5, brandMaxW), cols.brand, textY, fontRegular, 7.5, COLOR_TEXT_MUTED);
    drawText(curPage, item.hsn || "-", cols.hsn, textY, fontRegular, 7.5, COLOR_TEXT_MUTED);
    drawText(curPage, String(item.qty), cols.qty, textY, fontRegular, 8, COLOR_TEXT);
    drawText(curPage, fmt(item.mrp), cols.mrp, textY, fontRegular, 7.5, COLOR_TEXT);
    drawText(curPage, item.discount ? `${item.discount}%` : "-", cols.disc, textY, fontRegular, 7.5, COLOR_TEXT);
    drawText(curPage, item.gstPct ? `${item.gstPct}%` : "-", cols.gst, textY, fontRegular, 7.5, COLOR_TEXT);

    // Total — right-aligned at MARGIN_R
    const liveLineTotal = (item.lineTotal && item.lineTotal > 0)
      ? item.lineTotal
      : (item.qty * item.mrp * (1 - (item.discount || 0) / 100) * (1 + (item.gstPct || 0) / 100));
    const totalStr = fmt(liveLineTotal);
    const totalW = fontBold.widthOfTextAtSize(totalStr, 8);
    drawText(curPage, totalStr, MARGIN_R - totalW - 6, textY, fontBold, 8, COLOR_TEXT);

    y -= ROW_H;
  }

  // Close the table with a bottom border
  drawRect(curPage, MARGIN_L, y + 9, CONTENT_W, 1, COLOR_NAVY);
  y -= 14;

  // If totals + signature won't fit, push to next page
  if (y < BOTTOM_THRESHOLD - 60) {
    const newPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
    allPages.push(newPage);
    curPage = newPage;
    drawPageHeader(newPage, true);
    y = PAGE_H - HEADER_H - 30;
  }

  // ── TOTALS CARD (right side, elegant cream card with red bottom strip) ──
  const totalsW = 230;
  const totalsX = MARGIN_R - totalsW;
  const totalsLines = 4 + (computedDiscount > 0 ? 1 : 0); // subtotal, [discount], gst, separator, grand
  const totalsH = 16 + totalsLines * 16 + 18; // top label + rows + bottom band

  // Card background + border
  drawRectBorder(curPage, totalsX, y - totalsH, totalsW, totalsH, COLOR_CREAM, COLOR_BORDER);
  // Top label band (navy)
  drawRect(curPage, totalsX, y - 18, totalsW, 18, COLOR_NAVY);
  drawText(curPage, "SUMMARY", totalsX + 10, y - 13, fontBold, 8.5, COLOR_WHITE);

  // Totals rows
  let ty = y - 36;
  function drawTotalRow(label: string, value: string, bold = false, color = COLOR_TEXT) {
    const fnt = bold ? fontBold : fontRegular;
    const size = bold ? 10 : 8.5;
    drawText(curPage, label, totalsX + 14, ty, fnt, size, color);
    const vw = fnt.widthOfTextAtSize(value, size);
    drawText(curPage, value, totalsX + totalsW - 14 - vw, ty, fnt, size, color);
    ty -= 16;
  }
  drawTotalRow("Subtotal", fmt(computedSubtotal));
  if (computedDiscount > 0) {
    drawTotalRow("Discount", "-" + fmt(computedDiscount), false, COLOR_RED);
  }
  drawTotalRow("GST", fmt(computedTax));
  // Thin separator above Grand Total
  drawRect(curPage, totalsX + 12, ty + 11, totalsW - 24, 0.5, COLOR_BORDER);
  ty -= 2;
  drawTotalRow("GRAND TOTAL", fmt(computedGrand), true, COLOR_NAVY);

  // Bottom red strip — at the very bottom of the card, clear of text
  drawRect(curPage, totalsX, y - totalsH, totalsW, 3, COLOR_RED);

  // FX note (if applicable)
  if (quotation.currency !== "INR" && quotation.fxRate && quotation.fxRate !== 1) {
    drawText(curPage, `Rate: 1 ${quotation.currency} = ${useUnicodeFont ? "₹" : "Rs. "}${quotation.fxRate.toFixed(4)}`,
      totalsX + 14, y - totalsH - 12, fontRegular, 7, COLOR_TEXT_MUTED);
  }

  // ── AMOUNT IN WORDS (left of totals card) ───────────────────────────────
  const wordsY = y - 18;
  drawText(curPage, "Amount in Words:", MARGIN_L, wordsY, fontBold, 7.5, COLOR_TEXT_MUTED);
  const wordsStr = numberToWordsIndian(computedGrand);
  const wordsLines = wrapText(wordsStr, fontBold, 8, totalsX - MARGIN_L - 14);
  let wy = wordsY - 13;
  for (const ln of wordsLines.slice(0, 3)) {
    drawText(curPage, ln, MARGIN_L, wy, fontBold, 8, COLOR_TEXT);
    wy -= 11;
  }

  // Drop cursor below totals card
  y -= totalsH + 14;

  // ── BANK DETAILS + NOTES + TERMS ────────────────────────────────────────
  if (company.bankName && company.bankAccount) {
    drawText(curPage, "BANK DETAILS", MARGIN_L, y, fontBold, 8, COLOR_NAVY);
    y -= 12;
    drawRect(curPage, MARGIN_L, y + 10, 60, 0.5, COLOR_RED);
    drawText(
      curPage,
      `${company.bankName}   ·   A/C: ${company.bankAccount}   ·   IFSC: ${company.bankIfsc || "-"}`,
      MARGIN_L, y - 2, fontRegular, 8, COLOR_TEXT,
    );
    y -= 14;
  }

  if (quotation.notes) {
    y -= 6;
    drawText(curPage, "NOTES", MARGIN_L, y, fontBold, 8, COLOR_NAVY);
    drawRect(curPage, MARGIN_L, y - 4, 30, 0.5, COLOR_RED);
    y -= 12;
    const lines = wrapText(quotation.notes, fontRegular, 8, CONTENT_W - 4);
    for (const line of lines.slice(0, 4)) {
      drawText(curPage, line, MARGIN_L, y, fontRegular, 8, COLOR_TEXT);
      y -= 11;
    }
  }

  if (quotation.terms) {
    y -= 4;
    drawText(curPage, "TERMS & CONDITIONS", MARGIN_L, y, fontBold, 8, COLOR_NAVY);
    drawRect(curPage, MARGIN_L, y - 4, 100, 0.5, COLOR_RED);
    y -= 12;
    const lines = wrapText(quotation.terms, fontRegular, 7.5, CONTENT_W - 4);
    for (const line of lines.slice(0, 6)) {
      drawText(curPage, line, MARGIN_L, y, fontRegular, 7.5, COLOR_TEXT_MUTED);
      y -= 10;
    }
  }

  // ── SIGNATURE BLOCK (bottom-right of last page) ─────────────────────────
  // Reserve space above footer; if no room, push to new page
  if (y < FOOTER_H + 100) {
    const newPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
    allPages.push(newPage);
    curPage = newPage;
    drawPageHeader(newPage, true);
    y = PAGE_H - HEADER_H - 30;
  }
  const sigX = MARGIN_R - 180;
  const sigY = FOOTER_H + 60;
  drawRect(curPage, sigX, sigY, 180, 0.5, COLOR_TEXT_MUTED);
  drawText(curPage, "Authorised Signatory", sigX, sigY - 12, fontBold, 8, COLOR_TEXT);
  drawText(curPage, `For ${company.name}`, sigX, sigY - 24, fontRegular, 7.5, COLOR_TEXT_MUTED);

  // ── FOOTERS on every page ───────────────────────────────────────────────
  const totalPages = allPages.length;
  allPages.forEach((p, idx) => drawPageFooter(p, idx + 1, totalPages));

  // ── SAVE ────────────────────────────────────────────────────────────────
  const pdfBytes = await pdfDoc.save();
  const buffer = Buffer.from(pdfBytes);

  const safeName = quotation.quoteNo.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.join(QUOTATIONS_DIR, `${safeName}.pdf`);
  fs.writeFileSync(filePath, buffer);

  console.log(`[pdf] Generated quotation PDF: ${filePath} (${totalPages} pages, ${items.length} items)`);
  return buffer;
}

// Word-wrap helper
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// =====================================================================
// R5.3 — Purchase Order PDF (internal procurement doc, not customer-facing)
// =====================================================================
export interface PoForPdf {
  poNumber: string;
  createdAt?: number | null;
  status?: string | null;
  subtotal?: number | null;
  discount?: number | null;
  tax?: number | null;
  total?: number | null;
  notes?: string | null;
  shipToName?: string | null;
  shipToAddress?: string | null;
  shipToPhone?: string | null;
  customerName?: string | null;
  customerPoNumber?: string | null;
  poDate?: number | null;
  items?: Array<{
    partNumber?: string | null;
    brand?: string | null;
    description?: string | null;
    qty?: number | null;
    unitPrice?: number | null;
    discountPct?: number | null;
    taxPct?: number | null;
    lineTotal?: number | null;
    vendorName?: string | null;
    vendorRate?: number | null;
    purchaseCost?: number | null;
  }>;
}

export async function generatePOPDF(po: PoForPdf, company: any): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const PAGE_W = 595, PAGE_H = 842;
  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const reg = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const M = 40;
  let y = PAGE_H - M;

  // Header band
  drawRect(page, 0, PAGE_H - 70, PAGE_W, 70, COLOR_NAVY);
  drawText(page, company?.name || "NARMADA MOTORS", M, PAGE_H - 36, bold, 18, COLOR_WHITE);
  drawText(page, "PURCHASE ORDER", PAGE_W - M - 150, PAGE_H - 36, bold, 16, COLOR_WHITE);
  if (company?.gstin) drawText(page, `GSTIN: ${company.gstin}`, M, PAGE_H - 56, reg, 9, COLOR_WHITE);
  y = PAGE_H - 90;

  // Company address block
  const addr = [company?.addressLine1, company?.addressLine2, [company?.city, company?.state, company?.pincode].filter(Boolean).join(", ")].filter(Boolean) as string[];
  for (const line of addr) { drawText(page, line, M, y, reg, 9, COLOR_TEXT_MUTED); y -= 12; }
  y -= 6;

  // PO meta
  drawText(page, `PO No: ${po.poNumber}`, M, y, bold, 11);
  drawText(page, `Date: ${fmtDate(po.createdAt)}`, PAGE_W - M - 160, y, reg, 10);
  y -= 16;
  drawText(page, `Status: ${(po.status || "draft").toUpperCase()}`, M, y, reg, 10);
  y -= 20;

  // Table header
  const cols = [
    { x: M, w: 25, label: "#" },
    { x: M + 25, w: 80, label: "Part No" },
    { x: M + 105, w: 55, label: "Brand" },
    { x: M + 160, w: 110, label: "Description" },
    { x: M + 270, w: 30, label: "Qty" },
    { x: M + 300, w: 65, label: "Seller" },
    { x: M + 365, w: 55, label: "Rate" },
    { x: M + 420, w: 55, label: "Amount" },
  ];
  drawRect(page, M, y - 4, PAGE_W - 2 * M, 18, COLOR_CREAM);
  for (const c of cols) drawText(page, c.label, c.x + 2, y, bold, 9, COLOR_NAVY);
  y -= 20;

  const items = po.items || [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (y < 120) { page = pdfDoc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - M; }
    const descLines = wrapText(String(it.description || ""), reg, 8, 105);
    drawText(page, String(i + 1), cols[0].x + 2, y, reg, 8);
    drawText(page, String(it.partNumber || "-"), cols[1].x + 2, y, reg, 8);
    drawText(page, String(it.brand || "-"), cols[2].x + 2, y, reg, 8);
    drawText(page, descLines[0] || "-", cols[3].x + 2, y, reg, 8);
    drawText(page, String(it.qty ?? 0), cols[4].x + 2, y, reg, 8);
    drawText(page, String(it.vendorName || "-"), cols[5].x + 2, y, reg, 8);
    const rate = it.vendorRate ?? it.unitPrice;
    drawText(page, fmtCurrency(rate, "INR", false), cols[6].x + 2, y, reg, 8);
    drawText(page, fmtCurrency(it.lineTotal, "INR", false), cols[7].x + 2, y, reg, 8);
    y -= 14;
    for (let l = 1; l < descLines.length; l++) { drawText(page, descLines[l], cols[3].x + 2, y, reg, 8); y -= 12; }
    drawRect(page, M, y + 4, PAGE_W - 2 * M, 0.5, COLOR_BORDER);
  }

  // Totals
  y -= 10;
  const tx = PAGE_W - M - 200;
  const trow = (label: string, val: number | null | undefined, isBold = false) => {
    drawText(page, label, tx, y, isBold ? bold : reg, 10);
    drawText(page, fmtCurrency(val, "INR", false), tx + 110, y, isBold ? bold : reg, 10);
    y -= 16;
  };
  trow("Subtotal", po.subtotal);
  trow("Discount", po.discount);
  trow("Tax (GST)", po.tax);
  drawRect(page, tx, y + 4, 200, 0.5, COLOR_BORDER);
  trow("Grand Total", po.total, true);

  if (po.notes) {
    y -= 10;
    drawText(page, "Notes:", M, y, bold, 9); y -= 12;
    for (const line of wrapText(po.notes, reg, 9, PAGE_W - 2 * M)) { drawText(page, line, M, y, reg, 9, COLOR_TEXT_MUTED); y -= 12; }
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

// =====================================================================
// R14.2 — Customer-rate Purchase Order PDF (Delhi + Data team download)
// Mirrors generatePOPDF's layout but uses the CUSTOMER rate (unitPrice) and
// strips every vendor/internal field. There is NO vendor column, NO vendor
// rate, NO purchase cost. Line Total = qty x customer rate. Safe to hand to
// the customer or to Delhi (who must not see vendor pricing).
// Columns: # | Part No | Brand | Description | Qty | Customer Rate | Line Total
// =====================================================================
export async function generateCustomerPOPDF(po: PoForPdf, company: any): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const PAGE_W = 595, PAGE_H = 842;
  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const reg = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const M = 40;
  let y = PAGE_H - M;

  // Header band (reuse Narmada navy/red styling)
  drawRect(page, 0, PAGE_H - 70, PAGE_W, 70, COLOR_NAVY);
  drawRect(page, 0, PAGE_H - 73, PAGE_W, 3, COLOR_RED);
  drawText(page, company?.name || "NARMADA MOTORS", M, PAGE_H - 36, bold, 18, COLOR_WHITE);
  drawText(page, "PURCHASE ORDER", PAGE_W - M - 150, PAGE_H - 36, bold, 16, COLOR_WHITE);
  if (company?.gstin) drawText(page, `GSTIN: ${company.gstin}`, M, PAGE_H - 56, reg, 9, COLOR_WHITE);
  y = PAGE_H - 90;

  // Company address block
  const addr = [company?.addressLine1, company?.addressLine2, [company?.city, company?.state, company?.pincode].filter(Boolean).join(", ")].filter(Boolean) as string[];
  for (const line of addr) { drawText(page, line, M, y, reg, 9, COLOR_TEXT_MUTED); y -= 12; }
  y -= 6;

  // Bill-to / ship-to + PO meta
  if (po.customerName) { drawText(page, `Customer: ${po.customerName}`, M, y, bold, 11); y -= 14; }
  if (po.customerPoNumber) { drawText(page, `Customer PO #: ${po.customerPoNumber}`, M, y, reg, 10, COLOR_TEXT_MUTED); y -= 13; }
  const shipBits = [po.shipToName, po.shipToAddress, po.shipToPhone].filter(Boolean) as string[];
  if (shipBits.length) {
    drawText(page, "Ship To:", M, y, bold, 9); y -= 12;
    for (const sb of shipBits) { for (const line of wrapText(sb, reg, 9, PAGE_W - 2 * M)) { drawText(page, line, M, y, reg, 9, COLOR_TEXT_MUTED); y -= 12; } }
  }
  y -= 4;
  drawText(page, `PO No: ${po.poNumber}`, M, y, bold, 11);
  drawText(page, `Date: ${fmtDate(po.poDate ?? po.createdAt)}`, PAGE_W - M - 160, y, reg, 10);
  y -= 20;

  // Table header — NO vendor column
  const cols = [
    { x: M, w: 25, label: "#" },
    { x: M + 25, w: 95, label: "Part No" },
    { x: M + 120, w: 70, label: "Brand" },
    { x: M + 190, w: 150, label: "Description" },
    { x: M + 340, w: 35, label: "Qty" },
    { x: M + 375, w: 70, label: "Cust. Rate" },
    { x: M + 445, w: 70, label: "Line Total" },
  ];
  drawRect(page, M, y - 4, PAGE_W - 2 * M, 18, COLOR_CREAM);
  for (const c of cols) drawText(page, c.label, c.x + 2, y, bold, 9, COLOR_NAVY);
  y -= 20;

  const items = po.items || [];
  let subtotal = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (y < 120) { page = pdfDoc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - M; }
    const qty = Number(it.qty ?? 0) || 0;
    const rate = it.unitPrice != null ? Number(it.unitPrice) : 0;
    const lineTotal = it.lineTotal != null ? Number(it.lineTotal) : rate * qty;
    subtotal += lineTotal;
    const descLines = wrapText(String(it.description || ""), reg, 8, 145);
    drawText(page, String(i + 1), cols[0].x + 2, y, reg, 8);
    drawText(page, String(it.partNumber || "-"), cols[1].x + 2, y, reg, 8);
    drawText(page, String(it.brand || "-"), cols[2].x + 2, y, reg, 8);
    drawText(page, descLines[0] || "-", cols[3].x + 2, y, reg, 8);
    drawText(page, String(qty), cols[4].x + 2, y, reg, 8);
    drawText(page, fmtCurrency(rate, "INR", false), cols[5].x + 2, y, reg, 8);
    drawText(page, fmtCurrency(lineTotal, "INR", false), cols[6].x + 2, y, reg, 8);
    y -= 14;
    for (let l = 1; l < descLines.length; l++) { drawText(page, descLines[l], cols[3].x + 2, y, reg, 8); y -= 12; }
    drawRect(page, M, y + 4, PAGE_W - 2 * M, 0.5, COLOR_BORDER);
  }

  // Totals — prefer stored PO totals, fall back to computed customer subtotal
  y -= 10;
  const tx = PAGE_W - M - 200;
  const trow = (label: string, val: number | null | undefined, isBold = false) => {
    drawText(page, label, tx, y, isBold ? bold : reg, 10);
    drawText(page, fmtCurrency(val, "INR", false), tx + 110, y, isBold ? bold : reg, 10);
    y -= 16;
  };
  trow("Subtotal", po.subtotal != null ? po.subtotal : subtotal);
  trow("Discount", po.discount);
  trow("Tax (GST)", po.tax);
  drawRect(page, tx, y + 4, 200, 0.5, COLOR_BORDER);
  trow("Grand Total", po.total != null ? po.total : subtotal, true);

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

// =====================================================================
// R8-v2 — Internal Purchase Order PDF (Bug 4)
// Shows seller + purchase rate + line cost + customer rate. Internal-only —
// must never be sent to the customer (the customer-facing doc is generatePOPDF /
// the quotation PDF). Columns:
//   S.No | Part No | Brand | Description | Qty | Vendor | Purchase Rate | Line Cost | Customer Rate
// =====================================================================
export async function generateInternalPOPDF(po: PoForPdf, company: any): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const PAGE_W = 842, PAGE_H = 595; // landscape — more horizontal room for 9 columns
  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const reg = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const M = 30;
  let y = PAGE_H - M;

  drawRect(page, 0, PAGE_H - 60, PAGE_W, 60, COLOR_NAVY);
  drawText(page, company?.name || "NARMADA MOTORS", M, PAGE_H - 30, bold, 16, COLOR_WHITE);
  drawText(page, "INTERNAL PURCHASE ORDER", PAGE_W - M - 240, PAGE_H - 30, bold, 14, COLOR_WHITE);
  drawText(page, "CONFIDENTIAL — NOT FOR CUSTOMER", PAGE_W - M - 240, PAGE_H - 48, reg, 8, COLOR_WHITE);
  y = PAGE_H - 78;

  drawText(page, `PO No: ${po.poNumber}`, M, y, bold, 11);
  drawText(page, `Date: ${fmtDate(po.createdAt)}`, PAGE_W - M - 200, y, reg, 10);
  y -= 14;
  drawText(page, `Status: ${(po.status || "draft").toUpperCase()}`, M, y, reg, 10);
  if (po.shipToName) drawText(page, `Ship To: ${po.shipToName}`, M + 160, y, reg, 10);
  y -= 20;

  const cols = [
    { x: M, w: 28, label: "S.No" },
    { x: M + 28, w: 95, label: "Part No" },
    { x: M + 123, w: 70, label: "Brand" },
    { x: M + 193, w: 175, label: "Description" },
    { x: M + 368, w: 35, label: "Qty" },
    { x: M + 403, w: 110, label: "Vendor" },
    { x: M + 513, w: 80, label: "Purch. Rate" },
    { x: M + 593, w: 85, label: "Line Cost" },
    { x: M + 678, w: 85, label: "Cust. Rate" },
  ];
  const drawHeader = () => {
    drawRect(page, M, y - 4, PAGE_W - 2 * M, 18, COLOR_CREAM);
    for (const c of cols) drawText(page, c.label, c.x + 2, y, bold, 8, COLOR_NAVY);
    y -= 20;
  };
  drawHeader();

  const items = po.items || [];
  let totalCost = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (y < 70) { page = pdfDoc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - M; drawHeader(); }
    const qty = Number(it.qty ?? 0);
    const purchRate = it.vendorRate ?? it.purchaseCost ?? null;
    const lineCost = purchRate != null ? purchRate * qty : null;
    if (lineCost != null) totalCost += lineCost;
    const custRate = it.unitPrice ?? null;
    const descLines = wrapText(String(it.description || ""), reg, 8, 170);
    drawText(page, String(i + 1), cols[0].x + 2, y, reg, 8);
    drawText(page, String(it.partNumber || "-"), cols[1].x + 2, y, reg, 8);
    drawText(page, String(it.brand || "-"), cols[2].x + 2, y, reg, 8);
    drawText(page, descLines[0] || "-", cols[3].x + 2, y, reg, 8);
    drawText(page, String(qty), cols[4].x + 2, y, reg, 8);
    drawText(page, String(it.vendorName || "-"), cols[5].x + 2, y, reg, 8);
    drawText(page, purchRate != null ? fmtCurrency(purchRate, "INR", false) : "-", cols[6].x + 2, y, reg, 8);
    drawText(page, lineCost != null ? fmtCurrency(lineCost, "INR", false) : "-", cols[7].x + 2, y, reg, 8);
    drawText(page, custRate != null ? fmtCurrency(custRate, "INR", false) : "-", cols[8].x + 2, y, reg, 8);
    y -= 14;
    for (let l = 1; l < descLines.length; l++) { drawText(page, descLines[l], cols[3].x + 2, y, reg, 8); y -= 12; }
    drawRect(page, M, y + 4, PAGE_W - 2 * M, 0.5, COLOR_BORDER);
  }

  y -= 12;
  drawText(page, "Total Purchase Cost:", cols[6].x - 40, y, bold, 10);
  drawText(page, fmtCurrency(totalCost, "INR", false), cols[7].x + 2, y, bold, 10);

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

// =====================================================================
// R7.2 — Product Catalogue PDF (writes to uploads dir, returns served URL)
// =====================================================================
export async function generateCataloguePDF(
  products: any[],
  company: any,
  opts: { brand?: string; category?: string } = {},
): Promise<{ url: string; path: string }> {
  const pdfDoc = await PDFDocument.create();
  const PAGE_W = 595, PAGE_H = 842;
  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const reg = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const M = 40;

  drawRect(page, 0, PAGE_H - 80, PAGE_W, 80, COLOR_NAVY);
  drawText(page, company?.name || "NARMADA MOTORS", M, PAGE_H - 36, bold, 18, COLOR_WHITE);
  drawText(page, "PRODUCT CATALOGUE", M, PAGE_H - 58, reg, 12, COLOR_WHITE);
  const filt = [opts.brand, opts.category].filter(Boolean).join(" / ");
  if (filt) drawText(page, filt.toUpperCase(), PAGE_W - M - 180, PAGE_H - 58, reg, 10, COLOR_WHITE);
  let y = PAGE_H - 100;

  const cols = [
    { x: M, w: 100, label: "Part No" },
    { x: M + 100, w: 70, label: "Brand" },
    { x: M + 170, w: 220, label: "Product" },
    { x: M + 390, w: 60, label: "Category" },
    { x: M + 460, w: 55, label: "Price" },
  ];
  const drawHeader = () => {
    drawRect(page, M, y - 4, PAGE_W - 2 * M, 18, COLOR_CREAM);
    for (const c of cols) drawText(page, c.label, c.x + 2, y, bold, 9, COLOR_NAVY);
    y -= 20;
  };
  drawHeader();

  for (const p of products) {
    if (y < 80) { page = pdfDoc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - M; drawHeader(); }
    const nameLines = wrapText(String(p.name || ""), reg, 8, 215);
    drawText(page, String(p.partNumber || p.oemNumber || "-"), cols[0].x + 2, y, reg, 8);
    drawText(page, String(p.brand || "-"), cols[1].x + 2, y, reg, 8);
    drawText(page, nameLines[0] || "-", cols[2].x + 2, y, reg, 8);
    drawText(page, String(p.category || "-"), cols[3].x + 2, y, reg, 8);
    drawText(page, fmtCurrency(p.priceInr, "INR", false), cols[4].x + 2, y, reg, 8);
    y -= 14;
    for (let l = 1; l < nameLines.length; l++) { drawText(page, nameLines[l], cols[2].x + 2, y, reg, 8); y -= 12; }
    drawRect(page, M, y + 4, PAGE_W - 2 * M, 0.5, COLOR_BORDER);
  }

  const bytes = await pdfDoc.save();
  const dir = path.join(DATA_DIR, "uploads");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fname = `catalogue-${Date.now()}.pdf`;
  fs.writeFileSync(path.join(dir, fname), Buffer.from(bytes));
  return { url: `/files/${fname}`, path: path.join(dir, fname) };
}
