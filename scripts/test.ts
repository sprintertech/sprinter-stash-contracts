import dotenv from "dotenv"; 
dotenv.config();
import {assert} from "./common";
import {main as deploy} from "./deploy";
import {main as upgradeLiquidityPool} from "./upgradeLiquidityPool";

async function main() {
  console.log("Test deploy.")
  await deploy();
  console.log("Test upgradeLiquidityPool.")
  await upgradeLiquidityPool();
  console.log("Success.");
}

assert(process.env.SCRIPT_ENV === "CI", "Unexpected SCRIPT_ENV value");
main();
