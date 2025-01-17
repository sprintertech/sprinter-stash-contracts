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

To deploy to live networks, create a `.env` file using the `.env.example` and fill in the relevant variables (only the ones needed for your deployment).
You need to have a private key specified.
To deploy to Base Testnet do:

    npm run deploy-basetest

Make sure to save the output of the deployment. You can use those later in the `.env` file to run other scripts on the already deployed system.

You could optionally set VERIFY to `true` in order to publish the source code after deployemnt to sourcify.dev.
