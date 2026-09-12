import { spawnSync } from "node:child_process";
import { cpSync } from "node:fs";
const result = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build", "--webpack"], {
  stdio: "inherit", env: { ...process.env, FOLIO_RUNTIME: "aws" },
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
cpSync("public", ".next/standalone/public", { recursive: true });
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
