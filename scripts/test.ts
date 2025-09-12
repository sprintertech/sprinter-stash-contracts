import dotenv from "dotenv"; 
dotenv.config();
import {assert} from "./common";
import {main as deploy} from "./deploy";
import {main as upgradeRebalancer} from "./upgradeRebalancer";
import {main as upgradeRepayer} from "./upgradeRepayer";
import {main as redeployStash} from "./redeployStash";
import {main as deployCensoredMulticall} from "./deployCensoredMulticall";
import {main as deployUSDCPool} from "./deployUSDCPool";
import {main as deployUSDCStablecoinPool} from "./deployUSDCStablecoinPool";
import {main as deployRepayer} from "./deployRepayer";
import {main as upgradeLiquidityHub} from "./upgradeLiquidityHub";
import {main as deployUSDCPoolAave} from "./deployUSDCPoolAave";
import {main as deployUSDCPoolAaveLongTerm} from "./deployUSDCPoolAaveLongTerm";
import {main as deployStandaloneRepayer} from "./deployStandaloneRepayer";

async function main() {
  console.log("Test deploy.")
  await deploy();
  console.log("Test upgradeRebalancer.")
  await upgradeRebalancer();
  console.log("Test upgradeRepayer.")
  await upgradeRepayer();
  console.log("Test redeployStash.")
  await redeployStash();
  console.log("Test deployUSDCPool.")
  await deployUSDCPool();
  console.log("Test deployUSDCStablecoinPool.")
  await deployUSDCStablecoinPool();
  console.log("Test deployRepayer.")
  await deployRepayer();
  console.log("Test upgradeLiquidityHub.")
  await upgradeLiquidityHub();
  console.log("Test deployUSDCPoolAave.")
  await deployUSDCPoolAave();
  console.log("Test deployUSDCPoolAaveLongTerm.")
  await deployUSDCPoolAaveLongTerm();
  console.log("Test deployStandaloneRepayer.")
  process.env.STANDALONE_REPAYER_ENV = "SparkStage";
  await deployStandaloneRepayer();
  console.log("Test deployCensoredMulticall.")
  process.env.DEPLOY_ID = "NEW_ID";
  await deployCensoredMulticall();
  console.log("Success.");
}

assert(process.env.SCRIPT_ENV === "CI", "Unexpected SCRIPT_ENV value");
main();
