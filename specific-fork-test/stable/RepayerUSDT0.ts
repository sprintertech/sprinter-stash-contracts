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
  TestLiquidityPool, Repayer,
} from "../../typechain-types";
import {prodNetworkConfig as networkConfig} from "../../network.config";

// Unlike Tempo, Stable's USDT0 is a dual-role asset that is simultaneously the native gas
// token and an ERC-20, so its OFT pays LayerZero fees via ordinary msg.value
// (USDT0OFT.nativeToken() reverts on Stable) and does not require an ERC-20 approval
// (USDT0OFT.approvalRequired() is false there).
describe.skip("Repayer USDT0 (Stable fork)", function () {
  const deployAll = async () => {
    // Mining a block before doing any calls (eth_call) fixes the issue:
    // https://github.com/NomicFoundation/edr/issues/1214
    await mine();
    const [deployer, admin, repayUser, setTokensUser] = await hre.ethers.getSigners();
    await setCode(repayUser.address, "0x00");

    const forkNetworkConfig = networkConfig.STABLE;

    const REPAYER_ROLE = hre.ethers.encodeBytes32String("REPAYER_ROLE");
    const DEPOSIT_PROFIT_ROLE = hre.ethers.encodeBytes32String("DEPOSIT_PROFIT_ROLE");

    assertAddress(forkNetworkConfig.USDT0OFT, "USDT0OFT address is missing from STABLE config");

    const usdt0Oft = await hre.ethers.getContractAt("IOFT", forkNetworkConfig.USDT0OFT!);
    const usdt0Token = await hre.ethers.getContractAt("ERC20", await usdt0Oft.token());

    expect(usdt0Token.target).to.equal(forkNetworkConfig.Tokens.USDT?.Address);
    expect(await usdt0Oft.approvalRequired()).to.be.false;

    // A stand-in for the destination pool on Arbitrum (this test only forks Stable).
    const liquidityPool = (await deploy(
      "TestLiquidityPool",
      deployer,
      {},
      usdt0Token,
      deployer,
      ZERO_ADDRESS
    )) as TestLiquidityPool;

    const USDT0_DEC = 10n ** (await usdt0Token.decimals());

    const repayerImpl = (
      await deployX("Repayer", deployer, "RepayerStableUSDT0", {},
        Domain.STABLE,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
        forkNetworkConfig.USDT0OFT, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
      )
    ) as Repayer;

    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin,
      repayUser,
      setTokensUser,
      [liquidityPool],
      [Domain.ARBITRUM_ONE],
      [Provider.USDT0],
      [ZERO_ADDRESS],
      [],
    )).data;

    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyStableUSDT0", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;
    const repayerProxyAdminAddress = await getCreateAddress(repayerProxy, 1);
    const repayerAdmin = (await getContractAt("ProxyAdmin", repayerProxyAdminAddress, admin)) as ProxyAdmin;

    await liquidityPool.grantRole(DEPOSIT_PROFIT_ROLE, repayer);

    return {
      deployer, admin, repayUser, usdt0Token, setTokensUser,
      USDT0_DEC, liquidityPool, repayer, repayerProxy, repayerAdmin, usdt0Oft,
      REPAYER_ROLE, DEFAULT_ADMIN_ROLE,
    };
  };

  it("Should allow repayer to bridge USDT0 from Stable to Arbitrum via USDT0 OFT on fork", async function () {
    this.timeout(80000);
    const {repayer, USDT0_DEC, usdt0Token, repayUser, liquidityPool, usdt0Oft} = await loadFixture(deployAll);

    assertAddress(
      process.env.USDT0_OWNER_STABLE_ADDRESS,
      "Env variables not configured (USDT0_OWNER_STABLE_ADDRESS missing)"
    );
    const usdt0Owner = await hre.ethers.getImpersonatedSigner(process.env.USDT0_OWNER_STABLE_ADDRESS!);
    await setBalance(process.env.USDT0_OWNER_STABLE_ADDRESS!, 10n ** 18n);

    const amount = 4n * USDT0_DEC;
    await usdt0Token.connect(usdt0Owner).transfer(repayer, 10n * USDT0_DEC);

    const balanceBefore = await usdt0Token.balanceOf(repayer);

    const nativeFee = (await usdt0Oft.quoteSend({
      dstEid: 30110,
      to: hre.ethers.zeroPadValue(liquidityPool.target as string, 32),
      amountLD: amount,
      minAmountLD: amount,
      extraOptions: "0x",
      composeMsg: "0x",
      oftCmd: "0x",
    }, false)).nativeFee;

    const extraData = AbiCoder.defaultAbiCoder().encode(["uint256"], [amount]);
    const tx = repayer.connect(repayUser).initiateRepay(
      usdt0Token,
      amount,
      liquidityPool,
      Domain.ARBITRUM_ONE,
      Provider.USDT0,
      extraData,
      {value: nativeFee}
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(usdt0Token.target, amount, liquidityPool.target, Domain.ARBITRUM_ONE, Provider.USDT0);
    await expect(tx)
      .to.emit(repayer, "USDT0Transfer")
      .withArgs(usdt0Token.target, liquidityPool.target, "30110", amount);

    expect(await usdt0Token.balanceOf(repayer)).to.equal(balanceBefore - amount);
  });
});
