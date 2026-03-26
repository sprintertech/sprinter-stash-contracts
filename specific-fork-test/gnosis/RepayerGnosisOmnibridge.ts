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

describe("Repayer Gnosis Omnibridge (Gnosis Chain fork)", function () {
  const deployAll = async () => {
    const [deployer, admin, repayUser, setTokensUser] = await hre.ethers.getSigners();
    await setCode(repayUser.address, "0x00");

    const gnosisConfig = networkConfig.GNOSIS_CHAIN;

    const REPAYER_ROLE = hre.ethers.encodeBytes32String("REPAYER_ROLE");
    const DEPOSIT_PROFIT_ROLE = hre.ethers.encodeBytes32String("DEPOSIT_PROFIT_ROLE");

    assertAddress(gnosisConfig.Omnibridge, "GNOSIS_CHAIN Omnibridge address is missing");

    // Primary USDC on Gnosis Chain is USDCe (Circle's Bridged USDC Standard = ASSETS).
    const usdce = await hre.ethers.getContractAt("ERC20", gnosisConfig.Tokens.USDC);
    const wxdai = await hre.ethers.getContractAt("IWrappedNativeToken", gnosisConfig.WrappedNativeToken);

    const liquidityPool = (await deploy(
      "TestLiquidityPool",
      deployer,
      {},
      usdce,
      deployer,
      gnosisConfig.WrappedNativeToken
    )) as TestLiquidityPool;

    const USDCE_DEC = 10n ** (await usdce.decimals());
    const repayerImpl = (
      await deployX("Repayer", deployer, "RepayerGnosis", {},
        Domain.GNOSIS_CHAIN,
        usdce,   // assets = USDCe (primary Gnosis USDC)
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        wxdai,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        gnosisConfig.Omnibridge,
        gnosisConfig.GnosisUSDCxDAI,
        gnosisConfig.GnosisUSDCTransmuter,
        ZERO_ADDRESS,
      )
    ) as Repayer;

    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin,
      repayUser,
      setTokensUser,
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.GNOSIS_OMNIBRIDGE],
      [true],
      [],
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
      deployer, admin, repayUser, usdce, setTokensUser, wxdai,
      USDCE_DEC, liquidityPool, repayer, repayerProxy, repayerAdmin,
      REPAYER_ROLE, DEFAULT_ADMIN_ROLE, gnosisConfig,
    };
  };

  it("Should allow repayer to bridge USDCe from Gnosis to Ethereum via Omnibridge on fork", async function () {
    const {repayer, USDCE_DEC, usdce, repayUser, liquidityPool, gnosisConfig} = await loadFixture(deployAll);

    assertAddress(gnosisConfig.GnosisUSDCxDAI, "GnosisUSDCxDAI address is missing from network config");
    assertAddress(gnosisConfig.GnosisUSDCTransmuter, "GnosisUSDCTransmuter address is missing from network config");
    assertAddress(
      process.env.USDCE_OWNER_GNOSIS_ADDRESS,
      "Env variables not configured (USDCE_OWNER_GNOSIS_ADDRESS missing)"
    );

    const usdcxdai = await hre.ethers.getContractAt("ERC20", gnosisConfig.GnosisUSDCxDAI!);
    const usdceOwner = await hre.ethers.getImpersonatedSigner(process.env.USDCE_OWNER_GNOSIS_ADDRESS!);
    await setBalance(process.env.USDCE_OWNER_GNOSIS_ADDRESS!, 10n ** 18n);

    const amount = 4n * USDCE_DEC;
    await usdce.connect(usdceOwner).transfer(repayer, 10n * USDCE_DEC);

    const gnosisOmnibridge = gnosisConfig.Omnibridge!;
    const bridgeBalanceBefore = await usdcxdai.balanceOf(gnosisOmnibridge);

    const tx = await repayer.connect(repayUser).initiateRepay(
      usdce,
      amount,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.GNOSIS_OMNIBRIDGE,
      "0x"
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(usdce.target, amount, liquidityPool.target, Domain.ETHEREUM, Provider.GNOSIS_OMNIBRIDGE);
    // Event emits USDCxDAI (after swap), not USDCe
    await expect(tx)
      .to.emit(repayer, "GnosisOmnibridgeTransferInitiated")
      .withArgs(gnosisConfig.GnosisUSDCxDAI, liquidityPool.target, amount);
    await expect(tx)
      .to.emit(usdcxdai, "Transfer")
      .withArgs(repayer.target, gnosisOmnibridge, amount);

    expect(await usdce.balanceOf(repayer)).to.equal(6n * USDCE_DEC);
    expect(await usdcxdai.balanceOf(repayer)).to.equal(0n);
    expect(await usdcxdai.balanceOf(gnosisOmnibridge)).to.equal(bridgeBalanceBefore + amount);
  });
});
