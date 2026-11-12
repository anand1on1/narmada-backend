/** Public presentation policy only. Never use this to delete or rewrite history. */
export const excludedPublicText = (value: unknown): boolean =>
  typeof value === "string" && /eicher|vecv/i.test(value.replace(/&#(?:x([0-9a-f]+)|(\d+));?/gi,
    (_m, hex, decimal) => String.fromCharCode(parseInt(hex || decimal, hex ? 16 : 10))));
export const publicRecord = (value: any): boolean => !value || typeof value !== "object" ||
  !Object.values(value).some(v => typeof v === "string" && excludedPublicText(v));
/** Callers supply only hard-coded SQL identifiers, never request input. */
export function publicSql(fields: string[]) {
  return fields.map(f => `(lower(coalesce(${f},'')) NOT LIKE '%eicher%' AND lower(coalesce(${f},'')) NOT LIKE '%vecv%')`).join(" AND ");
}
