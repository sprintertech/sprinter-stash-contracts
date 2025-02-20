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
To deploy to Base Testnet do:

    npm run deploy-basetest

Make sure to save the output of the deployment. You can use those later in the `.env` file to run other scripts on the already deployed system.

You could optionally set VERIFY to `true` in order to publish the source code after deployemnt to Etherscan.
