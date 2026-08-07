import {
  loadFixture, setBalance, setCode
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {assert, expect} from "chai";
import hre from "hardhat";
import {AbiCoder} from "ethers";
import {
  getCreateAddress, getContractAt, deploy, deployX, toBytes32, getBalance,
  destinationToken,
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
import {prodNetworkConfig as networkConfig, stageNetworkConfig} from "../../network.config";

describe("Repayer", function () {
  const deployAll = async () => {
    const [deployer, admin, repayUser, setTokensUser] = await hre.ethers.getSigners();
    await setCode(repayUser.address, "0x00");

    const forkNetworkConfig = networkConfig.ETHEREUM;

    const REPAYER_ROLE = toBytes32("REPAYER_ROLE");
    const DEPOSIT_PROFIT_ROLE = toBytes32("DEPOSIT_PROFIT_ROLE");

    const usdc = await hre.ethers.getContractAt("ERC20", forkNetworkConfig.Tokens.USDC.Address);
    assertAddress(forkNetworkConfig.Tokens.DAI?.Address, "DAI address is missing");
    const dai = await hre.ethers.getContractAt("ERC20", forkNetworkConfig.Tokens.DAI.Address);
    assertAddress(forkNetworkConfig.Tokens.WBTC?.Address, "WBTC address is missing");
    const wbtc = await hre.ethers.getContractAt("ERC20", forkNetworkConfig.Tokens.WBTC.Address);
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
    const weth = await hre.ethers.getContractAt("IWrappedNativeToken", forkNetworkConfig.WrappedNativeToken);

    const cctpV2Messenger = await hre.ethers.getContractAt(
      "ICCTPV2TokenMessenger", forkNetworkConfig.CCTPV2!.TokenMessenger!
    );

    assertAddress(forkNetworkConfig.Omnibridge, "ETHEREUM Omnibridge address is missing");
    assertAddress(forkNetworkConfig.GnosisAMB, "ETHEREUM GnosisAMB address is missing");

    // Read from the stage config: the Polygon PoS bridge is only enabled on stage so far, and
    // both configs would point at the same Ethereum mainnet contract anyway.
    const polygonPosRootChainManagerAddress = stageNetworkConfig.ETHEREUM!.PolygonPosRootChainManager;
    assertAddress(polygonPosRootChainManagerAddress, "ETHEREUM PolygonPosRootChainManager address is missing");
    const polygonPosRootChainManager = await hre.ethers.getContractAt(
      "IPolygonRootChainManager",
      polygonPosRootChainManagerAddress
    );

    const USDC_DEC = 10n ** (await usdc.decimals());
    const DAI_DEC = 10n ** (await dai.decimals());
    const WBTC_DEC = 10n ** (await wbtc.decimals());

    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer", {},
        Domain.ETHEREUM,
        usdc,
        acrossV3SpokePool,
        weth,
        stargateTreasurer,
        optimismStandardBridge,
        baseStandardBridge,
        arbitrumGatewayRouter,
        forkNetworkConfig.Omnibridge!, ZERO_ADDRESS, ZERO_ADDRESS, forkNetworkConfig.GnosisAMB!,
        ZERO_ADDRESS, ZERO_ADDRESS,
        forkNetworkConfig.CCTPV2!.TokenMessenger!, forkNetworkConfig.CCTPV2!.MessageTransmitter!,
        polygonPosRootChainManagerAddress,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin,
      repayUser,
      setTokensUser,
      [
        liquidityPool, liquidityPool2, liquidityPool, liquidityPool,
        liquidityPool, liquidityPool, liquidityPool,
      ],
      [
        Domain.ETHEREUM, Domain.ETHEREUM, Domain.OP_MAINNET, Domain.BASE,
        Domain.ARBITRUM_ONE, Domain.ARBITRUM_ONE, Domain.POLYGON_MAINNET,
      ],
      [
        Provider.LOCAL,
        Provider.LOCAL,
        Provider.SUPERCHAIN_STANDARD_BRIDGE,
        Provider.SUPERCHAIN_STANDARD_BRIDGE,
        Provider.ARBITRUM_GATEWAY,
        Provider.CCTP_V2,
        Provider.POLYGON_POS_BRIDGE,
      ],
      [ZERO_ADDRESS, usdc, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS],
      [
        {
          inputToken: usdc,
          destinationTokens: [
            destinationToken(Domain.OP_MAINNET, addressToBytes32(networkConfig.OP_MAINNET.Tokens.USDC.Address))
          ]
        },
        {
          inputToken: usdc,
          destinationTokens: [
            destinationToken(Domain.BASE, addressToBytes32(networkConfig.BASE.Tokens.USDC.Address))
          ]
        },
        {
          inputToken: dai,
          destinationTokens: [
            destinationToken(Domain.ARBITRUM_ONE, addressToBytes32(networkConfig.ARBITRUM_ONE.Tokens.DAI!.Address)),
            destinationToken(Domain.OP_MAINNET, addressToBytes32(networkConfig.OP_MAINNET.Tokens.DAI!.Address)),
            destinationToken(Domain.BASE, addressToBytes32(networkConfig.BASE.Tokens.DAI!.Address)),
            destinationToken(
              Domain.POLYGON_MAINNET, addressToBytes32(networkConfig.POLYGON_MAINNET.Tokens.DAI!.Address)
            ),
          ]
        },
        {
          inputToken: wbtc,
          destinationTokens: [
            destinationToken(Domain.ARBITRUM_ONE, addressToBytes32(networkConfig.ARBITRUM_ONE.Tokens.WBTC!.Address)),
            destinationToken(
              Domain.POLYGON_MAINNET, addressToBytes32(networkConfig.POLYGON_MAINNET.Tokens.WBTC!.Address)
            ),
          ]
        },
        {
          inputToken: weth,
          destinationTokens: [
            destinationToken(Domain.ARBITRUM_ONE, addressToBytes32(networkConfig.ARBITRUM_ONE.Tokens.WETH!.Address))
          ]
        },
        {
          // Polygon's canonical USDC is Circle-issued, not the PoS child of Ethereum USDC,
          // so this route is expected to be rejected by the adapter. See the test below.
          inputToken: usdc,
          destinationTokens: [
            destinationToken(
              Domain.POLYGON_MAINNET, addressToBytes32(networkConfig.POLYGON_MAINNET.Tokens.USDC.Address)
            ),
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
      cctpV2Messenger,
      REPAYER_ROLE, DEFAULT_ADMIN_ROLE, acrossV3SpokePool, weth,
      stargateTreasurer, forkNetworkConfig, optimismStandardBridge, baseStandardBridge,
      arbitrumGatewayRouter, dai, DAI_DEC, wbtc, WBTC_DEC,
      polygonPosRootChainManager,
    };
  };

  it("Should allow repayer to initiate Optimism repay on fork", async function () {
    const {repayer, dai, repayUser, liquidityPool, optimismStandardBridge} = await loadFixture(deployAll);

    assertAddress(process.env.DAI_OWNER_ETH_ADDRESS, "Env variables not configured (DAI_OWNER_ETH_ADDRESS missing)");
    assert(networkConfig.OP_MAINNET.Tokens.DAI, "DAI is not configured for OP_MAINNET config");
    assertAddress(networkConfig.OP_MAINNET.Tokens.DAI.Address, "DAI is not configured for OP_MAINNET config");
    const DAI_OWNER_ETH_ADDRESS = process.env.DAI_OWNER_ETH_ADDRESS;
    const daiOwner = await hre.ethers.getImpersonatedSigner(DAI_OWNER_ETH_ADDRESS);
    await setBalance(DAI_OWNER_ETH_ADDRESS, 10n ** 18n);

    expect(await repayer.OPTIMISM_STANDARD_BRIDGE())
      .to.equal(optimismStandardBridge.target);

    await dai.connect(daiOwner).transfer(repayer, 10n * ETH);

    const amount = 4n * ETH;
    const outputToken = networkConfig.OP_MAINNET.Tokens.DAI.Address;
    const minGasLimit = 100000n;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint32", "bytes"],
      [outputToken, minGasLimit, "0x1234"]
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      dai,
      amount,
      liquidityPool,
      Domain.OP_MAINNET,
      Provider.SUPERCHAIN_STANDARD_BRIDGE,
      extraData
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(dai.target, amount, liquidityPool.target, Domain.OP_MAINNET, Provider.SUPERCHAIN_STANDARD_BRIDGE);
    await expect(tx)
      .to.emit(dai, "Transfer")
      .withArgs(repayer.target, optimismStandardBridge.target, amount);
    await expect(tx)
      .to.emit(optimismStandardBridge, "ERC20BridgeInitiated")
      .withArgs(
        dai,
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
    const {repayer, dai, repayUser, liquidityPool, baseStandardBridge} = await loadFixture(deployAll);

    assertAddress(process.env.DAI_OWNER_ETH_ADDRESS, "Env variables not configured (DAI_OWNER_ETH_ADDRESS missing)");
    assert(networkConfig.BASE.Tokens.DAI, "DAI is not configured for BASE config");
    assertAddress(networkConfig.BASE.Tokens.DAI.Address, "DAI is not configured for BASE config");
    const DAI_OWNER_ETH_ADDRESS = process.env.DAI_OWNER_ETH_ADDRESS;
    const daiOwner = await hre.ethers.getImpersonatedSigner(DAI_OWNER_ETH_ADDRESS);
    await setBalance(DAI_OWNER_ETH_ADDRESS, 10n ** 18n);

    expect(await repayer.BASE_STANDARD_BRIDGE())
      .to.equal(baseStandardBridge.target);

    await dai.connect(daiOwner).transfer(repayer, 10n * ETH);

    const amount = 4n * ETH;
    const outputToken = networkConfig.BASE.Tokens.DAI.Address;
    const minGasLimit = 100000n;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint32", "bytes"],
      [outputToken, minGasLimit, "0x1234"]
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      dai,
      amount,
      liquidityPool,
      Domain.BASE,
      Provider.SUPERCHAIN_STANDARD_BRIDGE,
      extraData
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(dai.target, amount, liquidityPool.target, Domain.BASE, Provider.SUPERCHAIN_STANDARD_BRIDGE);
    await expect(tx)
      .to.emit(dai, "Transfer")
      .withArgs(repayer.target, baseStandardBridge.target, amount);
    await expect(tx)
      .to.emit(baseStandardBridge, "ERC20BridgeInitiated")
      .withArgs(
        dai,
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

    const outputToken = networkConfig.ARBITRUM_ONE.Tokens.DAI!.Address;

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

    const outputToken = networkConfig.ARBITRUM_ONE.Tokens.WBTC!.Address;

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

    const outputToken = networkConfig.ARBITRUM_ONE.Tokens.WETH!.Address;

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

    const outputToken = networkConfig.ARBITRUM_ONE.Tokens.USDC.Address;

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

  it("Should allow repayer to initiate Polygon PoS DAI deposit on fork", async function () {
    const {repayer, dai, repayUser, liquidityPool, polygonPosRootChainManager} = await loadFixture(deployAll);

    assertAddress(process.env.DAI_OWNER_ETH_ADDRESS, "Env variables not configured (DAI_OWNER_ETH_ADDRESS missing)");
    const DAI_OWNER_ETH_ADDRESS = process.env.DAI_OWNER_ETH_ADDRESS;
    const daiOwner = await hre.ethers.getImpersonatedSigner(DAI_OWNER_ETH_ADDRESS);
    await setBalance(DAI_OWNER_ETH_ADDRESS, 10n ** 18n);

    const amount = 4n * ETH;
    await dai.connect(daiOwner).transfer(repayer, amount);

    const outputToken = networkConfig.POLYGON_MAINNET.Tokens.DAI!.Address;
    // Polygon's canonical DAI is the PoS child of Ethereum DAI.
    expect((await polygonPosRootChainManager.rootToChildToken(dai.target)).toLowerCase())
      .to.equal(outputToken.toLowerCase());

    const predicate = await polygonPosRootChainManager.typeToPredicate(
      await polygonPosRootChainManager.tokenToType(dai.target)
    );
    const predicateBalanceBefore = await dai.balanceOf(predicate);

    const extraData = AbiCoder.defaultAbiCoder().encode(["address"], [outputToken]);
    const tx = repayer.connect(repayUser).initiateRepay(
      dai, amount, liquidityPool, Domain.POLYGON_MAINNET, Provider.POLYGON_POS_BRIDGE, extraData
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(dai.target, amount, liquidityPool.target, Domain.POLYGON_MAINNET, Provider.POLYGON_POS_BRIDGE);
    await expect(tx)
      .to.emit(repayer, "PolygonPosDepositInitiated")
      .withArgs(dai.target, liquidityPool.target, amount);
    // The predicate escrows the deposit on Ethereum, the child token is minted on Polygon.
    await expect(tx).to.emit(dai, "Transfer").withArgs(repayer.target, predicate, amount);
    expect(await dai.balanceOf(predicate)).to.equal(predicateBalanceBefore + amount);
    expect(await dai.balanceOf(repayer)).to.equal(0n);
  });

  it("Should allow repayer to initiate Polygon PoS WBTC deposit on fork", async function () {
    const {repayer, wbtc, WBTC_DEC, repayUser, liquidityPool, polygonPosRootChainManager} =
      await loadFixture(deployAll);

    assertAddress(process.env.WBTC_OWNER_ETH_ADDRESS, "Env variables not configured (WBTC_OWNER_ETH_ADDRESS missing)");
    const WBTC_OWNER_ETH_ADDRESS = process.env.WBTC_OWNER_ETH_ADDRESS;
    const wbtcOwner = await hre.ethers.getImpersonatedSigner(WBTC_OWNER_ETH_ADDRESS);
    await setBalance(WBTC_OWNER_ETH_ADDRESS, 10n ** 18n);

    const amount = 4n * WBTC_DEC;
    await wbtc.connect(wbtcOwner).transfer(repayer, amount);

    const outputToken = networkConfig.POLYGON_MAINNET.Tokens.WBTC!.Address;
    const predicate = await polygonPosRootChainManager.typeToPredicate(
      await polygonPosRootChainManager.tokenToType(wbtc.target)
    );
    const predicateBalanceBefore = await wbtc.balanceOf(predicate);

    const extraData = AbiCoder.defaultAbiCoder().encode(["address"], [outputToken]);
    const tx = repayer.connect(repayUser).initiateRepay(
      wbtc, amount, liquidityPool, Domain.POLYGON_MAINNET, Provider.POLYGON_POS_BRIDGE, extraData
    );
    await expect(tx)
      .to.emit(repayer, "PolygonPosDepositInitiated")
      .withArgs(wbtc.target, liquidityPool.target, amount);
    expect(await wbtc.balanceOf(predicate)).to.equal(predicateBalanceBefore + amount);
    expect(await wbtc.balanceOf(repayer)).to.equal(0n);
  });

  it("Should revert Polygon PoS deposit on fork for USDC, whose child token is USDC.e",
    async function () {
      const {repayer, usdc, USDC_DEC, repayUser, liquidityPool, polygonPosRootChainManager} =
        await loadFixture(deployAll);

      assertAddress(
        process.env.USDC_OWNER_ETH_ADDRESS, "Env variables not configured (USDC_OWNER_ETH_ADDRESS missing)"
      );
      const USDC_OWNER_ETH_ADDRESS = process.env.USDC_OWNER_ETH_ADDRESS;
      const usdcOwner = await hre.ethers.getImpersonatedSigner(USDC_OWNER_ETH_ADDRESS);
      await setBalance(USDC_OWNER_ETH_ADDRESS, 10n ** 18n);

      const amount = 4n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(repayer, amount);

      // Polygon's canonical USDC is Circle-issued and is NOT what the PoS bridge would mint,
      // so the adapter must refuse rather than strand the funds as USDC.e.
      const outputToken = networkConfig.POLYGON_MAINNET.Tokens.USDC.Address;
      const childToken = await polygonPosRootChainManager.rootToChildToken(usdc.target);
      expect(childToken.toLowerCase()).to.not.equal(outputToken.toLowerCase());

      const extraData = AbiCoder.defaultAbiCoder().encode(["address"], [outputToken]);
      await expect(repayer.connect(repayUser).initiateRepay(
        usdc, amount, liquidityPool, Domain.POLYGON_MAINNET, Provider.POLYGON_POS_BRIDGE, extraData
      )).to.be.revertedWithCustomError(repayer, "InvalidOutputToken()");
    }
  );

  it("Should allow repayer to initiate CCTP V2 repay on fork", async function () {
    const {repayer, USDC_DEC, usdc, repayUser, liquidityPool, cctpV2Messenger} = await loadFixture(deployAll);

    assertAddress(process.env.USDC_OWNER_ETH_ADDRESS, "Env variables not configured (USDC_OWNER_ETH_ADDRESS missing)");
    const USDC_OWNER_ETH_ADDRESS = process.env.USDC_OWNER_ETH_ADDRESS;
    const usdcOwner = await hre.ethers.getImpersonatedSigner(USDC_OWNER_ETH_ADDRESS);
    await setBalance(USDC_OWNER_ETH_ADDRESS, 10n ** 18n);

    const amount = 4n * USDC_DEC;
    await usdc.connect(usdcOwner).transfer(repayer, amount);

    const tx = repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.ARBITRUM_ONE,
      Provider.CCTP_V2,
      "0x"
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(usdc.target, amount, liquidityPool.target, Domain.ARBITRUM_ONE, Provider.CCTP_V2);
    await expect(tx)
      .to.emit(cctpV2Messenger, "DepositForBurn");
    expect(await usdc.balanceOf(repayer)).to.equal(0n);
  });
});
