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

describe("Repayer Gnosis Omnibridge (Ethereum fork)", function () {
  const deployAll = async () => {
    const [deployer, admin, repayUser, setTokensUser] = await hre.ethers.getSigners();
    await setCode(repayUser.address, "0x00");

    const forkNetworkConfig = networkConfig.ETHEREUM;

    const REPAYER_ROLE = hre.ethers.encodeBytes32String("REPAYER_ROLE");
    const DEPOSIT_PROFIT_ROLE = hre.ethers.encodeBytes32String("DEPOSIT_PROFIT_ROLE");

    const usdc = await hre.ethers.getContractAt("ERC20", forkNetworkConfig.Tokens.USDC);
    const weth = await hre.ethers.getContractAt("IWrappedNativeToken", forkNetworkConfig.WrappedNativeToken);

    const liquidityPool = (await deploy(
      "TestLiquidityPool",
      deployer,
      {},
      usdc,
      deployer,
      forkNetworkConfig.WrappedNativeToken
    )) as TestLiquidityPool;

    assertAddress(forkNetworkConfig.Omnibridge, "ETHEREUM Omnibridge address is missing");
    assertAddress(forkNetworkConfig.GnosisAMB, "ETHEREUM GnosisAMB address is missing");

    const cctpTokenMessenger = forkNetworkConfig.CCTP!.TokenMessenger!;
    const cctpMessageTransmitter = forkNetworkConfig.CCTP!.MessageTransmitter!;

    const USDC_DEC = 10n ** (await usdc.decimals());

    const repayerImpl = (
      await deployX("Repayer", deployer, "RepayerEthereumGnosis", {},
        Domain.ETHEREUM,
        usdc,
        cctpTokenMessenger,
        cctpMessageTransmitter,
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
      )
    ) as Repayer;

    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin,
      repayUser,
      setTokensUser,
      [liquidityPool],
      [Domain.GNOSIS_CHAIN],
      [Provider.GNOSIS_OMNIBRIDGE],
      [true],
      [],
    )).data;

    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyGnosis", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;
    const repayerProxyAdminAddress = await getCreateAddress(repayerProxy, 1);
    const repayerAdmin = (await getContractAt("ProxyAdmin", repayerProxyAdminAddress, admin)) as ProxyAdmin;

    await liquidityPool.grantRole(DEPOSIT_PROFIT_ROLE, repayer);

    return {
      deployer, admin, repayUser, usdc, setTokensUser, weth,
      USDC_DEC, liquidityPool, repayer, repayerProxy, repayerAdmin,
      REPAYER_ROLE, DEFAULT_ADMIN_ROLE, forkNetworkConfig,
    };
  };

  it("Should allow repayer to initiate Gnosis Omnibridge repay from Ethereum to Gnosis on fork", async function () {
    const {repayer, USDC_DEC, usdc, repayUser, liquidityPool, forkNetworkConfig} = await loadFixture(deployAll);

    assertAddress(
      process.env.USDC_OWNER_ETH_ADDRESS,
      "Env variables not configured (USDC_OWNER_ETH_ADDRESS missing)"
    );
    const USDC_OWNER_ETH_ADDRESS = process.env.USDC_OWNER_ETH_ADDRESS;
    const usdcOwner = await hre.ethers.getImpersonatedSigner(USDC_OWNER_ETH_ADDRESS);
    await setBalance(USDC_OWNER_ETH_ADDRESS, 10n ** 18n);

    const amount = 4n * USDC_DEC;
    await usdc.connect(usdcOwner).transfer(repayer, 10n * USDC_DEC);

    const ethereumOmnibridge = forkNetworkConfig.Omnibridge!;
    const bridgeBalanceBefore = await usdc.balanceOf(ethereumOmnibridge);

    const tx = repayer.connect(repayUser).initiateRepay(
      usdc,
      amount,
      liquidityPool,
      Domain.GNOSIS_CHAIN,
      Provider.GNOSIS_OMNIBRIDGE,
      "0x"
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(usdc.target, amount, liquidityPool.target, Domain.GNOSIS_CHAIN, Provider.GNOSIS_OMNIBRIDGE);
    await expect(tx)
      .to.emit(repayer, "GnosisOmnibridgeTransferInitiated")
      .withArgs(usdc.target, liquidityPool.target, amount);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(repayer.target, ethereumOmnibridge, amount);

    expect(await usdc.balanceOf(repayer)).to.equal(6n * USDC_DEC);
    expect(await usdc.balanceOf(ethereumOmnibridge)).to.equal(bridgeBalanceBefore + amount);
  });
});
