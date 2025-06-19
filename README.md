# sprinter-liquidity-contracts

Solidity contracts that facilitate Sprinter Liquidity logic

### Install

    node 22.x is required
    nvm use
    npm install
    npm run compile

### Test

    npm run test

### Deployment

For local development you need to run a local hardhat node and deploy to it:

	npm run node
	npm run deploy-local

Local deployment wallet private key is: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

To deploy to live networks, create a `.env` file using the `.env.example` and fill in the relevant variables (only the ones needed for your deployment).
You need to have a private key specified.
Inspect and modify if needed the `network.config.ts`.
To deploy to Base Sepolia Testnet do:

    npm run dry:deploy-basesepolia
    npm run deploy-basesepolia

Make sure to save the output of the deployment. You can use those later in the `.env` file to run other scripts on the already deployed system.

You could optionally set VERIFY to `true` in order to publish the source code after deployment to Etherscan.

### Deployed contract addresses

[YAML](deployments/deployments.yml)

### Deployment logs

[Base Sepolia](deployments/deploy-basesepolia.log), [Optimism Sepolia](deployments/deploy-opsepolia.log), [Arbitrum Sepolia](deployments/deploy-arbitrumsepolia.log)

[Base](deployments/deploy-base.log), [Optimism Mainnet](deployments/deploy-opmainnet.log), [Arbitrum One](deployments/deploy-arbitrumone.log)

### Rebalancing

Manual Rebalance transaction creation through Safe UI:

1. Connect to the operations multisig on the source chain.
2. Click New Transaction -> Transaction Builder (URL is like: https://app.safe.global/apps/open?safe=base:0x83B8D2eAda788943c3e80892f37f9c102271C1D6&appUrl=https%3A%2F%2Fapps-portal.safe.global%2Ftx-builder)
3. Enter Rebalancer address from deployments config: 0xA85Cf46c150db2600b1D03E437bedD5513869888
4. Enter initiateRebalance ABI:

    `[{"inputs":[{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"address","name":"sourcePool","type":"address"},{"internalType":"address","name":"destinationPool","type":"address"},{"internalType":"enum IRoute.Domain","name":"destinationDomain","type":"uint8"},{"internalType":"enum IRoute.Provider","name":"provider","type":"uint8"},{"internalType":"bytes","name":"extraData","type":"bytes"}],"name":"initiateRebalance","outputs":[],"stateMutability":"nonpayable","type":"function"}]`

5. Fill in transaction details (Base -> Base):
    * Amount: 100000000000 (100,000,000000 USDC with 6 decimals).
    * Source Pool: 0x7C255279c098fdF6c3116D2BecD9978002c09f4b (AaveUSDC pool).
    * Destination Pool: 0xB58Bb9643884abbbad64FA7eBc874c5481E5c032 (USDC pool).
    * Destination Domain: 4 (Base, Reference https://github.com/sprintertech/sprinter-stash-contracts/blob/main/scripts/common.ts#L38).
    * Provider: 0 (Local, Reference: https://github.com/sprintertech/sprinter-stash-contracts/blob/main/scripts/common.ts#L30).
    * Extra Data: 0x (Depends on the selected provider).

6. Click + Add new transaction.
7. Optionally add more transactions to the batch.

7. Fill in transaction details (Base -> Arbitrum):
    * Amount: 500000000000 (500,000,000000 USDC with 6 decimals).
    * Source Pool: 0x7C255279c098fdF6c3116D2BecD9978002c09f4b (AaveUSDC pool).
    * Destination Pool: 0x7C255279c098fdF6c3116D2BecD9978002c09f4b (AaveUSDC pool).
    * Destination Domain: 3 (Arbitrum One, Reference https://github.com/sprintertech/sprinter-stash-contracts/blob/main/scripts/common.ts#L38).
    * Provider: 1 (CCTP, Reference: https://github.com/sprintertech/sprinter-stash-contracts/blob/main/scripts/common.ts#L30).
    * Extra Data: 0x (Depends on the selected provider).

8. Click Create Batch.
9. Click Simulate.
10. Click Send Batch.

---

If rebalancing destination was another chain, then you will need to execute one more transaction on the destination multisig.
By CCTP V1 docs it says that attestation could be produced 9-19 minutes after initial transaction, you will need a tx hash for that.

1. Execute the following in the sprinter stash repo for the source network `hardhat --network BASE cctp-get-process-data --txhash {initiate tx hash}` to get extra data. If there were multiple rebalances, there would be multiple extra datas, one for each processRebalance call.
2. Connect to the operations multisig on the destination chain.
3. Click New Transaction -> Transaction Builder.
4. Enter Rebalancer address from deployments config: 0xA85Cf46c150db2600b1D03E437bedD5513869888
5. Enter processRebalance ABI:

    `[{"inputs":[{"internalType":"address","name":"destinationPool","type":"address"},{"internalType":"enum IRoute.Provider","name":"provider","type":"uint8"},{"internalType":"bytes","name":"extraData","type":"bytes"}],"name":"processRebalance","outputs":[],"stateMutability":"nonpayable","type":"function"}]`

6. Fill in transaction details:
    * Destination Pool: 0x7C255279c098fdF6c3116D2BecD9978002c09f4b (AaveUSDC pool).
    * Provider: 1 (CCTP, Reference: https://github.com/sprintertech/sprinter-stash-contracts/blob/main/scripts/common.ts#L30).
    * Extra Data: take form step (1).

7. Click + Add new transaction.
8. Optionally add more transactions to the batch.

9. Click Create Batch.
10. Click Simulate.
11. Click Send Batch.