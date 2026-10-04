# Working in cezar-mcp

This is an independent TypeScript/Node 20+ stdio MCP adapter. Task execution and state ownership belong to an existing cezar server through HTTP and SSE; the adapter does not modify the cezar repository. Local build/tarball installation is supported; registry publication is a separate release action.

| Task | Read first | Rules |
|---|---|---|
| Product specification | `README.md`, `.ai/specs/` | Label proposed behavior; distinguish cezar's existing behavior from new adapter behavior. |
| Repository process | `.ai/agentic.config.json`, `SDLC.md` | Target this repository's configured base; never publish to cezar upstream unless explicitly asked. |
| Review | `CODE_REVIEW.md`, `BACKWARD_COMPATIBILITY.md` | Verify scope, external API assumptions and compatibility evidence. |

Run the ordered gate in `.ai/agentic.config.json` and `SDLC.md`: diff check, typecheck, unit/integration tests, build, package tests and isolated live conformance. Provision the exact disposable cezar artifact explicitly per README; missing live prerequisites fail. Never substitute fixture results for live compatibility evidence.
