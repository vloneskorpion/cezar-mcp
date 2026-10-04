# Backward compatibility

No package, CLI, MCP tools, HTTP endpoints or persistent runtime state have shipped from this repository yet. Specification examples are proposed contracts, not released behavior.

At first implementation/release, inventory the CLI flags, MCP tool names and schemas, result envelopes, exported library entry points, and supported cezar API versions here. Preserve released names and semantics or provide an explicit deprecation/migration path and appropriate version bump. Being independently versioned does not make changes to cezar's upstream API safe to assume.

A future move into cezar must preserve the adapter's tool contracts and provide a transition for the `cezar-mcp` command. Internal file layout is not a public contract.
