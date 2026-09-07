import dotenv from "dotenv";
dotenv.config();
import hre from "hardhat";
import {getVerifier, getHardhatNetworkConfig, getNetworkConfig, logDeployers} from "./helpers";
import {isSet, assert, addressToBytes32, ZERO_ADDRESS, assertAddress} from "./common";
import {PaxosOracle} from "../typechain-types";
import {Network, NetworkConfig, Token, TokenInfo} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);
  const id = "PaxosOracle";

  let network: Network;
  let config: NetworkConfig;
  console.log("Deploying PaxosOracle");
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
  }
  await logDeployers();

  assert(config.StashDex, "StashDex must be configured");
  let usdcAddress = ZERO_ADDRESS;
  if (config.Tokens.USDC) {
    usdcAddress = config.Tokens.USDC.Address;
    assertAddress(usdcAddress, "USDC must be an address");
  }
  assert(config.Tokens.USDC, "USDC must be configured");

  // Register all tokens appearing in StashDex routes (both tokenIn and tokenOut) plus pool tokens.
  const tokenNameSet = new Set<Token>(Object.keys(config.StashDex.Pools) as Token[]);
  for (const {TokenIn, TokenOut} of config.StashDex.Routes) {
    tokenNameSet.add(TokenIn);
    tokenNameSet.add(TokenOut);
  }
  const paxosStablecoins: TokenInfo[] = [...tokenNameSet].map(tokenName => {
    const tokenInfo = config.Tokens[tokenName];
    assert(tokenInfo, `Token ${tokenName} not found in config`);
    return tokenInfo;
  });
  console.log(`USDC: ${usdcAddress}`);
  console.log(
    `Paxos stablecoins (1:1 to USDC): ${paxosStablecoins.map(t => t.Address).join(", ") || "none configured"}`
  );

  const initialAssets = paxosStablecoins.map(t => ({
    assetId: addressToBytes32(t.Address),
    decimals: t.Decimals,
  }));

  const paxosOracle: PaxosOracle = (await verifier.deployX(
    "PaxosOracle",
    deployer,
    {},
    [
      config.Admin,
      usdcAddress,
      initialAssets,
    ],
    id
  )) as PaxosOracle;
  console.log(`${id}: ${paxosOracle.target}`);

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
