import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { createServer } from "node:net";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { artifactDigest, REFERENCE_REVISION } from "../../scripts/artifact.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const here = dirname(fileURLToPath(import.meta.url));
async function freePort() {
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
function envelope(result) {
  const value = result.structuredContent;
  assert.ok(value, "structured MCP result");
  return value.result ?? value;
}

test(
  "pinned real cezar and installed adapter complete the supervisor workflow in an isolated dry-run sandbox",
  { timeout: 120000 },
  async () => {
    const manifestPath = process.env.CEZAR_CONTRACT_ARTIFACT;
    assert.ok(
      manifestPath,
      "Missing CEZAR_CONTRACT_ARTIFACT: provision the pinned artifact; live compatibility is never skipped.",
    );
    const artifact = JSON.parse(await readFile(resolve(manifestPath), "utf8"));
    assert.equal(artifact.revision, REFERENCE_REVISION);
    assert.equal(artifact.isolationProfile, "cezar-1f40016d-dry-run");
    assert.equal(
      await artifactDigest(artifact.packageRoot),
      artifact.digest,
      "artifact digest before launch",
    );
    const packageJson = JSON.parse(
      await readFile(join(artifact.packageRoot, "package.json"), "utf8"),
    );
    assert.equal(packageJson.version, artifact.version);
    const sandbox = await mkdtemp(join(tmpdir(), "cezar-mcp-live-"));
    const project = join(sandbox, "project");
    const home = join(sandbox, "home");
    const bin = join(sandbox, "bin");
    for (const path of [
      project,
      home,
      bin,
      join(home, ".cezar"),
      join(home, ".config"),
      join(home, ".cache"),
      join(home, ".claude"),
      join(home, ".codex"),
      join(home, ".cursor"),
      join(home, ".copilot"),
      join(home, ".junie"),
      join(home, ".pi"),
    ])
      await mkdir(path, { recursive: true });
    const git = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    await symlink(process.execPath, join(bin, "node"));
    await symlink(git, join(bin, "git"));
    const env = {
      PATH: bin,
      HOME: home,
      USERPROFILE: home,
      CEZ_HOME: join(home, ".cezar"),
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_CACHE_HOME: join(home, ".cache"),
      CODEX_HOME: join(home, ".codex"),
      CLAUDE_CONFIG_DIR: join(home, ".claude"),
      CURSOR_CONFIG_DIR: join(home, ".cursor"),
      COPILOT_HOME: join(home, ".copilot"),
      PI_CODING_AGENT_DIR: join(home, ".pi"),
      TMPDIR: sandbox,
      TEMP: sandbox,
      TMP: sandbox,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: join(home, "empty-git-config"),
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "Contract Test",
      GIT_AUTHOR_EMAIL: "contract@example.invalid",
      GIT_COMMITTER_NAME: "Contract Test",
      GIT_COMMITTER_EMAIL: "contract@example.invalid",
      CEZ_DRY_RUN: "1",
      CEZ_NO_BANNER: "1",
      CEZ_AUTOMATIONS: "0",
      CEZ_SKILLS_AUTO_UPDATE: "0",
      CEZ_FOLLOWUPS: "0",
      CEZ_TITLE_UPDATES: "0",
      CEZ_AUTO_COMMIT: "0",
      CEZAR_TEST_NETWORK_LOG: join(sandbox, "network.log"),
      NODE_OPTIONS: `--import=${join(here, "network-guard.mjs")}`,
    };
    // The environment is an allowlist. Never copy process.env, tokens, login paths or provider state.
    for (const key of [
      "HOME",
      "CEZ_HOME",
      "XDG_CONFIG_HOME",
      "XDG_CACHE_HOME",
      "CODEX_HOME",
      "CLAUDE_CONFIG_DIR",
      "CURSOR_CONFIG_DIR",
      "COPILOT_HOME",
      "PI_CODING_AGENT_DIR",
    ])
      assert.ok(env[key].startsWith(sandbox + "/"), `sandbox ${key}`);
    execFileSync(
      process.execPath,
      [
        "--import",
        join(here, "network-guard.mjs"),
        "--input-type=module",
        "-e",
        `
      import net from 'node:net';
      let blocked=false;
      try { net.connect({host:'example.invalid',port:443}); } catch { blocked=true; }
      if(!blocked) throw new Error('network guard did not block external sockets');
      try { await fetch('https://example.invalid'); throw new Error('external fetch allowed'); } catch(e) {
        if(e.message==='external fetch allowed')throw e;
      }
    `,
      ],
      { cwd: project, env, stdio: "pipe", timeout: 5000 },
    );
    execFileSync(git, ["init", "-q"], { cwd: project, env });
    await writeFile(
      join(project, "README.md"),
      "# Isolated contract fixture\n",
    );
    execFileSync(git, ["add", "."], { cwd: project, env });
    execFileSync(git, ["commit", "-qm", "fixture"], { cwd: project, env });
    await mkdir(join(project, ".ai/cezar"), { recursive: true });
    await writeFile(
      join(project, ".ai/cezar/config.json"),
      JSON.stringify({ skillsRepos: [], defaultRunner: "claude" }),
    );
    await writeFile(
      join(home, ".cezar/config.json"),
      JSON.stringify({
        skillsAutoUpdate: false,
        resources: { maxParallel: 3 },
      }),
    );
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    let log = "";
    let cezar;
    let mcp;
    let client;
    const proofs = [];
    try {
      cezar = spawn(
        process.execPath,
        [
          "--import",
          join(here, "network-guard.mjs"),
          join(artifact.packageRoot, "dist/index.js"),
          "serve",
          "--repo",
          project,
          "--port",
          String(port),
          "--bind-host",
          "127.0.0.1",
          "--no-open",
        ],
        {
          cwd: project,
          env,
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      cezar.stdout.on("data", (b) => {
        log = (log + b.toString()).slice(-32768);
      });
      cezar.stderr.on("data", (b) => {
        log = (log + b.toString()).slice(-32768);
      });
      let health;
      for (let i = 0; i < 100; i++) {
        if (cezar.exitCode !== null) throw new Error(`cezar exited: ${log}`);
        try {
          const response = await fetch(`${url}/api/v1/health`, {
            signal: AbortSignal.timeout(500),
          });
          if (response.ok) {
            health = await response.json();
            break;
          }
        } catch {}
        await sleep(100);
      }
      assert.equal(health?.version, artifact.version, log);
      assert.equal(health?.capabilities.automations, false);
      proofs.push("isolated cezar boot");
      const packed = JSON.parse(
        execFileSync("npm", ["pack", "--json", "--pack-destination", sandbox], {
          encoding: "utf8",
        }),
      )[0];
      const install = join(sandbox, "adapter");
      await mkdir(install);
      await writeFile(
        join(install, "package.json"),
        '{"private":true,"type":"module"}',
      );
      execFileSync(
        "npm",
        [
          "install",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          join(sandbox, packed.filename),
        ],
        { cwd: install, stdio: "pipe", timeout: 120000 },
      );
      mcp = new StdioClientTransport({
        command: process.execPath,
        args: [
          join(install, "node_modules/@vloneskorpion/cezar-mcp/dist/bin.js"),
          "--url",
          url,
        ],
        cwd: install,
        env: { PATH: bin, HOME: home },
        stderr: "pipe",
      });
      client = new Client({ name: "cezar-live-conformance", version: "1.0" });
      await client.connect(mcp);
      const call = async (name, args = {}) => {
        const value = envelope(
          await client.callTool({ name, arguments: args }),
        );
        assert.equal(value.ok, true, `${name}: ${JSON.stringify(value)}`);
        return value.data;
      };
      assert.equal((await client.listTools()).tools.length, 14);
      const projects = await call("list_projects");
      const projectId = projects.projects[0].id;
      assert.notEqual(projectId, "default");
      assert.equal(projects.connection.compatibility, "unverified");
      await call("list_workflows", { projectId });
      proofs.push("packaged SDK handshake, 14 tools, concrete scope");
      const first = await call("create_task", {
        projectId,
        task: "mock:ask\nCoordinate worker one",
        autonomous: false,
      });
      const second = await call("create_task", {
        projectId,
        task: "Coordinate worker two",
        autonomous: false,
      });
      const refs = [first, second].map((t) => ({ projectId, runId: t.runId }));
      const listed = await call("list_tasks", { projectId });
      assert.ok(listed.tasks.some((task) => task.runId === refs[0].runId));
      const renamed = await call("update_task", {
        ...refs[0],
        patch: { title: "Contract supervisor worker" },
      });
      assert.equal(renamed.runId, refs[0].runId);
      const initial = await Promise.all(refs.map((r) => call("get_task", r)));
      const observations = await call("wait_for_events", {
        watches: initial.map((t) => t.baseline),
        timeoutMs: 2000,
      });
      assert.equal(observations.observations.length, 2);
      proofs.push("two root workers, bounded multi-task wait");
      const settle = async (ref, statuses) => {
        for (let i = 0; i < 120; i++) {
          const task = await call("get_task", ref);
          if (statuses.includes(task.status)) return task;
          await sleep(50);
        }
        throw new Error(`Task did not settle: ${ref.runId}`);
      };
      const question = await settle(refs[0], ["waiting"]);
      assert.ok(
        question.pendingQuestion?.questions?.length,
        "worker pending question",
      );
      await settle(refs[1], ["waiting"]);
      await call("get_changes", { ...refs[0], view: "summary" });
      await call("get_changes", { ...refs[0], view: "diff" });
      proofs.push("task listing, title update and attributed summary/diff");
      const history = await call("read_messages", refs[0]);
      assert.ok(history.itemCount > 0);
      const sent = await call("send_message", {
        ...refs[0],
        text: "/skill\nanswer the question",
      });
      assert.equal(sent.delivered, true);
      proofs.push(
        "pending question, transcript history, exact slash message delivered",
      );
      await settle(refs[0], ["waiting"]);
      await call("finish_task", refs[0]);
      await settle(refs[0], ["done", "review"]);
      await call("continue_task", { ...refs[0], text: "Explicit follow-up" });
      await settle(refs[0], ["waiting"]);
      proofs.push("finish and explicit continuation");
      const child = await call("dispatch_task", {
        ...refs[0],
        order: { objective: "mock:done child", kind: "implement" },
      });
      assert.ok(child.runId);
      await settle({ projectId, runId: child.runId }, ["done", "review"]);
      await call("cancel_task", refs[1]);
      await settle(refs[1], ["cancelled"]);
      const refusal = envelope(
        await client.callTool({
          name: "dispatch_task",
          arguments: {
            ...refs[1],
            order: { objective: "must refuse terminal parent" },
          },
        }),
      );
      assert.equal(refusal.ok, false);
      assert.equal(refusal.error.outcome, "rejected");
      proofs.push(
        "real child dispatch, cancellation and settled-parent refusal",
      );
      const invalid = envelope(
        await client.callTool({
          name: "get_task",
          arguments: { projectId: "other-project", runId: refs[0].runId },
        }),
      );
      assert.equal(invalid.ok, false);
      proofs.push("wrong-project refusal");
      const survivor = await call("create_task", {
        projectId,
        task: "Remain open after the adapter disconnects",
        autonomous: false,
      });
      const survivorRef = { projectId, runId: survivor.runId };
      await settle(survivorRef, ["waiting"]);
      await client.close();
      client = undefined;
      const survived = await fetch(
        `${url}/api/v1/p/${encodeURIComponent(projectId)}/runs/${survivor.runId}`,
      ).then((r) => r.json());
      assert.equal(survived.status, "waiting");
      proofs.push("MCP disconnect leaves cezar task alive");
      assert.equal(
        await artifactDigest(artifact.packageRoot),
        artifact.digest,
        "cezar artifact unchanged after suite",
      );
      const evidence = {
        adapterVersion: "0.1.0",
        cezarVersion: artifact.version,
        revision: artifact.revision,
        artifactDigest: artifact.digest,
        checkedAt: new Date().toISOString(),
        checks: proofs,
        hermes: "unverified (not available)",
      };
      await mkdir(".ai/qa/artifacts_live", { recursive: true });
      await writeFile(
        ".ai/qa/artifacts_live/cezar-live.json",
        JSON.stringify(evidence, null, 2) + "\n",
      );
    } catch (error) {
      await mkdir(".ai/qa/artifacts_live", { recursive: true });
      await writeFile(
        ".ai/qa/artifacts_live/cezar-live-failure.log",
        log.slice(-32768),
      );
      throw error;
    } finally {
      await client?.close().catch(() => {});
      if (cezar && cezar.exitCode === null) {
        const exited = once(cezar, "exit");
        if (process.platform !== "win32") process.kill(-cezar.pid, "SIGTERM");
        else cezar.kill("SIGTERM");
        let killTimer;
        try {
          await Promise.race([
            exited,
            new Promise((r) => {
              killTimer = setTimeout(r, 3000);
            }),
          ]);
        } finally {
          clearTimeout(killTimer);
        }
        if (cezar.exitCode === null) {
          if (process.platform !== "win32") process.kill(-cezar.pid, "SIGKILL");
          else cezar.kill("SIGKILL");
          await exited;
        }
      }
      await rm(sandbox, { recursive: true, force: true });
    }
  },
);
