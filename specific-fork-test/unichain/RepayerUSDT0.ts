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

describe("Repayer USDT0 (Unichain fork)", function () {
  const deployAll = async () => {
    const [deployer, admin, repayUser, setTokensUser] = await hre.ethers.getSigners();
    await setCode(repayUser.address, "0x00");

    const forkNetworkConfig = networkConfig.UNICHAIN;

    const REPAYER_ROLE = hre.ethers.encodeBytes32String("REPAYER_ROLE");
    const DEPOSIT_PROFIT_ROLE = hre.ethers.encodeBytes32String("DEPOSIT_PROFIT_ROLE");

    assertAddress(forkNetworkConfig.USDT0OFT, "USDT0OFT address is missing from UNICHAIN config");

    const usdc = await hre.ethers.getContractAt("ERC20", forkNetworkConfig.Tokens.USDC.Address);
    const usdt0Oft = await hre.ethers.getContractAt("IOFT", forkNetworkConfig.USDT0OFT!);
    const usdt0Token = await hre.ethers.getContractAt("ERC20", await usdt0Oft.token());
    const weth = await hre.ethers.getContractAt("IWrappedNativeToken", forkNetworkConfig.WrappedNativeToken);

    expect(usdt0Token.target).to.equal(forkNetworkConfig.Tokens.USDT?.Address);

    const liquidityPool = (await deploy(
      "TestLiquidityPool",
      deployer,
      {},
      usdc,
      deployer,
      forkNetworkConfig.WrappedNativeToken
    )) as TestLiquidityPool;

    const USDT0_DEC = 10n ** (await usdt0Token.decimals());

    const repayerImpl = (
      await deployX("Repayer", deployer, "RepayerUnichainUSDT0", {},
        Domain.UNICHAIN,
        usdc,
        forkNetworkConfig.CCTP!.TokenMessenger!,
        forkNetworkConfig.CCTP!.MessageTransmitter!,
        forkNetworkConfig.AcrossV3SpokePool!,
        forkNetworkConfig.EverclearFeeAdapter!,
        weth,
        forkNetworkConfig.StargateTreasurer!,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
        forkNetworkConfig.USDT0OFT, ZERO_ADDRESS, ZERO_ADDRESS,
      )
    ) as Repayer;

    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin,
      repayUser,
      setTokensUser,
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.USDT0],
      [true],
      [],
    )).data;

    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyUnichainUSDT0", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;
    const repayerProxyAdminAddress = await getCreateAddress(repayerProxy, 1);
    const repayerAdmin = (await getContractAt("ProxyAdmin", repayerProxyAdminAddress, admin)) as ProxyAdmin;

    await liquidityPool.grantRole(DEPOSIT_PROFIT_ROLE, repayer);

    return {
      deployer, admin, repayUser, usdc, usdt0Token, setTokensUser, weth,
      USDT0_DEC, liquidityPool, repayer, repayerProxy, repayerAdmin,
      REPAYER_ROLE, DEFAULT_ADMIN_ROLE,
    };
  };

  it("Should allow repayer to bridge USDT0 from Unichain to Ethereum via USDT0 OFT on fork", async function () {
    this.timeout(120000);
    const {repayer, USDT0_DEC, usdt0Token, repayUser, liquidityPool} = await loadFixture(deployAll);

    assertAddress(
      process.env.USDT0_OWNER_UNICHAIN_ADDRESS,
      "Env variables not configured (USDT0_OWNER_UNICHAIN_ADDRESS missing)"
    );
    const usdt0Owner = await hre.ethers.getImpersonatedSigner(process.env.USDT0_OWNER_UNICHAIN_ADDRESS!);
    await setBalance(process.env.USDT0_OWNER_UNICHAIN_ADDRESS!, 10n ** 18n);

    const amount = 4n * USDT0_DEC;
    await usdt0Token.connect(usdt0Owner).transfer(repayer, 10n * USDT0_DEC);

    const balanceBefore = await usdt0Token.balanceOf(repayer);

    const tx = repayer.connect(repayUser).initiateRepay(
      usdt0Token,
      amount,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.USDT0,
      "0x",
      {value: hre.ethers.parseEther("0.01")}
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(usdt0Token.target, amount, liquidityPool.target, Domain.ETHEREUM, Provider.USDT0);
    await expect(tx)
      .to.emit(repayer, "USDT0Transfer")
      .withArgs(usdt0Token.target, liquidityPool.target, "30101", amount);

    expect(await usdt0Token.balanceOf(repayer)).to.equal(balanceBefore - amount);
  });
});
