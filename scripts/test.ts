import dotenv from "dotenv"; 
dotenv.config();
import {assert} from "./common";
import {main as deploy} from "./deploy";
import {main as upgradeRebalancer} from "./upgradeRebalancer";
import {main as redeployStash} from "./redeployStash";
import {main as deployCensoredMulticall} from "./deployCensoredMulticall";

async function main() {
  console.log("Test deploy.")
  await deploy();
  console.log("Test upgradeRebalancer.")
  await upgradeRebalancer();
  console.log("Test redeployStash.")
  await redeployStash();
  console.log("Test deployCensoredMulticall.")
  await deployCensoredMulticall();
  console.log("Success.");
}

assert(process.env.SCRIPT_ENV === "CI", "Unexpected SCRIPT_ENV value");
main();
