import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openSqliteStore } from "../lib/server/storage-node.ts";
import { requestDenied } from "../lib/server/request-guard.ts";
import type { AccessPolicy } from "../lib/server/storage-types.ts";

test("SQLite survives reopen and two connections cannot overwrite a newer revision", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "folio-sqlite-"));
  const filename = path.join(directory, "workspace.sqlite");
  const first = openSqliteStore(filename);
  const second = openSqliteStore(filename);
  try {
    assert.deepEqual(await first.load("original"), { revision: 0, data: "original" });
    assert.equal(await second.save("newer", 0), true);
    assert.equal(await first.save("stale", 0), false);
    assert.deepEqual(await first.load("replacement seed"), { revision: 1, data: "newer" });
    assert.equal(statSync(filename).mode & 0o777, 0o600);
  } finally { first.close(); second.close(); }
  const reopened = openSqliteStore(filename);
  try { assert.deepEqual(await reopened.load("seed"), { revision: 1, data: "newer" }); }
  finally { reopened.close(); rmSync(directory, { recursive: true }); }
});

const policy: AccessPolicy = { mode: "hosted", origin: "https://folio.example", proxyKey: "test-key-".repeat(8) };
const headers = { host: "folio.example", "x-forwarded-proto": "https", "x-folio-proxy-key": policy.proxyKey };
const request = (method = "GET", changes: Record<string, string> = {}) => new Request("http://127.0.0.1:4320/api/workspace", { method, headers: { ...headers, ...changes } });

test("hosted API denies proxy bypass, wrong host and insecure forwarded protocol", () => {
  assert.equal(requestDenied(request(), policy), null);
  const invalidHeaders: Record<string, string>[] = [{ "x-folio-proxy-key": "" }, { "x-folio-proxy-key": "x".repeat(policy.proxyKey.length) }, { host: "attacker.example" }, { "x-forwarded-proto": "http" }];
  for (const changes of invalidHeaders) {
    assert.ok(requestDenied(request("GET", changes), policy));
  }
});
test("hosted writes require exact origin and reject cross-site browser requests", () => {
  assert.equal(requestDenied(request("PUT", { origin: policy.origin }), policy), null);
  assert.ok(requestDenied(request("PUT"), policy));
  assert.ok(requestDenied(request("PUT", { origin: "https://attacker.example" }), policy));
  assert.ok(requestDenied(request("PUT", { origin: policy.origin, "sec-fetch-site": "cross-site" }), policy));
  assert.ok(requestDenied(request("GET", { origin: "https://attacker.example" }), policy));
});
test("local API continues to reject remote hosts", () => {
  assert.equal(requestDenied(new Request("http://127.0.0.1:5183/api/workspace"), { mode: "local" }), null);
  assert.ok(requestDenied(new Request("https://folio.example/api/workspace"), { mode: "local" }));
});
