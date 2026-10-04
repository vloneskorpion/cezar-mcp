# Compatibility evidence

The adapter's initial candidate version is 0.1.0. The runtime requires Node 20+ and uses the maintained MCP TypeScript SDK 2.3.0 with Zod 4.6.5. Runtime/build dependencies contain no cezar package, source checkout, shared store or sibling-repository import. Installation and build require no cezar checkout.

## Tested target

| Target | Evidence | Classification |
|---|---|---|
| cezar 0.14.0 built from `1f40016d87d2b7ace23eedbdeae42bdf60c52684` | Real HTTP/SSE API through installed tarball and SDK stdio; [recorded result](evidence/cezar-live.json) | Tested exact source artifact |
| MCP SDK client 2.3.0 | Package handshake, catalog, read-only enforcement and live supervisor flow | Verified in tests |
| Hermes | Configuration derived from official documentation; executable unavailable | Unverified |
| Other cezar builds, including npm artifacts with the same version | No exact artifact evidence | Unverified |

The artifact fingerprint covers its built distribution, scripts and package metadata. Provisioning records an exact source revision and fingerprint; the live suite checks the fingerprint before and after launch. A version string is not an artifact identity. Cezar health reports only a version, so the adapter conservatively reports `compatibility:"unverified"` even when its operator connects to the tested build. It does not infer compatibility from semver, fixtures or a coincidentally matching `0.14.0` label.

## Isolation and reproducibility

Run `node scripts/provision-cezar.mjs` explicitly in this repository, then the full gate documented in the README with `CEZAR_CONTRACT_ARTIFACT` set to the generated manifest. Provisioning builds a disposable checkout under ignored `.ai/tmp/reference`; it refuses a supplied checkout at another revision. Missing manifests, wrong revisions, wrong profiles and altered fingerprints fail the live suite. No test consults an operator cockpit.

The harness creates a temporary git repository, HOME, CEZ_HOME, XDG config/cache and runner-config directories. Its child environment is an allowlist and its PATH contains only Node and git. It copies no credentials, tokens, vendor CLIs or operator state. `CEZ_DRY_RUN=1` uses cezar's simulated runner; automations, follow-ups, title updates, auto-commit and skill auto-update are disabled using this revision's actual controls, and `skillsRepos:[]` is written to the temporary project config.

This cezar revision also makes an unconditional registry-update probe. There is no claimed disable flag for that path: a test-only Node preload denies outbound fetch/socket connections except loopback and denies Unix sockets. The harness proves those denials before launch. This preload changes neither cezar's source/artifact nor the adapter runtime. It terminates only the process group it created and deletes only its temporary sandbox.

The suite exercises real creation of two roots, bounded multi-task waits, ordinary pending questions, transcript reads, exact slash messages, finish, explicit continuation, real child dispatch, cancellation, terminal-parent and wrong-project refusals. Closing MCP is checked against an independent waiting task, which remains alive. Fixtures separately exercise uncertain write outcomes, all delivery variants, hidden metrics, byte limits and stream cleanup.

## Wire decisions grounded in the target

Validators strip additive object fields and preserve absent optional values. Unknown statuses remain readable but disable existing-task writes. Capability flags govern dispatch and displayed token/cost fields; missing metrics are never fabricated as zero. Semantic watch digests omit metrics but include full validated report/question content before preview clipping.

Live evidence corrected two assumptions in the design examples: the task snapshot exposes an optional `currentStepId`, not a required numeric current-step index; history `itemCount` counts canonical UI items, not raw event envelopes. A page of at most 100 canonical items can contain more than 100 raw events, and a concurrent page read can contain events after the captured `asOfSeq`. The adapter preserves the server's pagination metadata and all event identities, applies an 8 MiB HTTP response bound, and either fits metadata within the 64 KiB output bound or returns an explicit size error. It never drops event identities silently to satisfy an invented count equality.

No changes to cezar, registry publication or upstream migration were performed. Real vendor execution and real Hermes still need their own operator verification before extending these claims.
