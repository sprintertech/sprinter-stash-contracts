import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {resolveAddress} from "ethers";
import {getVerifier, upgradeProxy} from "./helpers";
import {LiquidityPool} from "../typechain-types";
import {networkConfig, Network} from "../network.config";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const liquidityPoolAddress = await resolveAddress(process.env.LIQUIDITY_POOL || "");

  const verifier = getVerifier();

  const config = networkConfig[hre.network.name as Network];
  await upgradeProxy<LiquidityPool>(
    verifier.deploy,
    "LiquidityPool",
    deployer,
    [config.USDC, config.Aave],
    liquidityPoolAddress,
  );

  await verifier.verify(process.env.VERIFY === "true");
}

main();
