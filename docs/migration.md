# Optional future packaging migration

This is a recipe, not a migration performed by the current implementation.

1. Inventory released CLI flags, environment precedence, fourteen tool schemas, result envelopes and exported library contracts. Keep cezar state and execution ownership unchanged.
2. Move the transport-neutral contracts/handlers behind an equivalent injected `CezarClient`. An internal client may replace HTTP only after proving identical scoping, acceptance, cancellation, read-only and unknown-outcome semantics.
3. Add a thin cezar composition entry point that explicitly creates the client, MCP factory and transport. Importing the library must remain inactive. Do not make a factory start a cockpit, worker or permanent scheduler.
4. Retain a `cezar-mcp` executable wrapper and `CEZAR_MCP_URL` behavior for an announced transition release. Keep standalone install instructions and provide a versioned deprecation path before changing public imports or commands.
5. Run the same package, failure and live supervisor conformance suites against both compositions. Report exact artifact and host evidence. Removing a host entry remains a reversible rollback that leaves cezar tasks intact.
