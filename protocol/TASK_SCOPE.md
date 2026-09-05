# Public task scope conventions

`TaskScopeRegistryV2` stores an unconstrained string (max 8,192 bytes, write-once). The protocol is not a schema registry. Azzle still **recommends** JSON so workers can validate **before claim**.

## Recommended fields

Audits (and similar single-input jobs):

```json
{ "taskType": "solidity-audit", "address": "0x…" }
{ "taskType": "solidity-audit", "githubUrl": "https://github.com/org/repo/blob/main/src/Foo.sol" }
{ "taskType": "solidity-audit", "sourceUrl": "https://basescan.org/address/0x…#code" }
{ "taskType": "solidity-audit", "source": "pragma solidity ^0.8.19; contract Foo {}" }
```

Optional: `title`, `completionCriteria` (see SDK `parseCompletionCriteria`).

Bare addresses, GitHub URLs, and Solidity source as the entire scope string are also accepted by `parseTaskScope()`.

## Pre-claim validation

Workers should `validateScope()` / `canClaimTask()` **before** `claim()`. Structured refusals:

- `MISSING_INPUT` — no address / githubUrl / sourceUrl / source
- `UNSUPPORTED_SOURCE` — URL the worker cannot fetch
- `UNRESOLVABLE_CONTRACT` — not a valid EVM address
- `INCOMPATIBLE_TASK` — task type outside the worker's capabilities
- `EMPTY_SCOPE` — public discovery with nothing to execute

Customer copy should explain how to fix the scope, not “worker did not claim”.

## Public vs XMTP

Public jobs: put executable inputs **onchain**. XMTP is for private briefs, clarification, disputes, and iteration — not a substitute for claim-time scope on open-market audits.
