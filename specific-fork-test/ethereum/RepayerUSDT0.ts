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

describe("Repayer USDT0 (Ethereum fork)", function () {
  const deployAll = async () => {
    const [deployer, admin, repayUser, setTokensUser] = await hre.ethers.getSigners();
    await setCode(repayUser.address, "0x00");

    const forkNetworkConfig = networkConfig.ETHEREUM;

    const REPAYER_ROLE = hre.ethers.encodeBytes32String("REPAYER_ROLE");
    const DEPOSIT_PROFIT_ROLE = hre.ethers.encodeBytes32String("DEPOSIT_PROFIT_ROLE");

    assertAddress(forkNetworkConfig.Tokens.USDT?.Address, "USDT address is missing from ETHEREUM config");
    assertAddress(forkNetworkConfig.USDT0OFT, "USDT0OFT address is missing from ETHEREUM config");
    assertAddress(forkNetworkConfig.Omnibridge, "ETHEREUM Omnibridge address is missing");
    assertAddress(forkNetworkConfig.GnosisAMB, "ETHEREUM GnosisAMB address is missing");

    const usdc = await hre.ethers.getContractAt("ERC20", forkNetworkConfig.Tokens.USDC.Address);
    const usdt = await hre.ethers.getContractAt("ERC20", forkNetworkConfig.Tokens.USDT.Address);
    const weth = await hre.ethers.getContractAt("IWrappedNativeToken", forkNetworkConfig.WrappedNativeToken);
    
    const usdt0Oft = await hre.ethers.getContractAt("IOFT", forkNetworkConfig.USDT0OFT!);
    expect(await usdt0Oft.token()).to.equal(forkNetworkConfig.Tokens.USDT.Address);

    const liquidityPool = (await deploy(
      "TestLiquidityPool",
      deployer,
      {},
      usdc,
      deployer,
      forkNetworkConfig.WrappedNativeToken
    )) as TestLiquidityPool;

    const USDT_DEC = 10n ** (await usdt.decimals());

    const repayerImpl = (
      await deployX("Repayer", deployer, "RepayerEthereumUSDT0", {},
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
        forkNetworkConfig.USDT0OFT,
      )
    ) as Repayer;

    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin,
      repayUser,
      setTokensUser,
      [liquidityPool],
      [Domain.ARBITRUM_ONE],
      [Provider.USDT0],
      [true],
      [],
    )).data;

    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyEthereumUSDT0", {},
      repayerImpl, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;
    const repayerProxyAdminAddress = await getCreateAddress(repayerProxy, 1);
    const repayerAdmin = (await getContractAt("ProxyAdmin", repayerProxyAdminAddress, admin)) as ProxyAdmin;

    await liquidityPool.grantRole(DEPOSIT_PROFIT_ROLE, repayer);

    return {
      deployer, admin, repayUser, usdc, usdt, setTokensUser, weth,
      USDT_DEC, liquidityPool, repayer, repayerProxy, repayerAdmin,
      REPAYER_ROLE, DEFAULT_ADMIN_ROLE, forkNetworkConfig,
    };
  };

  it("Should allow repayer to bridge USDT from Ethereum to Arbitrum via USDT0 OFT on fork", async function () {
    const {repayer, USDT_DEC, usdt, repayUser, liquidityPool, forkNetworkConfig} = await loadFixture(deployAll);

    assertAddress(
      process.env.USDT_OWNER_ETH_ADDRESS,
      "Env variables not configured (USDT_OWNER_ETH_ADDRESS missing)"
    );
    const usdtOwner = await hre.ethers.getImpersonatedSigner(process.env.USDT_OWNER_ETH_ADDRESS!);
    await setBalance(process.env.USDT_OWNER_ETH_ADDRESS!, 10n ** 18n);

    const amount = 4n * USDT_DEC;
    await usdt.connect(usdtOwner).transfer(repayer, 10n * USDT_DEC);

    const usdt0OftAddress = forkNetworkConfig.USDT0OFT!;
    const usdtBalanceBefore = await usdt.balanceOf(repayer);

    const tx = repayer.connect(repayUser).initiateRepay(
      usdt,
      amount,
      liquidityPool,
      Domain.ARBITRUM_ONE,
      Provider.USDT0,
      "0x",
      {value: hre.ethers.parseEther("0.1")}
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(usdt.target, amount, liquidityPool.target, Domain.ARBITRUM_ONE, Provider.USDT0);
    // Adapter locks USDT via transferFrom: USDT moves from repayer to USDT0 OFT.
    await expect(tx)
      .to.emit(usdt, "Transfer")
      .withArgs(repayer.target, usdt0OftAddress, amount);

    await expect(tx)
      .to.emit(repayer, "USDT0Transfer")
      .withArgs(usdt.target, liquidityPool.target, "30110", amount);

    expect(await usdt.balanceOf(repayer)).to.equal(usdtBalanceBefore - amount);
  });
});
