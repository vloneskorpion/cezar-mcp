# Public compatibility inventory

Initial adapter version: 0.1.0, Node 20+ ESM, independently versioned from cezar.

Protected public surfaces after the first release:

- Executable `cezar-mcp`: `--url`, `--read-only`, `--help`, `--version`; endpoint precedence is explicit URL, `CEZAR_MCP_URL`, lazy discovery. Exit codes are 0 (EOF/shutdown), 2 (arguments), 1 (fatal process failure).
- Library exports: `createMcpServer`, `HttpCezarClient`, `VERSION`, input/result schemas and public types. Importing the entry point creates no activity. Factories require explicit composition.
- Fourteen MCP tool names and strict input schemas in `src/core/contracts.ts`, with schema-derived discovery. Success is `{ok:true,data,truncated}`; failure is `{ok:false,error:{code,message,outcome,...}}`, `isError:true`. Preserve absent costs, distinct delivery outcomes and unknown write outcomes.
- Concrete project/task identity, bounded client-held watch baselines, separate history cursors, no implicit continuation and no automatic mutation retry.
- Loopback-only HTTP/SSE transport; no adapter persistent state or remote listener.

Cezar is an external, independently released product. Wire validators accept additive object fields and project only consumed fields. Unknown statuses remain readable and prevent existing-task mutations. See `docs/compatibility.md` for exact tested artifact evidence; version strings alone never prove compatibility.

Before changing a released name or semantic contract, provide a versioned migration or deprecation path. A future move into cezar preserves tools, result semantics, read-only enforcement and `CEZAR_MCP_URL`; retain a standalone command wrapper for an announced transition release. Internal file paths are not public contracts.
