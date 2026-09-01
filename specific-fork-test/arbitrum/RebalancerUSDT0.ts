import {
  loadFixture, setBalance, setCode
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {AbiCoder} from "ethers";
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
import {prodNetworkConfig as networkConfig} from "../../network.config";
import {mineIfNeeded} from "../../scripts/helpers";

describe("Rebalancer USDT0 (Arbitrum fork)", function () {
  const deployAll = async () => {
    await mineIfNeeded();
    const [deployer, admin, rebalanceUser] = await hre.ethers.getSigners();
    await setCode(rebalanceUser.address, "0x00");

    const forkNetworkConfig = networkConfig.ARBITRUM_ONE;

    const REBALANCER_ROLE = hre.ethers.encodeBytes32String("REBALANCER_ROLE");
    const LIQUIDITY_ADMIN_ROLE = hre.ethers.encodeBytes32String("LIQUIDITY_ADMIN_ROLE");

    assertAddress(forkNetworkConfig.USDT0OFT, "USDT0OFT address is missing from ARBITRUM_ONE config");

    const usdc = await hre.ethers.getContractAt("ERC20", forkNetworkConfig.Tokens.USDC!.Address);
    const usdt0Oft = await hre.ethers.getContractAt("IOFT", forkNetworkConfig.USDT0OFT!);
    const usdt0Token = await hre.ethers.getContractAt("ERC20", await usdt0Oft.token());

    expect(usdt0Token.target).to.equal(forkNetworkConfig.Tokens.USDT?.Address);

    // Arbitrum's own USDT pool (ASSETS = USDT0-bridged USDT), the source of the rebalance.
    const localPool = (await deploy(
      "TestLiquidityPool", deployer, {}, usdt0Token, deployer, ZERO_ADDRESS
    )) as TestLiquidityPool;
    // A stand-in for the pool on Tempo/Stable that receives the bridged funds.
    const remotePool = (await deploy(
      "TestLiquidityPool", deployer, {}, usdt0Token, deployer, ZERO_ADDRESS
    )) as TestLiquidityPool;

    const USDT0_DEC = 10n ** (await usdt0Token.decimals());

    const rebalancerImpl = (
      await deployX("Rebalancer", deployer, "RebalancerArbitrumUSDT0", {},
        Domain.ARBITRUM_ONE,
        usdt0Token,
        usdc,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        forkNetworkConfig.USDT0OFT, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
      )
    ) as Rebalancer;

    const rebalancerInit = (await rebalancerImpl.initialize.populateTransaction(
      admin,
      rebalanceUser,
      [localPool, remotePool, remotePool],
      [Domain.ARBITRUM_ONE, Domain.TEMPO, Domain.STABLE],
      [Provider.LOCAL, Provider.USDT0, Provider.USDT0],
    )).data;

    const rebalancerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyArbitrumUSDT0Rebalancer", {},
      rebalancerImpl, admin, rebalancerInit
    )) as TransparentUpgradeableProxy;
    const rebalancer = (await getContractAt("Rebalancer", rebalancerProxy, deployer)) as Rebalancer;
    const rebalancerProxyAdminAddress = await getCreateAddress(rebalancerProxy, 1);
    const rebalancerAdmin = (await getContractAt("ProxyAdmin", rebalancerProxyAdminAddress, admin)) as ProxyAdmin;

    await localPool.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
    await remotePool.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);

    return {
      deployer, admin, rebalanceUser, usdt0Token, USDT0_DEC,
      localPool, remotePool, rebalancer, rebalancerProxy, rebalancerAdmin,
      REBALANCER_ROLE, DEFAULT_ADMIN_ROLE,
    };
  };

  it("Should allow rebalancer to bridge USDT0 from Arbitrum to Tempo via USDT0 OFT on fork", async function () {
    this.timeout(80000);
    const {rebalancer, USDT0_DEC, usdt0Token, rebalanceUser, localPool, remotePool} = await loadFixture(deployAll);

    assertAddress(
      process.env.USDT0_OWNER_ARBITRUM_ADDRESS,
      "Env variables not configured (USDT0_OWNER_ARBITRUM_ADDRESS missing)"
    );
    const usdt0Owner = await hre.ethers.getImpersonatedSigner(process.env.USDT0_OWNER_ARBITRUM_ADDRESS!);
    await setBalance(process.env.USDT0_OWNER_ARBITRUM_ADDRESS!, 10n ** 18n);

    const amount = 4n * USDT0_DEC;
    await usdt0Token.connect(usdt0Owner).transfer(localPool, amount);

    const extraData = AbiCoder.defaultAbiCoder().encode(["uint256"], [amount]);
    const tx = rebalancer.connect(rebalanceUser).initiateRebalance(
      amount, localPool, remotePool, Domain.TEMPO, Provider.USDT0, extraData,
      {value: hre.ethers.parseEther("0.01")}
    );
    await expect(tx)
      .to.emit(rebalancer, "InitiateRebalance")
      .withArgs(amount, localPool.target, remotePool.target, Domain.TEMPO, Provider.USDT0);
    await expect(tx)
      .to.emit(rebalancer, "USDT0Transfer")
      .withArgs(usdt0Token.target, rebalancer.target, "30410", amount);

    expect(await usdt0Token.balanceOf(localPool)).to.equal(0n);
    expect(await usdt0Token.balanceOf(rebalancer)).to.equal(0n);
  });
});
