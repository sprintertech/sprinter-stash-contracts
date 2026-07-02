# Sprinter Stash Integration Risk Framework

This framework scores every external integration the Stash contracts depend on: bridge
providers used by `Rebalancer`/`Repayer` routes, Aave v3 markets used by
`LiquidityPoolAave`/`LiquidityPoolAaveLongTerm`, and price oracles used by
`StashDex`/`Processor`. It is adapted from
[Yearn's risk framework](https://github.com/yearn/risk-score/blob/master/vaults/RISK_FRAMEWORK.md):
we keep their external-protocol dimensions (audits, centralization, value secured,
longevity) and replace the strategy-side dimensions with two that match our exposure
surface (trust model, oracle dependency).

Scores live in machine-readable form under [`risk/scores/`](./scores) and are checked
against `network.config.ts` in CI by [`scripts/check-risk-scores.ts`](../scripts/check-risk-scores.ts).

## Scoring

Each integration is scored 1 (lowest risk) to 5 (highest risk) on six dimensions.
Every score MUST cite at least one source URL in the score file. A score that cannot
be supported by a source is left `null` with a TODO comment - never guessed.

### 1. Audits

Public security audits by trusted firms, of the components we actually touch.

| Score | Criteria |
|-------|----------|
| 1 | 4 or more trusted firm audits, at least one covering the currently deployed version |
| 2 | 3 trusted firm audits |
| 3 | 2 trusted firm audits |
| 4 | 1 trusted firm audit |
| 5 | No public audit |

### 2. Centralization

Who can upgrade, pause, or censor the integration, and how constrained they are.

| Score | Criteria |
|-------|----------|
| 1 | Immutable contracts, or upgrades gated by onchain governance with an enforced timelock |
| 2 | Onchain governance with timelock, plus a guardian able to pause (not upgrade) |
| 3 | Multisig upgrade authority with 4+ independent signers and a timelock or exit window |
| 4 | Multisig upgrade authority without timelock, or issuer-controlled with regulatory oversight |
| 5 | EOA or multisig with fewer than 4 signers can upgrade or take funds instantly |

### 3. Value secured

Value the integration currently secures (TVL, or total value bridged/held). A large
attack surface that has held value for years is evidence of resilience.

| Score | Criteria |
|-------|----------|
| 1 | $480M or more |
| 2 | $120M - $480M |
| 3 | $40M - $120M |
| 4 | $10M - $40M |
| 5 | $10M or less |

### 4. Longevity

Time since the currently used major version launched on mainnet.

| Score | Criteria |
|-------|----------|
| 1 | 24 months or more |
| 2 | 18 - 24 months |
| 3 | 12 - 18 months |
| 4 | 6 - 12 months |
| 5 | Less than 6 months |

### 5. Trust model

Who attests that a cross-chain transfer or protocol interaction is valid. This replaces
Yearn's "protocol type" dimension and is the core bridge-risk question.

| Score | Criteria |
|-------|----------|
| 1 | Burn-and-mint by the asset issuer itself (e.g. Circle attestation), or blue-chip protocol with no messaging layer |
| 2 | Canonical rollup bridge secured by the L1 (fraud or validity proofs), including its governance caveats |
| 3 | Optimistic/intent settlement with an open, permissionless challenge mechanism |
| 4 | External validator or DVN set of independent, identified operators |
| 5 | Small permissioned validator set, centralized relayer, or opaque offchain infrastructure |

### 6. Oracle dependency

How the integration's safety depends on external pricing, and how that price is produced.

| Score | Criteria |
|-------|----------|
| 1 | No external price dependency |
| 2 | Redundant decentralized feeds with deviation checks |
| 3 | Single decentralized oracle network feed (e.g. Chainlink via Aave Oracle) |
| 4 | Single feed from one publisher (e.g. issuer-published price) |
| 5 | Spot/AMM-derived or otherwise manipulable price source |

## Risk level

The six scores are summed (range 6-30) and mapped to a level:

| Total | Level | Policy |
|-------|-------|--------|
| 6 - 12 | 1 | Unrestricted use in routes and pools |
| 13 - 18 | 2 | Allowed; review scores on any incident or governance change |
| 19 - 24 | 3 | Allowed only with written justification in the score entry `comment`; prefer alternatives on corridors that have them |
| 25 - 30 | 4 | MUST NOT appear in allowed routes or pool integrations. CI fails unless an explicit `exceptions` entry with justification exists |

CI enforces the Level 4 policy and that every provider referenced by a non-test route in
`network.config.ts` has a score entry (`npm run check:risk`).

## Process

1. Initial scores are drafted with cited sources and `"status": "draft"`.
2. A second team member reviews the sources and flips `"status"` to `"reviewed"`, adding
   their handle to `reviewers`.
3. Scores are re-reviewed when: an incident occurs, governance/ownership changes, a new
   major version is adopted, or 12 months pass - whichever comes first. Set
   `lastReviewed` on every review.
4. Adding a new `Provider`, Aave market, or oracle to `network.config.ts` requires adding
   a score entry in the same PR - CI fails otherwise.

## Score file schema

```jsonc
{
  "CCTP": {
    "name": "Circle CCTP v1",
    "scores": {
      "audits": 1,
      "centralization": 4,
      "valueSecured": 1,
      "longevity": 1,
      "trustModel": 1,
      "oracleDependency": 1
    },
    "riskLevel": 1,          // computed from the sum; CI recomputes and checks
    "comment": "Issuer burn-and-mint...",
    "sources": ["https://..."],
    "status": "draft",       // draft | reviewed
    "reviewers": [],
    "lastReviewed": "2026-07-02"
  }
}
```

Exceptions to the Level 4 policy live in the same file under a top-level `"exceptions"`
key: `{ "exceptions": { "PROVIDER_NAME": "justification" } }`.
