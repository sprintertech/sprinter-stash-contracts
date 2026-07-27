import {expect} from "chai";
import hre from "hardhat";
import {concat, dataSlice, keccak256, toUtf8Bytes} from "ethers";
import {getCreateX} from "../../test/helpers";
import {assert, assertAddress, CREATE_X_ADDRESS} from "../../scripts/common";
import {prodNetworkConfig as networkConfig} from "../../network.config";

// Tempo is not fully EVM-compatible (e.g. CALLVALUE and BALANCE always return 0), so Hardhat's
// fork/EDR network cannot replicate its real execution semantics. Instead of forking, the
// entire scenario (fund a local pool, wrap USDT0 into the LZD fee token, initiateRebalance)
// runs inside RebalancerUSDT0Tempo, and gets simulated via read-only eth_calls sent directly to
// live Tempo mainnet: nothing here forks state, spends real gas, or persists.
//
// Run with: hardhat test --network TEMPO ./specific-fork-test/tempo/RebalancerUSDT0.ts
// (a direct connection to the real network, NOT `FORK_TEST=TEMPO`).
//
// RebalancerUSDT0Tempo shares the same CreateX deployer/salt id ("TempoSimulation") as
// RepayerUSDT0Tempo, and therefore the same pre-funded EXPECTED_ADDRESS — see that file's
// harness for the full rationale on why run() is split from the constructor and why
// deployCreate3AndInit is used to preserve run()'s real revert reason.
describe("Rebalancer USDT0 (Tempo simulation)", function () {
  const SIMULATION_DEPLOYER = "0xdBD91aD22bE5304e385b7b0A2Cfe91164e416e11";
  const SIMULATION_ID = "TempoSimulation";
  const BRIDGE_AMOUNT = 1_000_000n; // 1 USDT0 (6 decimals).
  const REMOTE_POOL = "0x000000000000000000000000000000000000dEaD";
  const ARBITRUM_ONE_EID = 30110n;
  // Must match RebalancerUSDT0Tempo.EXPECTED_ADDRESS (== RepayerUSDT0Tempo.EXPECTED_ADDRESS),
  // and is pre-funded with real USDT0 on Tempo.
  const EXPECTED_ADDRESS = "0xcE98A33AC0a054bCE4ed6715b780F59A2e6CC7f1";

  // Same raw salt format as test/helpers.ts's deployX: 20 bytes deployer + protection flag
  // byte + 11 bytes of id-derived entropy. CreateX derives the actual CREATE3 address from
  // this salt only after confirming msg.sender matches the embedded deployer.
  function computeSalt(): string {
    return concat([
      SIMULATION_DEPLOYER,
      "0x00",
      dataSlice(keccak256(toUtf8Bytes(SIMULATION_ID)), 0, 11),
    ]);
  }

  // ethers throws differently depending on whether the underlying provider is a Hardhat
  // ProviderError (direct `.data`/`.code`) or an ethers CallExceptionError (`.data` too, but a
  // different shape) — read `.data` defensively rather than relying on `isError` type-narrowing.
  function extractRevertData(error: unknown): string {
    const data = (error as {data?: unknown})?.data;
    assert(typeof data === "string" && data.length > 0, `Call did not revert with usable data: ${error}`);
    return data;
  }

  it("Should not revert while deploying (sanity check, independent of run()/funding)", async function () {
    const forkNetworkConfig = networkConfig.TEMPO;
    assertAddress(forkNetworkConfig.USDT0OFT, "USDT0OFT address is missing from TEMPO config");
    assertAddress(
      forkNetworkConfig.USDT0FeeNativeToken, "USDT0FeeNativeToken address is missing from TEMPO config"
    );

    const factory = await hre.ethers.getContractFactory("RebalancerUSDT0Tempo");
    const deployTx = await factory.getDeployTransaction(
      forkNetworkConfig.USDT0OFT!,
      forkNetworkConfig.USDT0FeeNativeToken!,
      REMOTE_POOL,
    );

    // Plain deployCreate3 (no init call), via CreateX, so this also lands on and exercises the
    // exact same deterministic address as the funded simulation below (and, in turn, the
    // constructor's EXPECTED_ADDRESS check) rather than an arbitrary nonce-based address.
    const salt = computeSalt();
    const createX = await getCreateX();
    const data = createX.interface.encodeFunctionData("deployCreate3(bytes32,bytes)", [salt, deployTx.data]);
    const result = await hre.ethers.provider.call({to: CREATE_X_ADDRESS, from: SIMULATION_DEPLOYER, data});
    const [deployedAddress] = createX.interface.decodeFunctionResult("deployCreate3(bytes32,bytes)", result);
    expect(deployedAddress).to.equal(EXPECTED_ADDRESS);
  });

  it("Should bridge USDT0 from Tempo to Arbitrum via a single simulated eth_call", async function () {
    const forkNetworkConfig = networkConfig.TEMPO;
    assertAddress(forkNetworkConfig.USDT0OFT, "USDT0OFT address is missing from TEMPO config");
    assertAddress(
      forkNetworkConfig.USDT0FeeNativeToken, "USDT0FeeNativeToken address is missing from TEMPO config"
    );

    const factory = await hre.ethers.getContractFactory("RebalancerUSDT0Tempo");
    const deployTx = await factory.getDeployTransaction(
      forkNetworkConfig.USDT0OFT!,
      forkNetworkConfig.USDT0FeeNativeToken!,
      REMOTE_POOL,
    );
    const runCalldata = factory.interface.encodeFunctionData("run", [BRIDGE_AMOUNT]);

    const salt = computeSalt();
    const values = {constructorAmount: 0n, initCallAmount: 0n};
    const createX = await getCreateX();
    const data = createX.interface.encodeFunctionData(
      "deployCreate3AndInit(bytes32,bytes,bytes,(uint256,uint256))",
      [salt, deployTx.data, runCalldata, values],
    );

    let revertData: string;
    try {
      await hre.ethers.provider.call({to: CREATE_X_ADDRESS, from: SIMULATION_DEPLOYER, data});
      expect.fail("Expected the simulated call to revert (run() always reverts on completion)");
    } catch (error) {
      revertData = extractRevertData(error);
    }

    // CreateX wraps run()'s revert as FailedContractInitialisation(address emitter, bytes
    // revertData); unwrap once, then decode the inner error against our own contract's ABI.
    const outer = createX.interface.parseError(revertData);
    assert(outer !== null, `Unrecognized revert data from CreateX: ${revertData}`);
    assert(
      outer.name === "FailedContractInitialisation",
      `Expected FailedContractInitialisation, got ${outer.name} (args: ${outer.args})`
    );
    const [, innerRevertData] = outer.args;

    const decoded = factory.interface.parseError(innerRevertData);
    // Bubbles up whatever earlier step actually failed (e.g. insufficient USDT0 balance if the
    // simulation address hasn't been pre-funded yet) instead of asserting blindly.
    assert(decoded !== null, `run() reverted with data that doesn't match any known error: ${innerRevertData}`);
    expect(decoded.name).to.equal("SimulationSucceeded");

    const [
      rebalancer, localPool, usdt0, feeToken, bridgeAmount, nativeFeeUsed, dstEid,
      startingBalance, localPoolBalanceAfterWithdraw, rebalancerBalanceAfterSend,
    ] = decoded.args;
    expect(bridgeAmount).to.equal(BRIDGE_AMOUNT);
    expect(dstEid).to.equal(ARBITRUM_ONE_EID);
    expect(usdt0).to.equal(forkNetworkConfig.Tokens.USDT?.Address);
    expect(feeToken).to.equal(forkNetworkConfig.USDT0FeeNativeToken);
    // The local pool must have been withdrawn from by at least bridgeAmount, and the Rebalancer
    // must have fully forwarded whatever it received to the OFT (nothing left sitting on it).
    expect(localPoolBalanceAfterWithdraw).to.equal(0n);
    expect(rebalancerBalanceAfterSend).to.equal(0n);

    console.log(`Simulated Rebalancer: ${rebalancer}`);
    console.log(`Simulated local pool: ${localPool}`);
    console.log(`Starting balance (before funding): ${startingBalance}`);
    console.log(`Native (LZD) fee used: ${nativeFeeUsed}`);
  });
});
