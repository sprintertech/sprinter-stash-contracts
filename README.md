# sprinter-liquidity-contracts

Solidity contracts that facilitate Sprinter Liquidity logic

### Install

    Node 22.x is required
    nvm use
    npm install
    npm run compile

### Test

    npm run test
    npm run test:scripts
    npm run test:ethereum
    npm run lint

Add `FORK_BLOCK_NUMBER=blockNumber` in the beginning of the command to make subsequent runs much faster. Use one of the latest included blocks.

### Deployment

The general deployment approach here, for the best operational experience, is to use the same deployer wallet for each environment (prod, stage, etc.) deployment.
This is due to the use of deployed contract addresses derived from the combination of deployer wallet + DEPLOY_ID environment variable + contract ID.
This allows us to deploy contracts with varied constructor arguments (i.e., on different chains) to the same addresses.
By default, the contract ID is just its name.

We have upgradeable and immutable contract instances.

Upgradeable contracts add an extra proxy ID to the address derivation: DEPLOY_ID + proxyType + contractId.

Implementation contracts for initial deployment use: DEPLOY_ID + contractId.

Implementation contracts for upgrades use: UPGRADE_ID + contractId.

Immutable contracts use: DEPLOY_ID + contractId, where contractId will have a version suffix on subsequent deployments.

In case the deployer wallet for a particular environment is lost or compromised, it is only an inconvenience.
In order to recover from this situation, the newly deployed contracts will have to be put into configuration as literal addresses instead of IDs.

### Configuration

Check/update `network.config.ts` as the main source of truth of the *desired* state of the system. For instance if some routes needs to be updated, first change
them in the configuration, then apply the changes onchain. There are hardhat tasks that simplify the synchronization between config and onchain state.

### Deployment commands

For local development, you need to run a local hardhat node and deploy to it:

	npm run node
	npm run deploy-local

The local deployment wallet private key is: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

To deploy to live networks, create a `.env` file using the `.env.example` and fill in the relevant variables (only the ones needed for your deployment).
You need to have a private key specified.
Inspect and modify if needed the `network.config.ts`.
To deploy to Base Sepolia Testnet, do:

    npm run dry:deploy-basesepolia
    npm run deploy-basesepolia

Make sure to save the output of the deployment. You can use those later in the `.env` file to run other scripts on the already deployed system.

You can optionally set VERIFY to `true` in order to publish the source code to Etherscan after deployment.

### Deployed contract addresses

[YAML Stage](deployments/deployments.staging.yml)

[YAML](deployments/deployments.yml)

### Deployment logs

[Base Sepolia](deployments/deploy-basesepolia.log), [Optimism Sepolia](deployments/deploy-opsepolia.log), [Arbitrum Sepolia](deployments/deploy-arbitrumsepolia.log)

[Base Stage](deployments/deploy-base-stage.log), [Optimism Mainnet Stage](deployments/deploy-opmainnet-stage.log), [Arbitrum One Stage](deployments/deploy-arbitrumone-stage.log),

[Base](deployments/deploy-base.log), [Optimism Mainnet](deployments/deploy-opmainnet.log), [Arbitrum One](deployments/deploy-arbitrumone.log),
[Ethereum](deployments/deploy-ethereum.log), [Polygon Mainnet](deployments/deploy-polygon.log), [Unichain](deployments/deploy-unichain.log)

### Hardhat tasks

In order to update onchain rebalancer or repayer configurations to reflect what is put into configuration, execute the following tasks:

```
npm run hardhat -- update-routes-rebalancer --network BASE
npm run hardhat -- update-routes-repayer --network BASE
npm run hardhat -- add-tokens-repayer --network BASE
```

It will produce a list of instructions for the admin multisig.

### Rebalancing

Manual Rebalance transaction creation through Safe UI:

1. Connect to the operations multisig on the source chain.
2. Click New Transaction -> Transaction Builder (URL is like: https://app.safe.global/apps/open?safe=base:0x83B8D2eAda788943c3e80892f37f9c102271C1D6&appUrl=https%3A%2F%2Fapps-portal.safe.global%2Ftx-builder)
3. Enter Rebalancer address from deployments config: 0xA85Cf46c150db2600b1D03E437bedD5513869888
4. Enter initiateRebalance ABI:
```
[{"inputs":[{"internalType":"uint256","name":"amount","type":"uint256"},
{"internalType":"address","name":"sourcePool","type":"address"},
{"internalType":"address","name":"destinationPool","type":"address"},
{"internalType":"enum IRoute.Domain","name":"destinationDomain","type":"uint8"},
{"internalType":"enum IRoute.Provider","name":"provider","type":"uint8"},
{"internalType":"bytes","name":"extraData","type":"bytes"}],
"name":"initiateRebalance","outputs":[],"stateMutability":"nonpayable","type":"function"}]
```
5. Fill in transaction details (Base -> Base):
    * Amount: 100000000000 (100,000,000000 USDC with 6 decimals).
    * Source Pool: 0x7C255279c098fdF6c3116D2BecD9978002c09f4b (AaveUSDC pool).
    * Destination Pool: 0xB58Bb9643884abbbad64FA7eBc874c5481E5c032 (USDC pool).
    * Destination Domain: 4 (Base, Reference: https://github.com/sprintertech/sprinter-stash-contracts/blob/main/scripts/common.ts#L38).
    * Provider: 0 (Local, Reference: https://github.com/sprintertech/sprinter-stash-contracts/blob/main/scripts/common.ts#L30).
    * Extra Data: 0x (Depends on the selected provider).

6. Click + Add new transaction.
7. Optionally add more transactions to the batch.

8. Fill in transaction details (Base -> Arbitrum):
    * Amount: 500000000000 (500,000,000000 USDC with 6 decimals).
    * Source Pool: 0x7C255279c098fdF6c3116D2BecD9978002c09f4b (AaveUSDC pool).
    * Destination Pool: 0x7C255279c098fdF6c3116D2BecD9978002c09f4b (AaveUSDC pool).
    * Destination Domain: 3 (Arbitrum One, Reference: https://github.com/sprintertech/sprinter-stash-contracts/blob/main/scripts/common.ts#L38).
    * Provider: 1 (CCTP, Reference: https://github.com/sprintertech/sprinter-stash-contracts/blob/main/scripts/common.ts#L30).
    * Extra Data: 0x (Depends on the selected provider).

9. Click Create Batch.
10. Click Simulate.
11. Click Send Batch.

---

If the rebalancing destination was another chain, then you will need to execute one more transaction on the destination multisig.
According to CCTP V1 docs, attestation could be produced 9-19 minutes after the initial transaction, and you will need a tx hash for that.

1. Execute the following in the sprinter stash repo for the source network: `npm run hardhat -- cctp-get-process-data --txhash {initiate tx hash} --network BASE` to get extra data. If there were multiple rebalances, there would be multiple extra datas, one for each processRebalance call.
2. Connect to the operations multisig on the destination chain.
3. Click New Transaction -> Transaction Builder.
4. Enter Rebalancer address from deployments config: 0xA85Cf46c150db2600b1D03E437bedD5513869888
5. Enter processRebalance ABI:
```
[{"inputs":[{"internalType":"address","name":"destinationPool","type":"address"},
{"internalType":"enum IRoute.Provider","name":"provider","type":"uint8"},
{"internalType":"bytes","name":"extraData","type":"bytes"}],
"name":"processRebalance","outputs":[],"stateMutability":"nonpayable","type":"function"}]
```
6. Fill in transaction details:
    * Destination Pool: 0x7C255279c098fdF6c3116D2BecD9978002c09f4b (AaveUSDC pool).
    * Provider: 1 (CCTP, Reference: https://github.com/sprintertech/sprinter-stash-contracts/blob/main/scripts/common.ts#L30).
    * Extra Data: take from step (1).

7. Click + Add new transaction.
8. Optionally add more transactions to the batch.

9. Click Create Batch.
10. Click Simulate.
11. Click Send Batch.
