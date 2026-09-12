import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";

const directory = mkdtempSync(path.join(tmpdir(), "folio-aws-check-"));
const port = process.env.FOLIO_TEST_PORT || "5328";
const target = `http://127.0.0.1:${port}`;
const proxy = { origin: "https://folio.test", proxyKey: randomBytes(32).toString("hex") };
const config = path.join(directory, "proxy.json");
writeFileSync(config, JSON.stringify(proxy), { mode: 0o600 });
const server = spawn(process.execPath, [".next/standalone/server.js"], {
  env: { ...process.env, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: port,
    FOLIO_DB_PATH: path.join(directory, "workspace.sqlite"), FOLIO_PUBLIC_ORIGIN: proxy.origin, FOLIO_PROXY_KEY: proxy.proxyKey },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk; });
server.stderr.on("data", (chunk) => { serverOutput += chunk; });
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (server.exitCode !== null) throw new Error(`Server exited: ${serverOutput}`);
    try {
      const response = await fetch(`${target}/api/workspace`);
      if (response.status === 403) { ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, `Server did not become ready: ${serverOutput}`);
  const html = await (await fetch(target)).text();
  const assets = [...html.matchAll(/(?:href|src)="([^\"]+\.(?:css|js)(?:\?[^\"]*)?)"/g)].map((match) => match[1]);
  assert.ok(assets.length > 0);
  for (const asset of new Set([...assets, "/favicon.svg"])) {
    assert.equal((await fetch(new URL(asset, target))).status, 200, asset);
  }
  const checks = spawn(process.execPath, ["--test", "tests/api.test.mjs"], {
    stdio: "inherit", env: { ...process.env, FOLIO_TEST_URL: target, FOLIO_TEST_PROXY_FILE: config },
  });
  const [code] = await once(checks, "exit");
  assert.equal(code, 0, "AWS API verification failed");
  console.log("AWS standalone assets and API verified");
} finally {
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await once(server, "exit");
  }
  rmSync(directory, { recursive: true, force: true });
}
