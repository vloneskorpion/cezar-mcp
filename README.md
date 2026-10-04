# cezar-mcp

An independent stdio MCP adapter that lets an external supervisor coordinate tasks in an already-running cezar cockpit through its HTTP/SSE API. Cezar owns execution, worktrees, scheduling and state. The adapter exposes fourteen tools and creates no server listener or persistent task store.

## Install locally

Requires Node 20+ and npm. No registry release is required; this version has not been published by this implementation.

```sh
git clone https://github.com/vloneskorpion/cezar-mcp.git
cd cezar-mcp
npm ci --ignore-scripts
npm run build
npm pack
npm install --global ./vloneskorpion-cezar-mcp-0.1.0.tgz
cezar-mcp --version
```

Until the implementation merges, check out the implementation PR branch before building. Alternatively configure your host to run `node /absolute/path/cezar-mcp/dist/bin.js` after the build. Installing or building this package never installs, launches or modifies cezar.

## Connect your MCP host

Start your existing cezar cockpit separately. Prefer an explicit endpoint:

```sh
cezar-mcp --url http://127.0.0.1:4321
```

The MCP host launches this command and owns its stdin/stdout. Endpoint precedence is `--url`, then `CEZAR_MCP_URL`, then discovery of ports 4321–4370 on `127.0.0.1`. Discovery starts on the first tool call, examines all fifty ports with at most five concurrent probes, and requires exactly one healthy cezar. An incomplete or ambiguous scan refuses selection. The selected origin remains pinned for the connection; restart with `--url` to select a different cockpit. `CEZ_API_URL` and `CEZ_TASK_ID` are ignored. The adapter does not load `.env` files.

Only HTTP origins using literal loopback IPs are accepted, including `127.0.0.1` and `[::1]`. DNS names, credentials, URL paths, query strings, fragments and redirects are rejected. This is a local operator control surface: cezar does not authenticate the adapter as an external supervisor. Run your MCP host and cezar within the same trusted machine boundary.

Add `--read-only` to expose only the seven inspection/wait tools. Mutation handlers also enforce read-only mode if invoked directly. Host-side filtering alone is not this enforcement.

For Hermes, the following configuration follows its [documented stdio keys](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp/). Real Hermes interoperability remains **unverified**; the packaged SDK handshake is tested.

```yaml
mcp_servers:
  cezar:
    command: cezar-mcp
    args: ["--url", "http://127.0.0.1:4321"]
    timeout: 60
```

Use an absolute command path when the host has a restricted PATH. Keep its tool timeout above the maximum 30-second wait. Tool failures return structured errors while the MCP process remains usable. Normal EOF/SIGINT/SIGTERM closes adapter requests without cancelling cezar tasks. Serving uses stdout only for MCP; diagnostics go to stderr. Argument errors exit 2, fatal process failures exit 1, normal shutdown exits 0.

## Tools

Inputs are strict and schema-derived; discover them with your host's tool catalog. Every task reference is `{projectId, runId}`. Obtain concrete project ids from `list_projects`; `default` is rejected.

| Tool | Purpose |
|---|---|
| `list_projects` | Concrete projects and connection/compatibility metadata; limit/offset |
| `list_workflows` | Named workflows and load issues in one project |
| `list_tasks` | Project tasks, status/query filters and limit/offset |
| `get_task` | Task details, question/report previews and a watch baseline |
| `read_messages` | History events and opaque older/newer/live cursors |
| `get_changes` | Attributed changes or a diff preview, with full cockpit link |
| `create_task` | One root, `variants: 1`, isolated worktree; default `quick-task` |
| `update_task` | Allowlisted title/task patch; initial task text is queued-only |
| `send_message` | Exact text through cezar's user-message path |
| `continue_task` | Explicit continuation with optional text, runner and model |
| `cancel_task` | Engine cancellation, including its descendant behavior |
| `finish_task` | Gracefully close an eligible waiting session |
| `dispatch_task` | Engine-managed child under a real nonterminal parent |
| `wait_for_events` | Bounded observations for up to sixteen task baselines |

Success has `{ok:true,data,truncated}` in `structuredContent`, plus a short text summary. Failure has `{ok:false,error:{code,message,outcome,...}}` with MCP `isError:true`. Output is capped at 64 KiB; individual free-text previews at 8192 characters. Follow returned collection offsets/history cursors and cockpit links for omitted content. Unknown cezar statuses remain readable and prevent existing-task mutations. Missing costs or usage stay absent; health capability flags control metric visibility.

Creation confirms acceptance and actual initial status, not completion. Omitted `autonomous` preserves cezar's default. Requested dispatch intent is reported separately from whether the actual returned run applied it. Messages preserve slash syntax and distinguish `{delivered:true}`, `{queued:true,message:{id,createdAt}}`, and `{deferred:true}`. External instructions are user-role messages, not an authenticated special supervisor role. A closed session requires an explicit `continue_task`; no fallback occurs.

A mutation is attempted once. If a timeout, disconnect, cancellation after sending, server failure or invalid success response makes acceptance uncertain, `outcome_unknown` reports `outcome:"unknown"`. Inspect `get_task`, `list_tasks` and `read_messages` before deciding whether another write is necessary. Repeating creation can create a duplicate root. Refusals distinguish `rejected` from `not_attempted`.

## Supervise workers

1. Select a project and workflow. Create independent roots for independent assignments; retain their returned ids. Roots have separate worktree bases, not a shared commander budget.
2. Read each task with `get_task` and retain its `baseline`. Call `wait_for_events` with those baselines and, for example, `timeoutMs:25000`.
3. Handle each observation independently. A state change can expose a question or report; transcript availability calls for `read_messages`. Replace the watch baseline with the returned baseline. History cursors track what you read; `afterSeq` only tracks durable notification progress.
4. Answer questions with exact `send_message` text. Interpret delivery acceptance before proceeding. Continue a settled session only through an explicit decision and `continue_task`.
5. For an existing dispatch tree, target a real nonterminal parent with `dispatch_task`. Engine caps, costs, budgets, branch relationships and report delivery apply. A refused child is never converted to a root. A commander is a real worker, with its own runner and cost.
6. Treat reports and `done` as worker claims. Inspect changes, tests and review evidence before approving or merging outside this adapter.

Timeout with no change is ordinary. An unchanged terminal task does not wake repeatedly. One active wait is allowed per MCP connection; reads remain available. Stream loss, malformed data, deletion or a future/mismatched baseline requires a fresh task/history baseline. Cancelling a wait cancels only adapter requests. There is no retained subscription, reconnect journal or scheduler; MCP notifications do not start a supervisor turn. The supervisor must call again while actively coordinating; cezar owns monitoring wake-ups.

## Compose as a library

Importing the ESM entry point creates no transport, network requests or background work. The caller supplies a client and chooses a transport:

```ts
import { createMcpServer, HttpCezarClient } from '@vloneskorpion/cezar-mcp';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

const client = new HttpCezarClient({ url: 'http://127.0.0.1:4321' });
const server = createMcpServer({ client, readOnly: true });
await server.connect(new StdioServerTransport());
// The host owns shutdown; closing the server closes the client.
```

A different transport can implement the exported `CezarClient` interface without changing tool semantics. The core imports no Node process/environment/filesystem API, MCP SDK or cezar internals.

## Validate and roll back

```sh
npm run typecheck
npm test
npm run build
npm run test:package
# Explicit dev/CI prerequisite: fetch and build a disposable, exact cezar revision.
node scripts/provision-cezar.mjs
CEZAR_CONTRACT_ARTIFACT="$PWD/.ai/tmp/reference/artifact.json" npm run test:contract:live
```

Run `git diff --check` before that sequence. The live suite fails when its artifact is missing, rather than claiming compatibility from fixtures. It launches only its isolated dry-run fixture. CI executes the gate on Node 20 and 24. See [compatibility evidence](docs/compatibility.md), [public contracts](BACKWARD_COMPATIBILITY.md) and the [optional future migration recipe](docs/migration.md).

To roll back, remove the host's MCP entry and uninstall this local package (`npm uninstall --global @vloneskorpion/cezar-mcp`). This stops adapter access; existing cezar tasks and state remain owned by cezar. Inspect/cancel them explicitly through cezar if desired. No adapter state migration is needed.
