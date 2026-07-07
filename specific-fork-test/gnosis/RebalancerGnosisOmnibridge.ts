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
  TestLiquidityPool, Rebalancer,
} from "../../typechain-types";
import {networkConfig} from "../../network.config";

describe("Rebalancer Gnosis Omnibridge (Gnosis Chain fork)", function () {
  const deployAll = async () => {
    const [deployer, admin, rebalanceUser] = await hre.ethers.getSigners();
    await setCode(rebalanceUser.address, "0x00");

    const gnosisConfig = networkConfig.GNOSIS_CHAIN;

    const REBALANCER_ROLE = hre.ethers.encodeBytes32String("REBALANCER_ROLE");
    const LIQUIDITY_ADMIN_ROLE = hre.ethers.encodeBytes32String("LIQUIDITY_ADMIN_ROLE");

    assertAddress(gnosisConfig.Omnibridge, "GNOSIS_CHAIN Omnibridge address is missing");

    // Primary USDC on Gnosis Chain is USDCe (Circle's Bridged USDC Standard = ASSETS).
    const usdce = await hre.ethers.getContractAt("ERC20", gnosisConfig.Tokens.USDC.Address);
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
    const rebalancerImpl = (
      await deployX("Rebalancer", deployer, "RebalancerGnosis", {},
        Domain.GNOSIS_CHAIN,
        usdce,
        gnosisConfig.Omnibridge,
        gnosisConfig.GnosisUSDCxDAI,
        gnosisConfig.GnosisUSDCTransmuter,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
      )
    ) as Rebalancer;

    const rebalancerInit = (await rebalancerImpl.initialize.populateTransaction(
      admin,
      rebalanceUser,
      [liquidityPool],
      [Domain.GNOSIS_CHAIN],
      [Provider.LOCAL],
    )).data;

    const rebalancerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRebalancer", {},
      rebalancerImpl, admin, rebalancerInit
    )) as TransparentUpgradeableProxy;
    const rebalancer = (await getContractAt("Rebalancer", rebalancerProxy, deployer)) as Rebalancer;
    const rebalancerProxyAdminAddress = await getCreateAddress(rebalancerProxy, 1);
    const rebalancerAdmin = (await getContractAt("ProxyAdmin", rebalancerProxyAdminAddress, admin)) as ProxyAdmin;

    await liquidityPool.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);

    return {
      deployer, admin, rebalanceUser, usdce, wxdai,
      USDCE_DEC, liquidityPool, rebalancer, rebalancerProxy, rebalancerAdmin,
      REBALANCER_ROLE, DEFAULT_ADMIN_ROLE, gnosisConfig,
    };
  };

  it("Should allow rebalancer to process rebalance via Gnosis Omnibridge on Gnosis fork", async function () {
    const {rebalancer, USDCE_DEC, usdce, rebalanceUser, liquidityPool, gnosisConfig} = await loadFixture(deployAll);

    assertAddress(gnosisConfig.GnosisUSDCxDAI, "GnosisUSDCxDAI address is missing from network config");
    assertAddress(gnosisConfig.GnosisUSDCTransmuter, "GnosisUSDCTransmuter address is missing from network config");
    assertAddress(
      process.env.USDCXDAI_OWNER_GNOSIS_ADDRESS,
      "Env variables not configured (USDCXDAI_OWNER_GNOSIS_ADDRESS missing)"
    );

    const usdcxdai = await hre.ethers.getContractAt("ERC20", gnosisConfig.GnosisUSDCxDAI!);
    const usdcxdaiOwner = await hre.ethers.getImpersonatedSigner(process.env.USDCXDAI_OWNER_GNOSIS_ADDRESS!);
    await setBalance(process.env.USDCXDAI_OWNER_GNOSIS_ADDRESS!, 10n ** 18n);

    const amount = 4n * USDCE_DEC;
    // Simulate bridge delivery: USDCxDAI lands on the rebalancer contract
    await usdcxdai.connect(usdcxdaiOwner).transfer(rebalancer, amount);

    const tx = await rebalancer.connect(rebalanceUser).processRebalance(
      liquidityPool,
      Provider.GNOSIS_OMNIBRIDGE,
      "0x"
    );
    await expect(tx)
      .to.emit(rebalancer, "ProcessRebalance")
      .withArgs(amount, liquidityPool.target, Provider.GNOSIS_OMNIBRIDGE);
    // USDCxDAI moved from rebalancer to transmuter
    await expect(tx)
      .to.emit(usdcxdai, "Transfer")
      .withArgs(rebalancer.target, gnosisConfig.GnosisUSDCTransmuter, amount);
    // USDCe moved from transmuter to rebalancer
    await expect(tx)
      .to.emit(usdce, "Transfer")
      .withArgs(gnosisConfig.GnosisUSDCTransmuter, rebalancer.target, amount);
    // USDCe moved from rebalancer to pool
    await expect(tx)
      .to.emit(usdce, "Transfer")
      .withArgs(rebalancer.target, liquidityPool.target, amount);
    await expect(tx)
      .to.emit(liquidityPool, "Deposit");

    expect(await usdce.balanceOf(liquidityPool)).to.equal(amount);
    expect(await usdcxdai.balanceOf(rebalancer)).to.equal(0n);
  });
});
