# Standalone cezar-mcp implementation

Source doc: .ai/specs/2026-10-04-standalone-cezar-mcp.md
Source PR: #1
Engine: om-auto-create-pr (steps: 9, --loop: no)

## Goal
Implement the spec at .ai/specs/2026-10-04-standalone-cezar-mcp.md as an independently installed stdio MCP adapter for an existing cezar cockpit.

## Scope
Fourteen strictly scoped tools, injectable core/client boundaries, loopback HTTP and request-owned SSE, CLI/package lifecycle, tests and operator documentation. The specification remains on design PR #1 and is materialized here only for reference; it is not part of this branch.

## Non-goals
No cezar source changes, public npm publication, upstream PR, merge, remote MCP listener, automatic mutation retry, permanent scheduler, state journal or future upstream migration implementation.

## Implementation Plan
Follow the source specification's three phases and nine steps below. Use released Node 20-compatible MCP SDK v2 and Zod; verify the public HTTP/SSE shapes at cezar revision 1f40016d87d2b7ace23eedbdeae42bdf60c52684. Use an isolated pinned development artifact only for explicit live tests, never a runtime/build dependency of this package.

## Risks
- A version label alone cannot identify the pinned cezar artifact. Compatibility metadata remains unverified unless identity matches documented evidence.
- Writes accepted before connection loss have unknown outcomes; tests must prove exactly one attempt.
- Live harness isolation must be demonstrated before launch. Missing live prerequisites fail, never skip.
- Real Hermes interoperability is unverified if Hermes is unavailable; SDK evidence is reported separately.
- User-facing control requires manual QA approval before merge under the configured gate.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Standalone connection and inspection

- [x] 1.1 Establish package and public boundaries. — f494f13
- [x] 1.2 Define wire and core contracts. — 2da7e4f
- [ ] 1.3 Implement the CLI, connection and read tools.
- [ ] 1.4 Prove standalone installation.

### Phase 2: Task control

- [ ] 2.1 Implement write tools.
- [ ] 2.2 Verify failure and delivery semantics.

### Phase 3: Supervision and external compatibility

- [ ] 3.1 Implement bounded event waits.
- [ ] 3.2 Prove conformance and supervisor workflow against cezar.
- [ ] 3.3 Record compatibility and release guidance.
