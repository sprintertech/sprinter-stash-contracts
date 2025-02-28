import dotenv from "dotenv"; 
dotenv.config();
import {assert} from "./common";
import {main as deploy} from "./deploy";
import {main as upgradeRebalancer} from "./upgradeRebalancer";

async function main() {
  console.log("Test deploy.")
  await deploy();
  console.log("Test upgradeRebalancer.")
  await upgradeRebalancer();
  console.log("Success.");
}

assert(process.env.SCRIPT_ENV === "CI", "Unexpected SCRIPT_ENV value");
main();
