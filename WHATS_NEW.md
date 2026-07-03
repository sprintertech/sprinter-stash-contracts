# What's New — Tenderly Integration

The repo now mirrors all deployed contracts into Tenderly and auto-simulates
admin operations before they reach the Safe multisig. This covers Phases 1–2 of
[TENDERLY_PLAN.md](TENDERLY_PLAN.md); the short tutorials below show what you
can do today.

**Setup (once):** add to your `.env` — `TENDERLY_ACCESS_KEY` (secret, never
commit or print), optionally `TENDERLY_ACCOUNT` (default `sprinter`) and
`TENDERLY_PROJECT` (defaults to `sprinter-stash-production`, or
`sprinter-staging` when `DEPLOY_TYPE=STAGE`). Everything degrades gracefully:
without the key, simulations print a one-line skip notice and nothing blocks.

---

## 1. Keep Tenderly in sync with the deployment manifests

Two Tenderly projects mirror the deployment manifests (the single source of
truth for addresses): `sprinter-stash-production` ← `deployments/deployments.yml`
and `sprinter-staging` ← `deployments/deployments.staging.yml`.

```bash
TENDERLY_DRY_RUN=1 npm run tenderly:sync   # preview the diff, write nothing
npm run tenderly:sync                      # sync prod
npm run tenderly:sync-staging              # sync staging
```

The sync is idempotent and additive: missing contracts are added, extras are
reported as **drift** but never deleted, and networks Tenderly doesn't support
(e.g. HyperEVM) are skipped with a notice. Third-party tokens like USDC are
deliberately excluded so they don't swamp the transaction listing.

**When to run it:** after any deploy that changes `deployments/*.yml`. A clean
run prints "Nothing to add, project is in sync."

Note: it's `TENDERLY_DRY_RUN`, not `DRY_RUN` — the latter already means "network
to simulate deployment on" in `hardhat.config.ts`.

## 2. Review Safe transactions as a state diff, not hex

Admin tasks used to print raw calldata that was signed blind. Now, whenever a
transaction is proposed to the Safe Transaction Service (or dry-run in
impersonation mode), it is automatically simulated **from the Safe's address**
against real chain state:

```bash
SAFE=<safe-address> npm run hardhat -- update-routes-rebalancer --network BASE
```

Alongside the usual output you get:

```
Simulating Safe transaction on Tenderly...
  Result: SUCCESS (gas used: 84213)
  Events (2):
    RouteSet @ 0x…rebalancer
    ...
  State changes (1):
    0x… (raw slot) 0x00…00 → 0x00…01
  Simulation: https://dashboard.tenderly.co/shared/simulation/<id>
```

The link is a **public shared simulation** — Safe signers can open it without
Tenderly org access and inspect the full decoded trace before signing. This
covers all config-sync families (`update-routes-*`, `update-tokens-repayer`,
`update-stashdex-*`, `update-paxos-oracle-assets`) since they all funnel
through `scripts/safe.ts`.

Simulation is advisory: a Tenderly outage never blocks the admin path. Opt out
with `TENDERLY_SIMULATE=false`.

## 3. Rehearse upgrades before proposing them

Upgrades are the highest-risk admin op. Upgrade scripts (the `UPGRADE_ID`
family) that print ProxyAdmin `upgradeAndCall` calldata now also print a
rehearsal simulation — and it works in dry-run, even though the new
implementation only exists on the local fork, by injecting its bytecode as a
state override:

```bash
DRY_RUN=BASE DEPLOY_ID=MVP UPGRADE_ID=<id> npx hardhat run scripts/upgradeRebalancer.ts
```

The rehearsal shows the post-upgrade state diff. What to check in the link:

- the ERC1967 **implementation slot** flips to the expected new address;
- **ERC7201 namespaced storage** is otherwise untouched (no unexpected slots);
- any **initializer effects** from the `upgradeAndCall` data are the ones you
  intended.

## 4. Simulate anything programmatically

`scripts/tenderlySimulate.ts` is the reusable helper behind all of the above:

```ts
import {reportSimulation, simulateOnTenderly} from "./tenderlySimulate";

// Advisory: prints summary + shareable link, never throws.
await reportSimulation({chainId: 8453, from: safe, to: pool, data}, "pause tx");

// Programmatic: returns {url, success, summary}, throws on API errors.
const outcome = await simulateOnTenderly({
  chainId: 8453, from, to, data,
  stateOverrides: {[proxy]: {code: newImplementationBytecode}},
});
```

`stateOverrides` accepts per-address `code`, `balance`, and `storage` — the
same mechanism the upgrade rehearsal uses. Formatter behavior is unit-tested in
`test/TenderlySimulate.ts` against mocked API responses (CI never calls
Tenderly).

## 5. Let agents do the tracing

The Tenderly MCP server is registered in `.mcp.json`, so Claude Code sessions
in this repo can simulate transactions, pull decoded call traces, inspect state
changes, and manage Virtual TestNets directly. Try:

> "Trace transaction 0x… on Base and explain why it reverted."

> "Simulate calling totalAssets() on the Base LiquidityHub proxy."

Both proxies and implementations are registered in the projects, so traces
decode through the proxy with our contract names.

---

## What's next

Phases 3–6 (alerting, protocol-aware Web3 Actions, Virtual TestNets for
staging, agent debugging skills) are planned — see the status table in
[TENDERLY_PLAN.md](TENDERLY_PLAN.md).
