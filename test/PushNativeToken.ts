import {
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {
  deploy, getBalance,
} from "./helpers";
import {
  MockTarget,
} from "../typechain-types";

describe("PushNativeToken", function () {
  const deployAll = async () => {
    const [deployer] = await hre.ethers.getSigners();

    const mockTarget = (
      await deploy("MockTarget", deployer)
    ) as MockTarget;

    return {deployer, mockTarget};
  };

  it("Should allow to push native token to a non payable contract", async function () {
    const {
      deployer, mockTarget,
    } = await loadFixture(deployAll);

    const amount = 1000n;

    await deploy("PushNativeToken", deployer, {value: amount}, mockTarget);
    expect(await getBalance(mockTarget)).to.equal(amount);
  });

  it("Should deploy empty code", async function () {
    const {
      deployer, mockTarget,
    } = await loadFixture(deployAll);

    const amount = 1000n;

    const pusher = await deploy("PushNativeToken", deployer, {value: amount}, mockTarget);
    expect(await hre.ethers.provider.getCode(pusher)).to.equal("0x");
  });
});
