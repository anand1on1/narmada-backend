/**
 * R26 — shared PDF helper built on pdf-lib (already a dependency; no new packages).
 *
 * Provides a small document builder with a consistent Narmada header/footer and a
 * key/value + table layout. Reused by:
 *   - Consignment "From Delhi" export (one section per PO)
 *   - Vendor Ledger export (one section per seller)
 *
 * Unicode font (NotoSans) is embedded so ₹ U+20B9 renders. Falls back to Helvetica
 * if the font file is missing (then ₹ is replaced with "Rs ").
 */
import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont, RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import * as fs from "node:fs";
import * as path from "node:path";

const NAVY = rgb(0.102, 0.145, 0.251);
const RED = rgb(0.784, 0.063, 0.18);
const GREY = rgb(0.42, 0.45, 0.5);
const LIGHT = rgb(0.93, 0.94, 0.96);
const WHITE = rgb(1, 1, 1);

const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

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

export interface PdfCell { text: string; width: number; align?: "left" | "right" | "center"; }
export interface PdfColumn { header: string; width: number; align?: "left" | "right" | "center"; }

export class PdfBuilder {
  private doc!: PDFDocument;
  private page!: PDFPage;
  private font!: PDFFont;
  private bold!: PDFFont;
  private hasUnicode = false;
  private y = 0;
  private title: string;
  private subtitle: string;

  private constructor(title: string, subtitle: string) {
    this.title = title;
    this.subtitle = subtitle;
  }

  static async create(title: string, subtitle = ""): Promise<PdfBuilder> {
    const b = new PdfBuilder(title, subtitle);
    b.doc = await PDFDocument.create();
    b.doc.registerFontkit(fontkit);
    const fp = resolveFontPath();
    if (fp) {
      const bytes = fs.readFileSync(fp);
      b.font = await b.doc.embedFont(bytes, { subset: true });
      b.bold = b.font; // single weight available; reuse for bold
      b.hasUnicode = true;
    } else {
      b.font = await b.doc.embedFont(StandardFonts.Helvetica);
      b.bold = await b.doc.embedFont(StandardFonts.HelveticaBold);
    }
    b.newPage();
    return b;
  }

  private san(s: string): string {
    if (this.hasUnicode) return s;
    return String(s ?? "").replace(/₹/g, "Rs ");
  }

  private newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.drawHeader();
    this.y = PAGE_H - 110;
  }

  private drawHeader() {
    // top navy band with title
    this.page.drawRectangle({ x: 0, y: PAGE_H - 70, width: PAGE_W, height: 70, color: NAVY });
    this.page.drawRectangle({ x: 0, y: PAGE_H - 74, width: PAGE_W, height: 4, color: RED });
    this.page.drawText(this.san("Narmada Mobility"), {
      x: MARGIN, y: PAGE_H - 38, size: 18, font: this.bold, color: WHITE,
    });
    if (this.title) {
      this.page.drawText(this.san(this.title), {
        x: MARGIN, y: PAGE_H - 58, size: 10, font: this.font, color: rgb(0.8, 0.84, 0.9),
      });
    }
    if (this.subtitle) {
      const w = this.font.widthOfTextAtSize(this.san(this.subtitle), 9);
      this.page.drawText(this.san(this.subtitle), {
        x: PAGE_W - MARGIN - w, y: PAGE_H - 50, size: 9, font: this.font, color: rgb(0.8, 0.84, 0.9),
      });
    }
  }

  private ensure(space: number) {
    if (this.y - space < 60) this.newPage();
  }

  sectionTitle(text: string) {
    this.ensure(40);
    this.y -= 8;
    this.page.drawRectangle({ x: MARGIN, y: this.y - 4, width: CONTENT_W, height: 22, color: LIGHT });
    this.page.drawRectangle({ x: MARGIN, y: this.y - 4, width: 4, height: 22, color: RED });
    this.page.drawText(this.san(text), { x: MARGIN + 10, y: this.y + 2, size: 11, font: this.bold, color: NAVY });
    this.y -= 26;
  }

  keyValues(pairs: Array<[string, string]>) {
    const colW = CONTENT_W / 2;
    for (let i = 0; i < pairs.length; i += 2) {
      this.ensure(18);
      for (let c = 0; c < 2; c++) {
        const pair = pairs[i + c];
        if (!pair) continue;
        const x = MARGIN + c * colW;
        this.page.drawText(this.san(pair[0] + ":"), { x, y: this.y, size: 8.5, font: this.bold, color: GREY });
        const labelW = this.bold.widthOfTextAtSize(this.san(pair[0] + ":"), 8.5);
        this.page.drawText(this.san(pair[1] || "—"), { x: x + labelW + 6, y: this.y, size: 8.5, font: this.font, color: NAVY });
      }
      this.y -= 16;
    }
    this.y -= 4;
  }

  table(columns: PdfColumn[], rows: string[][]) {
    this.ensure(30);
    const rowH = 18;
    // header row
    this.page.drawRectangle({ x: MARGIN, y: this.y - 4, width: CONTENT_W, height: rowH, color: NAVY });
    let cx = MARGIN + 6;
    for (const col of columns) {
      this.drawCellText(col.header, cx, this.y + 1, col.width - 8, 8, this.bold, WHITE, col.align);
      cx += col.width;
    }
    this.y -= rowH;
    // body
    let striped = false;
    for (const row of rows) {
      this.ensure(rowH + 2);
      if (this.y === PAGE_H - 110) {
        // fresh page after break — repeat header
        this.page.drawRectangle({ x: MARGIN, y: this.y - 4, width: CONTENT_W, height: rowH, color: NAVY });
        let hx = MARGIN + 6;
        for (const col of columns) {
          this.drawCellText(col.header, hx, this.y + 1, col.width - 8, 8, this.bold, WHITE, col.align);
          hx += col.width;
        }
        this.y -= rowH;
      }
      if (striped) {
        this.page.drawRectangle({ x: MARGIN, y: this.y - 4, width: CONTENT_W, height: rowH, color: rgb(0.97, 0.97, 0.98) });
      }
      let bx = MARGIN + 6;
      row.forEach((cell, idx) => {
        const col = columns[idx];
        if (!col) return;
        this.drawCellText(cell, bx, this.y + 1, col.width - 8, 8, this.font, NAVY, col.align);
        bx += col.width;
      });
      this.y -= rowH;
      striped = !striped;
    }
    this.y -= 6;
  }

  private drawCellText(
    text: string, x: number, y: number, maxW: number, size: number,
    font: PDFFont, color: RGB, align: "left" | "right" | "center" = "left",
  ) {
    let s = this.san(String(text ?? ""));
    // truncate to fit
    while (s.length > 1 && font.widthOfTextAtSize(s, size) > maxW) {
      s = s.slice(0, -2);
    }
    let tx = x;
    const w = font.widthOfTextAtSize(s, size);
    if (align === "right") tx = x + maxW - w;
    else if (align === "center") tx = x + (maxW - w) / 2;
    this.page.drawText(s, { x: tx, y, size, font, color });
  }

  spacer(h = 10) { this.y -= h; }

  note(text: string) {
    this.ensure(16);
    this.page.drawText(this.san(text), { x: MARGIN, y: this.y, size: 8, font: this.font, color: GREY });
    this.y -= 14;
  }

  private drawFooters() {
    const pages = this.doc.getPages();
    const total = pages.length;
    pages.forEach((p, i) => {
      p.drawLine({
        start: { x: MARGIN, y: 44 }, end: { x: PAGE_W - MARGIN, y: 44 },
        thickness: 0.5, color: LIGHT,
      });
      const left = this.san("Narmada Mobility · sales@Narmadamobility.com · +91 79090 83806");
      p.drawText(left, { x: MARGIN, y: 32, size: 7, font: this.font, color: GREY });
      const right = `Page ${i + 1} of ${total}`;
      const w = this.font.widthOfTextAtSize(right, 7);
      p.drawText(right, { x: PAGE_W - MARGIN - w, y: 32, size: 7, font: this.font, color: GREY });
    });
  }

  async finish(): Promise<Buffer> {
    this.drawFooters();
    const bytes = await this.doc.save();
    return Buffer.from(bytes);
  }
}
