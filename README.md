# cezar-mcp

An independent MCP adapter for supervising tasks in an existing cezar instance.

This repository is at the design stage. It has no implemented CLI or published package yet. Specifications live in `.ai/specs/`. The intended flow is external AI supervisor → MCP adapter → cezar HTTP/SSE API → workers.

Product development and pull requests belong to this repository. A future move into cezar is an optional packaging migration, not a current dependency.

Proposed design: [Standalone cezar-mcp for external task supervision](.ai/specs/2026-10-04-standalone-cezar-mcp.md).
