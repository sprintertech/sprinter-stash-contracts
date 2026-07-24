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
  TestLiquidityPool, Repayer, ILZEndpointDollar,
} from "../../typechain-types";
import {prodNetworkConfig as networkConfig} from "../../network.config";

// Tempo has no native currency (CALLVALUE always returns 0 on Tempo), so its USDT0 OFT
// requires LayerZero fees to be paid in an ERC-20 token (USDT0OFT.nativeToken()) instead
// of msg.value. This is why the deployment below wires USDT0FeeNativeToken and every
// initiateRepay call below encodes a (minAmountLD, nativeFee) pair in extraData.
// USDT0FeeNativeToken is LZD (ILZEndpointDollar): fee tokens are obtained by wrapping USDT0
// into LZD 1:1, rather than needing a separate LZD-holder address to impersonate.
describe.skip("Repayer USDT0 (Tempo fork)", function () {
  const deployAll = async () => {
    // Mining a block before doing any calls (eth_call) fixes the issue:
    // https://github.com/NomicFoundation/edr/issues/1214
    await mine();
    const [deployer, admin, repayUser, setTokensUser] = await hre.ethers.getSigners();
    await setCode(repayUser.address, "0x00");

    const forkNetworkConfig = networkConfig.TEMPO;

    const REPAYER_ROLE = hre.ethers.encodeBytes32String("REPAYER_ROLE");
    const DEPOSIT_PROFIT_ROLE = hre.ethers.encodeBytes32String("DEPOSIT_PROFIT_ROLE");

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

    // A stand-in for the destination pool on Arbitrum (this test only forks Tempo).
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
      await deployX("Repayer", deployer, "RepayerTempoUSDT0", {},
        Domain.TEMPO,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
        forkNetworkConfig.USDT0OFT, forkNetworkConfig.USDT0FeeNativeToken, ZERO_ADDRESS, ZERO_ADDRESS,
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
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyTempoUSDT0", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;
    const repayerProxyAdminAddress = await getCreateAddress(repayerProxy, 1);
    const repayerAdmin = (await getContractAt("ProxyAdmin", repayerProxyAdminAddress, admin)) as ProxyAdmin;

    await liquidityPool.grantRole(DEPOSIT_PROFIT_ROLE, repayer);

    return {
      deployer, admin, repayUser, usdt0Token, feeToken, setTokensUser,
      USDT0_DEC, liquidityPool, repayer, repayerProxy, repayerAdmin, usdt0Oft,
      REPAYER_ROLE, DEFAULT_ADMIN_ROLE,
    };
  };

  it("Should allow repayer to bridge USDT0 from Tempo to Arbitrum via USDT0 OFT on fork", async function () {
    this.timeout(80000);
    const {
      repayer, USDT0_DEC, usdt0Token, feeToken, repayUser, liquidityPool, usdt0Oft,
    } = await loadFixture(deployAll);

    assertAddress(
      process.env.USDT0_OWNER_TEMPO_ADDRESS,
      "Env variables not configured (USDT0_OWNER_TEMPO_ADDRESS missing)"
    );
    const usdt0Owner = await hre.ethers.getImpersonatedSigner(process.env.USDT0_OWNER_TEMPO_ADDRESS!);
    await setBalance(process.env.USDT0_OWNER_TEMPO_ADDRESS!, 10n ** 18n);

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

    // Mint LZD fee tokens by wrapping USDT0 1:1, straight to repayUser (the REPAYER_ROLE
    // caller), instead of needing a separate LZD-holder address to impersonate.
    await usdt0Token.connect(usdt0Owner).approve(feeToken, nativeFee);
    await feeToken.connect(usdt0Owner).wrap(usdt0Token, repayUser, nativeFee);
    // repayUser must approve the Repayer to pull the fee token, since it is pulled from the
    // caller rather than from the Repayer's own balance.
    await feeToken.connect(repayUser).approve(repayer, nativeFee);

    const extraData = AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [amount, nativeFee]);
    const tx = repayer.connect(repayUser).initiateRepay(
      usdt0Token,
      amount,
      liquidityPool,
      Domain.ARBITRUM_ONE,
      Provider.USDT0,
      extraData,
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
