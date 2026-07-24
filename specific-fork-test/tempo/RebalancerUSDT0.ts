import {
  loadFixture, mine, setBalance, setCode
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
  TestLiquidityPool, Rebalancer, ILZEndpointDollar,
} from "../../typechain-types";
import {prodNetworkConfig as networkConfig} from "../../network.config";

// Tempo has no native currency (CALLVALUE always returns 0 on Tempo), so its USDT0 OFT
// requires LayerZero fees to be paid in an ERC-20 token (USDT0OFT.nativeToken()) instead
// of msg.value, matching the wiring in scripts/deploy.ts / network.config for Tempo.
// USDT0FeeNativeToken is LZD (ILZEndpointDollar): fee tokens are obtained by wrapping USDT0
// into LZD 1:1, rather than needing a separate LZD-holder address to impersonate.
describe.skip("Rebalancer USDT0 (Tempo fork)", function () {
  const deployAll = async () => {
    // Mining a block before doing any calls (eth_call) fixes the issue:
    // https://github.com/NomicFoundation/edr/issues/1214
    await mine();
    const [deployer, admin, rebalanceUser] = await hre.ethers.getSigners();
    await setCode(rebalanceUser.address, "0x00");

    const forkNetworkConfig = networkConfig.TEMPO;

    const REBALANCER_ROLE = hre.ethers.encodeBytes32String("REBALANCER_ROLE");
    const LIQUIDITY_ADMIN_ROLE = hre.ethers.encodeBytes32String("LIQUIDITY_ADMIN_ROLE");

    assertAddress(forkNetworkConfig.USDT0OFT, "USDT0OFT address is missing from TEMPO config");
    assertAddress(
      forkNetworkConfig.USDT0FeeNativeToken, "USDT0FeeNativeToken address is missing from TEMPO config"
    );

    const usdt0Oft = await hre.ethers.getContractAt("IOFT", forkNetworkConfig.USDT0OFT!);
    const usdt0Token = await hre.ethers.getContractAt("ERC20", await usdt0Oft.token());
    const feeToken = (
      await hre.ethers.getContractAt("ILZEndpointDollar", forkNetworkConfig.USDT0FeeNativeToken!)
    ) as ILZEndpointDollar;

    expect(usdt0Token.target).to.equal(forkNetworkConfig.Tokens.USDT?.Address);
    expect(await usdt0Oft.approvalRequired()).to.be.true;
    expect(await usdt0Oft.nativeToken()).to.equal(feeToken.target);

    // Tempo's own USDT pool (ASSETS = USDT0-bridged USDT), the source of the rebalance.
    const localPool = (await deploy(
      "TestLiquidityPool", deployer, {}, usdt0Token, deployer, ZERO_ADDRESS
    )) as TestLiquidityPool;
    // A stand-in for the pool on Arbitrum that receives the bridged funds.
    const remotePool = (await deploy(
      "TestLiquidityPool", deployer, {}, usdt0Token, deployer, ZERO_ADDRESS
    )) as TestLiquidityPool;

    const USDT0_DEC = 10n ** (await usdt0Token.decimals());

    const rebalancerImpl = (
      await deployX("Rebalancer", deployer, "RebalancerTempoUSDT0", {},
        Domain.TEMPO,
        usdt0Token,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        forkNetworkConfig.USDT0OFT, forkNetworkConfig.USDT0FeeNativeToken, ZERO_ADDRESS, ZERO_ADDRESS,
      )
    ) as Rebalancer;

    const rebalancerInit = (await rebalancerImpl.initialize.populateTransaction(
      admin,
      rebalanceUser,
      [localPool, remotePool],
      [Domain.TEMPO, Domain.ARBITRUM_ONE],
      [Provider.LOCAL, Provider.USDT0],
    )).data;

    const rebalancerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyTempoRebalancerUSDT0", {},
      rebalancerImpl, admin, rebalancerInit
    )) as TransparentUpgradeableProxy;
    const rebalancer = (await getContractAt("Rebalancer", rebalancerProxy, deployer)) as Rebalancer;
    const rebalancerProxyAdminAddress = await getCreateAddress(rebalancerProxy, 1);
    const rebalancerAdmin = (await getContractAt("ProxyAdmin", rebalancerProxyAdminAddress, admin)) as ProxyAdmin;

    await localPool.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
    await remotePool.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);

    return {
      deployer, admin, rebalanceUser, usdt0Token, feeToken, USDT0_DEC,
      localPool, remotePool, rebalancer, rebalancerProxy, rebalancerAdmin, usdt0Oft,
      REBALANCER_ROLE, DEFAULT_ADMIN_ROLE,
    };
  };

  it("Should allow rebalancer to bridge USDT0 from Tempo to Arbitrum via USDT0 OFT on fork", async function () {
    this.timeout(80000);
    const {
      rebalancer, USDT0_DEC, usdt0Token, feeToken, rebalanceUser, localPool, remotePool, usdt0Oft,
    } = await loadFixture(deployAll);

    assertAddress(
      process.env.USDT0_OWNER_TEMPO_ADDRESS,
      "Env variables not configured (USDT0_OWNER_TEMPO_ADDRESS missing)"
    );
    const usdt0Owner = await hre.ethers.getImpersonatedSigner(process.env.USDT0_OWNER_TEMPO_ADDRESS!);
    await setBalance(process.env.USDT0_OWNER_TEMPO_ADDRESS!, 10n ** 18n);

    const amount = 4n * USDT0_DEC;
    await usdt0Token.connect(usdt0Owner).transfer(localPool, amount);

    const nativeFee = (await usdt0Oft.quoteSend({
      dstEid: 30110,
      to: hre.ethers.zeroPadValue(rebalancer.target as string, 32),
      amountLD: amount,
      minAmountLD: amount,
      extraOptions: "0x",
      composeMsg: "0x",
      oftCmd: "0x",
    }, false)).nativeFee;

    // Mint LZD fee tokens by wrapping USDT0 1:1, straight to rebalanceUser (the
    // REBALANCER_ROLE caller), instead of needing a separate LZD-holder address to impersonate.
    await usdt0Token.connect(usdt0Owner).approve(feeToken, nativeFee);
    await feeToken.connect(usdt0Owner).wrap(usdt0Token, rebalanceUser, nativeFee);
    // rebalanceUser must approve the Rebalancer to pull the fee token, since it is pulled from
    // the caller rather than from the Rebalancer's own balance.
    await feeToken.connect(rebalanceUser).approve(rebalancer, nativeFee);

    const extraData = AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [amount, nativeFee]);
    const tx = rebalancer.connect(rebalanceUser).initiateRebalance(
      amount, localPool, remotePool, Domain.ARBITRUM_ONE, Provider.USDT0, extraData,
    );
    await expect(tx)
      .to.emit(rebalancer, "InitiateRebalance")
      .withArgs(amount, localPool.target, remotePool.target, Domain.ARBITRUM_ONE, Provider.USDT0);
    await expect(tx)
      .to.emit(rebalancer, "USDT0Transfer")
      .withArgs(usdt0Token.target, rebalancer.target, "30110", amount);

    expect(await usdt0Token.balanceOf(localPool)).to.equal(0n);
    expect(await usdt0Token.balanceOf(rebalancer)).to.equal(0n);
  });
});
