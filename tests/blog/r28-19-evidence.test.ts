import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
const network = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: network.lookup }));
vi.mock("node:https", () => ({ request: network.request }));
import { readEvidence } from "../../server/auto-blogger-safety";

let replies: { status: number; location?: string; body?: string; type?: string }[];
beforeEach(() => {
  replies = [];
  network.lookup.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  network.request.mockReset().mockImplementation((_url: URL, options: any, callback: any) => {
    const req = new EventEmitter() as any;
    req.destroy = (e: Error) => { req.emit("error", e); req.emit("close"); };
    req.end = () => queueMicrotask(() => {
      const next = replies.shift() || { status: 500 };
      const res = new EventEmitter() as any;
      res.statusCode = next.status; res.headers = { location: next.location, "content-type": next.type || "text/html" };
      res.resume = () => req.emit("close");
      callback(res);
      if (next.status === 200) {
        res.emit("data", Buffer.from(next.body || `<h1>Technical reference</h1><p>${"Manufacturer technical context for procurement questions. ".repeat(15)}</p>`));
        res.emit("end"); req.emit("close");
      }
    });
    return req;
  });
});
describe("R28.19 authoritative evidence transport", () => {
  it("follows bounded safe relative redirects, revalidates DNS and pins each resolved public address", async () => {
    replies = [{ status: 301, location: "/technical/" }, { status: 200 }];
    const result = await readEvidence("https://www.tatamotors.com/technical");
    expect(result.url).toBe("https://www.tatamotors.com/technical/");
    expect(result.text.length).toBeGreaterThan(250);
    expect(network.lookup).toHaveBeenCalledTimes(2);
    for (const call of network.request.mock.calls) {
      const callback = vi.fn(); call[1].lookup("www.tatamotors.com", {}, callback);
      expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
      expect(call[1].headers).not.toHaveProperty("Authorization");
    }
  });
  it("rejects off-allowlist redirects, HTTP downgrades, credentials and private addresses before connecting", async () => {
    for (const location of ["https://evil.test/", "http://www.tatamotors.com/", "https://user:secret@www.tatamotors.com/", "https://127.0.0.1/"]) {
      replies = [{ status: 302, location }];
      await expect(readEvidence("https://www.tatamotors.com/start")).rejects.toThrow("SOURCE_URL_REJECTED");
    }
    network.lookup.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    const calls = network.request.mock.calls.length;
    await expect(readEvidence("https://www.tatamotors.com/start")).rejects.toThrow("SOURCE_ADDRESS_REJECTED");
    expect(network.request).toHaveBeenCalledTimes(calls);
  });
  it("rechecks DNS after redirect and rejects loops or more than three hops", async () => {
    replies = [{ status: 302, location: "/next" }];
    network.lookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]).mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 }]);
    await expect(readEvidence("https://www.tatamotors.com/start")).rejects.toThrow("SOURCE_ADDRESS_REJECTED");
    replies = [{ status: 302, location: "/start" }];
    await expect(readEvidence("https://www.tatamotors.com/start")).rejects.toThrow("SOURCE_REDIRECT_REJECTED");
    replies = [1, 2, 3, 4].map(n => ({ status: 302, location: `/hop-${n}` }));
    await expect(readEvidence("https://www.tatamotors.com/start")).rejects.toThrow("SOURCE_REDIRECT_REJECTED");
  });
  it("rejects unsupported media, short or oversized content; never treats provider snippets as fetched evidence", async () => {
    replies = [{ status: 200, type: "application/pdf" }];
    await expect(readEvidence("https://www.tatamotors.com/file")).rejects.toThrow("SOURCE_UNREACHABLE");
    replies = [{ status: 200, body: "<p>Too short</p>" }];
    await expect(readEvidence("https://www.tatamotors.com/file")).rejects.toThrow("EVIDENCE_INSUFFICIENT");
    replies = [{ status: 200, body: "x".repeat(750001) }];
    await expect(readEvidence("https://www.tatamotors.com/file")).rejects.toThrow("SOURCE_UNREACHABLE");
  });
});
