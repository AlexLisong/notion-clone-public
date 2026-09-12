// Next and Vinext generate incompatible declarations in the same directories.
// Remove only generated types when switching runtimes; retain builds and data.
import { rmSync } from "node:fs";

for (const directory of [".next/types", ".next/dev/types"]) {
  rmSync(directory, { recursive: true, force: true });
}
