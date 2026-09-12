import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
const target = process.env.FOLIO_TEST_URL;
const proxy = process.env.FOLIO_TEST_PROXY_FILE ? JSON.parse(readFileSync(process.env.FOLIO_TEST_PROXY_FILE, "utf8")) : null;
const trustedHeaders = proxy ? { Host: new URL(proxy.origin).host, "X-Forwarded-Proto": "https", "X-Folio-Proxy-Key": proxy.proxyKey } : {};
// Consume every response and isolate requests after intentional early rejections.
// The HTTP client also preserves Host when exercising the proxy contract.
const apiFetch = (url, options = {}) => new Promise((resolve, reject) => {
  const req = httpRequest(url, { ...options, agent: false }, (res) => {
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: Object.fromEntries(Object.entries(res.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value || ""])) })));
    res.on("error", reject);
  });
  req.setTimeout(15000, () => req.destroy(new Error("API request timed out")));
  req.on("error", reject);
  req.end(options.body);
});
test(
  "local workspace API: persistence, validation, CAS and origin boundary",
  { skip: !target },
  async (t) => {
    const url = new URL("/api/workspace", target);
    assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
    const get = async () => {
      const response = await apiFetch(url, { headers: trustedHeaders });
      assert.equal(response.status, 200);
      return response.json();
    };
    const put = (body, headers = {}) =>
      apiFetch(url, {
        method: "PUT",
        headers: { ...trustedHeaders, ...(proxy ? { Origin: proxy.origin } : {}), "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    const original = await get();
    const testId = crypto.randomUUID();
    const base = original.workspace.pages[0];
    const testPage = {
      ...structuredClone(base),
      id: testId,
      parentId: null,
      title: "API verification temporary page",
      favorite: false,
      trashedAt: null,
      trashBatch: null,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "API persistence test" }],
          },
        ],
      },
    };
    let created = false;
    try {
      if (proxy) await t.test("rejects requests that bypass the authenticated proxy", async () => {
        assert.equal((await apiFetch(url)).status, 403);
      });
      await t.test(
        "accepts a valid update and returns persistent content",
        async () => {
          const response = await put({
            revision: original.revision,
            workspace: {
              ...original.workspace,
              pages: [...original.workspace.pages, testPage],
            },
          });
          assert.equal(response.status, 200);
          created = true;
          const saved = await get();
          assert.equal(saved.revision, original.revision + 1);
          assert.equal(
            saved.workspace.pages.find((p) => p.id === testId).title,
            testPage.title,
          );
        },
      );
      await t.test(
        "rejects stale writes without overwriting newer data",
        async () => {
          const response = await put({
            revision: original.revision,
            workspace: original.workspace,
          });
          assert.equal(response.status, 409);
          assert.ok((await get()).workspace.pages.some((p) => p.id === testId));
        },
      );
      await t.test("rejects cross-origin write requests", async () => {
        const current = await get();
        // Repeated small and multi-chunk rejections must leave the local Worker
        // proxy ready for the following request, without applying any changes.
        for (const padding of ["", "x".repeat(128 * 1024), ""]) {
          const response = await put({ ...current, padding }, {
            Origin: "https://untrusted.example",
          });
          assert.equal(response.status, 403);
          assert.equal((await get()).revision, current.revision);
        }
      });
      await t.test("rejects unsupported content types without blocking the next request", async () => {
        const current = await get();
        const response = await put(current, { "Content-Type": "text/plain" });
        assert.equal(response.status, 415);
        assert.equal((await get()).revision, current.revision);
      });
      await t.test("rejects invalid JSON structures", async () => {
        const current = await get();
        const broken = structuredClone(current);
        broken.workspace.pages[0].parentId = broken.workspace.pages[0].id;
        assert.equal((await put(broken)).status, 400);
      });
      await t.test("rejects executable links in imported content", async () => {
        const current = await get();
        current.workspace.pages.find((p) => p.id === testId).content = {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Bad",
                  marks: [
                    { type: "link", attrs: { href: "javascript:alert(1)" } },
                  ],
                },
              ],
            },
          ],
        };
        assert.equal((await put(current)).status, 400);
      });
      await t.test("rejects oversized uploads before parsing", async () => {
        assert.equal(
          (await put({ data: "x".repeat(10 * 1024 * 1024) })).status,
          413,
        );
      });
    } finally {
      if (created) {
        const current = await get();
        current.workspace.pages = current.workspace.pages.filter(
          (p) => p.id !== testId,
        );
        assert.equal((await put(current)).status, 200);
      }
    }
  },
);
