import {
  loadFixture, setBalance, setCode
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {
  getCreateAddress, getContractAt, deploy, deployX,
} from "../../test/helpers";
import {
  ProviderSolidity as Provider, DomainSolidity as Domain,
  DEFAULT_ADMIN_ROLE, assertAddress, ZERO_ADDRESS,
} from "../../scripts/common";
import {
  TransparentUpgradeableProxy, ProxyAdmin,
  TestLiquidityPool, Repayer,
} from "../../typechain-types";
import {networkConfig} from "../../network.config";

describe("Repayer WBTC OFT (Ethereum fork)", function () {
  const deployAll = async () => {
    const [deployer, admin, repayUser, setTokensUser] = await hre.ethers.getSigners();
    await setCode(repayUser.address, "0x00");

    const forkNetworkConfig = networkConfig.ETHEREUM;

    const REPAYER_ROLE = hre.ethers.encodeBytes32String("REPAYER_ROLE");
    const DEPOSIT_PROFIT_ROLE = hre.ethers.encodeBytes32String("DEPOSIT_PROFIT_ROLE");

    assertAddress(forkNetworkConfig.Tokens.WBTC?.Address, "WBTC address is missing from ETHEREUM config");
    assertAddress(forkNetworkConfig.WBTCOFT, "WBTCOFT address is missing from ETHEREUM config");
    assertAddress(forkNetworkConfig.Omnibridge, "ETHEREUM Omnibridge address is missing");
    assertAddress(forkNetworkConfig.GnosisAMB, "ETHEREUM GnosisAMB address is missing");

    const usdc = await hre.ethers.getContractAt("ERC20", forkNetworkConfig.Tokens.USDC.Address);
    const wbtc = await hre.ethers.getContractAt("ERC20", forkNetworkConfig.Tokens.WBTC.Address);
    const weth = await hre.ethers.getContractAt("IWrappedNativeToken", forkNetworkConfig.WrappedNativeToken);

    const wbtcOft = await hre.ethers.getContractAt("IOFT", forkNetworkConfig.WBTCOFT!);
    expect(await wbtcOft.token()).to.equal(forkNetworkConfig.Tokens.WBTC.Address);

    const liquidityPool = (await deploy(
      "TestLiquidityPool",
      deployer,
      {},
      usdc,
      deployer,
      forkNetworkConfig.WrappedNativeToken
    )) as TestLiquidityPool;

    const WBTC_DEC = 10n ** (await wbtc.decimals());

    const repayerImpl = (
      await deployX("Repayer", deployer, "RepayerEthereumWBTCOFT", {},
        Domain.ETHEREUM,
        usdc,
        forkNetworkConfig.CCTP!.TokenMessenger!,
        forkNetworkConfig.CCTP!.MessageTransmitter!,
        forkNetworkConfig.AcrossV3SpokePool!,
        forkNetworkConfig.EverclearFeeAdapter!,
        weth,
        forkNetworkConfig.StargateTreasurer!,
        forkNetworkConfig.OptimismStandardBridge!,
        forkNetworkConfig.BaseStandardBridge!,
        forkNetworkConfig.ArbitrumGatewayRouter!,
        forkNetworkConfig.Omnibridge,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        forkNetworkConfig.GnosisAMB,
        forkNetworkConfig.USDT0OFT!, ZERO_ADDRESS, ZERO_ADDRESS,
        forkNetworkConfig.WBTCOFT!,
      )
    ) as Repayer;

    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin,
      repayUser,
      setTokensUser,
      [liquidityPool],
      [Domain.BASE],
      [Provider.WBTC_OFT],
      [true],
      [],
    )).data;

    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyEthereumWBTCOFT", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;
    const repayerProxyAdminAddress = await getCreateAddress(repayerProxy, 1);
    const repayerAdmin = (await getContractAt("ProxyAdmin", repayerProxyAdminAddress, admin)) as ProxyAdmin;

    await liquidityPool.grantRole(DEPOSIT_PROFIT_ROLE, repayer);

    return {
      deployer, admin, repayUser, usdc, wbtc, setTokensUser, weth,
      WBTC_DEC, liquidityPool, repayer, repayerProxy, repayerAdmin,
      REPAYER_ROLE, DEFAULT_ADMIN_ROLE, forkNetworkConfig,
    };
  };

  it("Should allow repayer to bridge WBTC from Ethereum to Base via WBTC OFT on fork", async function () {
    const {repayer, WBTC_DEC, wbtc, repayUser, liquidityPool, forkNetworkConfig} = await loadFixture(deployAll);

    assertAddress(
      process.env.WBTC_OWNER_ETH_ADDRESS,
      "Env variables not configured (WBTC_OWNER_ETH_ADDRESS missing)"
    );
    const wbtcOwner = await hre.ethers.getImpersonatedSigner(process.env.WBTC_OWNER_ETH_ADDRESS!);
    await setBalance(process.env.WBTC_OWNER_ETH_ADDRESS!, 10n ** 18n);

    const amount = 4n * WBTC_DEC;
    await wbtc.connect(wbtcOwner).transfer(repayer, 10n * WBTC_DEC);

    const wbtcOftAddress = forkNetworkConfig.WBTCOFT!;
    const wbtcBalanceBefore = await wbtc.balanceOf(repayer);

    const tx = repayer.connect(repayUser).initiateRepay(
      wbtc,
      amount,
      liquidityPool,
      Domain.BASE,
      Provider.WBTC_OFT,
      "0x",
      {value: hre.ethers.parseEther("0.1")}
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(wbtc.target, amount, liquidityPool.target, Domain.BASE, Provider.WBTC_OFT);
    // OFTAdapter on Ethereum locks WBTC via transferFrom: WBTC moves from repayer to the OFT.
    await expect(tx)
      .to.emit(wbtc, "Transfer")
      .withArgs(repayer.target, wbtcOftAddress, amount);

    await expect(tx)
      .to.emit(repayer, "WBTCOFTTransfer")
      .withArgs(wbtc.target, liquidityPool.target, "30184", amount);

    expect(await wbtc.balanceOf(repayer)).to.equal(wbtcBalanceBefore - amount);
  });
});
