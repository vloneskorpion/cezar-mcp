import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { installPackage } from "./install.js";
import { fixtureServer } from "../fixtures/server.js";

test(
  "clean tarball installs without cezar, imports quietly and speaks real stdio MCP",
  { timeout: 120000 },
  async () => {
    const install = await installPackage();
    const fixture = await fixtureServer();
    try {
      assert.equal(
        execFileSync(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `globalThis.fetch=()=>{throw new Error('network on import')};await import('@vloneskorpion/cezar-mcp');`,
          ],
          { cwd: install.dir, encoding: "utf8" },
        ),
        "",
      );
      assert.equal(
        execFileSync(install.bin, ["--version"], { encoding: "utf8" }).trim(),
        "0.1.0",
      );
      const transport = new StdioClientTransport({
        command: install.bin,
        args: ["--url", fixture.url, "--read-only"],
        cwd: install.dir,
        stderr: "pipe",
      });
      const client = new Client({ name: "installed-smoke", version: "1.0" });
      try {
        await client.connect(transport);
        const tools = await client.listTools();
        assert.ok(tools.tools.some((t) => t.name === "get_task"));
        assert.equal(
          tools.tools.some((t) => t.name === "create_task"),
          false,
        );
        const result = await client.callTool({
          name: "list_projects",
          arguments: {},
        });
        assert.equal(result.isError, undefined);
        assert.ok(result.structuredContent);
        const task = await client.callTool({
          name: "get_task",
          arguments: { projectId: "demo", runId: "run-1" },
        });
        assert.equal(task.isError, undefined);
        assert.equal(
          (
            await client.callTool({
              name: "get_task",
              arguments: { projectId: "default", runId: "run-1" },
            })
          ).isError,
          true,
        );
      } finally {
        await client.close();
      }
      const offline = new Client({ name: "offline-smoke", version: "1.0" });
      const offlineTransport = new StdioClientTransport({
        command: install.bin,
        args: ["--url", "http://127.0.0.1:1"],
        cwd: install.dir,
        stderr: "pipe",
      });
      try {
        await offline.connect(offlineTransport);
        assert.ok((await offline.listTools()).tools.length >= 6);
        const result = await offline.callTool({
          name: "list_projects",
          arguments: {},
        });
        assert.equal(result.isError, true);
      } finally {
        await offline.close();
      }
    } finally {
      await fixture.close();
      await install.cleanup();
    }
  },
);
