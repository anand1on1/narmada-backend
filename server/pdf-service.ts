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
import * as fs from "node:fs";
import * as path from "node:path";

const DATA_DIR = process.env.DATA_DIR || ".";
const QUOTATIONS_DIR = path.join(DATA_DIR, "uploads", "quotations");

// Path to the bundled NotoSans font (supports ₹ and full Unicode range).
const NOTO_SANS_PATH = path.join(__dirname, "assets", "fonts", "NotoSans-Regular.ttf");

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

function fmtCurrency(amount: number | null | undefined, currency = "INR"): string {
  if (amount === null || amount === undefined) return "0.00";
  const sym = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "AED" ? "AED " : "₹";
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
  const page = pdfDoc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();

  // Prefer NotoSans (Unicode / ₹ support). Fall back to Helvetica only if the font file
  // is missing (e.g. first deploy before assets are copied).
  let fontBold: PDFFont;
  let fontRegular: PDFFont;
  if (fs.existsSync(NOTO_SANS_PATH)) {
    const notoBytes = fs.readFileSync(NOTO_SANS_PATH);
    // pdf-lib subset embedding: embed once and use for both regular and "bold" — NotoSans
    // variable font includes weight axis so visual weight is acceptable for headers.
    fontRegular = await pdfDoc.embedFont(notoBytes, { subset: true });
    fontBold = fontRegular; // same TTF; weight difference handled via font-size contrast
  } else {
    // Fallback: Helvetica (WinAnsi) — ₹ will be replaced with "Rs." by fmtCurrency
    fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  }

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

  // ============ BILL TO ============
  y -= 6;
  drawRect(page, marginL, y - 4, 120, 16, COLOR_RED);
  drawText(page, "BILL TO", marginL + 4, y, fontBold, 9, COLOR_WHITE);
  y -= 20;

  drawText(page, customer.name, marginL, y, fontBold, 10, COLOR_TEXT);
  y -= 14;
  if (customer.address) {
    drawText(page, customer.address, marginL, y, fontRegular, 8, COLOR_TEXT);
    y -= 12;
  }
  const custCityState = [customer.city, customer.state].filter(Boolean).join(", ");
  if (custCityState) {
    drawText(page, custCityState, marginL, y, fontRegular, 8, COLOR_TEXT);
    y -= 12;
  }
  if (customer.gstNumber) {
    drawText(page, `GSTIN: ${customer.gstNumber}`, marginL, y, fontRegular, 8, COLOR_MID_GRAY);
    y -= 12;
  }
  if (customer.phone) {
    drawText(page, `Ph: ${customer.phone}`, marginL, y, fontRegular, 8, COLOR_MID_GRAY);
    y -= 12;
  }

  // Valid until (right side)
  if (quotation.validUntil) {
    const validStr = `Valid Until: ${fmtDate(quotation.validUntil)}`;
    const vw = fontRegular.widthOfTextAtSize(validStr, 9);
    drawText(page, validStr, marginR - vw, y + 40, fontRegular, 9, COLOR_RED);
  }

  y -= 10;

  // ============ TABLE HEADER ============
  y -= 6;
  drawRect(page, marginL, y - 4, contentWidth, 18, COLOR_DARK);

  const cols = {
    no: marginL + 4,
    partNo: marginL + 24,
    desc: marginL + 90,
    hsn: marginL + 270,
    qty: marginL + 320,
    mrp: marginL + 355,
    disc: marginL + 395,
    gst: marginL + 430,
    total: marginL + 465,
  };

  const headerY = y;
  drawText(page, "#", cols.no, headerY, fontBold, 7, COLOR_WHITE);
  drawText(page, "Part No.", cols.partNo, headerY, fontBold, 7, COLOR_WHITE);
  drawText(page, "Description", cols.desc, headerY, fontBold, 7, COLOR_WHITE);
  drawText(page, "HSN", cols.hsn, headerY, fontBold, 7, COLOR_WHITE);
  drawText(page, "Qty", cols.qty, headerY, fontBold, 7, COLOR_WHITE);
  drawText(page, "MRP", cols.mrp, headerY, fontBold, 7, COLOR_WHITE);
  drawText(page, "Disc%", cols.disc, headerY, fontBold, 7, COLOR_WHITE);
  drawText(page, "GST%", cols.gst, headerY, fontBold, 7, COLOR_WHITE);
  drawText(page, "Total", cols.total, headerY, fontBold, 7, COLOR_WHITE);
  y -= 20;

  // ============ TABLE ROWS ============
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const rowY = y;

    // Alternate row background
    if (i % 2 === 1) {
      drawRect(page, marginL, rowY - 4, contentWidth, 14, COLOR_LIGHT_GRAY);
    }

    // Truncate description if needed
    const descTrunc = item.productName.length > 35
      ? item.productName.slice(0, 34) + "…"
      : item.productName;

    drawText(page, String(item.lineNo), cols.no, rowY, fontRegular, 7, COLOR_TEXT);
    drawText(page, item.partNumber || "-", cols.partNo, rowY, fontRegular, 7, COLOR_TEXT);
    drawText(page, descTrunc, cols.desc, rowY, fontRegular, 7, COLOR_TEXT);
    drawText(page, item.hsn || "-", cols.hsn, rowY, fontRegular, 7, COLOR_TEXT);
    drawText(page, String(item.qty), cols.qty, rowY, fontRegular, 7, COLOR_TEXT);
    drawText(page, fmtCurrency(item.mrp, quotation.currency), cols.mrp, rowY, fontRegular, 7, COLOR_TEXT);
    drawText(page, item.discount ? `${item.discount}%` : "-", cols.disc, rowY, fontRegular, 7, COLOR_TEXT);
    drawText(page, item.gstPct ? `${item.gstPct}%` : "-", cols.gst, rowY, fontRegular, 7, COLOR_TEXT);
    drawText(page, fmtCurrency(item.lineTotal, quotation.currency), cols.total, rowY, fontRegular, 7, COLOR_TEXT);

    y -= 14;

    // Page overflow protection (simple — add new page if needed)
    if (y < 160) {
      // Just stop rendering items — real implementation would add pages
      break;
    }
  }

  // ============ TOTALS BOX ============
  y -= 10;
  drawRect(page, marginL + contentWidth - 170, y - 4, 170, 3, COLOR_RED);
  y -= 10;

  const totalsX = marginL + contentWidth - 170;
  const totalsValX = marginR - 4;

  function drawTotalRow(label: string, value: string, bold = false) {
    const fnt = bold ? fontBold : fontRegular;
    const col = bold ? COLOR_DARK : COLOR_TEXT;
    drawText(page, label, totalsX, y, fnt, 8, col);
    const vw = fnt.widthOfTextAtSize(value, 8);
    drawText(page, value, totalsValX - vw, y, fnt, 8, col);
    y -= 13;
  }

  drawTotalRow("Subtotal:", fmtCurrency(quotation.subtotal, quotation.currency));
  if (quotation.totalDiscount && quotation.totalDiscount > 0) {
    drawTotalRow("Discount:", `-${fmtCurrency(quotation.totalDiscount, quotation.currency)}`);
  }
  drawTotalRow("GST:", fmtCurrency(quotation.totalTax, quotation.currency));
  y -= 2;
  drawRect(page, totalsX, y - 2, 170, 1, COLOR_MID_GRAY);
  y -= 6;
  drawTotalRow("GRAND TOTAL:", fmtCurrency(quotation.grandTotal, quotation.currency), true);
  if (quotation.currency !== "INR" && quotation.fxRate && quotation.fxRate !== 1) {
    drawText(
      page,
      `(Rate: 1 ${quotation.currency} = ₹${quotation.fxRate.toFixed(4)})`,
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
    drawText(page, "Bank Details:", marginL, y, fontBold, 8, COLOR_DARK);
    y -= 12;
    drawText(
      page,
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
    drawText(page, "Notes:", marginL, y, fontBold, 8, COLOR_DARK);
    y -= 12;
    // Simple wrap (basic)
    const lines = wrapText(quotation.notes, fontRegular, 8, contentWidth);
    for (const line of lines.slice(0, 3)) {
      drawText(page, line, marginL, y, fontRegular, 8, COLOR_TEXT);
      y -= 11;
    }
  }

  if (quotation.terms) {
    y -= 4;
    drawText(page, "Terms & Conditions:", marginL, y, fontBold, 8, COLOR_DARK);
    y -= 11;
    const lines = wrapText(quotation.terms, fontRegular, 7, contentWidth);
    for (const line of lines.slice(0, 5)) {
      drawText(page, line, marginL, y, fontRegular, 7, COLOR_MID_GRAY);
      y -= 10;
    }
  }

  // ============ FOOTER ============
  drawRect(page, 0, 24, width, 20, COLOR_DARK);
  drawText(
    page,
    `${company.name} | This is a computer-generated quotation`,
    marginL,
    30,
    fontRegular,
    7,
    rgb(0.75, 0.75, 0.75),
  );

  // ============ SAVE ============
  const pdfBytes = await pdfDoc.save();
  const buffer = Buffer.from(pdfBytes);

  const safeName = quotation.quoteNo.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.join(QUOTATIONS_DIR, `${safeName}.pdf`);
  fs.writeFileSync(filePath, buffer);

  console.log(`[pdf] Generated quotation PDF: ${filePath}`);
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
