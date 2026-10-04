# Working in cezar-mcp

This is an independent MCP adapter project at the specification stage. No runtime stack or public API has shipped. The intended architecture delegates task execution and state ownership to an existing cezar server through HTTP and SSE; the adapter does not modify the cezar repository.

| Task | Read first | Rules |
|---|---|---|
| Product specification | `README.md`, `.ai/specs/` | Label proposed behavior; distinguish cezar's existing behavior from new adapter behavior. |
| Repository process | `.ai/agentic.config.json`, `SDLC.md` | Target this repository's configured base; never publish to cezar upstream unless explicitly asked. |
| Review | `CODE_REVIEW.md`, `BACKWARD_COMPATIBILITY.md` | Verify scope, external API assumptions and compatibility evidence. |

Current validation: `git diff --check`. The first implementation must add appropriate build, typecheck and test commands and update the pipeline; this documentation check is not a runtime validation gate.
