/**
 * PDF generation service — Session C
 * Uses pdf-lib to generate quotation PDFs.
 * Dark band + red accent matching Narmada Mobility branding.
 * Saves to uploads/quotations/{quote_no}.pdf
 *
 * Font note: NotoSans-Regular.ttf is used instead of the built-in Helvetica so that
 * Unicode characters such as the Rupee sign (₹ U+20B9) render correctly. Helvetica
 * (WinAnsi encoding) does not include U+20B9 and silently drops or errors on it.
 */
import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import * as fs from "node:fs";
import * as path from "node:path";

const DATA_DIR = process.env.DATA_DIR || ".";
const QUOTATIONS_DIR = path.join(DATA_DIR, "uploads", "quotations");

// Resolve path to the bundled NotoSans font (supports ₹ and full Unicode range).
// Tries multiple candidate locations so both dev (__dirname = server/) and
// prod (__dirname = dist/) work, as well as a safety CWD-relative path.
function resolveFontPath(): string | null {
  const candidates = [
    path.join(__dirname, "assets", "fonts", "NotoSans-Regular.ttf"),                  // prod: dist/assets
    path.join(process.cwd(), "server", "assets", "fonts", "NotoSans-Regular.ttf"),     // dev
    path.join(process.cwd(), "dist", "assets", "fonts", "NotoSans-Regular.ttf"),       // safety
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Color palette
const COLOR_DARK = rgb(0.1, 0.1, 0.15);        // near-black header
const COLOR_RED = rgb(0.78, 0.08, 0.08);        // Narmada red accent
const COLOR_WHITE = rgb(1, 1, 1);
const COLOR_LIGHT_GRAY = rgb(0.95, 0.95, 0.95); // alternate row
const COLOR_MID_GRAY = rgb(0.6, 0.6, 0.6);
const COLOR_TEXT = rgb(0.1, 0.1, 0.1);

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
  // Round 3: shipping address (optional — "ship to" block when any field is set)
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
  return `${sym}${amount.toFixed(2)}`;
}

function fmtDate(ts: number | null | undefined): string {
  if (!ts) return "-";
  return new Date(ts).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color = COLOR_TEXT,
): void {
  page.drawText(String(text || ""), { x, y, font, size, color });
}

function drawRect(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  color: ReturnType<typeof rgb>,
): void {
  page.drawRectangle({ x, y, width: w, height: h, color });
}

/**
 * Generate a quotation PDF.
 * Returns a Buffer and also saves to uploads/quotations/{quoteNo}.pdf
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
  // Required by pdf-lib to embed custom (non-Standard) fonts such as our NotoSans TTF.
  pdfDoc.registerFontkit(fontkit as any);
  const page = pdfDoc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();

  // Prefer NotoSans (Unicode / ₹ support). Fall back to Helvetica only if the font file
  // is missing or fontkit fails to parse it.
  const fontPath = resolveFontPath();
  let useUnicodeFont = fontPath !== null;
  let fontBold: PDFFont;
  let fontRegular: PDFFont;
  if (useUnicodeFont) {
    try {
      const notoBytes = fs.readFileSync(fontPath!);
      console.log(`[PDF] NotoSans font loaded: ${notoBytes.length} bytes from ${fontPath}`);
      if (notoBytes.length < 100000) {
        throw new Error(`Font file suspiciously small (${notoBytes.length} bytes) — likely corrupt`);
      }
      // CRITICAL: subset:false embeds the FULL font. subset:true causes glyph dropout
      // in pdf-lib where letters render as gaps because the subset table omits glyphs
      // that were referenced. Full embed adds ~2.5MB per PDF but is bulletproof.
      fontRegular = await pdfDoc.embedFont(notoBytes, { subset: false });
      fontBold = fontRegular; // same TTF; weight difference handled via font-size contrast
      console.log("[PDF] using font: NotoSans (Unicode, full embed)");
    } catch (err) {
      console.error("[PDF] NotoSans embed failed, falling back to Helvetica:", err);
      useUnicodeFont = false;
      fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    }
  } else {
    // Fallback: Helvetica (WinAnsi) — ₹ will be replaced with "Rs." by fmtCurrency
    fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    console.log("[PDF] using font: Helvetica (Rs. fallback) — font path not resolved");
  }

  // Closure-style fmtCurrency that captures the unicode flag so all call sites are safe
  const fmt = (amount: number | null | undefined, cur = quotation.currency) =>
    fmtCurrency(amount, cur, useUnicodeFont);

  let y = height - 40;
  const marginL = 40;
  const marginR = width - 40;
  const contentWidth = marginR - marginL;

  // ============ HEADER BAND ============
  drawRect(page, 0, height - 80, width, 80, COLOR_DARK);

  // Company name (large, white)
  drawText(page, company.name.toUpperCase(), marginL, height - 35, fontBold, 16, COLOR_WHITE);

  // Red accent bar
  drawRect(page, 0, height - 82, width, 3, COLOR_RED);

  // Company contact (small, white)
  const contactLine = [company.phone, company.email].filter(Boolean).join(" | ");
  if (contactLine) {
    drawText(page, contactLine, marginL, height - 55, fontRegular, 8, rgb(0.85, 0.85, 0.85));
  }
  const addrLine = [company.address, company.city, company.state].filter(Boolean).join(", ");
  if (addrLine) {
    drawText(page, addrLine, marginL, height - 67, fontRegular, 8, rgb(0.75, 0.75, 0.75));
  }

  // Quote label (right side of header)
  drawText(page, "QUOTATION", marginR - 120, height - 35, fontBold, 14, COLOR_RED);
  drawText(page, quotation.quoteNo, marginR - 120, height - 52, fontRegular, 10, COLOR_WHITE);
  drawText(page, `Date: ${fmtDate(quotation.createdAt)}`, marginR - 120, height - 65, fontRegular, 8, rgb(0.8, 0.8, 0.8));

  y = height - 100;

  // ============ GSTIN / Company Info ============
  if (company.gstin) {
    drawText(page, `GSTIN: ${company.gstin}`, marginL, y, fontRegular, 8, COLOR_MID_GRAY);
    y -= 14;
  }

  // ============ BILL TO  +  SHIP TO (Round 3) ============
  // Two columns: BILL TO on the left, SHIP TO on the right when shipping fields are set.
  y -= 6;
  const hasShipping = !!(
    quotation.shippingName ||
    quotation.shippingAddress ||
    quotation.shippingCity ||
    quotation.shippingState ||
    quotation.shippingPincode ||
    quotation.shippingPhone
  );
  const colWidth = hasShipping ? Math.floor((contentWidth - 12) / 2) : 120;
  const shipColX = marginL + colWidth + 12;

  drawRect(page, marginL, y - 4, colWidth, 16, COLOR_RED);
  drawText(page, "BILL TO", marginL + 4, y, fontBold, 9, COLOR_WHITE);
  if (hasShipping) {
    drawRect(page, shipColX, y - 4, colWidth, 16, COLOR_DARK);
    drawText(page, "SHIP TO", shipColX + 4, y, fontBold, 9, COLOR_WHITE);
  }

  const colHeaderY = y;
  y -= 20;
  const colBodyStartY = y;

  // BILL TO body (left column)
  let leftY = colBodyStartY;
  drawText(page, customer.name, marginL, leftY, fontBold, 10, COLOR_TEXT);
  leftY -= 14;
  if (customer.address) {
    drawText(page, customer.address, marginL, leftY, fontRegular, 8, COLOR_TEXT);
    leftY -= 12;
  }
  const custCityState = [customer.city, customer.state].filter(Boolean).join(", ");
  if (custCityState) {
    drawText(page, custCityState, marginL, leftY, fontRegular, 8, COLOR_TEXT);
    leftY -= 12;
  }
  if (customer.gstNumber) {
    drawText(page, `GSTIN: ${customer.gstNumber}`, marginL, leftY, fontRegular, 8, COLOR_MID_GRAY);
    leftY -= 12;
  }
  if (customer.phone) {
    drawText(page, `Ph: ${customer.phone}`, marginL, leftY, fontRegular, 8, COLOR_MID_GRAY);
    leftY -= 12;
  }

  // SHIP TO body (right column) — only if any shipping field present
  let rightY = colBodyStartY;
  if (hasShipping) {
    const shipName = quotation.shippingName || customer.name;
    drawText(page, shipName, shipColX, rightY, fontBold, 10, COLOR_TEXT);
    rightY -= 14;
    if (quotation.shippingAddress) {
      drawText(page, quotation.shippingAddress, shipColX, rightY, fontRegular, 8, COLOR_TEXT);
      rightY -= 12;
    }
    const shipCityState = [quotation.shippingCity, quotation.shippingState].filter(Boolean).join(", ");
    const shipLine2 = quotation.shippingPincode ? `${shipCityState}${shipCityState ? " " : ""}${quotation.shippingPincode}` : shipCityState;
    if (shipLine2) {
      drawText(page, shipLine2, shipColX, rightY, fontRegular, 8, COLOR_TEXT);
      rightY -= 12;
    }
    if (quotation.shippingPhone) {
      drawText(page, `Ph: ${quotation.shippingPhone}`, shipColX, rightY, fontRegular, 8, COLOR_MID_GRAY);
      rightY -= 12;
    }
  }

  // Collapse the two columns back to a single cursor at the lower of the two.
  y = Math.min(leftY, rightY);

  // Valid until (right side, anchored to the BILL TO header band so it never collides)
  if (quotation.validUntil) {
    const validStr = `Valid Until: ${fmtDate(quotation.validUntil)}`;
    const vw = fontRegular.widthOfTextAtSize(validStr, 9);
    drawText(page, validStr, marginR - vw, colHeaderY + 24, fontRegular, 9, COLOR_RED);
  }

  y -= 10;

  // ============ COMPUTE TOTALS FROM ITEMS ============
  // Stored totals are often zero/null. Compute live from items so PDFs always
  // reflect the truth even for older quotes that never had totals saved.
  const itemTotals = items.reduce(
    (acc, it) => {
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
    },
    { subtotal: 0, totalDiscount: 0, totalTax: 0, grandTotal: 0 },
  );
  const computedSubtotal = (quotation.subtotal && quotation.subtotal > 0) ? quotation.subtotal : itemTotals.subtotal;
  const computedDiscount = (quotation.totalDiscount && quotation.totalDiscount > 0) ? quotation.totalDiscount : itemTotals.totalDiscount;
  const computedTax = (quotation.totalTax && quotation.totalTax > 0) ? quotation.totalTax : itemTotals.totalTax;
  const computedGrand = (quotation.grandTotal && quotation.grandTotal > 0) ? quotation.grandTotal : itemTotals.grandTotal;

  // ============ COLUMN LAYOUT (shared across pages) ============
  const cols = {
    no: marginL + 4,
    partNo: marginL + 24,
    desc: marginL + 84,
    brand: marginL + 204,
    hsn: marginL + 254,
    qty: marginL + 294,
    mrp: marginL + 326,
    disc: marginL + 361,
    gst: marginL + 393,
    total: marginL + 425,
  };

  function drawTableHeaderAt(targetPage: PDFPage, headerYTop: number): number {
    drawRect(targetPage, marginL, headerYTop - 4, contentWidth, 18, COLOR_DARK);
    drawText(targetPage, "#", cols.no, headerYTop, fontBold, 7, COLOR_WHITE);
    drawText(targetPage, "Part No.", cols.partNo, headerYTop, fontBold, 7, COLOR_WHITE);
    drawText(targetPage, "Description", cols.desc, headerYTop, fontBold, 7, COLOR_WHITE);
    drawText(targetPage, "Brand", cols.brand, headerYTop, fontBold, 7, COLOR_WHITE);
    drawText(targetPage, "HSN", cols.hsn, headerYTop, fontBold, 7, COLOR_WHITE);
    drawText(targetPage, "Qty", cols.qty, headerYTop, fontBold, 7, COLOR_WHITE);
    drawText(targetPage, "MRP", cols.mrp, headerYTop, fontBold, 7, COLOR_WHITE);
    drawText(targetPage, "Disc%", cols.disc, headerYTop, fontBold, 7, COLOR_WHITE);
    drawText(targetPage, "GST%", cols.gst, headerYTop, fontBold, 7, COLOR_WHITE);
    drawText(targetPage, "Total", cols.total, headerYTop, fontBold, 7, COLOR_WHITE);
    return headerYTop - 20;
  }

  // ============ TABLE HEADER (page 1) ============
  y -= 6;
  let curPage: PDFPage = page;
  y = drawTableHeaderAt(curPage, y);
  const allPages: PDFPage[] = [page];

  // ============ TABLE ROWS (with real pagination) ============
  const ROW_HEIGHT = 14;
  const BOTTOM_THRESHOLD = 100; // when y drops below this, start a new page

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (y < BOTTOM_THRESHOLD) {
      const newPage = pdfDoc.addPage([595, 842]);
      allPages.push(newPage);
      curPage = newPage;
      // Continuation header band
      drawRect(curPage, 0, height - 30, width, 30, COLOR_DARK);
      drawText(
        curPage,
        `${company.name.toUpperCase()} — QUOTATION ${quotation.quoteNo} (continued)`,
        marginL,
        height - 20,
        fontBold,
        9,
        COLOR_WHITE,
      );
      y = height - 50;
      y = drawTableHeaderAt(curPage, y);
    }

    const rowY = y;

    if (i % 2 === 1) {
      drawRect(curPage, marginL, rowY - 4, contentWidth, ROW_HEIGHT, COLOR_LIGHT_GRAY);
    }

    const descTrunc = item.productName.length > 22
      ? item.productName.slice(0, 21) + "…"
      : item.productName;
    const brandTrunc = item.brand && item.brand.length > 9
      ? item.brand.slice(0, 8) + "…"
      : (item.brand || "-");

    drawText(curPage, String(item.lineNo), cols.no, rowY, fontRegular, 7, COLOR_TEXT);
    drawText(curPage, item.partNumber || "-", cols.partNo, rowY, fontRegular, 7, COLOR_TEXT);
    drawText(curPage, descTrunc, cols.desc, rowY, fontRegular, 7, COLOR_TEXT);
    drawText(curPage, brandTrunc, cols.brand, rowY, fontRegular, 7, COLOR_TEXT);
    drawText(curPage, item.hsn || "-", cols.hsn, rowY, fontRegular, 7, COLOR_TEXT);
    drawText(curPage, String(item.qty), cols.qty, rowY, fontRegular, 7, COLOR_TEXT);
    drawText(curPage, fmt(item.mrp), cols.mrp, rowY, fontRegular, 7, COLOR_TEXT);
    drawText(curPage, item.discount ? `${item.discount}%` : "-", cols.disc, rowY, fontRegular, 7, COLOR_TEXT);
    drawText(curPage, item.gstPct ? `${item.gstPct}%` : "-", cols.gst, rowY, fontRegular, 7, COLOR_TEXT);
    // Use computed line total if stored is null/zero
    const liveLineTotal = (item.lineTotal && item.lineTotal > 0)
      ? item.lineTotal
      : (item.qty * item.mrp * (1 - (item.discount || 0) / 100) * (1 + (item.gstPct || 0) / 100));
    drawText(curPage, fmt(liveLineTotal), cols.total, rowY, fontRegular, 7, COLOR_TEXT);

    y -= ROW_HEIGHT;
  }

  // If totals + footer won't fit on the current page, push them to a fresh page
  if (y < BOTTOM_THRESHOLD + 40) {
    const newPage = pdfDoc.addPage([595, 842]);
    allPages.push(newPage);
    curPage = newPage;
    drawRect(curPage, 0, height - 30, width, 30, COLOR_DARK);
    drawText(
      curPage,
      `${company.name.toUpperCase()} — QUOTATION ${quotation.quoteNo} (continued)`,
      marginL,
      height - 20,
      fontBold,
      9,
      COLOR_WHITE,
    );
    y = height - 60;
  }

  // ============ TOTALS BOX ============
  // Round 3: clean up the red bar so it no longer overlaps with the totals text.
  // We draw a thin red bar ABOVE the totals block (as a section divider), and a
  // bold red underline BELOW the Grand Total row (clear of the text).
  y -= 14;
  const totalsX = marginL + contentWidth - 170;
  const totalsValX = marginR - 4;
  // Top divider — thin red bar sitting above the totals, with breathing room.
  drawRect(curPage, totalsX, y + 8, 170, 2, COLOR_RED);

  function drawTotalRow(label: string, value: string, bold = false) {
    const fnt = bold ? fontBold : fontRegular;
    const col = bold ? COLOR_DARK : COLOR_TEXT;
    drawText(curPage, label, totalsX, y, fnt, 8, col);
    const vw = fnt.widthOfTextAtSize(value, 8);
    drawText(curPage, value, totalsValX - vw, y, fnt, 8, col);
    y -= 13;
  }

  drawTotalRow("Subtotal:", fmt(computedSubtotal));
  if (computedDiscount > 0) {
    drawTotalRow("Discount:", `-${fmt(computedDiscount)}`);
  }
  drawTotalRow("GST:", fmt(computedTax));
  y -= 2;
  drawRect(curPage, totalsX, y - 2, 170, 1, COLOR_MID_GRAY);
  y -= 6;
  drawTotalRow("GRAND TOTAL:", fmt(computedGrand), true);
  // Bottom red underline — clears the Grand Total text (which already moved y down 13px).
  drawRect(curPage, totalsX, y + 6, 170, 2.5, COLOR_RED);
  y -= 4;
  if (quotation.currency !== "INR" && quotation.fxRate && quotation.fxRate !== 1) {
    drawText(
      curPage,
      `(Rate: 1 ${quotation.currency} = ${useUnicodeFont ? "\u20b9" : "Rs. "}${quotation.fxRate.toFixed(4)})`,
      totalsX,
      y,
      fontRegular,
      7,
      COLOR_MID_GRAY,
    );
    y -= 12;
  }

  // ============ BANK DETAILS ============
  if (company.bankName && company.bankAccount) {
    y -= 10;
    drawText(curPage, "Bank Details:", marginL, y, fontBold, 8, COLOR_DARK);
    y -= 12;
    drawText(
      curPage,
      `${company.bankName} | A/C: ${company.bankAccount} | IFSC: ${company.bankIfsc || "-"}`,
      marginL,
      y,
      fontRegular,
      7.5,
      COLOR_TEXT,
    );
    y -= 12;
  }

  // ============ NOTES / TERMS ============
  if (quotation.notes) {
    y -= 6;
    drawText(curPage, "Notes:", marginL, y, fontBold, 8, COLOR_DARK);
    y -= 12;
    const lines = wrapText(quotation.notes, fontRegular, 8, contentWidth);
    for (const line of lines.slice(0, 3)) {
      drawText(curPage, line, marginL, y, fontRegular, 8, COLOR_TEXT);
      y -= 11;
    }
  }

  if (quotation.terms) {
    y -= 4;
    drawText(curPage, "Terms & Conditions:", marginL, y, fontBold, 8, COLOR_DARK);
    y -= 11;
    const lines = wrapText(quotation.terms, fontRegular, 7, contentWidth);
    for (const line of lines.slice(0, 5)) {
      drawText(curPage, line, marginL, y, fontRegular, 7, COLOR_MID_GRAY);
      y -= 10;
    }
  }

  // ============ FOOTERS on EVERY page ============
  const totalPages = allPages.length;
  allPages.forEach((p, idx) => {
    drawRect(p, 0, 24, width, 20, COLOR_DARK);
    drawText(
      p,
      `${company.name} | This is a computer-generated quotation`,
      marginL,
      30,
      fontRegular,
      7,
      rgb(0.75, 0.75, 0.75),
    );
    const pageLabel = `Page ${idx + 1} of ${totalPages}`;
    const plw = fontRegular.widthOfTextAtSize(pageLabel, 7);
    drawText(p, pageLabel, marginR - plw, 30, fontRegular, 7, rgb(0.75, 0.75, 0.75));
  });

  // ============ SAVE ============
  const pdfBytes = await pdfDoc.save();
  const buffer = Buffer.from(pdfBytes);

  const safeName = quotation.quoteNo.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.join(QUOTATIONS_DIR, `${safeName}.pdf`);
  fs.writeFileSync(filePath, buffer);

  console.log(`[pdf] Generated quotation PDF: ${filePath} (${totalPages} pages, ${items.length} items)`);
  return buffer;
}

// Simple text wrap helper
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
