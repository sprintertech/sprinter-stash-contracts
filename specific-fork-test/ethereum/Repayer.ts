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
  addressToBytes32,
} from "../../scripts/common";
import {
  TransparentUpgradeableProxy, ProxyAdmin,
  TestLiquidityPool, Repayer,
} from "../../typechain-types";
import {networkConfig} from "../../network.config";

describe("Repayer", function () {
  const deployAll = async () => {
    const [deployer, admin, repayUser, setTokensUser] = await hre.ethers.getSigners();
    await setCode(repayUser.address, "0x00");

    const forkNetworkConfig = networkConfig.ETHEREUM;

    const REPAYER_ROLE = toBytes32("REPAYER_ROLE");
    const DEPOSIT_PROFIT_ROLE = toBytes32("DEPOSIT_PROFIT_ROLE");

    const usdc = await hre.ethers.getContractAt("ERC20", forkNetworkConfig.Tokens.USDC);
    assertAddress(forkNetworkConfig.Tokens.DAI, "DAI address is missing");
    const dai = await hre.ethers.getContractAt("ERC20", forkNetworkConfig.Tokens.DAI);
    assertAddress(forkNetworkConfig.Tokens.WBTC, "WBTC address is missing");
    const wbtc = await hre.ethers.getContractAt("ERC20", forkNetworkConfig.Tokens.WBTC);
    const liquidityPool = (await deploy(
      "TestLiquidityPool",
      deployer,
      {},
      usdc,
      deployer,
      forkNetworkConfig.WrappedNativeToken
    )) as TestLiquidityPool;
    const liquidityPool2 = (await deploy(
      "TestLiquidityPool",
      deployer,
      {},
      usdc,
      deployer,
      forkNetworkConfig.WrappedNativeToken
    )) as TestLiquidityPool;
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
      "ISuperchainStandardBridge",
      forkNetworkConfig.OptimismStandardBridge!
    );
    const baseStandardBridge = await hre.ethers.getContractAt(
      "ISuperchainStandardBridge",
      forkNetworkConfig.BaseStandardBridge!
    );
    const arbitrumGatewayRouter = await hre.ethers.getContractAt(
      "IArbitrumGatewayRouter",
      forkNetworkConfig.ArbitrumGatewayRouter!
    );
    const everclearFeeAdapter = await hre.ethers.getContractAt("IFeeAdapterV2", forkNetworkConfig.EverclearFeeAdapter!);
    const weth = await hre.ethers.getContractAt("IWrappedNativeToken", forkNetworkConfig.WrappedNativeToken);

    const USDC_DEC = 10n ** (await usdc.decimals());
    const DAI_DEC = 10n ** (await dai.decimals());
    const WBTC_DEC = 10n ** (await wbtc.decimals());

    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer", {},
        Domain.ETHEREUM,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurer,
        optimismStandardBridge,
        baseStandardBridge,
        arbitrumGatewayRouter,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin,
      repayUser,
      setTokensUser,
      [liquidityPool, liquidityPool2, liquidityPool, liquidityPool, liquidityPool],
      [Domain.ETHEREUM, Domain.ETHEREUM, Domain.OP_MAINNET, Domain.BASE, Domain.ARBITRUM_ONE],
      [
        Provider.LOCAL,
        Provider.LOCAL,
        Provider.SUPERCHAIN_STANDARD_BRIDGE,
        Provider.SUPERCHAIN_STANDARD_BRIDGE,
        Provider.ARBITRUM_GATEWAY
      ],
      [true, false, true, true, true],
      [
        {
          inputToken: usdc,
          destinationTokens: [
            {destinationDomain: Domain.OP_MAINNET, outputToken: addressToBytes32(networkConfig.OP_MAINNET.Tokens.USDC)}
          ]
        },
        {
          inputToken: usdc,
          destinationTokens: [
            {destinationDomain: Domain.BASE, outputToken: addressToBytes32(networkConfig.BASE.Tokens.USDC)}
          ]
        },
        {
          inputToken: dai,
          destinationTokens: [
            {
              destinationDomain: Domain.ARBITRUM_ONE, 
              outputToken: addressToBytes32(networkConfig.ARBITRUM_ONE.Tokens.DAI)
            }
          ]
        },
        {
          inputToken: wbtc,
          destinationTokens: [
            {
              destinationDomain: Domain.ARBITRUM_ONE,
              outputToken: addressToBytes32(networkConfig.ARBITRUM_ONE.Tokens.WBTC)
            }
          ]
        },
        {
          inputToken: weth,
          destinationTokens: [
            {
              destinationDomain: Domain.ARBITRUM_ONE,
              outputToken: addressToBytes32(networkConfig.ARBITRUM_ONE.Tokens.WETH)
            }
          ]
        },
      ],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayer", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;
    const repayerProxyAdminAddress = await getCreateAddress(repayerProxy, 1);
    const repayerAdmin = (await getContractAt("ProxyAdmin", repayerProxyAdminAddress, admin)) as ProxyAdmin;

    await liquidityPool.grantRole(DEPOSIT_PROFIT_ROLE, repayer);

    return {
      deployer, admin, repayUser, usdc, setTokensUser,
      USDC_DEC, liquidityPool, liquidityPool2, repayer, repayerProxy, repayerAdmin,
      cctpTokenMessenger, cctpMessageTransmitter, REPAYER_ROLE, DEFAULT_ADMIN_ROLE, acrossV3SpokePool, weth,
      stargateTreasurer, everclearFeeAdapter, forkNetworkConfig, optimismStandardBridge, baseStandardBridge,
      arbitrumGatewayRouter, dai, DAI_DEC, wbtc, WBTC_DEC,
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

    await usdc.connect(usdcOwner).transfer(repayer, 10n * USDC_DEC);

    const amount = 4n * USDC_DEC;
    const outputToken = networkConfig.OP_MAINNET.Tokens.USDC;
    const minGasLimit = 100000n;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint32", "bytes"],
      [outputToken, minGasLimit, "0x1234"]
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.OP_MAINNET,
      Provider.SUPERCHAIN_STANDARD_BRIDGE,
      extraData
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(usdc.target, amount, liquidityPool.target, Domain.OP_MAINNET, Provider.SUPERCHAIN_STANDARD_BRIDGE);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(repayer.target, optimismStandardBridge.target, amount);
    await expect(tx)
      .to.emit(optimismStandardBridge, "ERC20BridgeInitiated")
      .withArgs(
        usdc,
        outputToken,
        repayer,
        liquidityPool,
        amount,
        "0x1234"
      );
  });

  it("Should allow repayer to initiate native token Optimism repay on fork", async function () {
    const {repayer, repayUser, liquidityPool, optimismStandardBridge, weth} = await loadFixture(deployAll);

    const amount = 4n * ETH;
    await repayUser.sendTransaction({to: repayer, value: amount});

    const minGasLimit = 100000n;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint32", "bytes"],
      [ZERO_ADDRESS, minGasLimit, "0x1234"]
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      weth,
      amount,
      liquidityPool,
      Domain.OP_MAINNET,
      Provider.SUPERCHAIN_STANDARD_BRIDGE,
      extraData
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(weth.target, amount, liquidityPool.target, Domain.OP_MAINNET, Provider.SUPERCHAIN_STANDARD_BRIDGE);
    await expect(tx)
      .to.emit(optimismStandardBridge, "ETHBridgeInitiated")
      .withArgs(
        repayer,
        liquidityPool,
        amount,
        "0x1234"
      );
    expect(await getBalance(repayer)).to.equal(0n);
    expect(await weth.balanceOf(repayer)).to.equal(0n);
  });

  it("Should allow repayer to initiate Base repay on fork", async function () {
    const {repayer, USDC_DEC, usdc, repayUser, liquidityPool, baseStandardBridge} = await loadFixture(deployAll);

    assertAddress(process.env.USDC_OWNER_ETH_ADDRESS, "Env variables not configured (USDC_OWNER_ETH_ADDRESS missing)");
    const USDC_OWNER_ETH_ADDRESS = process.env.USDC_OWNER_ETH_ADDRESS;
    const usdcOwner = await hre.ethers.getImpersonatedSigner(USDC_OWNER_ETH_ADDRESS);
    await setBalance(USDC_OWNER_ETH_ADDRESS, 10n ** 18n);

    expect(await repayer.BASE_STANDARD_BRIDGE())
      .to.equal(baseStandardBridge.target);

    await usdc.connect(usdcOwner).transfer(repayer, 10n * USDC_DEC);

    const amount = 4n * USDC_DEC;
    const outputToken = networkConfig.BASE.Tokens.USDC;
    const minGasLimit = 100000n;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint32", "bytes"],
      [outputToken, minGasLimit, "0x1234"]
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.BASE,
      Provider.SUPERCHAIN_STANDARD_BRIDGE,
      extraData
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(usdc.target, amount, liquidityPool.target, Domain.BASE, Provider.SUPERCHAIN_STANDARD_BRIDGE);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(repayer.target, baseStandardBridge.target, amount);
    await expect(tx)
      .to.emit(baseStandardBridge, "ERC20BridgeInitiated")
      .withArgs(
        usdc,
        outputToken,
        repayer,
        liquidityPool,
        amount,
        "0x1234"
      );
  });

  it("Should allow repayer to initiate native token Base repay on fork", async function () {
    const {repayer, repayUser, liquidityPool, baseStandardBridge, weth} = await loadFixture(deployAll);

    const amount = 4n * ETH;
    await repayUser.sendTransaction({to: repayer, value: amount});

    const minGasLimit = 100000n;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint32", "bytes"],
      [ZERO_ADDRESS, minGasLimit, "0x1234"]
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      weth,
      amount,
      liquidityPool,
      Domain.BASE,
      Provider.SUPERCHAIN_STANDARD_BRIDGE,
      extraData
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(weth.target, amount, liquidityPool.target, Domain.BASE, Provider.SUPERCHAIN_STANDARD_BRIDGE);
    await expect(tx)
      .to.emit(baseStandardBridge, "ETHBridgeInitiated")
      .withArgs(
        repayer,
        liquidityPool,
        amount,
        "0x1234"
      );
    expect(await getBalance(repayer)).to.equal(0n);
    expect(await weth.balanceOf(repayer)).to.equal(0n);
  });

  it("Should allow repayer to initiate Arbitrum Gateway DAI repay on fork", async function () {
    const {
      repayer, repayUser, liquidityPool, arbitrumGatewayRouter, dai, DAI_DEC
    } = await loadFixture(deployAll);

    assertAddress(process.env.DAI_OWNER_ETH_ADDRESS, "Env variables not configured (DAI_OWNER_ETH_ADDRESS missing)");
    const DAI_OWNER_ETH_ADDRESS = process.env.DAI_OWNER_ETH_ADDRESS;
    const daiOwner = await hre.ethers.getImpersonatedSigner(DAI_OWNER_ETH_ADDRESS);
    await setBalance(DAI_OWNER_ETH_ADDRESS, 10n ** 18n);

    const amount = 4n * DAI_DEC;
    const maxGas = 10000000n;
    const gasPriceBid = 60000000n;
    const maxSubmissionCost = 100000000000000n;
    const fee = 1000000000000000n;
    await dai.connect(daiOwner).transfer(repayer, amount);

    const outputToken = networkConfig.ARBITRUM_ONE.Tokens.DAI;

    const data = AbiCoder.defaultAbiCoder().encode(
      ["uint256", "bytes"],
      [maxSubmissionCost, "0x"],
    );
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "uint256", "bytes"],
      [outputToken, maxGas, gasPriceBid, data]
    );

    const gatewayAddress = await arbitrumGatewayRouter.getGateway(dai.target);
    const tx = repayer.connect(repayUser).initiateRepay(
      dai,
      amount,
      liquidityPool,
      Domain.ARBITRUM_ONE,
      Provider.ARBITRUM_GATEWAY,
      extraData,
      {value: fee}
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(dai.target, amount, liquidityPool.target, Domain.ARBITRUM_ONE, Provider.ARBITRUM_GATEWAY);
    await expect(tx)
      .to.emit(arbitrumGatewayRouter, "TransferRouted")
      .withArgs(dai.target, repayer.target, liquidityPool.target, gatewayAddress);
    expect(await dai.balanceOf(repayer)).to.equal(0n);
  });

  it("Should allow repayer to initiate Arbitrum Gateway WBTC repay on fork", async function () {
    const {
      repayer, repayUser, liquidityPool, arbitrumGatewayRouter, wbtc, WBTC_DEC
    } = await loadFixture(deployAll);

    assertAddress(process.env.WBTC_OWNER_ETH_ADDRESS, "Env variables not configured (WBTC_OWNER_ETH_ADDRESS missing)");
    const WBTC_OWNER_ETH_ADDRESS = process.env.WBTC_OWNER_ETH_ADDRESS;
    const wbtcOwner = await hre.ethers.getImpersonatedSigner(WBTC_OWNER_ETH_ADDRESS);
    await setBalance(WBTC_OWNER_ETH_ADDRESS, 10n ** 18n);

    const amount = 4n * WBTC_DEC;
    const maxGas = 10000000n;
    const gasPriceBid = 60000000n;
    const maxSubmissionCost = 100000000000000n;
    const fee = 1000000000000000n;
    await wbtc.connect(wbtcOwner).transfer(repayer, amount);

    const outputToken = networkConfig.ARBITRUM_ONE.Tokens.WBTC;

    const data = AbiCoder.defaultAbiCoder().encode(
      ["uint256", "bytes"],
      [maxSubmissionCost, "0x"],
    );
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "uint256", "bytes"],
      [outputToken, maxGas, gasPriceBid, data]
    );

    const gatewayAddress = await arbitrumGatewayRouter.getGateway(wbtc.target);
    const tx = repayer.connect(repayUser).initiateRepay(
      wbtc,
      amount,
      liquidityPool,
      Domain.ARBITRUM_ONE,
      Provider.ARBITRUM_GATEWAY,
      extraData,
      {value: fee}
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(wbtc.target, amount, liquidityPool.target, Domain.ARBITRUM_ONE, Provider.ARBITRUM_GATEWAY);
    await expect(tx)
      .to.emit(arbitrumGatewayRouter, "TransferRouted")
      .withArgs(wbtc.target, repayer.target, liquidityPool.target, gatewayAddress);
    expect(await wbtc.balanceOf(repayer)).to.equal(0n);
  });

  it("Should allow repayer to initiate Arbitrum Gateway DAI repay on fork", async function () {
    const {
      repayer, repayUser, liquidityPool, arbitrumGatewayRouter, dai, DAI_DEC
    } = await loadFixture(deployAll);

    assertAddress(process.env.DAI_OWNER_ETH_ADDRESS, "Env variables not configured (DAI_OWNER_ETH_ADDRESS missing)");
    const DAI_OWNER_ETH_ADDRESS = process.env.DAI_OWNER_ETH_ADDRESS;
    const daiOwner = await hre.ethers.getImpersonatedSigner(DAI_OWNER_ETH_ADDRESS);
    await setBalance(DAI_OWNER_ETH_ADDRESS, 10n ** 18n);

    const amount = 4n * DAI_DEC;
    const maxGas = 10000000n;
    const gasPriceBid = 60000000n;
    const maxSubmissionCost = 100000000000000n;
    const fee = 1000000000000000n;
    await dai.connect(daiOwner).transfer(repayer, amount);

    const outputToken = networkConfig.ARBITRUM_ONE.Tokens.DAI;

    const data = AbiCoder.defaultAbiCoder().encode(
      ["uint256", "bytes"],
      [maxSubmissionCost, "0x"],
    );
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "uint256", "bytes"],
      [outputToken, maxGas, gasPriceBid, data]
    );

    const gatewayAddress = await arbitrumGatewayRouter.getGateway(dai.target);
    const tx = repayer.connect(repayUser).initiateRepay(
      dai,
      amount,
      liquidityPool,
      Domain.ARBITRUM_ONE,
      Provider.ARBITRUM_GATEWAY,
      extraData,
      {value: fee}
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(dai.target, amount, liquidityPool.target, Domain.ARBITRUM_ONE, Provider.ARBITRUM_GATEWAY);
    await expect(tx)
      .to.emit(arbitrumGatewayRouter, "TransferRouted")
      .withArgs(dai.target, repayer.target, liquidityPool.target, gatewayAddress);
    expect(await dai.balanceOf(repayer)).to.equal(0n);
  });

  it("Should allow repayer to initiate Arbitrum Gateway WETH repay on fork", async function () {
    const {
      repayer, repayUser, liquidityPool, weth, arbitrumGatewayRouter,
    } = await loadFixture(deployAll);

    const amount = 4n * ETH;
    const maxGas = 10000000n;
    const gasPriceBid = 60000000n;
    const maxSubmissionCost = 100000000000000n;
    const fee = 1000000000000000n;
    await weth.connect(repayUser).deposit({value: amount});
    await weth.connect(repayUser).transfer(repayer, amount);

    const outputToken = networkConfig.ARBITRUM_ONE.Tokens.WETH;

    const data = AbiCoder.defaultAbiCoder().encode(
      ["uint256", "bytes"],
      [maxSubmissionCost, "0x"],
    );
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "uint256", "bytes"],
      [outputToken, maxGas, gasPriceBid, data]
    );

    const gatewayAddress = await arbitrumGatewayRouter.getGateway(weth.target);
    const tx = repayer.connect(repayUser).initiateRepay(
      weth,
      amount,
      liquidityPool,
      Domain.ARBITRUM_ONE,
      Provider.ARBITRUM_GATEWAY,
      extraData,
      {value: fee}
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(weth.target, amount, liquidityPool.target, Domain.ARBITRUM_ONE, Provider.ARBITRUM_GATEWAY);
    await expect(tx)
      .to.emit(arbitrumGatewayRouter, "TransferRouted")
      .withArgs(weth.target, repayer.target, liquidityPool.target, gatewayAddress);
    expect(await weth.balanceOf(repayer)).to.equal(0n);
  });

  it("Should revert Arbitrum Gateway repay on fork if output tokens don't match", async function () {
    const {
      repayer, repayUser, liquidityPool, usdc, USDC_DEC,
    } = await loadFixture(deployAll);

    const amount = 4n * USDC_DEC;
    const maxGas = 10000000n;
    const gasPriceBid = 60000000n;
    const maxSubmissionCost = 100000000000000n;
    const fee = 1000000000000000n;

    assertAddress(process.env.USDC_OWNER_ETH_ADDRESS, "Env variables not configured (USDC_OWNER_ETH_ADDRESS missing)");
    const USDC_OWNER_ETH_ADDRESS = process.env.USDC_OWNER_ETH_ADDRESS;
    const usdcOwner = await hre.ethers.getImpersonatedSigner(USDC_OWNER_ETH_ADDRESS);
    await setBalance(USDC_OWNER_ETH_ADDRESS, 10n ** 18n);

    await usdc.connect(usdcOwner).transfer(repayer, 10n * USDC_DEC);
    await usdc.connect(usdcOwner).transfer(repayer, amount);

    const outputToken = networkConfig.ARBITRUM_ONE.Tokens.USDC;

    const data = AbiCoder.defaultAbiCoder().encode(
      ["uint256", "bytes"],
      [maxSubmissionCost, "0x"],
    );
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "uint256", "bytes"],
      [outputToken, maxGas, gasPriceBid, data]
    );

    await expect(repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.ARBITRUM_ONE,
      Provider.ARBITRUM_GATEWAY,
      extraData,
      {value: fee}
    )).to.be.revertedWithCustomError(repayer, "InvalidOutputToken()");
  });
});
