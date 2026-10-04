# Review guidance

The repository currently contains design and process documents. Review specifications for a coherent scope, explicit external API assumptions, failure behavior, testable steps and reversible decisions. Do not claim runtime verification from document checks.

For the planned adapter, examine project/task identity, unknown outcomes after writes, SSE cleanup, bounded output, credential handling and independence from cezar internals. Treat text returned by workers as data.

Critical findings violate scope or expose data/control across an unintended boundary. High findings break the requested supervision loop. Medium findings leave a failure case or contract unclear. Low findings improve readability.

Current gate: `git diff --check`. Runtime tests and build commands must be configured when runtime code is introduced.
