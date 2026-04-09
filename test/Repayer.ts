import {
  loadFixture, setBalance, time, setCode
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {AbiCoder, hexlify, toUtf8Bytes, AddressLike, BigNumberish, BytesLike} from "ethers";
import {anyValue} from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import {
  getCreateAddress, getContractAt, deploy, deployX, toBytes32, getBalance,
  destinationToken,
} from "./helpers";
import {
  ProviderSolidity as Provider, DomainSolidity as Domain, ZERO_ADDRESS,
  DEFAULT_ADMIN_ROLE, assertAddress, ETH, addressToBytes32,
} from "../scripts/common";
import {
  TestUSDC, TransparentUpgradeableProxy, ProxyAdmin,
  TestLiquidityPool, Repayer, TestCCTPTokenMessenger, TestCCTPMessageTransmitter,
  TestAcrossV3SpokePool, TestStargate, MockStargateTreasurerTrue, MockStargateTreasurerFalse,
  TestSuperchainStandardBridge, IWrappedNativeToken, TestArbitrumGatewayRouter,
  TestGnosisOmnibridge, TestGnosisAMB, TestUSDCTransmuter,
  TestUSDT0, TestUSDT0OFTAdapter, TestUSDT0OFTNative,
  TestEverclearFeeAdapter,
} from "../typechain-types";
import {networkConfig} from "../network.config";

const ALLOWED = true;
const DISALLOWED = false;

async function now() {
  return BigInt(await time.latest());
}

describe("Repayer", function () {
  const isOutputTokenAllowed = async (
    repayer: Repayer,
    inputToken: AddressLike,
    destinationDomain: BigNumberish,
    outputToken: BytesLike
  ) => {
    const {isAllowed} = await repayer.outputTokenData(inputToken, destinationDomain, outputToken);
    return isAllowed;
  };

  const deployAll = async () => {
    const [deployer, admin, repayUser, user, setTokensUser] = await hre.ethers.getSigners();
    await setCode(repayUser.address, "0x00");

    const forkNetworkConfig = networkConfig.BASE;

    const REPAYER_ROLE = toBytes32("REPAYER_ROLE");

    const usdc = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
    const liquidityPool = (await deploy(
      "TestLiquidityPool",
      deployer,
      {},
      usdc,
      deployer,
      networkConfig.BASE.WrappedNativeToken
    )) as TestLiquidityPool;
    const liquidityPool2 = (await deploy(
      "TestLiquidityPool",
      deployer,
      {},
      usdc,
      deployer,
      networkConfig.BASE.WrappedNativeToken
    )) as TestLiquidityPool;
    const cctpTokenMessenger = (await deploy("TestCCTPTokenMessenger", deployer, {})) as TestCCTPTokenMessenger;
    const cctpMessageTransmitter = (
      await deploy("TestCCTPMessageTransmitter", deployer, {})
    ) as TestCCTPMessageTransmitter;
    const acrossV3SpokePool = (
      await deploy("TestAcrossV3SpokePool", deployer, {})
    ) as TestAcrossV3SpokePool;
    const stargateTreasurerTrue = (
      await deploy("MockStargateTreasurerTrue", deployer, {})
    ) as MockStargateTreasurerTrue;
    const stargateTreasurerFalse = (
      await deploy("MockStargateTreasurerFalse", deployer, {})
    ) as MockStargateTreasurerFalse;
    const optimismBridge = (
      await deploy("TestSuperchainStandardBridge", deployer, {})
    ) as TestSuperchainStandardBridge;
    const baseBridge = (
      await deploy("TestSuperchainStandardBridge", deployer, {})
    ) as TestSuperchainStandardBridge;
    const l2TokenAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
    const arbitrumGatewayRouter = (
      await deploy("TestArbitrumGatewayRouter", deployer, {}, usdc.target, l2TokenAddress)
    ) as TestArbitrumGatewayRouter;

    const USDC_DEC = 10n ** (await usdc.decimals());

    const EURC_ADDRESS = "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42";
    const EURC_OWNER_ADDRESS = process.env.EURC_OWNER_ADDRESS!;
    if (!EURC_OWNER_ADDRESS) throw new Error("Env variables not configured (EURC_OWNER_ADDRESS missing)");
    const eurc = await hre.ethers.getContractAt("ERC20", EURC_ADDRESS);
    const eurcOwner = await hre.ethers.getImpersonatedSigner(EURC_OWNER_ADDRESS);
    await setBalance(EURC_OWNER_ADDRESS, 10n ** 18n);
    const EURC_DEC = 10n ** (await eurc.decimals());

    const WETH_ADDRESS = forkNetworkConfig.WrappedNativeToken;
    const weth = await hre.ethers.getContractAt("IWrappedNativeToken", WETH_ADDRESS);

    const everclearFeeAdapter = await hre.ethers.getContractAt("IFeeAdapterV2", forkNetworkConfig.EverclearFeeAdapter!);

    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer", {},
        Domain.BASE,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin,
      repayUser,
      setTokensUser,
      [liquidityPool, liquidityPool2, liquidityPool, liquidityPool],
      [Domain.BASE, Domain.BASE, Domain.ETHEREUM, Domain.ARBITRUM_ONE],
      [Provider.LOCAL, Provider.LOCAL, Provider.CCTP, Provider.CCTP],
      [true, false, true, true],
      [
        {
          inputToken: usdc,
          destinationTokens: [
            destinationToken(Domain.ETHEREUM, addressToBytes32(eurc.target))
          ]
        },
        {
          inputToken: eurc,
          destinationTokens: [
            destinationToken(Domain.ETHEREUM, addressToBytes32(usdc.target))
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

    // Shared mocks for tests that deploy a secondary Repayer on Domain.ETHEREUM.
    // ETHEREUM domain requires omnibridge != 0 and ethereumAmb != 0 by constructor validation.
    const sharedEthereumOmnibridge = (await deploy("TestGnosisOmnibridge", deployer, {})) as TestGnosisOmnibridge;
    const sharedEthereumAmb = (await deploy("TestGnosisAMB", deployer, {})) as TestGnosisAMB;

    return {
      deployer, admin, repayUser, user, usdc,
      USDC_DEC, eurc, EURC_DEC, eurcOwner, liquidityPool, liquidityPool2, repayer, repayerProxy, repayerAdmin,
      cctpTokenMessenger, cctpMessageTransmitter, REPAYER_ROLE, DEFAULT_ADMIN_ROLE, acrossV3SpokePool, weth,
      stargateTreasurerTrue, stargateTreasurerFalse, everclearFeeAdapter, forkNetworkConfig, optimismBridge,
      baseBridge, setTokensUser, arbitrumGatewayRouter, l2TokenAddress,
      sharedEthereumOmnibridge, sharedEthereumAmb,
    };
  };

  it("Should have default values", async function () {
    const {liquidityPool, liquidityPool2, repayer, usdc, REPAYER_ROLE, DEFAULT_ADMIN_ROLE,
      cctpTokenMessenger, cctpMessageTransmitter, admin, repayUser, deployer, acrossV3SpokePool,
      stargateTreasurerTrue, optimismBridge, baseBridge, setTokensUser, eurc,
    } = await loadFixture(deployAll);

    expect(await repayer.ASSETS()).to.equal(usdc.target);
    expect(await repayer.CCTP_TOKEN_MESSENGER()).to.equal(cctpTokenMessenger.target);
    expect(await repayer.CCTP_MESSAGE_TRANSMITTER()).to.equal(cctpMessageTransmitter.target);
    expect(await repayer.ACROSS_SPOKE_POOL()).to.equal(acrossV3SpokePool.target);
    expect(await repayer.STARGATE_TREASURER()).to.equal(stargateTreasurerTrue.target);
    expect(await repayer.OPTIMISM_STANDARD_BRIDGE()).to.equal(optimismBridge.target);
    expect(await repayer.BASE_STANDARD_BRIDGE()).to.equal(baseBridge.target);
    expect(await repayer.isRouteAllowed(liquidityPool, Domain.BASE, Provider.LOCAL)).to.be.true;
    expect(await repayer.isRouteAllowed(liquidityPool2, Domain.BASE, Provider.LOCAL)).to.be.true;
    expect(await repayer.isRouteAllowed(liquidityPool2, Domain.BASE, Provider.CCTP)).to.be.false;
    expect(await repayer.isRouteAllowed(liquidityPool2, Domain.ETHEREUM, Provider.CCTP)).to.be.false;
    expect(await repayer.isRouteAllowed(liquidityPool, Domain.ETHEREUM, Provider.CCTP)).to.be.true;
    expect(await repayer.isRouteAllowed(liquidityPool, Domain.AVALANCHE, Provider.CCTP)).to.be.false;
    expect(await repayer.isRouteAllowed(liquidityPool, Domain.ARBITRUM_ONE, Provider.CCTP)).to.be.true;
    expect(await repayer.isRouteAllowed(liquidityPool, Domain.ETHEREUM, Provider.ACROSS)).to.be.false;
    expect(await repayer.hasRole(DEFAULT_ADMIN_ROLE, admin)).to.be.true;
    expect(await repayer.hasRole(DEFAULT_ADMIN_ROLE, deployer)).to.be.false;
    expect(await repayer.hasRole(REPAYER_ROLE, repayUser)).to.be.true;
    expect(await repayer.hasRole(REPAYER_ROLE, deployer)).to.be.false;
    expect(await repayer.domainCCTP(Domain.ETHEREUM)).to.equal(0n);
    expect(await repayer.domainCCTP(Domain.AVALANCHE)).to.equal(1n);
    expect(await repayer.domainCCTP(Domain.OP_MAINNET)).to.equal(2n);
    expect(await repayer.domainCCTP(Domain.ARBITRUM_ONE)).to.equal(3n);
    expect(await repayer.domainCCTP(Domain.BASE)).to.equal(6n);
    expect(await repayer.domainCCTP(Domain.POLYGON_MAINNET)).to.equal(7n);
    await expect(repayer.domainCCTP(Domain.GNOSIS_CHAIN))
      .to.be.revertedWithCustomError(repayer, "UnsupportedDomain()");
    expect(await repayer.domainChainId(Domain.ETHEREUM)).to.equal(1n);
    expect(await repayer.domainChainId(Domain.AVALANCHE)).to.equal(43114n);
    expect(await repayer.domainChainId(Domain.OP_MAINNET)).to.equal(10n);
    expect(await repayer.domainChainId(Domain.ARBITRUM_ONE)).to.equal(42161n);
    expect(await repayer.domainChainId(Domain.BASE)).to.equal(8453n);
    expect(await repayer.domainChainId(Domain.POLYGON_MAINNET)).to.equal(137n);
    expect(await repayer.domainChainId(Domain.UNICHAIN)).to.equal(130n);
    expect(await repayer.domainChainId(Domain.BSC)).to.equal(56n);
    expect(await repayer.domainChainId(Domain.LINEA)).to.equal(59144n);
    expect(await repayer.domainChainId(Domain.GNOSIS_CHAIN)).to.equal(100n);
    await expect(repayer.domainChainId(Domain.OP_SEPOLIA))
      .to.be.revertedWithCustomError(repayer, "UnsupportedDomain()");
    expect(await repayer.layerZeroEndpointId(Domain.ETHEREUM)).to.equal(30101n);
    expect(await repayer.layerZeroEndpointId(Domain.AVALANCHE)).to.equal(30106n);
    expect(await repayer.layerZeroEndpointId(Domain.OP_MAINNET)).to.equal(30111n);
    expect(await repayer.layerZeroEndpointId(Domain.ARBITRUM_ONE)).to.equal(30110n);
    expect(await repayer.layerZeroEndpointId(Domain.BASE)).to.equal(30184n);
    expect(await repayer.layerZeroEndpointId(Domain.POLYGON_MAINNET)).to.equal(30109n);
    expect(await repayer.layerZeroEndpointId(Domain.UNICHAIN)).to.equal(30320n);
    expect(await repayer.layerZeroEndpointId(Domain.BSC)).to.equal(30102n);
    expect(await repayer.layerZeroEndpointId(Domain.LINEA)).to.equal(30183n);
    expect(await repayer.layerZeroEndpointId(Domain.GNOSIS_CHAIN)).to.equal(30145n);
    await expect(repayer.layerZeroEndpointId(Domain.OP_SEPOLIA))
      .to.be.revertedWithCustomError(repayer, "UnsupportedDomain()");
    expect(await repayer.getAllRoutes()).to.deep.equal([
      [liquidityPool.target, liquidityPool.target, liquidityPool.target, liquidityPool2.target],
      [Domain.ETHEREUM, Domain.ARBITRUM_ONE, Domain.BASE, Domain.BASE],
      [Provider.CCTP, Provider.CCTP, Provider.LOCAL, Provider.LOCAL],
      [true, true, true, false]
    ]);
    expect(await isOutputTokenAllowed(repayer, usdc, Domain.ETHEREUM, addressToBytes32(eurc.target))).to.be.true;
    expect(await isOutputTokenAllowed(repayer, eurc, Domain.ETHEREUM, addressToBytes32(usdc.target))).to.be.true;
    expect(await isOutputTokenAllowed(repayer, usdc, Domain.OP_MAINNET, addressToBytes32(eurc.target))).to.be.false;
    expect(await isOutputTokenAllowed(repayer, usdc, Domain.ETHEREUM, addressToBytes32(usdc.target))).to.be.false;

    await expect(repayer.connect(admin).initialize(
      admin, repayUser, setTokensUser, [], [], [], [], []
    )).to.be.reverted;
  });

  it("Should allow admin to enable routes", async function () {
    const {repayer, usdc, USDC_DEC, admin, repayUser,
      liquidityPool, liquidityPool2
    } = await loadFixture(deployAll);

    await usdc.transfer(repayer, 10n * USDC_DEC);
    await expect(repayer.connect(repayUser).initiateRepay(
      usdc,
      5n * USDC_DEC,
      liquidityPool,
      Domain.AVALANCHE,
      Provider.CCTP,
      "0x"
    )).to.be.revertedWithCustomError(repayer, "RouteDenied()");
    const tx = repayer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.AVALANCHE],
      [Provider.CCTP],
      [true],
      ALLOWED
    );
    await expect(tx)
      .to.emit(repayer, "SetRoute")
      .withArgs(liquidityPool.target, Domain.AVALANCHE, Provider.CCTP, true, ALLOWED);

    expect(await repayer.getAllRoutes()).to.deep.equal([
      [liquidityPool.target, liquidityPool.target, liquidityPool.target, liquidityPool.target, liquidityPool2.target],
      [Domain.ETHEREUM, Domain.AVALANCHE, Domain.ARBITRUM_ONE, Domain.BASE, Domain.BASE],
      [Provider.CCTP, Provider.CCTP, Provider.CCTP, Provider.LOCAL, Provider.LOCAL],
      [true, true, true, true, false],
    ]);
    expect(await repayer.isRouteAllowed(liquidityPool, Domain.ETHEREUM, Provider.CCTP)).to.be.true;
    expect(await repayer.isRouteAllowed(liquidityPool, Domain.AVALANCHE, Provider.CCTP)).to.be.true;
    expect(await repayer.isRouteAllowed(liquidityPool, Domain.ARBITRUM_ONE, Provider.CCTP)).to.be.true;
    await repayer.connect(repayUser).initiateRepay(
      usdc,
      5n * USDC_DEC,
      liquidityPool,
      Domain.AVALANCHE,
      Provider.CCTP,
      "0x"
    );
  });

  it("Should allow admin to disable routes", async function () {
    const {repayer, usdc, USDC_DEC, admin, repayUser, liquidityPool, liquidityPool2} = await loadFixture(deployAll);

    await usdc.transfer(repayer, 10n * USDC_DEC);
    await repayer.connect(repayUser).initiateRepay(
      usdc,
      5n * USDC_DEC,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.CCTP,
      "0x"
    );
    const tx = repayer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.CCTP],
      [true],
      DISALLOWED
    );
    await expect(tx)
      .to.emit(repayer, "SetRoute")
      .withArgs(liquidityPool.target, Domain.ETHEREUM, Provider.CCTP, true, DISALLOWED);

    expect(await repayer.getAllRoutes()).to.deep.equal([
      [liquidityPool.target, liquidityPool.target, liquidityPool2.target],
      [Domain.ARBITRUM_ONE, Domain.BASE, Domain.BASE],
      [Provider.CCTP, Provider.LOCAL, Provider.LOCAL],
      [true, true, false]
    ]);

    expect(await repayer.isRouteAllowed(liquidityPool, Domain.ETHEREUM, Provider.CCTP)).to.be.false;
    expect(await repayer.isRouteAllowed(liquidityPool, Domain.AVALANCHE, Provider.CCTP)).to.be.false;
    expect(await repayer.isRouteAllowed(liquidityPool, Domain.ARBITRUM_ONE, Provider.CCTP)).to.be.true;
    await expect(repayer.connect(repayUser).initiateRepay(
      usdc,
      5n * USDC_DEC,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.CCTP,
      "0x"
    )).to.be.revertedWithCustomError(repayer, "RouteDenied()");
  });

  it("Should not allow admin to enable invalid routes", async function () {
    const {repayer, admin, liquidityPool2, deployer} = await loadFixture(deployAll);
    const liquidityPool3 = (await deploy(
      "TestLiquidityPool", deployer, {}, admin, admin, networkConfig.BASE.WrappedNativeToken
    )) as TestLiquidityPool;

    await expect(repayer.connect(admin).setRoute(
      [liquidityPool2],
      [Domain.BASE],
      [Provider.CCTP],
      [true],
      ALLOWED
    )).to.be.revertedWithCustomError(repayer, "UnsupportedProvider()");
    await expect(repayer.connect(admin).setRoute(
      [liquidityPool2],
      [Domain.ETHEREUM],
      [Provider.LOCAL],
      [true],
      ALLOWED
    )).to.be.revertedWithCustomError(repayer, "UnsupportedProvider()");
    await expect(repayer.connect(admin).setRoute(
      [liquidityPool3],
      [Domain.BASE],
      [Provider.LOCAL],
      [false],
      ALLOWED
    )).to.be.revertedWithCustomError(repayer, "InvalidPoolAssets()");
  });

  it("Should not allow others to enable routes", async function () {
    const {repayer, repayUser, liquidityPool2} = await loadFixture(deployAll);

    await expect(repayer.connect(repayUser).setRoute(
      [liquidityPool2],
      [Domain.AVALANCHE],
      [Provider.CCTP],
      [true],
      ALLOWED
    )).to.be.revertedWithCustomError(repayer, "AccessControlUnauthorizedAccount(address,bytes32)");
  });

  it("Should not allow others to disable routes", async function () {
    const {repayer, repayUser, liquidityPool} = await loadFixture(deployAll);

    await expect(repayer.connect(repayUser).setRoute(
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.CCTP],
      [true],
      DISALLOWED
    )).to.be.revertedWithCustomError(repayer, "AccessControlUnauthorizedAccount(address,bytes32)");
  });

  it("Should allow SET_TOKENS_ROLE to allow output tokens", async function () {
    const {repayer, usdc, USDC_DEC, admin, repayUser,
      liquidityPool, user, eurc, setTokensUser,
    } = await loadFixture(deployAll);

    await usdc.transfer(repayer, 10n * USDC_DEC);
    await repayer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.ACROSS],
      [true],
      ALLOWED
    );

    const amount = 4n * USDC_DEC;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "address", "uint32", "uint32", "uint32"],
      [usdc.target, amount, user.address, 1n, 2n, 3n]
    );
    await expect(repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.ACROSS,
      extraData
    )).to.be.revertedWithCustomError(repayer, "InvalidOutputToken()");
    const tx = repayer.connect(setTokensUser).setInputOutputTokens(
      [
        {
          inputToken: usdc,
          destinationTokens: [
            destinationToken(Domain.ETHEREUM, addressToBytes32(usdc.target)),
            destinationToken(Domain.AVALANCHE, addressToBytes32(eurc.target), 8n)
          ]
        },
        {
          inputToken: eurc,
          destinationTokens: [
            destinationToken(Domain.OP_MAINNET, addressToBytes32(eurc.target), -4n)
          ]
        },
      ],
      ALLOWED
    );
    await expect(tx)
      .to.emit(repayer, "SetInputOutputToken")
      .withArgs(usdc.target, Domain.ETHEREUM, addressToBytes32(usdc.target), 0n, true);
    await expect(tx)
      .to.emit(repayer, "SetInputOutputToken")
      .withArgs(usdc.target, Domain.AVALANCHE, addressToBytes32(eurc.target), 8n, true);
    await expect(tx)
      .to.emit(repayer, "SetInputOutputToken")
      .withArgs(eurc.target, Domain.OP_MAINNET, addressToBytes32(eurc.target), -4n, true);

    expect(await isOutputTokenAllowed(repayer, usdc, Domain.ETHEREUM, addressToBytes32(eurc.target))).to.be.true;
    expect(await isOutputTokenAllowed(repayer, eurc, Domain.ETHEREUM, addressToBytes32(usdc.target))).to.be.true;
    expect(await isOutputTokenAllowed(repayer, eurc, Domain.ETHEREUM, addressToBytes32(eurc.target))).to.be.false;
    expect(await isOutputTokenAllowed(repayer, usdc, Domain.ETHEREUM, addressToBytes32(usdc.target))).to.be.true;
    expect(await isOutputTokenAllowed(repayer, usdc, Domain.AVALANCHE, addressToBytes32(eurc.target))).to.be.true;
    expect(await isOutputTokenAllowed(repayer, eurc, Domain.OP_MAINNET, addressToBytes32(eurc.target))).to.be.true;
    expect(
      (await repayer.outputTokenData(usdc, Domain.ETHEREUM, addressToBytes32(usdc.target))).localDecimalsGreaterBy
    ).to.equal(0n);
    expect(
      (await repayer.outputTokenData(usdc, Domain.AVALANCHE, addressToBytes32(eurc.target))).localDecimalsGreaterBy
    ).to.equal(8n);
    expect(
      (await repayer.outputTokenData(eurc, Domain.OP_MAINNET, addressToBytes32(eurc.target))).localDecimalsGreaterBy
    ).to.equal(-4n);
    await repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.ACROSS,
      extraData
    );
  });

  it("Should allow SET_TOKENS_ROLE to deny output tokens", async function () {
    const {repayer, usdc, USDC_DEC, admin, repayUser,
      liquidityPool, user, eurc, setTokensUser,
    } = await loadFixture(deployAll);

    await usdc.transfer(repayer, 10n * USDC_DEC);
    await repayer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.ACROSS],
      [true],
      ALLOWED
    );

    const amount = 4n * USDC_DEC;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "address", "uint32", "uint32", "uint32"],
      [eurc.target, amount, user.address, 1n, 2n, 3n]
    );
    await repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.ACROSS,
      extraData
    );

    const tx = repayer.connect(setTokensUser).setInputOutputTokens(
      [{
        inputToken: usdc,
        destinationTokens: [
          destinationToken(Domain.ETHEREUM, addressToBytes32(eurc.target), 2n)
        ]
      }],
      DISALLOWED
    );
    await expect(tx)
      .to.emit(repayer, "SetInputOutputToken")
      .withArgs(usdc.target, Domain.ETHEREUM, addressToBytes32(eurc.target), 2n, false);

    expect(await isOutputTokenAllowed(repayer, usdc, Domain.ETHEREUM, addressToBytes32(eurc.target))).to.be.false;
    expect(await isOutputTokenAllowed(repayer, eurc, Domain.ETHEREUM, addressToBytes32(usdc.target))).to.be.true;
    expect(await isOutputTokenAllowed(repayer, eurc, Domain.ETHEREUM, addressToBytes32(eurc.target))).to.be.false;
    expect(
      (await repayer.outputTokenData(usdc, Domain.ETHEREUM, addressToBytes32(eurc.target))).localDecimalsGreaterBy
    ).to.equal(2n);
    await expect(repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.ACROSS,
      extraData
    )).to.be.revertedWithCustomError(repayer, "InvalidOutputToken()");
  });

  it("Should NOT allow SET_TOKENS_ROLE to allow output tokens for local domain", async function () {
    const {repayer, usdc, setTokensUser,
    } = await loadFixture(deployAll);

    await expect(repayer.connect(setTokensUser).setInputOutputTokens(
      [{
        inputToken: usdc,
        destinationTokens: [
          destinationToken(Domain.BASE, addressToBytes32(usdc.target))
        ]
      }],
      ALLOWED
    )).to.be.revertedWithCustomError(repayer, "UnsupportedDomain()");
  });

  it("Should NOT allow others to allow output tokens", async function () {
    const {repayer, usdc, user,
    } = await loadFixture(deployAll);

    await expect(repayer.connect(user).setInputOutputTokens(
      [{
        inputToken: usdc,
        destinationTokens: [
          destinationToken(Domain.ETHEREUM, addressToBytes32(usdc.target))
        ]
      }],
      ALLOWED
    )).to.be.revertedWithCustomError(repayer, "AccessControlUnauthorizedAccount(address,bytes32)");
  });

  it("Should NOT allow others to deny output tokens", async function () {
    const {repayer, usdc, user, eurc,
    } = await loadFixture(deployAll);

    await expect(repayer.connect(user).setInputOutputTokens(
      [{
        inputToken: usdc,
        destinationTokens: [
          destinationToken(Domain.ETHEREUM, addressToBytes32(eurc.target))
        ]
      }],
      DISALLOWED
    )).to.be.revertedWithCustomError(repayer, "AccessControlUnauthorizedAccount(address,bytes32)");
  });

  it("Should allow repayer to initiate CCTP repay", async function () {
    const {repayer, usdc, USDC_DEC, repayUser, liquidityPool,
      cctpTokenMessenger
    } = await loadFixture(deployAll);

    await usdc.transfer(repayer, 10n * USDC_DEC);
    const tx = repayer.connect(repayUser).initiateRepay(
      usdc,
      4n * USDC_DEC,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.CCTP,
      "0x"
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(usdc.target, 4n * USDC_DEC, liquidityPool.target, Domain.ETHEREUM, Provider.CCTP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(repayer.target, cctpTokenMessenger.target, 4n * USDC_DEC);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(cctpTokenMessenger.target, ZERO_ADDRESS, 4n * USDC_DEC);

    expect(await usdc.balanceOf(repayer)).to.equal(6n * USDC_DEC);
  });

  it("Should allow repayer to initiate Across repay", async function () {
    const {repayer, usdc, USDC_DEC, admin, repayUser,
      liquidityPool, acrossV3SpokePool, eurc, user,
    } = await loadFixture(deployAll);

    await usdc.transfer(repayer, 10n * USDC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.ACROSS],
      [true],
      ALLOWED
    );
    const amount = 4n * USDC_DEC;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "address", "uint32", "uint32", "uint32"],
      [eurc.target, amount + 1n, user.address, 1n, 2n, 3n]
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.ACROSS,
      extraData
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(usdc.target, amount, liquidityPool.target, Domain.ETHEREUM, Provider.ACROSS);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(repayer.target, acrossV3SpokePool.target, amount);
    await expect(tx)
      .to.emit(acrossV3SpokePool, "FundsDeposited")
      .withArgs(
        addressToBytes32(usdc.target),
        addressToBytes32(eurc.target),
        amount,
        amount + 1n,
        1n,
        1337n,
        1n,
        2n,
        3n,
        addressToBytes32(repayer.target),
        addressToBytes32(liquidityPool.target),
        addressToBytes32(user.address),
        "0x"
      );

    expect(await usdc.balanceOf(repayer)).to.equal(6n * USDC_DEC);
  });

  it("Should allow repayer to initiate Across repay with a different token", async function () {
    const {repayer, EURC_DEC, admin, repayUser, usdc,
      liquidityPool, acrossV3SpokePool, eurc, user, eurcOwner,
    } = await loadFixture(deployAll);

    await eurc.connect(eurcOwner).transfer(repayer, 10n * EURC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.ACROSS],
      [true],
      ALLOWED
    );
    const amount = 4n * EURC_DEC;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "address", "uint32", "uint32", "uint32"],
      [usdc.target, amount * 998n / 1000n, user.address, 1n, 2n, 3n]
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      eurc,
      amount,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.ACROSS,
      extraData
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(eurc.target, amount, liquidityPool.target, Domain.ETHEREUM, Provider.ACROSS);
    await expect(tx)
      .to.emit(eurc, "Transfer")
      .withArgs(repayer.target, acrossV3SpokePool.target, amount);
    await expect(tx)
      .to.emit(acrossV3SpokePool, "FundsDeposited")
      .withArgs(
        addressToBytes32(eurc.target),
        addressToBytes32(usdc.target),
        amount,
        amount * 998n / 1000n,
        1n,
        1337n,
        1n,
        2n,
        3n,
        addressToBytes32(repayer.target),
        addressToBytes32(liquidityPool.target),
        addressToBytes32(user.address),
        "0x"
      );

    expect(await eurc.balanceOf(repayer)).to.equal(6n * EURC_DEC);
  });

  it("Should allow repayer to initiate Across repay with a different token and no output token", async function () {
    const {repayer, EURC_DEC, admin, repayUser, usdc,
      liquidityPool, acrossV3SpokePool, eurc, user, eurcOwner,
    } = await loadFixture(deployAll);

    await eurc.connect(eurcOwner).transfer(repayer, 10n * EURC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.ACROSS],
      [true],
      ALLOWED
    );
    const amount = 4n * EURC_DEC;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "address", "uint32", "uint32", "uint32"],
      [usdc.target, amount * 998n / 1000n, user.address, 1n, 2n, 3n]
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      eurc,
      amount,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.ACROSS,
      extraData
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(eurc.target, amount, liquidityPool.target, Domain.ETHEREUM, Provider.ACROSS);
    await expect(tx)
      .to.emit(eurc, "Transfer")
      .withArgs(repayer.target, acrossV3SpokePool.target, amount);
    await expect(tx)
      .to.emit(acrossV3SpokePool, "FundsDeposited")
      .withArgs(
        addressToBytes32(eurc.target),
        addressToBytes32(usdc.target),
        amount,
        amount * 998n / 1000n,
        1n,
        1337n,
        1n,
        2n,
        3n,
        addressToBytes32(repayer.target),
        addressToBytes32(liquidityPool.target),
        addressToBytes32(user.address),
        "0x"
      );

    expect(await eurc.balanceOf(repayer)).to.equal(6n * EURC_DEC);
  });

  it("Should allow repayer to initiate Across repay with SpokePool on fork", async function () {
    const {deployer, repayer, USDC_DEC, admin, repayUser, repayerAdmin, repayerProxy,
      liquidityPool, cctpTokenMessenger, cctpMessageTransmitter, weth, stargateTreasurerTrue, everclearFeeAdapter,
      optimismBridge, baseBridge, setTokensUser, arbitrumGatewayRouter,
    } = await loadFixture(deployAll);

    const acrossV3SpokePoolFork = await hre.ethers.getContractAt(
      "V3SpokePoolInterface",
      networkConfig.BASE.AcrossV3SpokePool!
    );
    const USDC_BASE_ADDRESS = networkConfig.BASE.Tokens.USDC.Address;

    assertAddress(process.env.USDC_OWNER_ADDRESS, "Env variables not configured (USDC_OWNER_ADDRESS missing)");
    const USDC_OWNER_ADDRESS = process.env.USDC_OWNER_ADDRESS;
    const usdc = await hre.ethers.getContractAt("ERC20", networkConfig.BASE.Tokens.USDC.Address);
    const usdcOwner = await hre.ethers.getImpersonatedSigner(USDC_OWNER_ADDRESS);

    const repayerImpl2 = (
      await deployX(
        "Repayer",
        deployer,
        "Repayer2",
        {},
        Domain.BASE,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePoolFork,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
      )
    ) as Repayer;

    expect(await repayerAdmin.connect(admin).upgradeAndCall(repayerProxy, repayerImpl2, "0x"))
      .to.emit(repayerProxy, "Upgraded");
    expect(await repayer.ACROSS_SPOKE_POOL())
      .to.equal(acrossV3SpokePoolFork.target);

    await usdc.connect(usdcOwner).transfer(repayer, 10n * USDC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.ACROSS],
      [true],
      ALLOWED
    );

    await repayer.connect(setTokensUser).setInputOutputTokens(
      [{
        inputToken: usdc,
        destinationTokens: [
          destinationToken(Domain.ETHEREUM, addressToBytes32(USDC_BASE_ADDRESS))
        ]
      }],
      ALLOWED
    );
    const amount = 4n * USDC_DEC;
    const currentTime = await now();
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "address", "uint32", "uint32", "uint32"],
      [USDC_BASE_ADDRESS, amount * 998n / 1000n, ZERO_ADDRESS, currentTime - 1n, currentTime + 90n, 0n]
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.ACROSS,
      extraData
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(usdc.target, amount, liquidityPool.target, Domain.ETHEREUM, Provider.ACROSS);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(repayer.target, acrossV3SpokePoolFork.target, amount);
    await expect(tx)
      .to.emit(acrossV3SpokePoolFork, "FundsDeposited")
      .withArgs(
        addressToBytes32(usdc.target),
        addressToBytes32(USDC_BASE_ADDRESS),
        amount,
        amount * 998n / 1000n,
        await repayer.domainChainId(Domain.ETHEREUM),
        anyValue,
        currentTime - 1n,
        currentTime + 90n,
        0n,
        addressToBytes32(repayer.target),
        addressToBytes32(liquidityPool.target),
        addressToBytes32(ZERO_ADDRESS),
        "0x"
      );
  });

  it("Should revert Across repay if call to Across reverts", async function () {
    const {repayer, EURC_DEC, admin, repayUser, usdc,
      liquidityPool, acrossV3SpokePool, eurc, user, eurcOwner,
    } = await loadFixture(deployAll);

    await eurc.connect(eurcOwner).transfer(repayer, 10n * EURC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.ACROSS],
      [true],
      ALLOWED
    );
    const amount = 4n * EURC_DEC;
    const fillDeadlineError = 0n;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "address", "uint32", "uint32", "uint32"],
      [usdc.target, amount, user.address, 1n, fillDeadlineError, 3n]
    );
    await expect(repayer.connect(repayUser).initiateRepay(
      eurc,
      amount,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.ACROSS,
      extraData
    )).to.be.revertedWithCustomError(acrossV3SpokePool, "InvalidFillDeadline()");
  });

  it("Should revert Across repay if slippage is above 0.20%", async function () {
    const {repayer, EURC_DEC, admin, repayUser,
      liquidityPool, eurc, user, eurcOwner,
    } = await loadFixture(deployAll);

    await eurc.connect(eurcOwner).transfer(repayer, 10n * EURC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.ACROSS],
      [true],
      ALLOWED
    );
    const amount = 4n * EURC_DEC;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "address", "uint32", "uint32", "uint32"],
      [ZERO_ADDRESS, amount * 998n / 1000n - 1n, user.address, 1n, 2n, 3n]
    );
    await expect(repayer.connect(repayUser).initiateRepay(
      eurc,
      amount,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.ACROSS,
      extraData
    )).to.be.revertedWithCustomError(repayer, "SlippageTooHigh()");
  });

  it("Should revert Across repay if native currency is sent along", async function () {
    const {repayer, EURC_DEC, admin, repayUser,
      liquidityPool, eurc, user, eurcOwner,
    } = await loadFixture(deployAll);

    await eurc.connect(eurcOwner).transfer(repayer, 10n * EURC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.ACROSS],
      [true],
      ALLOWED
    );
    const amount = 4n * EURC_DEC;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "address", "uint32", "uint32", "uint32"],
      [ZERO_ADDRESS, amount * 998n / 1000n - 1n, user.address, 1n, 2n, 3n]
    );
    await expect(repayer.connect(repayUser).initiateRepay(
      eurc,
      amount,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.ACROSS,
      extraData,
      {value: 1n}
    )).to.be.revertedWithCustomError(repayer, "NotPayable()");
  });

  it("Should revert Across repay if output token is not allowed", async function () {
    const {repayer, EURC_DEC, admin, repayUser,
      liquidityPool, eurc, user, eurcOwner,
    } = await loadFixture(deployAll);

    await eurc.connect(eurcOwner).transfer(repayer, 10n * EURC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.ACROSS],
      [true],
      ALLOWED
    );
    const amount = 4n * EURC_DEC;
    const fillDeadlineError = 0n;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "address", "uint32", "uint32", "uint32"],
      [user.address, amount, user.address, 1n, fillDeadlineError, 3n]
    );
    await expect(repayer.connect(repayUser).initiateRepay(
      eurc,
      amount,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.ACROSS,
      extraData
    )).to.be.revertedWithCustomError(repayer, "InvalidOutputToken()");
  });

  it.skip("Should allow repayer to initiate Everclear repay on fork", async function () {
    const {repayer, USDC_DEC, admin, repayUser,
      liquidityPool, everclearFeeAdapter, forkNetworkConfig, setTokensUser,
    } = await loadFixture(deployAll);

    assertAddress(process.env.USDC_OWNER_ADDRESS, "Env variables not configured (USDC_OWNER_ADDRESS missing)");
    const USDC_OWNER_ADDRESS = process.env.USDC_OWNER_ADDRESS;
    const usdc = await hre.ethers.getContractAt("ERC20", forkNetworkConfig.Tokens.USDC.Address);
    const usdcOwner = await hre.ethers.getImpersonatedSigner(USDC_OWNER_ADDRESS);

    await usdc.connect(usdcOwner).transfer(repayer, 100000n * USDC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.EVERCLEAR],
      [true],
      ALLOWED
    );
    const amount = 40000n * USDC_DEC;

    const apiData = (await (await fetch("https://api.everclear.org/intents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        origin: forkNetworkConfig.ChainId.toString(),
        destinations: [networkConfig.ETHEREUM.ChainId.toString()],
        to: liquidityPool.target,
        inputAsset: usdc.target,
        amount: amount.toString(),
        callData: "",
        maxFee: "0"
      })
    })).json()).data;
    const newIntentSelector = "0xae9b2bad";
    // API returns selector for a variety of newIntent that takes 'address' as resipient.
    // We are using version that expects a 'bytes32' instead. Encoding other data remains the same.
    const apiTx = everclearFeeAdapter.interface.decodeFunctionData("newIntent", newIntentSelector + apiData.substr(10));

    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "uint48", "tuple(uint256, uint256, bytes)"],
      [apiTx[3], apiTx[5], apiTx[6], apiTx[8]]
    );
    await repayer.connect(setTokensUser).setInputOutputTokens(
      [{
        inputToken: usdc,
        destinationTokens: [
          destinationToken(Domain.ETHEREUM, apiTx[3])
        ]
      }],
      ALLOWED
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.EVERCLEAR,
      extraData
    );

    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(usdc.target, amount, liquidityPool.target, Domain.ETHEREUM, Provider.EVERCLEAR);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(repayer.target, everclearFeeAdapter.target, amount);
    await expect(tx)
      .to.emit(everclearFeeAdapter, "IntentWithFeesAdded");
    expect(await usdc.balanceOf(repayer)).to.equal(60000n * USDC_DEC);
  });

  it.skip("Should allow repayer to initiate Everclear repay with other token on fork", async function () {
    const {repayer, admin, repayUser, USDC_DEC, eurcOwner,
      liquidityPool, everclearFeeAdapter, forkNetworkConfig, setTokensUser, eurc,
    } = await loadFixture(deployAll);

    await eurc.connect(eurcOwner).transfer(repayer, 20_000n * USDC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.EVERCLEAR],
      [true],
      ALLOWED
    );
    const amount = 10_000n * USDC_DEC;

    const resp = (await (await fetch("https://api.everclear.org/intents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        origin: forkNetworkConfig.ChainId.toString(),
        destinations: [networkConfig.ETHEREUM.ChainId.toString()],
        to: liquidityPool.target,
        inputAsset: eurc.target,
        amount: amount.toString(),
        callData: "",
        maxFee: "200",
      })
    })).json());
    const apiData = resp.data;

    const newIntentSelector = "0xae9b2bad";
    // API returns selector for a variety of newIntent that takes 'address' as resipient.
    // We are using version that expects a 'bytes32' instead. Encoding other data remains the same.
    const apiTx = everclearFeeAdapter.interface.decodeFunctionData("newIntent", newIntentSelector + apiData.substr(10));

    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "uint48", "tuple(uint256, uint256, bytes)"],
      [apiTx[3], apiTx[5], apiTx[6], apiTx[8]]
    );
    const apiAmountIn = apiTx[4];
    const apiFee = apiTx[8][0];
    const apiAmountWithFee = apiAmountIn + apiFee;
    expect(apiAmountWithFee).to.be.lessThanOrEqual(amount);
    await repayer.connect(setTokensUser).setInputOutputTokens(
      [{
        inputToken: eurc,
        destinationTokens: [
          destinationToken(Domain.ETHEREUM, apiTx[3])
        ]
      }],
      ALLOWED
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      eurc,
      apiAmountWithFee,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.EVERCLEAR,
      extraData
    );

    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(eurc.target, apiAmountWithFee, liquidityPool.target, Domain.ETHEREUM, Provider.EVERCLEAR);
    await expect(tx)
      .to.emit(eurc, "Transfer")
      .withArgs(repayer.target, everclearFeeAdapter.target, apiAmountWithFee);
    await expect(tx)
      .to.emit(everclearFeeAdapter, "IntentWithFeesAdded");
    expect(await eurc.balanceOf(repayer)).to.equal(20_000n * USDC_DEC - apiAmountWithFee);
    expect(await getBalance(repayer)).to.equal(0n);
  });

  it("Should allow repayer to initiate Everclear repay with mock adapter", async function () {
    const {
      usdc, USDC_DEC, deployer, admin, repayUser, setTokensUser,
      liquidityPool, cctpTokenMessenger, cctpMessageTransmitter, acrossV3SpokePool,
      weth, stargateTreasurerTrue, optimismBridge, baseBridge, arbitrumGatewayRouter,
    } = await loadFixture(deployAll);

    const mockEverclear = (
      await deploy("TestEverclearFeeAdapter", deployer, {})
    ) as TestEverclearFeeAdapter;

    const repayerImpl = (
      await deployX("Repayer", deployer, "RepayerEverclearMock", {},
        Domain.BASE,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        mockEverclear,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
      )
    ) as Repayer;
    const outputToken = addressToBytes32(usdc.target);
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin, repayUser, setTokensUser,
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.EVERCLEAR],
      [true],
      [{inputToken: usdc, destinationTokens: [destinationToken(Domain.ETHEREUM, outputToken)]}],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayerEverclearMock", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    const amount = 4n * USDC_DEC;
    await usdc.transfer(repayer, 10n * USDC_DEC);

    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "uint48", "tuple(uint256, uint256, bytes)"],
      [outputToken, amount, 0, [0, 0, "0x"]]
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      usdc, amount, liquidityPool, Domain.ETHEREUM, Provider.EVERCLEAR, extraData
    );

    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(usdc.target, amount, liquidityPool.target, Domain.ETHEREUM, Provider.EVERCLEAR);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(repayer.target, mockEverclear.target, amount);
    await expect(tx)
      .to.emit(mockEverclear, "IntentWithFeesAdded");
    expect(await usdc.balanceOf(repayer)).to.equal(6n * USDC_DEC);
  });

  it("Should allow repayer to initiate Everclear repay with other token with mock adapter", async function () {
    const {
      usdc, EURC_DEC, eurc, eurcOwner, deployer, admin, repayUser, setTokensUser,
      liquidityPool, cctpTokenMessenger, cctpMessageTransmitter, acrossV3SpokePool,
      weth, stargateTreasurerTrue, optimismBridge, baseBridge, arbitrumGatewayRouter,
    } = await loadFixture(deployAll);

    const mockEverclear = (
      await deploy("TestEverclearFeeAdapter", deployer, {})
    ) as TestEverclearFeeAdapter;

    const repayerImpl = (
      await deployX("Repayer", deployer, "RepayerEverclearMock2", {},
        Domain.BASE,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        mockEverclear,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
      )
    ) as Repayer;
    const outputToken = addressToBytes32(eurc.target as string);
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin, repayUser, setTokensUser,
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.EVERCLEAR],
      [true],
      [{inputToken: eurc, destinationTokens: [destinationToken(Domain.ETHEREUM, outputToken)]}],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayerEverclearMock2", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    const amount = 4n * EURC_DEC;
    await eurc.connect(eurcOwner).transfer(repayer, 10n * EURC_DEC);

    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "uint48", "tuple(uint256, uint256, bytes)"],
      [outputToken, amount, 0, [0, 0, "0x"]]
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      eurc, amount, liquidityPool, Domain.ETHEREUM, Provider.EVERCLEAR, extraData
    );

    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(eurc.target, amount, liquidityPool.target, Domain.ETHEREUM, Provider.EVERCLEAR);
    await expect(tx)
      .to.emit(eurc, "Transfer")
      .withArgs(repayer.target, mockEverclear.target, amount);
    await expect(tx)
      .to.emit(mockEverclear, "IntentWithFeesAdded");
    expect(await eurc.balanceOf(repayer)).to.equal(6n * EURC_DEC);
  });

  it("Should revert Everclear repay if call to Everclear reverts", async function () {
    const {repayer, USDC_DEC, admin, repayUser,
      liquidityPool, forkNetworkConfig, eurc,
    } = await loadFixture(deployAll);

    assertAddress(process.env.USDC_OWNER_ADDRESS, "Env variables not configured (USDC_OWNER_ADDRESS missing)");
    const USDC_OWNER_ADDRESS = process.env.USDC_OWNER_ADDRESS;
    const usdc = await hre.ethers.getContractAt("ERC20", forkNetworkConfig.Tokens.USDC.Address);
    const usdcOwner = await hre.ethers.getImpersonatedSigner(USDC_OWNER_ADDRESS);

    await usdc.connect(usdcOwner).transfer(repayer, 10n * USDC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.EVERCLEAR],
      [true],
      ALLOWED
    );
    const amount = 4n * USDC_DEC;

    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "uint48", "tuple(uint256, uint256, bytes)"],
      [addressToBytes32(eurc.target), amount, 0, [0, 0, "0x"]]
    );
    await expect(repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.EVERCLEAR,
      extraData
    )).to.be.reverted;
  });

  it("Should revert Everclear repay if output token is not allowed", async function () {
    const {repayer, USDC_DEC, admin, repayUser,
      liquidityPool, forkNetworkConfig, user,
    } = await loadFixture(deployAll);

    assertAddress(process.env.USDC_OWNER_ADDRESS, "Env variables not configured (USDC_OWNER_ADDRESS missing)");
    const USDC_OWNER_ADDRESS = process.env.USDC_OWNER_ADDRESS;
    const usdc = await hre.ethers.getContractAt("ERC20", forkNetworkConfig.Tokens.USDC.Address);
    const usdcOwner = await hre.ethers.getImpersonatedSigner(USDC_OWNER_ADDRESS);

    await usdc.connect(usdcOwner).transfer(repayer, 10n * USDC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.EVERCLEAR],
      [true],
      ALLOWED
    );
    const amount = 4n * USDC_DEC;

    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "uint48", "tuple(uint256, uint256, bytes)"],
      [addressToBytes32(user.address), amount, 0, [0, 0, "0x"]]
    );
    await expect(repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.EVERCLEAR,
      extraData
    )).to.be.revertedWithCustomError(repayer, "InvalidOutputToken()");
  });

  it("Should allow repayer to initiate Superchain Optimism repay with mock bridge", async function () {
    const {
      USDC_DEC, usdc, repayUser, liquidityPool, optimismBridge, cctpTokenMessenger, cctpMessageTransmitter,
      acrossV3SpokePool, everclearFeeAdapter, weth, stargateTreasurerTrue, admin, deployer, baseBridge,
      setTokensUser, arbitrumGatewayRouter,
      sharedEthereumOmnibridge, sharedEthereumAmb,
    } = await loadFixture(deployAll);
    const amount = 4n * USDC_DEC;
    const outputToken = networkConfig.OP_MAINNET.Tokens.USDC.Address;
    const minGasLimit = 100000n;

    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer2", {},
        Domain.ETHEREUM,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        sharedEthereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, sharedEthereumAmb, ZERO_ADDRESS,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin,
      repayUser,
      setTokensUser,
      [liquidityPool, liquidityPool],
      [Domain.ETHEREUM, Domain.OP_MAINNET],
      [Provider.LOCAL, Provider.SUPERCHAIN_STANDARD_BRIDGE],
      [true, true],
      [{
        inputToken: usdc,
        destinationTokens: [
          destinationToken(Domain.OP_MAINNET, addressToBytes32(outputToken))
        ]
      }],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayer2", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    await usdc.transfer(repayer, 10n * USDC_DEC);

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
      .to.emit(optimismBridge, "ERC20BridgeInitiated")
      .withArgs(usdc.target, outputToken, optimismBridge.target, liquidityPool.target, amount, "0x1234");
  });

  it("Should allow repayer to initiate Superchain Base repay with mock bridge", async function () {
    const {
      USDC_DEC, usdc, repayUser, liquidityPool, optimismBridge, cctpTokenMessenger, cctpMessageTransmitter,
      acrossV3SpokePool, everclearFeeAdapter, weth, stargateTreasurerTrue, admin, deployer, baseBridge,
      setTokensUser, arbitrumGatewayRouter,
      sharedEthereumOmnibridge, sharedEthereumAmb,
    } = await loadFixture(deployAll);
    const amount = 4n * USDC_DEC;
    const outputToken = networkConfig.BASE.Tokens.USDC.Address;
    const minGasLimit = 100000n;

    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer2", {},
        Domain.ETHEREUM,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        sharedEthereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, sharedEthereumAmb, ZERO_ADDRESS,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin,
      repayUser,
      setTokensUser,
      [liquidityPool, liquidityPool],
      [Domain.ETHEREUM, Domain.BASE],
      [Provider.LOCAL, Provider.SUPERCHAIN_STANDARD_BRIDGE],
      [true, true],
      [{
        inputToken: usdc,
        destinationTokens: [
          destinationToken(Domain.BASE, addressToBytes32(outputToken))
        ]
      }],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayer2", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    await usdc.transfer(repayer, 10n * USDC_DEC);

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
      .to.emit(baseBridge, "ERC20BridgeInitiated")
      .withArgs(usdc.target, outputToken, baseBridge.target, liquidityPool.target, amount, "0x1234");
  });

  it("Should revert Superchain repay if call to Standard Bridge reverts", async function () {
    const {
      USDC_DEC, usdc, repayUser, liquidityPool, optimismBridge, cctpTokenMessenger, cctpMessageTransmitter,
      acrossV3SpokePool, everclearFeeAdapter, weth, stargateTreasurerTrue, admin, deployer, baseBridge,
      setTokensUser, arbitrumGatewayRouter,
      sharedEthereumOmnibridge, sharedEthereumAmb,
    } = await loadFixture(deployAll);

    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer2", {},
        Domain.ETHEREUM,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        sharedEthereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, sharedEthereumAmb, ZERO_ADDRESS,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin,
      repayUser,
      setTokensUser,
      [liquidityPool, liquidityPool],
      [Domain.ETHEREUM, Domain.OP_MAINNET],
      [Provider.LOCAL, Provider.SUPERCHAIN_STANDARD_BRIDGE],
      [true, true],
      [{
        inputToken: usdc,
        destinationTokens: [
          destinationToken(Domain.OP_MAINNET, addressToBytes32(usdc.target))
        ]
      }],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayer2", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    await usdc.transfer(repayer, 10n * USDC_DEC);

    const amount = 4n * USDC_DEC;
    const outputToken = usdc.target;
    const minGasLimit = 100000n;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint32", "bytes"],
      [outputToken, minGasLimit, "0x"],
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
      .to.be.revertedWithCustomError(optimismBridge, "SuperchainStandardBridgeWrongRemoteToken");
  });

  it("Should revert Standard Bridge repay if native currency is sent along", async function () {
    const {
      USDC_DEC, usdc, repayUser, liquidityPool, optimismBridge, cctpTokenMessenger, cctpMessageTransmitter,
      acrossV3SpokePool, everclearFeeAdapter, weth, stargateTreasurerTrue, admin, deployer, baseBridge,
      setTokensUser, arbitrumGatewayRouter,
      sharedEthereumOmnibridge, sharedEthereumAmb,
    } = await loadFixture(deployAll);

    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer2", {},
        Domain.ETHEREUM,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        sharedEthereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, sharedEthereumAmb, ZERO_ADDRESS,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin,
      repayUser,
      setTokensUser,
      [liquidityPool, liquidityPool],
      [Domain.ETHEREUM, Domain.OP_MAINNET],
      [Provider.LOCAL, Provider.SUPERCHAIN_STANDARD_BRIDGE],
      [true, true],
      [{
        inputToken: usdc,
        destinationTokens: [
          destinationToken(Domain.OP_MAINNET, addressToBytes32(usdc.target))
        ]
      }],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayer2", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    await usdc.transfer(repayer, 10n * USDC_DEC);

    const amount = 4n * USDC_DEC;
    const outputToken = usdc.target;
    const minGasLimit = 100000n;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint32", "bytes"],
      [outputToken, minGasLimit, "0x"],
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.OP_MAINNET,
      Provider.SUPERCHAIN_STANDARD_BRIDGE,
      extraData,
      {value: 1n}
    );
    await expect(tx)
      .to.be.revertedWithCustomError(repayer, "NotPayable()");
  });

  it("Should revert Standard Bridge repay if output token is not allowed", async function () {
    const {
      USDC_DEC, usdc, repayUser, liquidityPool, optimismBridge, cctpTokenMessenger, cctpMessageTransmitter,
      acrossV3SpokePool, everclearFeeAdapter, weth, stargateTreasurerTrue, admin, deployer, baseBridge,
      setTokensUser, arbitrumGatewayRouter,
      sharedEthereumOmnibridge, sharedEthereumAmb,
    } = await loadFixture(deployAll);

    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer2", {},
        Domain.ETHEREUM,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        sharedEthereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, sharedEthereumAmb, ZERO_ADDRESS,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin,
      repayUser,
      setTokensUser,
      [liquidityPool, liquidityPool],
      [Domain.ETHEREUM, Domain.OP_MAINNET],
      [Provider.LOCAL, Provider.SUPERCHAIN_STANDARD_BRIDGE],
      [true, true],
      [],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayer2", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    await usdc.transfer(repayer, 10n * USDC_DEC);

    const amount = 4n * USDC_DEC;
    const outputToken = ZERO_ADDRESS;
    const minGasLimit = 100000n;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint32", "bytes"],
      [outputToken, minGasLimit, "0x"],
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
      .to.be.revertedWithCustomError(repayer, "InvalidOutputToken()");
  });

  it("Should NOT allow repayer to initiate Superchain Bridge repay from not Ethereum domain", async function () {
    const {repayer, USDC_DEC, usdc, admin, repayUser, liquidityPool} = await loadFixture(deployAll);

    await usdc.transfer(repayer, 10n * USDC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.SUPERCHAIN_STANDARD_BRIDGE],
      [true],
      ALLOWED
    );
    const amount = 4n * USDC_DEC;
    const outputToken = usdc.target;
    const minGasLimit = 100000n;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint32", "bytes"],
      [outputToken, minGasLimit, "0x"],
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.SUPERCHAIN_STANDARD_BRIDGE,
      extraData
    );
    await expect(tx)
      .to.be.revertedWithCustomError(repayer, "UnsupportedDomain");
  });

  it("Should NOT allow repayer to initiate Superchain Standard Bridge repay to unsupported domain", async function () {
    const {
      USDC_DEC, usdc, admin, repayUser, liquidityPool, deployer, cctpTokenMessenger, cctpMessageTransmitter,
      acrossV3SpokePool, everclearFeeAdapter, weth, stargateTreasurerTrue, optimismBridge, baseBridge,
      arbitrumGatewayRouter, sharedEthereumOmnibridge, sharedEthereumAmb, setTokensUser,
    } = await loadFixture(deployAll);

    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer4", {},
        Domain.ETHEREUM,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        sharedEthereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, sharedEthereumAmb, ZERO_ADDRESS,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin,
      repayUser,
      setTokensUser,
      [liquidityPool, liquidityPool],
      [Domain.ETHEREUM, Domain.GNOSIS_CHAIN],
      [Provider.LOCAL, Provider.SUPERCHAIN_STANDARD_BRIDGE],
      [true, true],
      [],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayer4", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    await usdc.transfer(repayer, 10n * USDC_DEC);
    const amount = 4n * USDC_DEC;
    const tx = repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.GNOSIS_CHAIN,
      Provider.SUPERCHAIN_STANDARD_BRIDGE,
      "0x"
    );
    await expect(tx)
      .to.be.revertedWithCustomError(repayer, "UnsupportedDomain");
  });

  it("Should allow repayer to initiate Arbitrum Gateway repay with mock bridge", async function () {
    const {
      USDC_DEC, usdc, repayUser, liquidityPool, optimismBridge, cctpTokenMessenger, cctpMessageTransmitter,
      acrossV3SpokePool, everclearFeeAdapter, weth, stargateTreasurerTrue, admin, deployer, baseBridge,
      setTokensUser, l2TokenAddress, arbitrumGatewayRouter,
      sharedEthereumOmnibridge, sharedEthereumAmb,
    } = await loadFixture(deployAll);
    const amount = 4n * USDC_DEC;
    const maxGas = 10000000n;
    const gasPriceBid = 1000000000n;
    const maxSubmissionCost = 100000000000000n;

    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer2", {},
        Domain.ETHEREUM,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        sharedEthereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, sharedEthereumAmb, ZERO_ADDRESS,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin,
      repayUser,
      setTokensUser,
      [liquidityPool, liquidityPool],
      [Domain.ETHEREUM, Domain.ARBITRUM_ONE],
      [Provider.LOCAL, Provider.ARBITRUM_GATEWAY],
      [true, true],
      [{
        inputToken: usdc,
        destinationTokens: [
          destinationToken(Domain.ARBITRUM_ONE, addressToBytes32(l2TokenAddress))
        ]
      }],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayer2", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    await usdc.transfer(repayer, 10n * USDC_DEC);

    const data = AbiCoder.defaultAbiCoder().encode(
      ["uint256", "bytes"],
      [maxSubmissionCost, "0x"],
    );
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "uint256", "bytes"],
      [l2TokenAddress, maxGas, gasPriceBid, data]
    );

    const tx = repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.ARBITRUM_ONE,
      Provider.ARBITRUM_GATEWAY,
      extraData
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(usdc.target, amount, liquidityPool.target, Domain.ARBITRUM_ONE, Provider.ARBITRUM_GATEWAY);
    await expect(tx)
      .to.emit(repayer, "ArbitrumERC20TransferInitiated")
      .withArgs(hexlify(toUtf8Bytes("GATEWAY_DATA")));
    await expect(tx)
      .to.emit(arbitrumGatewayRouter, "TransferRouted")
      .withArgs(usdc.target, repayer.target, liquidityPool.target, arbitrumGatewayRouter.target);
  });

  it("Should revert Arbitrum Gateway repay if output token doesn't match", async function () {
    const {
      USDC_DEC, usdc, repayUser, liquidityPool, optimismBridge, cctpTokenMessenger, cctpMessageTransmitter,
      acrossV3SpokePool, everclearFeeAdapter, weth, stargateTreasurerTrue, admin, deployer, baseBridge,
      setTokensUser, arbitrumGatewayRouter,
      sharedEthereumOmnibridge, sharedEthereumAmb,
    } = await loadFixture(deployAll);
    const amount = 4n * USDC_DEC;
    const maxGas = 10000000n;
    const gasPriceBid = 1000000000n;
    const maxSubmissionCost = 100000000000000n;

    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer2", {},
        Domain.ETHEREUM,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        sharedEthereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, sharedEthereumAmb, ZERO_ADDRESS,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin,
      repayUser,
      setTokensUser,
      [liquidityPool, liquidityPool],
      [Domain.ETHEREUM, Domain.ARBITRUM_ONE],
      [Provider.LOCAL, Provider.ARBITRUM_GATEWAY],
      [true, true],
      [{
        inputToken: usdc,
        destinationTokens: [
          destinationToken(Domain.ARBITRUM_ONE, addressToBytes32(weth.target))
        ]
      }],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayer2", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    await usdc.transfer(repayer, 10n * USDC_DEC);

    const data = AbiCoder.defaultAbiCoder().encode(
      ["uint256", "bytes"],
      [maxSubmissionCost, "0x"],
    );
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "uint256", "bytes"],
      [weth.target, maxGas, gasPriceBid, data]
    );

    await expect(repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.ARBITRUM_ONE,
      Provider.ARBITRUM_GATEWAY,
      extraData
    )).to.be.revertedWithCustomError(repayer, "InvalidOutputToken()");
  });

  it("Should revert Arbitrum Gateway repay if call to Arbitrum Gateway reverts", async function () {
    const {
      USDC_DEC, usdc, repayUser, liquidityPool, optimismBridge, cctpTokenMessenger, cctpMessageTransmitter,
      acrossV3SpokePool, everclearFeeAdapter, weth, stargateTreasurerTrue, admin, deployer, baseBridge,
      setTokensUser, l2TokenAddress, arbitrumGatewayRouter,
      sharedEthereumOmnibridge, sharedEthereumAmb,
    } = await loadFixture(deployAll);

    // Deploy repayer configured to use Arbitrum Gateway Router
    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer2", {},
        Domain.ETHEREUM,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        sharedEthereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, sharedEthereumAmb, ZERO_ADDRESS,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin,
      repayUser,
      setTokensUser,
      [liquidityPool, liquidityPool],
      [Domain.ETHEREUM, Domain.ARBITRUM_ONE],
      [Provider.LOCAL, Provider.ARBITRUM_GATEWAY],
      [true, true],
      [{
        inputToken: usdc,
        destinationTokens: [
          destinationToken(Domain.ARBITRUM_ONE, addressToBytes32(l2TokenAddress))
        ]
      }],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayer2", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    await usdc.transfer(repayer, 10n * USDC_DEC);

    // Use amount 2000 to trigger the mock router revert
    const amount = 2000n;
    const maxGas = 10000000n;
    const gasPriceBid = 1000000000n;
    const maxSubmissionCost = 100000000000000n;

    const data = AbiCoder.defaultAbiCoder().encode(
      ["uint256", "bytes"],
      [maxSubmissionCost, "0x"],
    );
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "uint256", "bytes"],
      [l2TokenAddress, maxGas, gasPriceBid, data]
    );

    await expect(repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.ARBITRUM_ONE,
      Provider.ARBITRUM_GATEWAY,
      extraData
  )).to.be.reverted;
  });

  it("Should initiate Arbitrum Gateway repay with wrapped native currency", async function () {
    const {
      usdc, repayUser, liquidityPool, optimismBridge, cctpTokenMessenger, cctpMessageTransmitter,
      acrossV3SpokePool, everclearFeeAdapter, weth, stargateTreasurerTrue, admin, deployer, baseBridge,
      setTokensUser, l2TokenAddress,
      sharedEthereumOmnibridge, sharedEthereumAmb,
    } = await loadFixture(deployAll);
    const amount = 100000n;
    const maxGas = 10000000n;
    const gasPriceBid = 1000000000n;
    const maxSubmissionCost = 100000000000000n;

    const arbitrumGatewayRouter = (
      await deploy("TestArbitrumGatewayRouter", deployer, {}, weth.target, l2TokenAddress)
    ) as TestArbitrumGatewayRouter;

    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer2", {},
        Domain.ETHEREUM,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        sharedEthereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, sharedEthereumAmb, ZERO_ADDRESS,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin,
      repayUser,
      setTokensUser,
      [liquidityPool, liquidityPool],
      [Domain.ETHEREUM, Domain.ARBITRUM_ONE],
      [Provider.LOCAL, Provider.ARBITRUM_GATEWAY],
      [true, true],
      [{
        inputToken: weth,
        destinationTokens: [
          destinationToken(Domain.ARBITRUM_ONE, addressToBytes32(l2TokenAddress))
        ]
      }],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayer2", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    await weth.connect(repayUser).deposit({value: amount});
    await weth.connect(repayUser).transfer(repayer, amount);

    const data = AbiCoder.defaultAbiCoder().encode(
      ["uint256", "bytes"],
      [maxSubmissionCost, "0x"],
    );
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "uint256", "bytes"],
      [l2TokenAddress, maxGas, gasPriceBid, data]
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      weth,
      amount,
      liquidityPool,
      Domain.ARBITRUM_ONE,
      Provider.ARBITRUM_GATEWAY,
      extraData
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(weth.target, amount, liquidityPool.target, Domain.ARBITRUM_ONE, Provider.ARBITRUM_GATEWAY);
    await expect(tx)
      .to.emit(arbitrumGatewayRouter, "TransferRouted")
      .withArgs(weth.target, repayer.target, liquidityPool.target, arbitrumGatewayRouter.target);
  });

  it("Should revert Arbitrum Gateway repay if output token doesn't match the gateway token", async function () {
    const {
      USDC_DEC, usdc, repayUser, liquidityPool, optimismBridge, cctpTokenMessenger, cctpMessageTransmitter,
      acrossV3SpokePool, everclearFeeAdapter, weth, stargateTreasurerTrue, admin, deployer, baseBridge,
      setTokensUser, l2TokenAddress, arbitrumGatewayRouter,
      sharedEthereumOmnibridge, sharedEthereumAmb,
    } = await loadFixture(deployAll);

    // Deploy repayer configured to use Arbitrum Gateway Router
    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer2", {},
        Domain.ETHEREUM,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        sharedEthereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, sharedEthereumAmb, ZERO_ADDRESS,
      )
    ) as Repayer;

    const wrongOutputToken = weth.target;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin,
      repayUser,
      setTokensUser,
      [liquidityPool, liquidityPool],
      [Domain.ETHEREUM, Domain.ARBITRUM_ONE],
      [Provider.LOCAL, Provider.ARBITRUM_GATEWAY],
      [true, true],
      [{
        inputToken: usdc,
        destinationTokens: [
          destinationToken(Domain.ARBITRUM_ONE, addressToBytes32(wrongOutputToken))
        ]
      }],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayer2", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    await usdc.transfer(repayer, 10n * USDC_DEC);

    // Use amount 2000 to trigger the mock router revert
    const amount = 2000n;
    const maxGas = 10000000n;
    const gasPriceBid = 1000000000n;
    const maxSubmissionCost = 100000000000000n;

    const data = AbiCoder.defaultAbiCoder().encode(
      ["uint256", "bytes"],
      [maxSubmissionCost, "0x"],
    );
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "uint256", "bytes"],
      [l2TokenAddress, maxGas, gasPriceBid, data]
    );

    await expect(repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.ARBITRUM_ONE,
      Provider.ARBITRUM_GATEWAY,
      extraData
    )).to.be.revertedWithCustomError(repayer, "InvalidOutputToken");
  });

  it("Should revert Arbitrum Gateway repay if output token is not allowed", async function () {
    const {
      USDC_DEC, usdc, repayUser, liquidityPool, optimismBridge, cctpTokenMessenger, cctpMessageTransmitter,
      acrossV3SpokePool, everclearFeeAdapter, weth, stargateTreasurerTrue, admin, deployer, baseBridge,
      setTokensUser, arbitrumGatewayRouter,
      sharedEthereumOmnibridge, sharedEthereumAmb,
    } = await loadFixture(deployAll);

    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer2", {},
        Domain.ETHEREUM,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        sharedEthereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, sharedEthereumAmb, ZERO_ADDRESS,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin,
      repayUser,
      setTokensUser,
      [liquidityPool, liquidityPool],
      [Domain.ETHEREUM, Domain.ARBITRUM_ONE],
      [Provider.LOCAL, Provider.ARBITRUM_GATEWAY],
      [true, true],
      [],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayer2", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    await usdc.transfer(repayer, 10n * USDC_DEC);

    const amount = 4n * USDC_DEC;
    const outputToken = ZERO_ADDRESS;
    const minGasLimit = 100000n;
    const maxSubmissionCost = 100000000000000n;
    const data = AbiCoder.defaultAbiCoder().encode(
      ["uint256", "bytes"],
      [maxSubmissionCost, "0x"],
    );
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint32", "bytes"],
      [outputToken, minGasLimit, data],
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.ARBITRUM_ONE,
      Provider.ARBITRUM_GATEWAY,
      extraData
    );
    await expect(tx)
      .to.be.revertedWithCustomError(repayer, "InvalidOutputToken()");
  });

  it("Should NOT allow repayer to initiate Arbitrum Gateway repay on invalid route", async function () {
    const {
      USDC_DEC, usdc, repayUser, liquidityPool, optimismBridge, cctpTokenMessenger, cctpMessageTransmitter,
      acrossV3SpokePool, everclearFeeAdapter, weth, stargateTreasurerTrue, admin, deployer, baseBridge,
      setTokensUser, arbitrumGatewayRouter, l2TokenAddress,
      sharedEthereumOmnibridge, sharedEthereumAmb,
    } = await loadFixture(deployAll);

    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer2", {},
        Domain.ETHEREUM,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        sharedEthereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, sharedEthereumAmb, ZERO_ADDRESS,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin,
      repayUser,
      setTokensUser,
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.LOCAL],
      [true],
      [],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayer2", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    const amount = 4n * USDC_DEC;

    await usdc.transfer(repayer, 10n * USDC_DEC);
      const maxGas = 10000000n;
    const gasPriceBid = 1000000000n;
    const maxSubmissionCost = 100000000000000n;
    const data = AbiCoder.defaultAbiCoder().encode(
      ["uint256", "bytes"],
      [maxSubmissionCost, "0x"],
    );
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "uint256", "bytes"],
      [l2TokenAddress, maxGas, gasPriceBid, data]
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.ARBITRUM_ONE,
      Provider.ARBITRUM_GATEWAY,
      extraData
    );
    await expect(tx)
      .to.be.revertedWithCustomError(repayer, "RouteDenied");
  });

  it("Should NOT allow repayer to initiate Arbitrum Gateway repay if local domain is not ETHEREUM", async function () {
    const {admin, USDC_DEC, usdc, repayUser, liquidityPool, repayer, l2TokenAddress} = await loadFixture(deployAll);

    await repayer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.ARBITRUM_ONE],
      [Provider.ARBITRUM_GATEWAY],
      [true],
      ALLOWED
    );

    const amount = 4n * USDC_DEC;

    await usdc.transfer(repayer, 10n * USDC_DEC);
      const maxGas = 10000000n;
    const gasPriceBid = 1000000000n;
    const maxSubmissionCost = 100000000000000n;
    const data = AbiCoder.defaultAbiCoder().encode(
      ["uint256", "bytes"],
      [maxSubmissionCost, "0x"],
    );
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "uint256", "bytes"],
      [l2TokenAddress, maxGas, gasPriceBid, data]
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.ARBITRUM_ONE,
      Provider.ARBITRUM_GATEWAY,
      extraData
    );
    await expect(tx)
      .to.be.revertedWithCustomError(repayer, "UnsupportedDomain");
  });

  it("Should NOT initiate Arbitrum Gateway repay if destination domain is not ARBITRUM_ONE", async function () {
    const {USDC_DEC, usdc, repayUser, liquidityPool, optimismBridge, cctpTokenMessenger, cctpMessageTransmitter,
      acrossV3SpokePool, everclearFeeAdapter, weth, stargateTreasurerTrue, admin, deployer, baseBridge,
      setTokensUser, arbitrumGatewayRouter, l2TokenAddress,
      sharedEthereumOmnibridge, sharedEthereumAmb} = await loadFixture(deployAll);

    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer2", {},
        Domain.ETHEREUM,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        sharedEthereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, sharedEthereumAmb, ZERO_ADDRESS,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin,
      repayUser,
      setTokensUser,
      [liquidityPool, liquidityPool],
      [Domain.ETHEREUM, Domain.BASE],
      [Provider.LOCAL, Provider.ARBITRUM_GATEWAY],
      [true, true],
      [],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayer2", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    const amount = 4n * USDC_DEC;

    await usdc.transfer(repayer, 10n * USDC_DEC);
      const maxGas = 10000000n;
    const gasPriceBid = 1000000000n;
    const maxSubmissionCost = 100000000000000n;
    const data = AbiCoder.defaultAbiCoder().encode(
      ["uint256", "bytes"],
      [maxSubmissionCost, "0x"],
    );
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "uint256", "bytes"],
      [l2TokenAddress, maxGas, gasPriceBid, data]
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.BASE,
      Provider.ARBITRUM_GATEWAY,
      extraData
    );
    await expect(tx)
      .to.be.revertedWithCustomError(repayer, "UnsupportedDomain");
  });

  it("Should revert Arbitrum Gateway repay if router address is 0", async function () {
    const {
      USDC_DEC, usdc, repayUser, liquidityPool, optimismBridge, cctpTokenMessenger, cctpMessageTransmitter,
      acrossV3SpokePool, everclearFeeAdapter, weth, stargateTreasurerTrue, admin, deployer, baseBridge,
      setTokensUser, l2TokenAddress,
      sharedEthereumOmnibridge, sharedEthereumAmb,
    } = await loadFixture(deployAll);

    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer2", {},
        Domain.ETHEREUM,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        ZERO_ADDRESS,
        sharedEthereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, sharedEthereumAmb, ZERO_ADDRESS,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin,
      repayUser,
      setTokensUser,
      [liquidityPool, liquidityPool],
      [Domain.ETHEREUM, Domain.ARBITRUM_ONE],
      [Provider.LOCAL, Provider.ARBITRUM_GATEWAY],
      [true, true],
      [],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayer2", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    await usdc.transfer(repayer, 10n * USDC_DEC);

    const amount = 4n * USDC_DEC;

    await usdc.transfer(repayer, 10n * USDC_DEC);
      const maxGas = 10000000n;
    const gasPriceBid = 1000000000n;
    const maxSubmissionCost = 100000000000000n;
    const data = AbiCoder.defaultAbiCoder().encode(
      ["uint256", "bytes"],
      [maxSubmissionCost, "0x"],
    );
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "uint256", "bytes"],
      [l2TokenAddress, maxGas, gasPriceBid, data]
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.ARBITRUM_ONE,
      Provider.ARBITRUM_GATEWAY,
      extraData
    );
    await expect(tx)
      .to.be.revertedWithCustomError(repayer, "ZeroAddress");
  });

  it("Should allow repayer to initiate repay of a different token", async function () {
    const {repayer, eurc, EURC_DEC, eurcOwner, repayUser, liquidityPool
    } = await loadFixture(deployAll);

    await eurc.connect(eurcOwner).transfer(repayer, 10n * EURC_DEC);
    const tx = repayer.connect(repayUser).initiateRepay(
      eurc,
      4n * EURC_DEC,
      liquidityPool,
      Domain.BASE,
      Provider.LOCAL,
      "0x"
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(eurc.target, 4n * EURC_DEC, liquidityPool.target, Domain.BASE, Provider.LOCAL);
    await expect(tx)
      .to.emit(eurc, "Transfer")
      .withArgs(repayer.target, liquidityPool.target, 4n * EURC_DEC);

    expect(await eurc.balanceOf(repayer)).to.equal(6n * EURC_DEC);
    expect(await eurc.balanceOf(liquidityPool)).to.equal(4n * EURC_DEC);
  });

  it("Should allow repayer to initiate repay to local pool", async function () {
    const {repayer, usdc, USDC_DEC, repayUser, liquidityPool2
    } = await loadFixture(deployAll);

    await usdc.transfer(repayer, 10n * USDC_DEC);
    const tx = repayer.connect(repayUser).initiateRepay(
      usdc,
      4n * USDC_DEC,
      liquidityPool2,
      Domain.BASE,
      Provider.LOCAL,
      "0x"
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(usdc.target, 4n * USDC_DEC, liquidityPool2.target, Domain.BASE, Provider.LOCAL);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(repayer.target, liquidityPool2.target, 4n * USDC_DEC);

    expect(await usdc.balanceOf(repayer)).to.equal(6n * USDC_DEC);
    expect(await usdc.balanceOf(liquidityPool2)).to.equal(4n * USDC_DEC);
  });

  it("Should not allow repayer to initiate repay on invalid route", async function () {
    const {repayer, usdc, USDC_DEC, repayUser, liquidityPool,
    } = await loadFixture(deployAll);

    await usdc.transfer(repayer, 10n * USDC_DEC);
    await expect(repayer.connect(repayUser).initiateRepay(
      usdc,
      4n * USDC_DEC,
      usdc,
      Domain.ETHEREUM,
      Provider.CCTP,
      "0x"
    )).to.be.revertedWithCustomError(repayer, "RouteDenied()");
    await expect(repayer.connect(repayUser).initiateRepay(
      usdc,
      4n * USDC_DEC,
      liquidityPool,
      Domain.BASE,
      Provider.CCTP,
      "0x"
    )).to.be.revertedWithCustomError(repayer, "RouteDenied()");
  });

  it("Should not allow others to initiate repay", async function () {
    const {repayer, usdc, USDC_DEC, admin, liquidityPool} = await loadFixture(deployAll);

    await usdc.transfer(repayer, 10n * USDC_DEC);
    await expect(repayer.connect(admin).initiateRepay(
      usdc,
      4n * USDC_DEC,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.CCTP,
      "0x"
    )).to.be.revertedWithCustomError(repayer, "AccessControlUnauthorizedAccount(address,bytes32)");
  });

  it("Should not allow repayer to initiate repay with 0 amount", async function () {
    const {repayer, repayUser, usdc, USDC_DEC, liquidityPool} = await loadFixture(deployAll);

    await usdc.transfer(repayer, 10n * USDC_DEC);
    await expect(repayer.connect(repayUser).initiateRepay(
      usdc,
      0n,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.CCTP,
      "0x"
    )).to.be.revertedWithCustomError(repayer, "ZeroAmount()");
  });

  it("Should not allow repayer to initiate repay with disabled route", async function () {
    const {repayer, repayUser, usdc, USDC_DEC, liquidityPool} = await loadFixture(deployAll);

    await usdc.transfer(repayer, 10n * USDC_DEC);
    await expect(repayer.connect(repayUser).initiateRepay(
      usdc,
      4n * USDC_DEC,
      liquidityPool,
      Domain.AVALANCHE,
      Provider.CCTP,
      "0x"
    )).to.be.revertedWithCustomError(repayer, "RouteDenied()");
  });

  it("Should not allow repayer to initiate repay with other token if the pool doesn't support it", async function () {
    const {repayer, repayUser, eurc, EURC_DEC, eurcOwner, liquidityPool2} = await loadFixture(deployAll);

    await eurc.connect(eurcOwner).transfer(repayer, 10n * EURC_DEC);
    await expect(repayer.connect(repayUser).initiateRepay(
      eurc,
      4n * EURC_DEC,
      liquidityPool2,
      Domain.BASE,
      Provider.LOCAL,
      "0x"
    )).to.be.revertedWithCustomError(repayer, "InvalidToken()");
  });

  it("Should not allow repayer to initiate repay with other token if the provider is CCTP", async function () {
    const {repayer, repayUser, eurc, EURC_DEC, eurcOwner, liquidityPool} = await loadFixture(deployAll);

    await eurc.connect(eurcOwner).transfer(repayer, 10n * EURC_DEC);
    await expect(repayer.connect(repayUser).initiateRepay(
      eurc,
      4n * EURC_DEC,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.CCTP,
      "0x"
    )).to.be.revertedWithCustomError(repayer, "InvalidToken()");
  });

  it("Should revert processRepay for unsupported providers", async function () {
    const {
      repayUser, liquidityPool, repayer,
    } = await loadFixture(deployAll);

    await expect(repayer.connect(repayUser).processRepay(
      liquidityPool, Provider.LOCAL, "0x"
    )).to.be.revertedWithCustomError(repayer, "UnsupportedProvider()");
    await expect(repayer.connect(repayUser).processRepay(
      liquidityPool, Provider.ACROSS, "0x"
    )).to.be.revertedWithCustomError(repayer, "UnsupportedProvider()");
    await expect(repayer.connect(repayUser).processRepay(
      liquidityPool, Provider.STARGATE, "0x"
    )).to.be.revertedWithCustomError(repayer, "UnsupportedProvider()");
    await expect(repayer.connect(repayUser).processRepay(
      liquidityPool, Provider.EVERCLEAR, "0x"
    )).to.be.revertedWithCustomError(repayer, "UnsupportedProvider()");
    await expect(repayer.connect(repayUser).processRepay(
      liquidityPool, Provider.SUPERCHAIN_STANDARD_BRIDGE, "0x"
    )).to.be.revertedWithCustomError(repayer, "UnsupportedProvider()");
    await expect(repayer.connect(repayUser).processRepay(
      liquidityPool, Provider.ARBITRUM_GATEWAY, "0x"
    )).to.be.revertedWithCustomError(repayer, "UnsupportedProvider()");
  });

  it("Should allow repayer to process repay", async function () {
    const {repayer, usdc, USDC_DEC, liquidityPool, repayUser} = await loadFixture(deployAll);

    const message = AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [usdc.target, liquidityPool.target, 4n * USDC_DEC]
    );
    const signature = AbiCoder.defaultAbiCoder().encode(["bool", "bool"], [true, true]);
    const extraData = AbiCoder.defaultAbiCoder().encode(["bytes", "bytes"], [message, signature]);
    const tx = repayer.connect(repayUser).processRepay(liquidityPool, Provider.CCTP, extraData);
    await expect(tx)
      .to.emit(repayer, "ProcessRepay")
      .withArgs(usdc.target, 4n * USDC_DEC, liquidityPool.target, Provider.CCTP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(ZERO_ADDRESS, liquidityPool.target, 4n * USDC_DEC);

    expect(await usdc.balanceOf(liquidityPool)).to.equal(4n * USDC_DEC);
    expect(await usdc.balanceOf(repayer)).to.equal(0n);
  });

  it("Should not allow others to process repay", async function () {
    const {repayer, usdc, USDC_DEC, liquidityPool, user} = await loadFixture(deployAll);

    const message = AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [usdc.target, liquidityPool.target, 4n * USDC_DEC]
    );
    const signature = AbiCoder.defaultAbiCoder().encode(["bool", "bool"], [true, true]);
    const extraData = AbiCoder.defaultAbiCoder().encode(["bytes", "bytes"], [message, signature]);
    await expect(repayer.connect(user).processRepay(liquidityPool, Provider.CCTP, extraData))
      .to.be.revertedWithCustomError(repayer, "AccessControlUnauthorizedAccount(address,bytes32)");;
  });

  it("Should revert if CCTP receiveMessage reverts", async function () {
    const {repayer, usdc, USDC_DEC, liquidityPool, repayUser} = await loadFixture(deployAll);

    const message = AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [usdc.target, liquidityPool.target, 4n * USDC_DEC]
    );
    const signature = AbiCoder.defaultAbiCoder().encode(["bool", "bool"], [false, true]);
    const extraData = AbiCoder.defaultAbiCoder().encode(["bytes", "bytes"], [message, signature]);
    await expect(repayer.connect(repayUser).processRepay(liquidityPool, Provider.CCTP, extraData))
      .to.be.reverted;
  });

  it("Should revert if CCTP receiveMessage returned false", async function () {
    const {repayer, usdc, USDC_DEC, liquidityPool, repayUser} = await loadFixture(deployAll);

    const message = AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [usdc.target, liquidityPool.target, 4n * USDC_DEC]
    );
    const signature = AbiCoder.defaultAbiCoder().encode(["bool", "bool"], [true, false]);
    const extraData = AbiCoder.defaultAbiCoder().encode(["bytes", "bytes"], [message, signature]);
    await expect(repayer.connect(repayUser).processRepay(liquidityPool, Provider.CCTP, extraData))
      .to.be.revertedWithCustomError(repayer, "ProcessFailed()");
  });

  it("Should revert CCTP initiate if native currency is sent along", async function () {
    const {repayer, usdc, USDC_DEC, liquidityPool, repayUser} = await loadFixture(deployAll);

    await usdc.transfer(repayer, 10n * USDC_DEC);

    await expect(repayer.connect(repayUser).initiateRepay(
      usdc,
      4n * USDC_DEC,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.CCTP,
      "0x",
      {value: 1n}
    )).to.be.revertedWithCustomError(repayer, "NotPayable()");
  });

  it("Should perform Stargate repay with a mock pool", async function () {
    const {repayer, USDC_DEC, usdc, admin, repayUser, liquidityPool, deployer} = await loadFixture(deployAll);

    const testStargate = (
      await deploy("TestStargate", deployer, {}, usdc)
    ) as TestStargate;
    expect(await testStargate.token()).to.eq(usdc.target);

    await usdc.transfer(repayer, 10n * USDC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.STARGATE],
      [true],
      ALLOWED
    );
    const amount = 4n * USDC_DEC;
    const minAmount = amount * 999n / 1000n;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"],
      [testStargate.target, minAmount]
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.STARGATE,
      extraData,
      {value: 1n * ETH}
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(usdc.target, amount, liquidityPool.target, Domain.ETHEREUM, Provider.STARGATE);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(repayer.target, testStargate.target, amount);

    const receipt = await hre.ethers.provider.getTransactionReceipt((await tx).hash);
    const events = await repayer.queryFilter(repayer.getEvent("StargateTransfer"), receipt!.blockNumber);
    const messagingFee = events[0].args[0][2];
    expect(messagingFee[1]).to.eq(0);
    const nativeFee = messagingFee[0];
    await expect(tx).to.changeEtherBalance(repayUser, -nativeFee);

    await expect(tx)
      .to.emit(testStargate, "OFTSent")
      .withArgs(
        anyValue,
        "30101",
        repayer.target,
        amount,
        minAmount
      );
  });

  it("Should revert Stargate repay if the pool is not registered", async function () {
    const {repayer, USDC_DEC, usdc, admin, repayUser, liquidityPool, deployer, cctpTokenMessenger,
      cctpMessageTransmitter, acrossV3SpokePool, weth, stargateTreasurerFalse, repayerAdmin, repayerProxy,
      everclearFeeAdapter, optimismBridge, baseBridge, arbitrumGatewayRouter,
    } = await loadFixture(deployAll);

    await usdc.transfer(repayer, 10n * USDC_DEC);

    const testStargate = (
      await deploy("TestStargate", deployer, {}, usdc)
    ) as TestStargate;
    expect(await testStargate.token()).to.eq(usdc.target);

    const repayerImpl2 = (
      await deployX(
        "Repayer",
        deployer,
        "Repayer2",
        {},
        Domain.BASE,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerFalse,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
      )
    ) as Repayer;

    expect(await repayerAdmin.connect(admin).upgradeAndCall(repayerProxy, repayerImpl2, "0x"))
      .to.emit(repayerProxy, "Upgraded");
    expect(await repayer.STARGATE_TREASURER())
      .to.equal(stargateTreasurerFalse.target);

    await repayer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.STARGATE],
      [true],
      ALLOWED
    );
    const amount = 4n * USDC_DEC;
    const minAmount = amount * 999n / 1000n;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"], [testStargate.target, minAmount]
    );
    await expect(repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.STARGATE,
      extraData,
      {value: 1n * ETH}
    )).to.be.revertedWithCustomError(repayer, "PoolInvalid");
  });

  it("Should revert Stargate repay if provided minimal amount is too low", async function () {
    const {repayer, USDC_DEC, usdc, admin, repayUser, liquidityPool, deployer
    } = await loadFixture(deployAll);

    await usdc.transfer(repayer, 10n * USDC_DEC);

    const testStargate = (
      await deploy("TestStargate", deployer, {}, usdc)
    ) as TestStargate;
    expect(await testStargate.token()).to.eq(usdc.target);

    await usdc.transfer(repayer, 10n * USDC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.STARGATE],
      [true],
      ALLOWED
    );

    const amount = 4n * USDC_DEC;
    const minAmount = amount * 997n / 1000n;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"], [testStargate.target, minAmount]
    );
    await expect(repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.STARGATE,
      extraData,
      {value: 1n * ETH}
    )).to.be.revertedWithCustomError(repayer, "SlippageTooHigh");
  });

  it("Should revert Stargate repay if the pool token doesn't match", async function () {
    const {
      repayer, EURC_DEC, usdc, admin, repayUser, liquidityPool, deployer, eurc, eurcOwner
    } = await loadFixture(deployAll);

    const testStargate = (
      await deploy("TestStargate", deployer, {}, usdc)
    ) as TestStargate;
    expect(await testStargate.token()).to.eq(usdc.target);

    await eurc.connect(eurcOwner).transfer(repayer, 10n * EURC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.STARGATE],
      [true],
      ALLOWED
    );
    const amount = 4n * EURC_DEC;
    const minAmount = amount * 999n / 1000n;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"], [testStargate.target, minAmount]
    );
    await expect(repayer.connect(repayUser).initiateRepay(
      eurc,
      amount,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.STARGATE,
      extraData,
      {value: 1n * ETH}
    )).to.be.revertedWithCustomError(repayer, "PoolInvalid");
  });

  it("Should allow repayer to initiate Stargate repay on fork and refund unspent fee", async function () {
    const {
      repayer, USDC_DEC, admin, repayUser, liquidityPool, deployer, cctpTokenMessenger, cctpMessageTransmitter,
      acrossV3SpokePool, weth, repayerAdmin, repayerProxy, everclearFeeAdapter, optimismBridge, baseBridge,
      arbitrumGatewayRouter,
    } = await loadFixture(deployAll);

    const stargatePoolUsdcAddress = "0x27a16dc786820B16E5c9028b75B99F6f604b5d26";
    const stargateTreasurer = "0xd47b03ee6d86Cf251ee7860FB2ACf9f91B9fD4d7";
    const stargatePoolUsdc = await hre.ethers.getContractAt(
      "IStargate",
      stargatePoolUsdcAddress
    );
    const USDC_BASE_ADDRESS = networkConfig.BASE.Tokens.USDC.Address;

    assertAddress(process.env.USDC_OWNER_ADDRESS, "Env variables not configured (USDC_OWNER_ADDRESS missing)");
    const USDC_OWNER_ADDRESS = process.env.USDC_OWNER_ADDRESS;
    const usdc = await hre.ethers.getContractAt("ERC20", USDC_BASE_ADDRESS);
    const usdcOwner = await hre.ethers.getImpersonatedSigner(USDC_OWNER_ADDRESS);

    const repayerImpl2 = (
      await deployX(
        "Repayer",
        deployer,
        "Repayer2",
        {},
        Domain.BASE,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurer,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
      )
    ) as Repayer;

    expect(await repayerAdmin.connect(admin).upgradeAndCall(repayerProxy, repayerImpl2, "0x"))
      .to.emit(repayerProxy, "Upgraded");
    expect(await repayer.STARGATE_TREASURER())
      .to.equal(stargateTreasurer);

    await usdc.connect(usdcOwner).transfer(repayer, 100000n * USDC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.STARGATE],
      [true],
      ALLOWED
    );
    const amount = 400n * USDC_DEC;
    const minAmount = amount * 998n / 1000n;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"], [stargatePoolUsdcAddress, minAmount]
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.STARGATE,
      extraData,
      {value: 1n * ETH}
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(usdc.target, amount, liquidityPool.target, Domain.ETHEREUM, Provider.STARGATE);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(repayer.target, stargatePoolUsdcAddress, amount);

    const receipt = await hre.ethers.provider.getTransactionReceipt((await tx).hash);
    const events = await repayer.queryFilter(repayer.getEvent("StargateTransfer"), receipt!.blockNumber);
    const messagingFee = events[0].args[0][2];
    expect(messagingFee[1]).to.eq(0);
    const nativeFee = messagingFee[0];
    await expect(tx).to.changeEtherBalance(repayUser, -nativeFee);

    await expect(tx)
      .to.emit(stargatePoolUsdc, "OFTSent")
      .withArgs(
        anyValue,
        "30101",
        repayer.target,
        amount,
        anyValue
      );
    const eventsOft = await stargatePoolUsdc.queryFilter(stargatePoolUsdc.getEvent("OFTSent"), receipt!.blockNumber);
    const amountOutSent = eventsOft[0].args[4];
    expect(amountOutSent).to.be.gte(minAmount);
  });

  it("Should revert if Stargate pool reverts the payment", async function () {
    const {repayer, USDC_DEC, admin, repayUser, liquidityPool} = await loadFixture(deployAll);

    const stargatePoolUsdcAddress = "0x27a16dc786820B16E5c9028b75B99F6f604b5d26";
    const USDC_BASE_ADDRESS = networkConfig.BASE.Tokens.USDC.Address;

    assertAddress(process.env.USDC_OWNER_ADDRESS, "Env variables not configured (USDC_OWNER_ADDRESS missing)");
    const USDC_OWNER_ADDRESS = process.env.USDC_OWNER_ADDRESS;
    const usdc = await hre.ethers.getContractAt("ERC20", USDC_BASE_ADDRESS);
    const usdcOwner = await hre.ethers.getImpersonatedSigner(USDC_OWNER_ADDRESS);

    await usdc.connect(usdcOwner).transfer(repayer, 10n * USDC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.STARGATE],
      [true],
      ALLOWED
    );
    const amount = 4n * USDC_DEC;
    const minAmount = amount * 999n / 1000n;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"], [stargatePoolUsdcAddress, minAmount]
    );
    // Not enough native fee provided
    await expect(repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.STARGATE,
      extraData,
      {value: 1n * USDC_DEC}
    )).to.be.reverted;
  });

  it("Should allow to receive native tokens", async function () {
      // Covered in Should wrap native tokens on initiate repay
  });

  it("Should allow to receive native tokens on initiate repay", async function () {
      // Covered in Should not wrap native tokens on initiate repay that were sent in as msg.value
  });

  it("Should wrap all native tokens on initiate repay", async function () {
    const {repayer, repayUser, liquidityPool, weth
    } = await loadFixture(deployAll);

    const nativeAmount = 10n * ETH;
    const repayAmount = 4n * ETH;

    await repayUser.sendTransaction({to: repayer, value: nativeAmount});
    const tx = repayer.connect(repayUser).initiateRepay(
      weth,
      repayAmount,
      liquidityPool,
      Domain.BASE,
      Provider.LOCAL,
      "0x"
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(weth.target, repayAmount, liquidityPool.target, Domain.BASE, Provider.LOCAL);
    await expect(tx)
      .to.emit(weth, "Transfer")
      .withArgs(repayer.target, liquidityPool.target, repayAmount);
    await expect(tx)
      .to.emit(weth, "Deposit")
      .withArgs(repayer.target, nativeAmount);

    expect(await weth.balanceOf(repayer)).to.equal(6n * ETH);
    expect(await weth.balanceOf(liquidityPool)).to.equal(4n * ETH);
    expect(await getBalance(repayer)).to.equal(0n);
  });

  it("Should unwrap enough native tokens on initiate repay", async function () {
    const {
      repayer, repayUser, liquidityPool, optimismBridge, usdc, cctpTokenMessenger,
      cctpMessageTransmitter, repayerAdmin, admin, repayerProxy, deployer, baseBridge, arbitrumGatewayRouter,
      sharedEthereumOmnibridge, sharedEthereumAmb,
    } = await loadFixture(deployAll);

    const wrappedAmount = 10n * ETH;
    const nativeAmount = 1n * ETH;
    const repayAmount = 4n * ETH;

    const weth = (await deploy("TestWETH", deployer)) as IWrappedNativeToken;

    await repayUser.sendTransaction({to: repayer, value: nativeAmount});
    await weth.connect(repayUser).deposit({value: wrappedAmount});
    await weth.connect(repayUser).transfer(repayer, wrappedAmount);

    const repayerImpl2 = (
      await deployX(
        "Repayer",
        deployer,
        "Repayer2",
        {},
        Domain.ETHEREUM,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        weth,
        ZERO_ADDRESS,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        sharedEthereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, sharedEthereumAmb, ZERO_ADDRESS,
      )
    ) as Repayer;

    expect(await repayerAdmin.connect(admin).upgradeAndCall(repayerProxy, repayerImpl2, "0x"))
      .to.emit(repayerProxy, "Upgraded");

    await repayer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.OP_MAINNET],
      [Provider.SUPERCHAIN_STANDARD_BRIDGE],
      [true],
      ALLOWED
    );

    const minGasLimit = 100000n;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint32", "bytes"],
      [ZERO_ADDRESS, minGasLimit, "0x1234"],
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      weth,
      repayAmount,
      liquidityPool,
      Domain.OP_MAINNET,
      Provider.SUPERCHAIN_STANDARD_BRIDGE,
      extraData
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(weth.target, repayAmount, liquidityPool.target, Domain.OP_MAINNET, Provider.SUPERCHAIN_STANDARD_BRIDGE);
    await expect(tx)
      .to.emit(weth, "Deposit")
      .withArgs(repayer.target, 1n * ETH);
    await expect(tx)
      .to.emit(weth, "Withdrawal")
      .withArgs(repayer.target, repayAmount);

    expect(await weth.balanceOf(repayer)).to.equal(7n * ETH);
    expect(await getBalance(repayer)).to.equal(0n);
    expect(await getBalance(optimismBridge)).to.equal(repayAmount);
  });

  it("Should not wrap native tokens on initiate repay if the balance is 0", async function () {
    const {repayer, repayUser, liquidityPool, weth
    } = await loadFixture(deployAll);

    const nativeAmount = 10n * ETH;
    const repayAmount = 4n * ETH;

    await weth.connect(repayUser).deposit({value: nativeAmount});
    await weth.connect(repayUser).transfer(repayer, nativeAmount);
    const tx = repayer.connect(repayUser).initiateRepay(
      weth,
      repayAmount,
      liquidityPool,
      Domain.BASE,
      Provider.LOCAL,
      "0x"
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(weth.target, repayAmount, liquidityPool.target, Domain.BASE, Provider.LOCAL);
    await expect(tx)
      .to.emit(weth, "Transfer")
      .withArgs(repayer.target, liquidityPool.target, repayAmount);
    await expect(tx)
      .to.not.emit(weth, "Deposit");

    expect(await weth.balanceOf(repayer)).to.equal(6n * ETH);
    expect(await weth.balanceOf(liquidityPool)).to.equal(4n * ETH);
    expect(await getBalance(repayer)).to.equal(0);
  });

  it("Should not wrap native tokens on initiate repay of other tokens", async function () {
    const {repayer, eurc, EURC_DEC, eurcOwner, repayUser, liquidityPool, weth,
    } = await loadFixture(deployAll);

    const nativeAmount = 10n * ETH;

    await repayUser.sendTransaction({to: repayer, value: nativeAmount});
    await eurc.connect(eurcOwner).transfer(repayer, 10n * EURC_DEC);
    const tx = repayer.connect(repayUser).initiateRepay(
      eurc,
      4n * EURC_DEC,
      liquidityPool,
      Domain.BASE,
      Provider.LOCAL,
      "0x"
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(eurc.target, 4n * EURC_DEC, liquidityPool.target, Domain.BASE, Provider.LOCAL);
    await expect(tx)
      .to.emit(eurc, "Transfer")
      .withArgs(repayer.target, liquidityPool.target, 4n * EURC_DEC);
    await expect(tx)
      .to.not.emit(weth, "Deposit");

    expect(await eurc.balanceOf(repayer)).to.equal(6n * EURC_DEC);
    expect(await eurc.balanceOf(liquidityPool)).to.equal(4n * EURC_DEC);
    expect(await weth.balanceOf(repayer)).to.equal(0);
    expect(await weth.balanceOf(liquidityPool)).to.equal(0);
    expect(await getBalance(repayer)).to.equal(nativeAmount);
  });

  it("Should not wrap native tokens on initiate repay that were sent in as msg.value", async function () {
    const {repayer, repayUser, liquidityPool, weth
    } = await loadFixture(deployAll);

    const nativeAmount = 10n * ETH;
    const repayAmount = 4n * ETH;
    const extraAmount = 1n * ETH;

    await repayUser.sendTransaction({to: repayer, value: nativeAmount});
    const tx = repayer.connect(repayUser).initiateRepay(
      weth,
      repayAmount,
      liquidityPool,
      Domain.BASE,
      Provider.LOCAL,
      "0x",
      {value: extraAmount}
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(weth.target, repayAmount, liquidityPool.target, Domain.BASE, Provider.LOCAL);
    await expect(tx)
      .to.emit(weth, "Transfer")
      .withArgs(repayer.target, liquidityPool.target, repayAmount);
    await expect(tx)
      .to.emit(weth, "Deposit")
      .withArgs(repayer.target, nativeAmount);

    expect(await weth.balanceOf(repayer)).to.equal(6n * ETH);
    expect(await weth.balanceOf(liquidityPool)).to.equal(repayAmount);
    expect(await getBalance(repayer)).to.equal(extraAmount);
  });

  it("Should not wrap native tokens on initiate repay if the balance was 0 before the tx", async function () {
    const {repayer, repayUser, liquidityPool, weth
    } = await loadFixture(deployAll);

    const nativeAmount = 10n * ETH;

    await expect(repayer.connect(repayUser).initiateRepay(
      weth,
      nativeAmount,
      liquidityPool,
      Domain.BASE,
      Provider.LOCAL,
      "0x",
      {value: nativeAmount}
    )).to.be.revertedWithCustomError(repayer, "InsufficientBalance()");
  });

  it("Should allow repayer to initiate Gnosis Omnibridge repay from Ethereum to Gnosis", async function () {
    const {
      USDC_DEC, usdc, repayUser, liquidityPool,
      cctpTokenMessenger, cctpMessageTransmitter, acrossV3SpokePool,
      everclearFeeAdapter, weth, stargateTreasurerTrue, admin, deployer,
      optimismBridge, baseBridge, arbitrumGatewayRouter, setTokensUser,
    } = await loadFixture(deployAll);
    const amount = 4n * USDC_DEC;

    const ethereumOmnibridge = (await deploy("TestGnosisOmnibridge", deployer, {})) as TestGnosisOmnibridge;
    const ethereumAmb = (await deploy("TestGnosisAMB", deployer, {})) as TestGnosisAMB;

    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer2", {},
        Domain.ETHEREUM,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        ethereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, ethereumAmb, ZERO_ADDRESS,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin, repayUser, setTokensUser,
      [liquidityPool], [Domain.GNOSIS_CHAIN], [Provider.GNOSIS_OMNIBRIDGE], [true], [],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayer2", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    await usdc.transfer(repayer, 10n * USDC_DEC);

    const tx = repayer.connect(repayUser).initiateRepay(
      usdc, amount, liquidityPool, Domain.GNOSIS_CHAIN, Provider.GNOSIS_OMNIBRIDGE, "0x"
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(usdc.target, amount, liquidityPool.target, Domain.GNOSIS_CHAIN, Provider.GNOSIS_OMNIBRIDGE);
    await expect(tx)
      .to.emit(repayer, "GnosisOmnibridgeTransferInitiated")
      .withArgs(usdc.target, liquidityPool.target, amount);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(repayer.target, ethereumOmnibridge.target, amount);
    expect(await usdc.balanceOf(repayer)).to.equal(6n * USDC_DEC);
    expect(await usdc.balanceOf(ethereumOmnibridge)).to.equal(amount);
  });

  it("Should allow repayer to initiate Gnosis Omnibridge repay from Gnosis to Ethereum", async function () {
    const {
      USDC_DEC, usdc, repayUser, liquidityPool,
      cctpTokenMessenger, cctpMessageTransmitter, acrossV3SpokePool,
      everclearFeeAdapter, weth, stargateTreasurerTrue, admin, deployer,
      optimismBridge, baseBridge, arbitrumGatewayRouter, setTokensUser,
    } = await loadFixture(deployAll);
    const amount = 4n * USDC_DEC;

    // usdc is assets (= GNOSIS_USDCE). usdc2 acts as a non-USDCe token (e.g. USDCxDAI) bridged directly.
    const usdc2 = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
    const gnosisOmnibridge = (await deploy("TestGnosisOmnibridge", deployer, {})) as TestGnosisOmnibridge;
    // dummySwap is only needed to satisfy constructor validation (gnosisUsdceSwap != 0 on Gnosis Chain).
    // It will not be called since the bridged token (usdc2) is not GNOSIS_USDCE (usdc).
    const dummySwap = (
      await deploy("TestUSDCTransmuter", deployer, {}, usdc.target, usdc.target)
    ) as TestUSDCTransmuter;

    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer2", {},
        Domain.GNOSIS_CHAIN,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        gnosisOmnibridge, usdc.target, dummySwap.target, ZERO_ADDRESS, ZERO_ADDRESS,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin, repayUser, setTokensUser,
      [liquidityPool], [Domain.ETHEREUM], [Provider.GNOSIS_OMNIBRIDGE], [true], [],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayer2", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    // Bridge usdc2 (not GNOSIS_USDCE=usdc), so no USDCe swap is triggered.
    await usdc2.transfer(repayer, 10n * USDC_DEC);

    const tx = repayer.connect(repayUser).initiateRepay(
      usdc2, amount, liquidityPool, Domain.ETHEREUM, Provider.GNOSIS_OMNIBRIDGE, "0x"
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(usdc2.target, amount, liquidityPool.target, Domain.ETHEREUM, Provider.GNOSIS_OMNIBRIDGE);
    await expect(tx)
      .to.emit(repayer, "GnosisOmnibridgeTransferInitiated")
      .withArgs(usdc2.target, liquidityPool.target, amount);
    await expect(tx)
      .to.emit(usdc2, "Transfer")
      .withArgs(repayer.target, gnosisOmnibridge.target, amount);
    expect(await usdc2.balanceOf(repayer)).to.equal(6n * USDC_DEC);
    expect(await usdc2.balanceOf(gnosisOmnibridge)).to.equal(amount);
  });

  it("Should swap USDCe to USDC before bridging from Gnosis to Ethereum", async function () {
    const {
      USDC_DEC, usdc, repayUser, liquidityPool,
      cctpTokenMessenger, cctpMessageTransmitter, acrossV3SpokePool,
      everclearFeeAdapter, weth, stargateTreasurerTrue, admin, deployer,
      optimismBridge, baseBridge, arbitrumGatewayRouter, setTokensUser,
    } = await loadFixture(deployAll);
    const amount = 4n * USDC_DEC;

    // usdc2 acts as USDCe (assets); usdc acts as USDCxDAI (bridgeable Omnibridge USDC)
    const usdc2 = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
    const usdceSwap = (
      await deploy("TestUSDCTransmuter", deployer, {}, usdc2.target, usdc.target)
    ) as TestUSDCTransmuter;
    const gnosisOmnibridge = (await deploy("TestGnosisOmnibridge", deployer, {})) as TestGnosisOmnibridge;

    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer2", {},
        Domain.GNOSIS_CHAIN,
        usdc2,   // assets = USDCe → GNOSIS_USDCE = usdc2
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        gnosisOmnibridge, usdc.target, usdceSwap.target, ZERO_ADDRESS, ZERO_ADDRESS,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin, repayUser, setTokensUser,
      [liquidityPool], [Domain.ETHEREUM], [Provider.GNOSIS_OMNIBRIDGE], [true], [],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayer2", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    // Fund repayer with USDCe and the swap contract with USDC
    await usdc2.transfer(repayer, 10n * USDC_DEC);
    await usdc.transfer(usdceSwap, 10n * USDC_DEC);

    const tx = repayer.connect(repayUser).initiateRepay(
      usdc2, amount, liquidityPool, Domain.ETHEREUM, Provider.GNOSIS_OMNIBRIDGE, "0x"
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(usdc2.target, amount, liquidityPool.target, Domain.ETHEREUM, Provider.GNOSIS_OMNIBRIDGE);
    // Event emits USDC (after swap), not USDCe
    await expect(tx)
      .to.emit(repayer, "GnosisOmnibridgeTransferInitiated")
      .withArgs(usdc.target, liquidityPool.target, amount);
    // USDCe moved from repayer to swap contract
    await expect(tx)
      .to.emit(usdc2, "Transfer")
      .withArgs(repayer.target, usdceSwap.target, amount);
    // USDC moved from swap contract to repayer then to bridge
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(repayer.target, gnosisOmnibridge.target, amount);
    expect(await usdc2.balanceOf(repayer)).to.equal(6n * USDC_DEC);
    expect(await usdc2.balanceOf(usdceSwap)).to.equal(amount);
    expect(await usdc.balanceOf(repayer)).to.equal(0n);
    expect(await usdc.balanceOf(gnosisOmnibridge)).to.equal(amount);
    expect(await usdc.balanceOf(usdceSwap)).to.equal(6n * USDC_DEC);
  });

  it("Should revert Gnosis Omnibridge repay if USDCe swap reverts", async function () {
    const {
      usdc, repayUser, liquidityPool,
      cctpTokenMessenger, cctpMessageTransmitter, acrossV3SpokePool,
      everclearFeeAdapter, weth, stargateTreasurerTrue, admin, deployer,
      optimismBridge, baseBridge, arbitrumGatewayRouter, setTokensUser,
    } = await loadFixture(deployAll);

    const usdc2 = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
    const usdceSwap = (
      await deploy("TestUSDCTransmuter", deployer, {}, usdc2.target, usdc.target)
    ) as TestUSDCTransmuter;
    const gnosisOmnibridge = (await deploy("TestGnosisOmnibridge", deployer, {})) as TestGnosisOmnibridge;

    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer2", {},
        Domain.GNOSIS_CHAIN,
        usdc2,   // assets = USDCe → GNOSIS_USDCE = usdc2
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        gnosisOmnibridge, usdc.target, usdceSwap.target, ZERO_ADDRESS, ZERO_ADDRESS,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin, repayUser, setTokensUser,
      [liquidityPool], [Domain.ETHEREUM], [Provider.GNOSIS_OMNIBRIDGE], [true], [],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayer2", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    // TestUSDCTransmuter.swap() reverts when amount == 2000
    const badAmount = 2000n;
    await usdc2.transfer(repayer, badAmount);

    await expect(repayer.connect(repayUser).initiateRepay(
      usdc2, badAmount, liquidityPool, Domain.ETHEREUM, Provider.GNOSIS_OMNIBRIDGE, "0x"
    )).to.be.reverted;
    expect(await usdc2.balanceOf(repayer)).to.equal(badAmount);
    expect(await usdc2.balanceOf(usdceSwap)).to.equal(0n);
  });

  it("Should revert Gnosis Omnibridge repay if native currency is sent along", async function () {
    const {
      USDC_DEC, usdc, repayUser, liquidityPool,
      cctpTokenMessenger, cctpMessageTransmitter, acrossV3SpokePool,
      everclearFeeAdapter, weth, stargateTreasurerTrue, admin, deployer,
      optimismBridge, baseBridge, arbitrumGatewayRouter, setTokensUser,
    } = await loadFixture(deployAll);

    const ethereumOmnibridge = (await deploy("TestGnosisOmnibridge", deployer, {})) as TestGnosisOmnibridge;
    const ethereumAmb = (await deploy("TestGnosisAMB", deployer, {})) as TestGnosisAMB;

    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer2", {},
        Domain.ETHEREUM,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        ethereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, ethereumAmb, ZERO_ADDRESS,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin, repayUser, setTokensUser,
      [liquidityPool], [Domain.GNOSIS_CHAIN], [Provider.GNOSIS_OMNIBRIDGE], [true], [],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayer2", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    await usdc.transfer(repayer, 10n * USDC_DEC);

    await expect(repayer.connect(repayUser).initiateRepay(
      usdc, 4n * USDC_DEC, liquidityPool, Domain.GNOSIS_CHAIN, Provider.GNOSIS_OMNIBRIDGE, "0x",
      {value: 1n}
    )).to.be.revertedWithCustomError(repayer, "NotPayable()");
  });

  it("Should revert Gnosis Omnibridge constructor if bridge address is 0 on Ethereum", async function () {
    const {
      usdc,
      cctpTokenMessenger, cctpMessageTransmitter, acrossV3SpokePool,
      everclearFeeAdapter, weth, stargateTreasurerTrue, deployer,
      optimismBridge, baseBridge, arbitrumGatewayRouter,
    } = await loadFixture(deployAll);

    const ethereumAmb = (await deploy("TestGnosisAMB", deployer, {})) as TestGnosisAMB;
    const factory = await hre.ethers.getContractFactory("Repayer", deployer);
    await expect(factory.deploy(
      Domain.ETHEREUM,
      usdc,
      cctpTokenMessenger,
      cctpMessageTransmitter,
      acrossV3SpokePool,
      everclearFeeAdapter,
      weth,
      stargateTreasurerTrue,
      optimismBridge,
      baseBridge,
      arbitrumGatewayRouter,
      ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ethereumAmb, ZERO_ADDRESS,
    )).to.be.revertedWithCustomError(factory, "ZeroAddress");
  });

  it("Should revert Gnosis Omnibridge constructor if required addresses are 0 on Gnosis", async function () {
    const {
      usdc,
      cctpTokenMessenger, cctpMessageTransmitter, acrossV3SpokePool,
      everclearFeeAdapter, weth, stargateTreasurerTrue, deployer,
      optimismBridge, baseBridge, arbitrumGatewayRouter,
    } = await loadFixture(deployAll);

    const usdc2 = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
    const gnosisOmnibridge = (await deploy("TestGnosisOmnibridge", deployer, {})) as TestGnosisOmnibridge;
    const usdceSwap = (await deploy("TestUSDCTransmuter", deployer, {}, usdc2, usdc)) as TestUSDCTransmuter;

    const factory = await hre.ethers.getContractFactory("Repayer", deployer);

    const baseArgs = [
      usdc2,   // assets = USDCe
      cctpTokenMessenger, cctpMessageTransmitter, acrossV3SpokePool,
      everclearFeeAdapter, weth, stargateTreasurerTrue, optimismBridge, baseBridge, arbitrumGatewayRouter,
    ] as const;

    // Omnibridge is 0
    await expect(factory.deploy(
      Domain.GNOSIS_CHAIN, ...baseArgs,
      ZERO_ADDRESS, usdc, usdceSwap, ZERO_ADDRESS, ZERO_ADDRESS,
    )).to.be.revertedWithCustomError(factory, "ZeroAddress");

    // USDCxDAI is 0
    await expect(factory.deploy(
      Domain.GNOSIS_CHAIN, ...baseArgs,
      gnosisOmnibridge, ZERO_ADDRESS, usdceSwap, ZERO_ADDRESS, ZERO_ADDRESS,
    )).to.be.revertedWithCustomError(factory, "ZeroAddress");

    // USDCe swap is 0
    await expect(factory.deploy(
      Domain.GNOSIS_CHAIN, ...baseArgs,
      gnosisOmnibridge, usdc, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
    )).to.be.revertedWithCustomError(factory, "ZeroAddress");
  });

  it("Should revert constructor if any Gnosis adapter address is non-zero on Base", async function () {
    const {
      usdc,
      cctpTokenMessenger, cctpMessageTransmitter, acrossV3SpokePool,
      everclearFeeAdapter, weth, stargateTreasurerTrue, deployer,
      optimismBridge, baseBridge, arbitrumGatewayRouter,
    } = await loadFixture(deployAll);

    const someAddress = (await deploy("TestGnosisOmnibridge", deployer, {})) as TestGnosisOmnibridge;
    const factory = await hre.ethers.getContractFactory("Repayer", deployer);

    const baseArgs = [
      usdc, cctpTokenMessenger, cctpMessageTransmitter, acrossV3SpokePool,
      everclearFeeAdapter, weth, stargateTreasurerTrue, optimismBridge, baseBridge, arbitrumGatewayRouter,
    ] as const;

    // Non-zero omnibridge
    await expect(factory.deploy(
      Domain.BASE, ...baseArgs,
      someAddress, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
    )).to.be.revertedWithCustomError(factory, "ZeroAddress");

    // Non-zero gnosisUsdcxdai
    await expect(factory.deploy(
      Domain.BASE, ...baseArgs,
      ZERO_ADDRESS, someAddress, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
    )).to.be.revertedWithCustomError(factory, "ZeroAddress");

    // Non-zero gnosisUsdceSwap
    await expect(factory.deploy(
      Domain.BASE, ...baseArgs,
      ZERO_ADDRESS, ZERO_ADDRESS, someAddress, ZERO_ADDRESS, ZERO_ADDRESS,
    )).to.be.revertedWithCustomError(factory, "ZeroAddress");

    // Non-zero ethereumAmb
    await expect(factory.deploy(
      Domain.BASE, ...baseArgs,
      ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, someAddress, ZERO_ADDRESS,
    )).to.be.revertedWithCustomError(factory, "ZeroAddress");
  });

  it("Should revert Gnosis Omnibridge repay if destination domain is wrong", async function () {
    const {
      USDC_DEC, usdc, repayUser, liquidityPool,
      cctpTokenMessenger, cctpMessageTransmitter, acrossV3SpokePool,
      everclearFeeAdapter, weth, stargateTreasurerTrue, admin, deployer,
      optimismBridge, baseBridge, arbitrumGatewayRouter, setTokensUser,
    } = await loadFixture(deployAll);

    const ethereumOmnibridge = (await deploy("TestGnosisOmnibridge", deployer, {})) as TestGnosisOmnibridge;
    const ethereumAmb = (await deploy("TestGnosisAMB", deployer, {})) as TestGnosisAMB;

    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer2", {},
        Domain.ETHEREUM,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        ethereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, ethereumAmb, ZERO_ADDRESS,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin, repayUser, setTokensUser,
      [liquidityPool, liquidityPool],
      [Domain.GNOSIS_CHAIN, Domain.ARBITRUM_ONE],
      [Provider.GNOSIS_OMNIBRIDGE, Provider.GNOSIS_OMNIBRIDGE],
      [true, true],
      [],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayer2", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    await usdc.transfer(repayer, 10n * USDC_DEC);

    // From Ethereum, only GNOSIS_CHAIN is valid destination
    await expect(repayer.connect(repayUser).initiateRepay(
      usdc, 4n * USDC_DEC, liquidityPool, Domain.ARBITRUM_ONE, Provider.GNOSIS_OMNIBRIDGE, "0x"
    )).to.be.revertedWithCustomError(repayer, "UnsupportedDomain()");
  });

  it("Should allow repayer to process Gnosis Omnibridge repay", async function () {
    const {
      USDC_DEC, usdc, repayUser, liquidityPool,
      cctpTokenMessenger, cctpMessageTransmitter, acrossV3SpokePool,
      everclearFeeAdapter, weth, stargateTreasurerTrue, admin, deployer,
      optimismBridge, baseBridge, arbitrumGatewayRouter, setTokensUser,
    } = await loadFixture(deployAll);
    const amount = 4n * USDC_DEC;

    const ethereumOmnibridge = (await deploy("TestGnosisOmnibridge", deployer, {})) as TestGnosisOmnibridge;
    const ethereumAmb = (await deploy("TestGnosisAMB", deployer, {})) as TestGnosisAMB;

    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer2", {},
        Domain.ETHEREUM,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        ethereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, ethereumAmb, ZERO_ADDRESS,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin, repayUser, setTokensUser,
      [liquidityPool], [Domain.ETHEREUM], [Provider.LOCAL], [true], [],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayer2", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    // Fund the AMB so it can deliver tokens to the pool
    await usdc.transfer(ethereumAmb, 10n * USDC_DEC);

    const message = AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [usdc.target, liquidityPool.target, amount]
    );
    const signatures = AbiCoder.defaultAbiCoder().encode(["bool"], [true]);
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "bytes", "bytes"],
      [usdc.target, message, signatures]
    );

    const tx = repayer.connect(repayUser).processRepay(
      liquidityPool, Provider.GNOSIS_OMNIBRIDGE, extraData
    );
    await expect(tx)
      .to.emit(repayer, "ProcessRepay")
      .withArgs(usdc.target, amount, liquidityPool.target, Provider.GNOSIS_OMNIBRIDGE);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(ethereumAmb.target, liquidityPool.target, amount);
    expect(await usdc.balanceOf(liquidityPool)).to.equal(amount);
    expect(await usdc.balanceOf(ethereumAmb)).to.equal(6n * USDC_DEC);
  });

  // Should revert repayer processRepay with Gnosis Omnibridge
  // of arbitrary token if target pool does not support all tokens
  it("Should revert repayer processRepay with Gnosis Omnibridge with invalid token", async function () {
    const {
      USDC_DEC, usdc, repayUser, liquidityPool,
      cctpTokenMessenger, cctpMessageTransmitter, acrossV3SpokePool,
      everclearFeeAdapter, weth, stargateTreasurerTrue, admin, deployer,
      optimismBridge, baseBridge, arbitrumGatewayRouter, setTokensUser,
    } = await loadFixture(deployAll);
    const amount = 4n * USDC_DEC;

    const ethereumOmnibridge = (await deploy("TestGnosisOmnibridge", deployer, {})) as TestGnosisOmnibridge;
    const ethereumAmb = (await deploy("TestGnosisAMB", deployer, {})) as TestGnosisAMB;

    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer2", {},
        Domain.ETHEREUM,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        ethereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, ethereumAmb, ZERO_ADDRESS,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin, repayUser, setTokensUser,
      [liquidityPool], [Domain.ETHEREUM], [Provider.LOCAL], [false], [],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayer2", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    const usdc2 = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
    // Fund the AMB so it can deliver tokens to the pool
    await usdc2.transfer(ethereumAmb, 10n * USDC_DEC);

    const message = AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [usdc2.target, liquidityPool.target, amount]
    );
    const signatures = AbiCoder.defaultAbiCoder().encode(["bool"], [true]);
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "bytes", "bytes"],
      [usdc2.target, message, signatures]
    );

    const tx = repayer.connect(repayUser).processRepay(
      liquidityPool, Provider.GNOSIS_OMNIBRIDGE, extraData
    );
    await expect(tx)
      .to.be.revertedWithCustomError(repayer, "InvalidToken()");
  });

  it("Should revert constructor if AMB or Omnibridge address is 0 on Ethereum", async function () {
    const {
      usdc,
      cctpTokenMessenger, cctpMessageTransmitter, acrossV3SpokePool,
      everclearFeeAdapter, weth, stargateTreasurerTrue, deployer,
      optimismBridge, baseBridge, arbitrumGatewayRouter,
    } = await loadFixture(deployAll);

    const ethereumOmnibridge = (await deploy("TestGnosisOmnibridge", deployer, {})) as TestGnosisOmnibridge;
    const ethereumAmb = (await deploy("TestGnosisAMB", deployer, {})) as TestGnosisAMB;
    const factory = await hre.ethers.getContractFactory("Repayer", deployer);

    const baseArgs = [
      usdc, cctpTokenMessenger, cctpMessageTransmitter, acrossV3SpokePool,
      everclearFeeAdapter, weth, stargateTreasurerTrue, optimismBridge, baseBridge, arbitrumGatewayRouter,
    ] as const;

    // Omnibridge is 0
    await expect(factory.deploy(
      Domain.ETHEREUM, ...baseArgs,
      ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ethereumAmb, ZERO_ADDRESS,
    )).to.be.revertedWithCustomError(factory, "ZeroAddress");

    // AMB is 0
    await expect(factory.deploy(
      Domain.ETHEREUM, ...baseArgs,
      ethereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
    )).to.be.revertedWithCustomError(factory, "ZeroAddress");
  });

  it("Should revert processRepay if AMB execution fails", async function () {
    const {
      USDC_DEC, usdc, repayUser, liquidityPool,
      cctpTokenMessenger, cctpMessageTransmitter, acrossV3SpokePool,
      everclearFeeAdapter, weth, stargateTreasurerTrue, admin, deployer,
      optimismBridge, baseBridge, arbitrumGatewayRouter, setTokensUser,
    } = await loadFixture(deployAll);

    const ethereumOmnibridge = (await deploy("TestGnosisOmnibridge", deployer, {})) as TestGnosisOmnibridge;
    const ethereumAmb = (await deploy("TestGnosisAMB", deployer, {})) as TestGnosisAMB;

    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer2", {},
        Domain.ETHEREUM,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        ethereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, ethereumAmb, ZERO_ADDRESS,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin, repayUser, setTokensUser,
      [liquidityPool], [Domain.ETHEREUM], [Provider.LOCAL], [true], [],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayer2", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    const message = AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"], [usdc.target, liquidityPool.target, 4n * USDC_DEC]
    );
    // isValid = false triggers SimulatedRevert in TestGnosisAMB
    const signatures = AbiCoder.defaultAbiCoder().encode(["bool"], [false]);
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "bytes", "bytes"], [usdc.target, message, signatures]
    );

    await expect(repayer.connect(repayUser).processRepay(
      liquidityPool, Provider.GNOSIS_OMNIBRIDGE, extraData
    )).to.be.reverted;
  });

  it("Should perform USDT0 repay with a mock OFT adapter (approval required)", async function () {
    // Adapter pattern (Ethereum): OFT calls transferFrom → forceApprove is triggered.
    const {
      usdc, admin, repayUser, liquidityPool, deployer,
      cctpTokenMessenger, cctpMessageTransmitter, acrossV3SpokePool,
      everclearFeeAdapter, weth, stargateTreasurerTrue,
      optimismBridge, baseBridge, arbitrumGatewayRouter, setTokensUser,
      sharedEthereumOmnibridge, sharedEthereumAmb,
    } = await loadFixture(deployAll);

    const testUsdt0 = (await deploy("TestUSDT0", deployer, {})) as TestUSDT0;
    const testOFT = (
      await deploy("TestUSDT0OFTAdapter", deployer, {}, testUsdt0)
    ) as TestUSDT0OFTAdapter;
    expect(await testOFT.token()).to.eq(testUsdt0.target);

    const USDT0_DEC = 10n ** (await testUsdt0.decimals());

    // Ethereum domain required so localDomain == Domain.ETHEREUM → forceApprove path.
    const repayerImpl = (
      await deployX("Repayer", deployer, "RepayerUSDT0Adapter", {},
        Domain.ETHEREUM,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        sharedEthereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, sharedEthereumAmb,
        testOFT,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin, repayUser, setTokensUser,
      [liquidityPool], [Domain.ARBITRUM_ONE], [Provider.USDT0], [true], [],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayerUSDT0Adapter", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    const amount = 4n * USDT0_DEC;
    await testUsdt0.mint(repayer.target, 10n * USDT0_DEC);

    const tx = repayer.connect(repayUser).initiateRepay(
      testUsdt0,
      amount,
      liquidityPool,
      Domain.ARBITRUM_ONE,
      Provider.USDT0,
      "0x",
      {value: 1n * ETH}
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(testUsdt0.target, amount, liquidityPool.target, Domain.ARBITRUM_ONE, Provider.USDT0);
    // Adapter locks via transferFrom: tokens move from repayer to OFT contract.
    await expect(tx)
      .to.emit(testUsdt0, "Transfer")
      .withArgs(repayer.target, testOFT.target, amount);

    await expect(tx)
      .to.emit(repayer, "USDT0Transfer")
      .withArgs(testUsdt0.target, liquidityPool.target, "30110", amount);
    await expect(tx).to.changeEtherBalance(repayUser, -(await testOFT.NATIVE_FEE()));
  });

  it("Should perform USDT0 repay with a native OFT (no approval needed, token is burned)", async function () {
    // Native OFT pattern (non-Ethereum): OFT calls token.burn() → no approval needed.
    const {
      usdc, admin, repayUser, liquidityPool, deployer,
      cctpTokenMessenger, cctpMessageTransmitter, acrossV3SpokePool,
      everclearFeeAdapter, weth, stargateTreasurerTrue,
      optimismBridge, baseBridge, arbitrumGatewayRouter, setTokensUser,
    } = await loadFixture(deployAll);

    const testUsdt0 = (await deploy("TestUSDT0", deployer, {})) as TestUSDT0;
    const testOFT = (
      await deploy("TestUSDT0OFTNative", deployer, {}, testUsdt0)
    ) as TestUSDT0OFTNative;
    expect(await testOFT.token()).to.eq(testUsdt0.target);

    const USDT0_DEC = 10n ** (await testUsdt0.decimals());

    // ARBITRUM_ONE domain → localDomain != ETHEREUM → no forceApprove, OFT calls burn().
    const repayerImpl = (
      await deployX("Repayer", deployer, "RepayerUSDT0Native", {},
        Domain.ARBITRUM_ONE,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
        testOFT,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin, repayUser, setTokensUser,
      [liquidityPool], [Domain.ETHEREUM], [Provider.USDT0], [true], [],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayerUSDT0Native", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    const amount = 4n * USDT0_DEC;
    await testUsdt0.mint(repayer.target, 10n * USDT0_DEC);

    const tx = repayer.connect(repayUser).initiateRepay(
      testUsdt0,
      amount,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.USDT0,
      "0x",
      {value: 1n * ETH}
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(testUsdt0.target, amount, liquidityPool.target, Domain.ETHEREUM, Provider.USDT0);
    // Native OFT burns via token.burn(): Transfer to zero address, no Transfer to OFT.
    await expect(tx)
      .to.emit(testUsdt0, "Transfer")
      .withArgs(repayer.target, hre.ethers.ZeroAddress, amount);

    await expect(tx)
      .to.emit(repayer, "USDT0Transfer")
      .withArgs(testUsdt0.target, liquidityPool.target, "30101", amount);
    await expect(tx).to.changeEtherBalance(repayUser, -(await testOFT.NATIVE_FEE()));
  });

  it("Should revert USDT0 repay if token doesn't match OFT.token()", async function () {
    const {
      usdc, admin, repayUser, liquidityPool, deployer,
      cctpTokenMessenger, cctpMessageTransmitter, acrossV3SpokePool,
      everclearFeeAdapter, weth, stargateTreasurerTrue,
      optimismBridge, baseBridge, arbitrumGatewayRouter, setTokensUser,
      eurc, eurcOwner, EURC_DEC,
    } = await loadFixture(deployAll);

    const testUsdt0 = (await deploy("TestUSDT0", deployer, {})) as TestUSDT0;
    const testOFT = (
      await deploy("TestUSDT0OFTAdapter", deployer, {}, testUsdt0)
    ) as TestUSDT0OFTAdapter;

    const repayerImpl = (
      await deployX("Repayer", deployer, "RepayerUSDT0TokenMismatch", {},
        Domain.BASE,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
        testOFT,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin, repayUser, setTokensUser,
      [liquidityPool], [Domain.ETHEREUM], [Provider.USDT0], [true], [],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayerUSDT0TokenMismatch", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    await eurc.connect(eurcOwner).transfer(repayer, 10n * EURC_DEC);

    await expect(repayer.connect(repayUser).initiateRepay(
      eurc,
      4n * EURC_DEC,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.USDT0,
      "0x",
      {value: 1n * ETH}
    )).to.be.revertedWithCustomError(repayer, "InvalidToken");
  });

  it("Should revert USDT0 repay if OFT address is zero", async function () {
    const {
      USDC_DEC, usdc, admin, repayUser, liquidityPool, deployer,
      cctpTokenMessenger, cctpMessageTransmitter, acrossV3SpokePool,
      everclearFeeAdapter, weth, stargateTreasurerTrue,
      optimismBridge, baseBridge, arbitrumGatewayRouter, setTokensUser,
    } = await loadFixture(deployAll);

    // The default deployAll fixture uses ZERO_ADDRESS for usdt0Oft
    // Redeploy a new repayer with ZERO_ADDRESS for usdt0Oft explicitly
    const repayerImpl = (
      await deployX("Repayer", deployer, "RepayerUSDT0Zero", {},
        Domain.BASE,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossV3SpokePool,
        everclearFeeAdapter,
        weth,
        stargateTreasurerTrue,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter,
        ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin, repayUser, setTokensUser,
      [liquidityPool], [Domain.ETHEREUM], [Provider.USDT0], [true], [],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayerUSDT0Zero", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

    await usdc.transfer(repayer, 10n * USDC_DEC);

    await expect(repayer.connect(repayUser).initiateRepay(
      usdc,
      4n * USDC_DEC,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.USDT0,
      "0x",
      {value: 1n * ETH}
    )).to.be.revertedWithCustomError(repayer, "ZeroAddress");
  });

  describe("Repayer on BSC domain", function () {
    // BSC tokens have 18 decimals; destination chains (e.g. Ethereum) use 6 (USDC/USDT) or 8 (WBTC).
    // AdapterHelper._destAmountToLocal scales destination output amounts back to BSC 18-decimal units:
    //   USDC_BSC / USDT_BSC:  destAmount * 10^12
    //   WBTC_BSC:             destAmount * 10^10
    // Slippage check: _destAmountToLocal(outputAmount, token, Domain.BSC) >= amount * 9980 / 10000
    const USDC_BSC_ADDRESS = networkConfig.BSC.Tokens.USDC.Address;
    const USDT_BSC_ADDRESS = networkConfig.BSC.Tokens.USDT!.Address;
    const WBTC_BSC_ADDRESS = networkConfig.BSC.Tokens.WBTC!.Address;
    const WETH_BSC_ADDRESS = networkConfig.BSC.Tokens.WETH!.Address;
    const USDC_ETHEREUM_ADDRESS = networkConfig.ETHEREUM.Tokens.USDC.Address;
    const USDT_ETHEREUM_ADDRESS = networkConfig.ETHEREUM.Tokens.USDT!.Address;
    const WBTC_ETHEREUM_ADDRESS = networkConfig.ETHEREUM.Tokens.WBTC!.Address;
    const WETH_ETHEREUM_ADDRESS = networkConfig.ETHEREUM.Tokens.WETH!.Address;
    const HIGH_DEC_TOKEN_ADDRESS = networkConfig.ETHEREUM.Tokens.DAI!.Address;
    const BSC_DEC = 10n ** 18n;
    const HIGH_DEC = 10n ** 27n;

    // amount = 4 * 10^18; threshold = amount * 9980 / 10000 = 3_992_000_000_000_000_000
    // USDC/USDT: outputAmount (6-decimal) must satisfy outputAmount * 10^12 >= threshold
    //   → outputAmount >= 3_992_000; revert at 3_991_999
    // WBTC: outputAmount (8-decimal) must satisfy outputAmount * 10^10 >= threshold
    //   → outputAmount >= 399_200_000; revert at 399_199_999
    const AMOUNT = 4n * BSC_DEC;
    const USDC_USDT_REVERT_OUTPUT = 3_991_999n;
    const USDC_USDT_PASS_OUTPUT = 3_992_000n;
    const WBTC_REVERT_OUTPUT = 399_199_999n;
    const WBTC_PASS_OUTPUT = 399_200_000n;
    const WETH_REVERT_OUTPUT = 4n * BSC_DEC * 998n / 1000n - 1n;
    const WETH_PASS_OUTPUT = WETH_REVERT_OUTPUT + 1n;
    const HIGH_DEC_REVERT_OUTPUT = 4n * HIGH_DEC * 998n / 1000n - 1n;
    const HIGH_DEC_PASS_OUTPUT = HIGH_DEC_REVERT_OUTPUT + 1n;

    const deployBSC = async () => {
      const {
        deployer, admin, repayUser, user, setTokensUser,
        acrossV3SpokePool, everclearFeeAdapter,
        stargateTreasurerTrue, cctpTokenMessenger, cctpMessageTransmitter,
        liquidityPool,
      } = await loadFixture(deployAll);

      // Place TestUSDC runtime bytecode at each hardcoded BSC address so
      // AdapterHelper address comparisons trigger the 18-decimal conversion path.
      const testUsdcTemplate = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
      const erc20Code = await hre.ethers.provider.getCode(testUsdcTemplate);
      await setCode(USDC_BSC_ADDRESS, erc20Code);
      await setCode(USDT_BSC_ADDRESS, erc20Code);
      await setCode(WBTC_BSC_ADDRESS, erc20Code);
      await setCode(WETH_BSC_ADDRESS, erc20Code);
      await setCode(HIGH_DEC_TOKEN_ADDRESS, erc20Code);

      const usdcBsc = await hre.ethers.getContractAt("TestUSDC", USDC_BSC_ADDRESS);
      const usdtBsc = await hre.ethers.getContractAt("TestUSDC", USDT_BSC_ADDRESS);
      const wbtcBsc = await hre.ethers.getContractAt("TestUSDC", WBTC_BSC_ADDRESS);
      const wethBsc = await hre.ethers.getContractAt("TestUSDC", WETH_BSC_ADDRESS);
      const highDecToken = await hre.ethers.getContractAt("TestUSDC", HIGH_DEC_TOKEN_ADDRESS);

      const repayerImpl = (
        await deployX("Repayer", deployer, "RepayerBSC", {},
          Domain.BSC,
          usdcBsc,
          cctpTokenMessenger,
          cctpMessageTransmitter,
          acrossV3SpokePool,
          everclearFeeAdapter,
          ZERO_ADDRESS,
          stargateTreasurerTrue,
          ZERO_ADDRESS,
          ZERO_ADDRESS,
          ZERO_ADDRESS,
          ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
        )
      ) as Repayer;
      const repayerInit = (await repayerImpl.initialize.populateTransaction(
        admin, repayUser, setTokensUser,
        [liquidityPool, liquidityPool],
        [Domain.ETHEREUM, Domain.ETHEREUM],
        [Provider.ACROSS, Provider.EVERCLEAR],
        [true, true],
        [
          {
            inputToken: usdcBsc,
            destinationTokens: [
              destinationToken(Domain.ETHEREUM, addressToBytes32(USDC_ETHEREUM_ADDRESS), 12n)
            ]
          },
          {
            inputToken: usdtBsc,
            destinationTokens: [
              destinationToken(Domain.ETHEREUM, addressToBytes32(USDT_ETHEREUM_ADDRESS), 12n)
            ]
          },
          {
            inputToken: wbtcBsc,
            destinationTokens: [
              destinationToken(Domain.ETHEREUM, addressToBytes32(WBTC_ETHEREUM_ADDRESS), 10n)
            ]
          },
          {
            inputToken: wethBsc,
            destinationTokens: [
              destinationToken(Domain.ETHEREUM, addressToBytes32(WETH_ETHEREUM_ADDRESS), 0n)
            ]
          },
          {
            inputToken: highDecToken,
            destinationTokens: [
              destinationToken(Domain.ETHEREUM, addressToBytes32(HIGH_DEC_TOKEN_ADDRESS), -9n)
            ]
          },
        ],
      )).data;
      const repayerProxy = (await deployX(
        "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayerBSC", {},
        repayerImpl, admin, repayerInit
      )) as TransparentUpgradeableProxy;
      const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

      await usdcBsc.mint(repayer, 10n * BSC_DEC);
      await usdtBsc.mint(repayer, 10n * BSC_DEC);
      await wbtcBsc.mint(repayer, 10n * BSC_DEC);
      await wethBsc.mint(repayer, 10n * BSC_DEC);
      await highDecToken.mint(repayer, 10n * BSC_DEC);

      return {
        deployer, admin, repayUser, user, setTokensUser,
        liquidityPool, repayer, acrossV3SpokePool,
        usdcBsc, usdtBsc, wbtcBsc, wethBsc, highDecToken,
      };
    };

    it("Should revert Everclear repay on BSC with USDC output amount too small after conversion",
      async function () {
        const {repayer, repayUser, liquidityPool, usdcBsc} = await loadFixture(deployBSC);
        const extraData = AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "uint256", "uint48", "tuple(uint256, uint256, bytes)"],
          [addressToBytes32(USDC_ETHEREUM_ADDRESS), USDC_USDT_REVERT_OUTPUT, 0, [0, 0, "0x"]]
        );
        await expect(repayer.connect(repayUser).initiateRepay(
          usdcBsc, AMOUNT, liquidityPool, Domain.ETHEREUM, Provider.EVERCLEAR, extraData
        )).to.be.revertedWithCustomError(repayer, "SlippageTooHigh");
      }
    );

    it("Should revert Everclear repay on BSC with USDT output amount too small after conversion",
      async function () {
        const {repayer, repayUser, liquidityPool, usdtBsc} = await loadFixture(deployBSC);
        const extraData = AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "uint256", "uint48", "tuple(uint256, uint256, bytes)"],
          [addressToBytes32(USDT_ETHEREUM_ADDRESS), USDC_USDT_REVERT_OUTPUT, 0, [0, 0, "0x"]]
        );
        await expect(repayer.connect(repayUser).initiateRepay(
          usdtBsc, AMOUNT, liquidityPool, Domain.ETHEREUM, Provider.EVERCLEAR, extraData
        )).to.be.revertedWithCustomError(repayer, "SlippageTooHigh");
      }
    );

    it("Should revert Everclear repay on BSC with WBTC output amount too small after conversion",
      async function () {
        const {repayer, repayUser, liquidityPool, wbtcBsc} = await loadFixture(deployBSC);
        const extraData = AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "uint256", "uint48", "tuple(uint256, uint256, bytes)"],
          [addressToBytes32(WBTC_ETHEREUM_ADDRESS), WBTC_REVERT_OUTPUT, 0, [0, 0, "0x"]]
        );
        await expect(repayer.connect(repayUser).initiateRepay(
          wbtcBsc, AMOUNT, liquidityPool, Domain.ETHEREUM, Provider.EVERCLEAR, extraData
        )).to.be.revertedWithCustomError(repayer, "SlippageTooHigh");
      }
    );

    it("Should revert Everclear repay on BSC with WETH output amount too small without conversion",
      async function () {
        const {repayer, repayUser, liquidityPool, wethBsc} = await loadFixture(deployBSC);
        const extraData = AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "uint256", "uint48", "tuple(uint256, uint256, bytes)"],
          [addressToBytes32(WETH_ETHEREUM_ADDRESS), WETH_REVERT_OUTPUT, 0, [0, 0, "0x"]]
        );
        await expect(repayer.connect(repayUser).initiateRepay(
          wethBsc, AMOUNT, liquidityPool, Domain.ETHEREUM, Provider.EVERCLEAR, extraData
        )).to.be.revertedWithCustomError(repayer, "SlippageTooHigh");
      }
    );

    it("Should revert Everclear repay on BSC with HIGH_DEC output amount too small after conversion",
      async function () {
        const {repayer, repayUser, liquidityPool, highDecToken} = await loadFixture(deployBSC);
        const extraData = AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "uint256", "uint48", "tuple(uint256, uint256, bytes)"],
          [addressToBytes32(HIGH_DEC_TOKEN_ADDRESS), HIGH_DEC_REVERT_OUTPUT, 0, [0, 0, "0x"]]
        );
        await expect(repayer.connect(repayUser).initiateRepay(
          highDecToken, AMOUNT, liquidityPool, Domain.ETHEREUM, Provider.EVERCLEAR, extraData
        )).to.be.revertedWithCustomError(repayer, "SlippageTooHigh");
      }
    );

    it("Should revert Across repay on BSC with USDC output amount too small after conversion",
      async function () {
        const {repayer, repayUser, liquidityPool, usdcBsc} = await loadFixture(deployBSC);
        const extraData = AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "address", "uint32", "uint32", "uint32"],
          [USDC_ETHEREUM_ADDRESS, USDC_USDT_REVERT_OUTPUT, ZERO_ADDRESS, 1n, 2n, 3n]
        );
        await expect(repayer.connect(repayUser).initiateRepay(
          usdcBsc, AMOUNT, liquidityPool, Domain.ETHEREUM, Provider.ACROSS, extraData
        )).to.be.revertedWithCustomError(repayer, "SlippageTooHigh");
      }
    );

    it("Should revert Across repay on BSC with USDT output amount too small after conversion",
      async function () {
        const {repayer, repayUser, liquidityPool, usdtBsc} = await loadFixture(deployBSC);
        const extraData = AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "address", "uint32", "uint32", "uint32"],
          [USDT_ETHEREUM_ADDRESS, USDC_USDT_REVERT_OUTPUT, ZERO_ADDRESS, 1n, 2n, 3n]
        );
        await expect(repayer.connect(repayUser).initiateRepay(
          usdtBsc, AMOUNT, liquidityPool, Domain.ETHEREUM, Provider.ACROSS, extraData
        )).to.be.revertedWithCustomError(repayer, "SlippageTooHigh");
      }
    );

    it("Should revert Across repay on BSC with WBTC output amount too small after conversion",
      async function () {
        const {repayer, repayUser, liquidityPool, wbtcBsc} = await loadFixture(deployBSC);
        const extraData = AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "address", "uint32", "uint32", "uint32"],
          [WBTC_ETHEREUM_ADDRESS, WBTC_REVERT_OUTPUT, ZERO_ADDRESS, 1n, 2n, 3n]
        );
        await expect(repayer.connect(repayUser).initiateRepay(
          wbtcBsc, AMOUNT, liquidityPool, Domain.ETHEREUM, Provider.ACROSS, extraData
        )).to.be.revertedWithCustomError(repayer, "SlippageTooHigh");
      }
    );

    it("Should revert Across repay on BSC with WETH output amount too small without conversion",
      async function () {
        const {repayer, repayUser, liquidityPool, wethBsc} = await loadFixture(deployBSC);
        const extraData = AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "address", "uint32", "uint32", "uint32"],
          [WETH_ETHEREUM_ADDRESS, WETH_REVERT_OUTPUT, ZERO_ADDRESS, 1n, 2n, 3n]
        );
        await expect(repayer.connect(repayUser).initiateRepay(
          wethBsc, AMOUNT, liquidityPool, Domain.ETHEREUM, Provider.ACROSS, extraData
        )).to.be.revertedWithCustomError(repayer, "SlippageTooHigh");
      }
    );

    it("Should revert Across repay on BSC with HIGH_DEC output amount too small after conversion",
      async function () {
        const {repayer, repayUser, liquidityPool, highDecToken} = await loadFixture(deployBSC);
        const extraData = AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "address", "uint32", "uint32", "uint32"],
          [HIGH_DEC_TOKEN_ADDRESS, HIGH_DEC_REVERT_OUTPUT, ZERO_ADDRESS, 1n, 2n, 3n]
        );
        await expect(repayer.connect(repayUser).initiateRepay(
          highDecToken, AMOUNT, liquidityPool, Domain.ETHEREUM, Provider.ACROSS, extraData
        )).to.be.revertedWithCustomError(repayer, "SlippageTooHigh");
      }
    );

    it("Should allow Across repay on BSC with USDC output amount sufficient after conversion",
      async function () {
        const {repayer, repayUser, liquidityPool, acrossV3SpokePool, usdcBsc, user} =
          await loadFixture(deployBSC);
        const extraData = AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "address", "uint32", "uint32", "uint32"],
          [USDC_ETHEREUM_ADDRESS, USDC_USDT_PASS_OUTPUT, user.address, 1n, 2n, 3n]
        );
        const tx = repayer.connect(repayUser).initiateRepay(
          usdcBsc, AMOUNT, liquidityPool, Domain.ETHEREUM, Provider.ACROSS, extraData
        );
        await expect(tx)
          .to.emit(repayer, "InitiateRepay")
          .withArgs(usdcBsc.target, AMOUNT, liquidityPool.target, Domain.ETHEREUM, Provider.ACROSS);
        await expect(tx)
          .to.emit(usdcBsc, "Transfer")
          .withArgs(repayer.target, acrossV3SpokePool.target, AMOUNT);
        await expect(tx)
          .to.emit(acrossV3SpokePool, "FundsDeposited")
          .withArgs(
            addressToBytes32(USDC_BSC_ADDRESS),
            addressToBytes32(USDC_ETHEREUM_ADDRESS),
            AMOUNT,
            USDC_USDT_PASS_OUTPUT,
            1n,
            1337n,
            1n,
            2n,
            3n,
            addressToBytes32(repayer.target),
            addressToBytes32(liquidityPool.target),
            addressToBytes32(user.address),
            "0x"
          );
      }
    );

    it("Should allow Across repay on BSC with USDT output amount sufficient after conversion",
      async function () {
        const {repayer, repayUser, liquidityPool, acrossV3SpokePool, usdtBsc, user} =
          await loadFixture(deployBSC);
        const extraData = AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "address", "uint32", "uint32", "uint32"],
          [USDT_ETHEREUM_ADDRESS, USDC_USDT_PASS_OUTPUT, user.address, 1n, 2n, 3n]
        );
        const tx = repayer.connect(repayUser).initiateRepay(
          usdtBsc, AMOUNT, liquidityPool, Domain.ETHEREUM, Provider.ACROSS, extraData
        );
        await expect(tx)
          .to.emit(repayer, "InitiateRepay")
          .withArgs(usdtBsc.target, AMOUNT, liquidityPool.target, Domain.ETHEREUM, Provider.ACROSS);
        await expect(tx)
          .to.emit(usdtBsc, "Transfer")
          .withArgs(repayer.target, acrossV3SpokePool.target, AMOUNT);
        await expect(tx)
          .to.emit(acrossV3SpokePool, "FundsDeposited")
          .withArgs(
            addressToBytes32(USDT_BSC_ADDRESS),
            addressToBytes32(USDT_ETHEREUM_ADDRESS),
            AMOUNT,
            USDC_USDT_PASS_OUTPUT,
            1n,
            1337n,
            1n,
            2n,
            3n,
            addressToBytes32(repayer.target),
            addressToBytes32(liquidityPool.target),
            addressToBytes32(user.address),
            "0x"
          );
      }
    );

    it("Should allow Across repay on BSC with WBTC output amount sufficient after conversion",
      async function () {
        const {repayer, repayUser, liquidityPool, acrossV3SpokePool, wbtcBsc, user} =
          await loadFixture(deployBSC);
        const extraData = AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "address", "uint32", "uint32", "uint32"],
          [WBTC_ETHEREUM_ADDRESS, WBTC_PASS_OUTPUT, user.address, 1n, 2n, 3n]
        );
        const tx = repayer.connect(repayUser).initiateRepay(
          wbtcBsc, AMOUNT, liquidityPool, Domain.ETHEREUM, Provider.ACROSS, extraData
        );
        await expect(tx)
          .to.emit(repayer, "InitiateRepay")
          .withArgs(wbtcBsc.target, AMOUNT, liquidityPool.target, Domain.ETHEREUM, Provider.ACROSS);
        await expect(tx)
          .to.emit(wbtcBsc, "Transfer")
          .withArgs(repayer.target, acrossV3SpokePool.target, AMOUNT);
        await expect(tx)
          .to.emit(acrossV3SpokePool, "FundsDeposited")
          .withArgs(
            addressToBytes32(WBTC_BSC_ADDRESS),
            addressToBytes32(WBTC_ETHEREUM_ADDRESS),
            AMOUNT,
            WBTC_PASS_OUTPUT,
            1n,
            1337n,
            1n,
            2n,
            3n,
            addressToBytes32(repayer.target),
            addressToBytes32(liquidityPool.target),
            addressToBytes32(user.address),
            "0x"
          );
      }
    );

    it("Should allow Across repay on BSC with WETH output amount sufficient without conversion",
      async function () {
        const {repayer, repayUser, liquidityPool, acrossV3SpokePool, wethBsc, user} =
          await loadFixture(deployBSC);
        const extraData = AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "address", "uint32", "uint32", "uint32"],
          [WETH_ETHEREUM_ADDRESS, WETH_PASS_OUTPUT, user.address, 1n, 2n, 3n]
        );
        const tx = repayer.connect(repayUser).initiateRepay(
          wethBsc, AMOUNT, liquidityPool, Domain.ETHEREUM, Provider.ACROSS, extraData
        );
        await expect(tx)
          .to.emit(repayer, "InitiateRepay")
          .withArgs(wethBsc.target, AMOUNT, liquidityPool.target, Domain.ETHEREUM, Provider.ACROSS);
        await expect(tx)
          .to.emit(wethBsc, "Transfer")
          .withArgs(repayer.target, acrossV3SpokePool.target, AMOUNT);
        await expect(tx)
          .to.emit(acrossV3SpokePool, "FundsDeposited")
          .withArgs(
            addressToBytes32(WETH_BSC_ADDRESS),
            addressToBytes32(WETH_ETHEREUM_ADDRESS),
            AMOUNT,
            WETH_PASS_OUTPUT,
            1n,
            1337n,
            1n,
            2n,
            3n,
            addressToBytes32(repayer.target),
            addressToBytes32(liquidityPool.target),
            addressToBytes32(user.address),
            "0x"
          );
      }
    );

    it("Should allow Across repay on BSC with HIGH_DEC output amount sufficient after conversion",
      async function () {
        const {repayer, repayUser, liquidityPool, acrossV3SpokePool, highDecToken, user} =
          await loadFixture(deployBSC);
        const extraData = AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "address", "uint32", "uint32", "uint32"],
          [HIGH_DEC_TOKEN_ADDRESS, HIGH_DEC_PASS_OUTPUT, user.address, 1n, 2n, 3n]
        );
        const tx = repayer.connect(repayUser).initiateRepay(
          highDecToken, AMOUNT, liquidityPool, Domain.ETHEREUM, Provider.ACROSS, extraData
        );
        await expect(tx)
          .to.emit(repayer, "InitiateRepay")
          .withArgs(highDecToken.target, AMOUNT, liquidityPool.target, Domain.ETHEREUM, Provider.ACROSS);
        await expect(tx)
          .to.emit(highDecToken, "Transfer")
          .withArgs(repayer.target, acrossV3SpokePool.target, AMOUNT);
        await expect(tx)
          .to.emit(acrossV3SpokePool, "FundsDeposited")
          .withArgs(
            addressToBytes32(HIGH_DEC_TOKEN_ADDRESS),
            addressToBytes32(HIGH_DEC_TOKEN_ADDRESS),
            AMOUNT,
            HIGH_DEC_PASS_OUTPUT,
            1n,
            1337n,
            1n,
            2n,
            3n,
            addressToBytes32(repayer.target),
            addressToBytes32(liquidityPool.target),
            addressToBytes32(user.address),
            "0x"
          );
      }
    );
  });
});
