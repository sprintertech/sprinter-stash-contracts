import {
  loadFixture, setBalance, setCode
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {AbiCoder} from "ethers";
import {
  getCreateAddress, getContractAt, deploy, deployX, toBytes32, getBalance,
} from "../../test/helpers";
import {
  ProviderSolidity as Provider, DomainSolidity as Domain,
  DEFAULT_ADMIN_ROLE, assertAddress, ETH, ZERO_ADDRESS,
} from "../../scripts/common";
import {
  TransparentUpgradeableProxy, ProxyAdmin,
  TestLiquidityPool, Repayer,
} from "../../typechain-types";
import {networkConfig} from "../../network.config";

describe("Repayer", function () {
  const deployAll = async () => {
    const [deployer, admin, repayUser, user] = await hre.ethers.getSigners();
    await setCode(repayUser.address, "0x00");

    const forkNetworkConfig = networkConfig.ETHEREUM;

    const REPAYER_ROLE = toBytes32("REPAYER_ROLE");
    const DEPOSIT_PROFIT_ROLE = toBytes32("DEPOSIT_PROFIT_ROLE");

    const usdc = await hre.ethers.getContractAt("ERC20", forkNetworkConfig.USDC);
    const liquidityPool = (await deploy("TestLiquidityPool", deployer, {}, usdc, deployer)) as TestLiquidityPool;
    const liquidityPool2 = (await deploy("TestLiquidityPool", deployer, {}, usdc, deployer)) as TestLiquidityPool;
    const cctpTokenMessenger = await hre.ethers.getContractAt(
      "ICCTPTokenMessenger",
      forkNetworkConfig.CCTP!.TokenMessenger!
    );
    const cctpMessageTransmitter = await hre.ethers.getContractAt(
      "ICCTPMessageTransmitter",
      forkNetworkConfig.CCTP!.MessageTransmitter!
    );
    const acrossV3SpokePool = await hre.ethers.getContractAt(
      "V3SpokePoolInterface",
      forkNetworkConfig.AcrossV3SpokePool!
    );
    const stargateTreasurer = await hre.ethers.getContractAt(
      "IStargateTreasurer",
      forkNetworkConfig.StargateTreasurer!
    );
    const optimismStandardBridge = await hre.ethers.getContractAt(
      "IOptimismStandardBridge",
      forkNetworkConfig.OptimismStandardBridge!
    );
    const everclearFeeAdapter = await hre.ethers.getContractAt("IFeeAdapter", forkNetworkConfig.EverclearFeeAdapter!);
    const weth = await hre.ethers.getContractAt("IWrappedNativeToken", forkNetworkConfig.WrappedNativeToken);

    const USDC_DEC = 10n ** (await usdc.decimals());

    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer", {},
        Domain.ETHEREUM,
        usdc.target,
        cctpTokenMessenger.target,
        cctpMessageTransmitter.target,
        acrossV3SpokePool.target,
        everclearFeeAdapter.target,
        weth.target,
        stargateTreasurer,
        optimismStandardBridge.target,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin.address,
      repayUser.address,
      [liquidityPool.target, liquidityPool2.target, liquidityPool.target],
      [Domain.ETHEREUM, Domain.ETHEREUM, Domain.OP_MAINNET],
      [Provider.LOCAL, Provider.LOCAL, Provider.OPTIMISM_STANDARD_BRIDGE],
      [true, false, true],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayer", {},
      repayerImpl.target, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy.target, deployer)) as Repayer;
    const repayerProxyAdminAddress = await getCreateAddress(repayerProxy, 1);
    const repayerAdmin = (await getContractAt("ProxyAdmin", repayerProxyAdminAddress, admin)) as ProxyAdmin;

    await liquidityPool.grantRole(DEPOSIT_PROFIT_ROLE, repayer.target);

    return {
      deployer, admin, repayUser, user, usdc,
      USDC_DEC, liquidityPool, liquidityPool2, repayer, repayerProxy, repayerAdmin,
      cctpTokenMessenger, cctpMessageTransmitter, REPAYER_ROLE, DEFAULT_ADMIN_ROLE, acrossV3SpokePool, weth,
      stargateTreasurer, everclearFeeAdapter, forkNetworkConfig, optimismStandardBridge,
    };
  };

  it("Should allow repayer to initiate Optimism repay on fork", async function () {
    const {repayer, USDC_DEC, usdc, repayUser, liquidityPool, optimismStandardBridge} = await loadFixture(deployAll);

    assertAddress(process.env.USDC_OWNER_ETH_ADDRESS, "Env variables not configured (USDC_OWNER_ETH_ADDRESS missing)");
    const USDC_OWNER_ETH_ADDRESS = process.env.USDC_OWNER_ETH_ADDRESS;
    const usdcOwner = await hre.ethers.getImpersonatedSigner(USDC_OWNER_ETH_ADDRESS);
    await setBalance(USDC_OWNER_ETH_ADDRESS, 10n ** 18n);

    expect(await repayer.OPTIMISM_STANDARD_BRIDGE())
      .to.equal(optimismStandardBridge.target);

    await usdc.connect(usdcOwner).transfer(repayer.target, 10n * USDC_DEC);

    const amount = 4n * USDC_DEC;
    const outputToken = networkConfig.OP_MAINNET.USDC;
    const minGasLimit = 100000n;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint32"],
      [outputToken, minGasLimit]
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      usdc.target,
      amount,
      liquidityPool.target,
      Domain.OP_MAINNET,
      Provider.OPTIMISM_STANDARD_BRIDGE,
      extraData
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(usdc.target, amount, liquidityPool.target, Domain.OP_MAINNET, Provider.OPTIMISM_STANDARD_BRIDGE);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(repayer.target, optimismStandardBridge.target, amount);
    await expect(tx)
      .to.emit(optimismStandardBridge, "ERC20BridgeInitiated")
      .withArgs(
        usdc.target,
        outputToken,
        repayer.target,
        liquidityPool.target,
        amount,
        "0x"
      );
  });

  it("Should allow repayer to initiate native token Optimism repay on fork", async function () {
    const {repayer, repayUser, liquidityPool, optimismStandardBridge, weth} = await loadFixture(deployAll);

    const amount = 4n * ETH;
    await repayUser.sendTransaction({to: repayer.target, value: amount});

    const minGasLimit = 100000n;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint32"],
      [ZERO_ADDRESS, minGasLimit]
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      weth.target,
      amount,
      liquidityPool.target,
      Domain.OP_MAINNET,
      Provider.OPTIMISM_STANDARD_BRIDGE,
      extraData
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(weth.target, amount, liquidityPool.target, Domain.OP_MAINNET, Provider.OPTIMISM_STANDARD_BRIDGE);
    await expect(tx)
      .to.emit(optimismStandardBridge, "ETHBridgeInitiated")
      .withArgs(
        repayer.target,
        liquidityPool.target,
        amount,
        "0x"
      );
    expect(await getBalance(repayer.target)).to.equal(0n);
    expect(await weth.balanceOf(repayer.target)).to.equal(0n);
  });
});
