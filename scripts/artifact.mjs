import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
export const REFERENCE_REVISION = "1f40016d87d2b7ace23eedbdeae42bdf60c52684";
export async function artifactDigest(root) {
  const hash = createHash("sha256");
  async function walk(relative) {
    for (const entry of (
      await readdir(join(root, relative), { withFileTypes: true })
    ).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        hash.update(path.replaceAll("\\", "/"));
        hash.update("\0");
        hash.update(await readFile(join(root, path)));
        hash.update("\0");
      }
    }
  }
  for (const path of ["dist", "scripts"]) await walk(path);
  hash.update(await readFile(join(root, "package.json")));
  return hash.digest("hex");
}
