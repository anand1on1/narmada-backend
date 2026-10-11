// Server-only: the same conservative lexical rules drive validation and the
// writing contract. No raw rejected text or arbitrary property names are kept.
const rules = [
  { id: "EXCLUSIVITY", phrase: "exclusive", pattern: /\bexclusive\b/i },
  { id: "SELLER_AUTHORIZATION", phrase: "authorized/authorised dealer, supplier, distributor or partner",
    pattern: /\bauthori[sz]ed (?:dealer|supplier|distributor|partner)\b/i },
  { id: "SUPERIORITY", phrase: "best supplier", pattern: /\bbest supplier\b/i },
  { id: "FITMENT_GUARANTEE", phrase: "guaranteed fit", pattern: /\bguaranteed fit\b/i },
  { id: "STOCK_AVAILABILITY", phrase: "in stock or ready stock", pattern: /\b(?:in stock|ready stock)\b/i },
  { id: "OEM_GENUINENESS", phrase: "genuine OEM or OEM genuine", pattern: /\b(?:genuine OEM|OEM genuine)\b/i },
  { id: "PRICE_SUPERIORITY", phrase: "lowest price", pattern: /\blowest price\b/i },
  { id: "OWN_FACILITIES", phrase: "our branch or our warehouse", pattern: /\b(?:our branch|our warehouse)\b/i },
  { id: "LEGACY_BRAND", phrase: "Narmada Motors", pattern: /\bNarmada Motors\b/i },
] as const;
export type CommercialField = "title" | "excerpt" | "content" | "metaTitle" | "metaDescription";
export type CommercialDiagnostic = { field: CommercialField; rule: typeof rules[number]["id"] };
export function commercialDiagnostics(fields: Record<CommercialField, string>): CommercialDiagnostic[] {
  return (Object.keys(fields) as CommercialField[]).flatMap(field =>
    rules.filter(rule => rule.pattern.test(fields[field])).map(rule => ({ field, rule: rule.id }))).slice(0, 12);
}
export class CommercialPolicyValidationError extends Error {
  constructor(readonly diagnostics: CommercialDiagnostic[]) {
    super("UNSUPPORTED_COMMERCIAL_CLAIM");
    this.name = "CommercialPolicyValidationError";
  }
}
export const COMMERCIAL_WRITING_RULES = `Commercial lexical rules for title, excerpt, article HTML text and metadata:
${rules.map(rule => `${rule.id}: avoid "${rule.phrase}".`).join("\n")}
These phrases are rejected even in negated advice or attributed source quotations in public article fields.
Use neutral questions such as "confirm availability" or "ask for manufacturer documentation".
Remove unsupported assertions about Narmada, NEVER disguise them with synonyms.
Keep evidenceQuote verbatim in claims metadata; do not alter a source quotation to evade a rule.
If supplied evidence cannot support two valid claims and useful compliant prose, return {"skip":true}.`;
