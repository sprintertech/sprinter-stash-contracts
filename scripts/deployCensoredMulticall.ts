import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {getVerifier} from "./helpers";
import {isSet, assert} from "./common";
import {CensoredTransferFromMulticall} from "../typechain-types";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);

  const censoredTransferFromMulticall = (
    await verifier.deployX("CensoredTransferFromMulticall", deployer)
  ) as CensoredTransferFromMulticall;

  console.log(`CensoredTransferFromMulticall: ${censoredTransferFromMulticall.target}`);

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
