import {
  loadFixture, setBalance, setCode,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {AbiCoder} from "ethers";
import {
  getCreateAddress, getContractAt, deploy, deployX,
} from "../../test/helpers";
import {
  ProviderSolidity as Provider, DomainSolidity as Domain,
  DEFAULT_ADMIN_ROLE, assertAddress, ZERO_ADDRESS, ETH,
  addressToBytes32,
} from "../../scripts/common";
import {
  TransparentUpgradeableProxy, ProxyAdmin,
  TestLiquidityPool, Repayer,
} from "../../typechain-types";
import {prodNetworkConfig as networkConfig} from "../../network.config";
import {mineIfNeeded} from "../../scripts/helpers";

// Only the burn half of the Polygon -> Ethereum leg is exercised here. The matching exit()
// on Ethereum needs a real, checkpointed, not-yet-exited burn payload, which cannot be
// reproduced on a fork, so it is covered by the mock unit tests in test/Repayer.ts instead.
describe("Repayer Polygon PoS Bridge (Polygon fork)", function () {
  const deployAll = async () => {
    await mineIfNeeded();
    const [deployer, admin, repayUser, setTokensUser] = await hre.ethers.getSigners();
    await setCode(repayUser.address, "0x00");

    const forkNetworkConfig = networkConfig.POLYGON_MAINNET;

    const REPAYER_ROLE = hre.ethers.encodeBytes32String("REPAYER_ROLE");
    const DEPOSIT_PROFIT_ROLE = hre.ethers.encodeBytes32String("DEPOSIT_PROFIT_ROLE");

    assertAddress(forkNetworkConfig.Tokens.DAI?.Address, "DAI address is missing from POLYGON_MAINNET config");

    const usdc = await hre.ethers.getContractAt("ERC20", forkNetworkConfig.Tokens.USDC.Address);
    // Polygon DAI is the PoS child of Ethereum DAI, so it exposes withdraw().
    const dai = await hre.ethers.getContractAt("ERC20", forkNetworkConfig.Tokens.DAI.Address);
    const weth = await hre.ethers.getContractAt("IWrappedNativeToken", forkNetworkConfig.WrappedNativeToken);

    const liquidityPool = (await deploy(
      "TestLiquidityPool",
      deployer,
      {},
      usdc,
      deployer,
      forkNetworkConfig.WrappedNativeToken
    )) as TestLiquidityPool;

    const repayerImpl = (
      await deployX("Repayer", deployer, "RepayerPolygonPos", {},
        Domain.POLYGON_MAINNET,
        usdc,
        forkNetworkConfig.AcrossV3SpokePool!,
        weth,
        forkNetworkConfig.StargateTreasurer!,
        ZERO_ADDRESS, // optimismBridge
        ZERO_ADDRESS, // baseBridge
        ZERO_ADDRESS, // arbitrumGatewayRouter
        ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, // gnosis
        ZERO_ADDRESS, ZERO_ADDRESS, // usdt0
        ZERO_ADDRESS, ZERO_ADDRESS, // cctpV2
        // Polygon has no RootChainManager; the burn leg only calls withdraw() on the child token.
        ZERO_ADDRESS,
      )
    ) as Repayer;

    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin,
      repayUser,
      setTokensUser,
      // The second route is only here so the "destination pool is not the Repayer" test reaches
      // the adapter's own guard instead of failing the route check first. Production configs do
      // not need it: the burn leg always targets the Repayer, which is allowed unconditionally.
      [liquidityPool, liquidityPool],
      [Domain.POLYGON_MAINNET, Domain.ETHEREUM],
      [Provider.LOCAL, Provider.POLYGON_POS_BRIDGE],
      [ZERO_ADDRESS, ZERO_ADDRESS],
      [{
        inputToken: dai.target,
        destinationTokens: [{
          destinationDomain: Domain.ETHEREUM,
          outputToken: addressToBytes32(networkConfig.ETHEREUM.Tokens.DAI!.Address),
          localDecimalsGreaterBy: 0n,
        }],
      }],
    )).data;

    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayerPolygonPos", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;
    const repayerProxyAdminAddress = await getCreateAddress(repayerProxy, 1);
    const repayerAdmin = (await getContractAt("ProxyAdmin", repayerProxyAdminAddress, admin)) as ProxyAdmin;

    await liquidityPool.grantRole(DEPOSIT_PROFIT_ROLE, repayer);

    return {
      deployer, admin, repayUser, setTokensUser, usdc, dai, weth,
      liquidityPool, repayer, repayerProxy, repayerAdmin,
      REPAYER_ROLE, DEFAULT_ADMIN_ROLE, forkNetworkConfig,
    };
  };

  it("Should allow repayer to burn DAI for a Polygon PoS exit to Ethereum on fork", async function () {
    const {repayer, dai, repayUser} = await loadFixture(deployAll);

    assertAddress(
      process.env.DAI_OWNER_POLYGON_ADDRESS,
      "Env variables not configured (DAI_OWNER_POLYGON_ADDRESS missing)"
    );
    const daiOwner = await hre.ethers.getImpersonatedSigner(process.env.DAI_OWNER_POLYGON_ADDRESS!);
    await setBalance(process.env.DAI_OWNER_POLYGON_ADDRESS!, 1000n * 10n ** 18n);

    const amount = 4n * ETH;
    await dai.connect(daiOwner).transfer(repayer, 10n * ETH);
    const totalSupplyBefore = await dai.totalSupply();

    const outputToken = networkConfig.ETHEREUM.Tokens.DAI!.Address;
    const extraData = AbiCoder.defaultAbiCoder().encode(["address"], [outputToken]);

    // The PoS exit on Ethereum credits whoever burned on Polygon, so the Repayer bridges to
    // itself and forwards the funds through processRepay() on the other side.
    const tx = repayer.connect(repayUser).initiateRepay(
      dai, amount, repayer, Domain.ETHEREUM, Provider.POLYGON_POS_BRIDGE, extraData
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(dai.target, amount, repayer.target, Domain.ETHEREUM, Provider.POLYGON_POS_BRIDGE);
    await expect(tx)
      .to.emit(repayer, "PolygonPosWithdrawInitiated")
      .withArgs(dai.target, amount);
    // The burn event is what the exit proof on Ethereum is built from.
    await expect(tx)
      .to.emit(dai, "Transfer")
      .withArgs(repayer.target, ZERO_ADDRESS, amount);

    expect(await dai.balanceOf(repayer)).to.equal(6n * ETH);
    expect(await dai.totalSupply()).to.equal(totalSupplyBefore - amount);
  });

  it("Should revert Polygon PoS burn on fork if destination pool is not the Repayer", async function () {
    const {repayer, dai, repayUser, liquidityPool} = await loadFixture(deployAll);

    assertAddress(
      process.env.DAI_OWNER_POLYGON_ADDRESS,
      "Env variables not configured (DAI_OWNER_POLYGON_ADDRESS missing)"
    );
    const daiOwner = await hre.ethers.getImpersonatedSigner(process.env.DAI_OWNER_POLYGON_ADDRESS!);
    await setBalance(process.env.DAI_OWNER_POLYGON_ADDRESS!, 1000n * 10n ** 18n);

    await dai.connect(daiOwner).transfer(repayer, 10n * ETH);

    const outputToken = networkConfig.ETHEREUM.Tokens.DAI!.Address;
    const extraData = AbiCoder.defaultAbiCoder().encode(["address"], [outputToken]);

    await expect(repayer.connect(repayUser).initiateRepay(
      dai, 4n * ETH, liquidityPool, Domain.ETHEREUM, Provider.POLYGON_POS_BRIDGE, extraData
    )).to.be.revertedWithCustomError(repayer, "InvalidDestinationPool()");
  });
});
