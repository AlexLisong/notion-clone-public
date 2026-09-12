import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (Number(process.versions.node.split(".")[0]) < 22)
  throw new Error(
    "Folio needs Node.js 22.13 or newer. Run nvm use if you use nvm.",
  );
mkdirSync(path.join(root, ".wrangler"), { recursive: true });
const config = path.join(root, ".wrangler", "local-migrations.json");
writeFileSync(
  config,
  JSON.stringify({
    name: "folio-local",
    compatibility_date: "2026-05-15",
    d1_databases: [
      {
        binding: "DB",
        database_name: "site-creator-d1",
        database_id: "00000000-0000-4000-8000-000000000000",
        migrations_dir: path.join(root, "drizzle"),
      },
    ],
  }),
);
const result = spawnSync(
  process.execPath,
  [
    "--import",
    path.join(root, "scripts/sites-env.mjs"),
    path.join(root, "node_modules/wrangler/bin/wrangler.js"),
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--config",
    config,
    "--persist-to",
    path.join(root, ".wrangler/state"),
  ],
  { cwd: root, stdio: ["pipe", "inherit", "inherit"], input: "y\n" },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(
  "Folio database is ready. Run npm run dev, then open the printed local URL.",
);
