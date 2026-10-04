/** Explicit dev/CI prerequisite, never runs during adapter install or build. */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { artifactDigest, REFERENCE_REVISION } from "./artifact.mjs";
const root = resolve(process.argv[2] ?? ".ai/tmp/reference");
await mkdir(root, { recursive: true });
const run = (cmd, args, cwd = root) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit", timeout: 240000 });
if (!existsSync(join(root, ".git"))) {
  run("git", ["init", "-q"]);
  run("git", [
    "remote",
    "add",
    "origin",
    "https://github.com/open-mercato/cezar.git",
  ]);
}
let existing;
try {
  existing = execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  run("git", ["fetch", "--depth", "1", "origin", REFERENCE_REVISION]);
  run("git", ["checkout", "--detach", "FETCH_HEAD"]);
  existing = REFERENCE_REVISION;
}
if (existing !== REFERENCE_REVISION)
  throw new Error(
    "The supplied checkout is not the pinned revision; use an empty destination or the reference checkout.",
  );
// An already materialized pinned checkout may be reused. CI materializes it separately before this command.
run("npm", [
  "ci",
  "--ignore-scripts",
  "--no-audit",
  "--no-fund",
  "--workspace",
  "@open-mercato/cezar",
  "--workspace",
  "@open-mercato/cezar-contract",
  "--workspace",
  "@open-mercato/cezar-api-client",
]);
run("npm", ["run", "build", "--workspace", "@open-mercato/cezar"]);
const packageRoot = join(root, "packages/cezar");
const pkg = JSON.parse(
  await readFile(join(packageRoot, "package.json"), "utf8"),
);
const manifest = {
  revision: REFERENCE_REVISION,
  version: pkg.version,
  packageRoot,
  digest: await artifactDigest(packageRoot),
  isolationProfile: "cezar-1f40016d-dry-run",
};
await writeFile(
  join(root, "artifact.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  `Live prerequisite: CEZAR_CONTRACT_ARTIFACT=${join(root, "artifact.json")}`,
);
