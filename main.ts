import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "entry.png");
const outDir = "/output";

mkdirSync(outDir, { recursive: true });
const dest = join(outDir, "entry.png");
copyFileSync(source, dest);
const written = statSync(dest).size;
const expected = statSync(source).size;
if (written !== expected) {
  throw new Error(`copy incomplete: wrote ${written} of ${expected} bytes`);
}
console.log(`wrote ${written} bytes to ${dest}`);
