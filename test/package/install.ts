import { mkdtemp, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
export async function installPackage() {
  const dir = await mkdtemp(join(tmpdir(), "cezar-mcp-package-"));
  try {
    const packed = JSON.parse(
      execFileSync("npm", ["pack", "--json", "--pack-destination", dir], {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      }),
    )[0];
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    execFileSync(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        join(dir, packed.filename),
      ],
      { cwd: dir, stdio: "pipe", timeout: 120000 },
    );
    const bin = join(dir, "node_modules/.bin/cezar-mcp");
    if (!((await stat(bin)).mode & 0o111))
      throw new Error("package executable permission missing");
    return {
      dir,
      bin,
      cleanup: () => rm(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}
