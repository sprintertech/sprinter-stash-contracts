import {
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {Signature, resolveAddress} from "ethers";
import {
  deploy,
} from "./helpers";
import {
  TestUSDC, CensoredTransferFromMulticall, MockTarget,
} from "../typechain-types";

describe("CensoredTransferFromMulticall", function () {
  const deployAll = async () => {
    const [deployer] = await hre.ethers.getSigners();

    const usdc = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
    const mockTarget = (
      await deploy("MockTarget", deployer)
    ) as MockTarget;
    const multicall = (
      await deploy("CensoredTransferFromMulticall", deployer)
    ) as CensoredTransferFromMulticall;

    const USDC = 10n ** (await usdc.decimals());

    return {deployer, usdc, USDC, mockTarget, multicall};
  };

  it("Should allow to call target after transfer with permit", async function () {
    const {
      deployer, usdc, USDC, mockTarget, multicall,
    } = await loadFixture(deployAll);

    const domain = {
      name: "Circle USD",
      version: "1",
      chainId: hre.network.config.chainId,
      verifyingContract: await resolveAddress(usdc),
    };

    const types = {
      Permit: [
        {name: "owner", type: "address"},
        {name: "spender", type: "address"},
        {name: "value", type: "uint256"},
        {name: "nonce", type: "uint256"},
        {name: "deadline", type: "uint256"},
      ],
    };

    const permitSig = Signature.from(await deployer.signTypedData(domain, types, {
      owner: deployer.address,
      spender: multicall.target,
      value: 10n * USDC,
      nonce: 0n,
      deadline: 2000000000n,
    }));

    const amount = 10n * USDC;
    const tx = multicall.connect(deployer).multicall(
      [usdc.target, usdc.target, usdc.target, mockTarget.target],
      [
        (await usdc.permit.populateTransaction(
          deployer.address, multicall.target, amount, 2000000000n, permitSig.v, permitSig.r, permitSig.s)
        ).data,
        (await usdc.transferFrom.populateTransaction(
          deployer.address, multicall.target, amount)
        ).data,
        (await usdc.approve.populateTransaction(
          mockTarget.target, amount)
        ).data,
        (await mockTarget.fulfill.populateTransaction(
          usdc.target, amount, "0x1234")
        ).data,
      ],
    );
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(deployer.address, multicall.target, amount);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(multicall.target, mockTarget.target, amount);
    await expect(tx)
      .to.emit(mockTarget, "DataReceived")
      .withArgs("0x1234");
    expect(await usdc.balanceOf(multicall.target)).to.equal(0n);
    expect(await usdc.balanceOf(mockTarget.target)).to.equal(10n * USDC);
  });

  it("Should not allow invalid length input", async function () {
    const {
      deployer, multicall,
    } = await loadFixture(deployAll);

    await expect(multicall.connect(deployer).multicall([multicall.target], []))
      .to.be.revertedWithCustomError(multicall, "InvalidLength()");
    await expect(multicall.connect(deployer).multicall([], ["0x1234"]))
      .to.be.revertedWithCustomError(multicall, "InvalidLength()");
  });

  it("Should not allow transferFrom NOT from msg.sender", async function () {
    const {
      deployer, multicall, usdc
    } = await loadFixture(deployAll);

    await expect(multicall.connect(deployer).multicall(
      [usdc.target],
      [(await usdc.transferFrom.populateTransaction(multicall.target, multicall.target, 1n)).data],
    )).to.be.revertedWithCustomError(multicall, "CensoredTransferFrom()");
  });

  it("Should revert if one of the calls reverts", async function () {
    const {
      deployer, multicall, mockTarget
    } = await loadFixture(deployAll);

    await expect(multicall.connect(deployer).multicall(
      [mockTarget.target, mockTarget.target],
      ["0x1234", "0x5678"],
    )).to.be.reverted;
    await expect(multicall.connect(deployer).multicall(
      [deployer.address],
      ["0x1234"],
    )).to.be.reverted;
  });
});
