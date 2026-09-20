import { describe, it, expect } from "vitest";
import { safeResultsReturn } from "../../client/src/lib/results-navigation";

describe("R28.17 safe result return URLs", () => {
  const base = "/team/purchase-orders";
  it("keeps a single encoded query round-trip, filters, and page", () => {
    const list = `${base}?q=${encodeURIComponent("A&B / 123")}&status=draft&from=2026-01-01&customer_id=2&page=3`;
    const detail = new URLSearchParams({ returnTo: list });
    expect(safeResultsReturn(new URLSearchParams(detail.toString()).get("returnTo"), base)).toBe(list);
  });
  it.each([null, "https://example.org", "//example.org", "/team/purchase-orders/123", "/admin/purchase-orders", "/team/purchase-orders#bad", "/team/purchase-orders?x=\\bad"])("falls back for unsafe or non-list target %s", input => {
    expect(safeResultsReturn(input, base)).toBe(base);
  });
});
