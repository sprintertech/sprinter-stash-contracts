import {expect} from "chai";
import hre from "hardhat";
import {concat, dataSlice, keccak256, toUtf8Bytes} from "ethers";
import {getCreateX} from "../../test/helpers";
import {assert, assertAddress, CREATE_X_ADDRESS} from "../../scripts/common";
import {prodNetworkConfig as networkConfig} from "../../network.config";

// Tempo is not fully EVM-compatible (e.g. CALLVALUE and BALANCE always return 0), so Hardhat's
// fork/EDR network cannot replicate its real execution semantics. Instead of forking, the
// entire scenario (fund Repayer, wrap USDT0 into the LZD fee token, initiateRepay) runs inside
// RepayerUSDT0Tempo, and gets simulated via read-only eth_calls sent directly to live Tempo
// mainnet: nothing here forks state, spends real gas, or persists.
//
// Run with: hardhat test --network TEMPO ./specific-fork-test/tempo/RepayerUSDT0.ts
// (a direct connection to the real network, NOT `FORK_TEST=TEMPO`).
//
// RepayerUSDT0Tempo's constructor only does setup that is not expected to fail (deploying a
// fresh Repayer implementation + proxy, wiring the USDT0 route); run() does everything that
// could actually fail (funding, wrapping the LZD fee, initiateRepay) and always reverts on
// completion, so CreateX's deployCreate3AndInit forwards the real revert reason via
// FailedContractInitialisation(address,bytes) rather than swallowing it behind its own
// generic, reason-less FailedContractCreation(address) (which is what happens if a plain
// deployCreate3's constructor itself reverts).
//
// RepayerUSDT0Tempo is deployed via CreateX's deployCreate3(AndInit) at a deterministic address
// (independent of the contract's bytecode, so future edits to it don't change the address)
// that must be pre-funded with real USDT0, since every call run() makes has msg.sender == that
// address — an eth_call's `from` override only affects the outermost call, not calls made
// further down the stack. "TempoSimulation" is intentionally test-case agnostic so other Tempo
// simulation contracts can reuse this same pre-funded address later.
describe("Repayer USDT0 (Tempo simulation)", function () {
  const SIMULATION_DEPLOYER = "0xdBD91aD22bE5304e385b7b0A2Cfe91164e416e11";
  const SIMULATION_ID = "TempoSimulation";
  const BRIDGE_AMOUNT = 1_000_000n; // 1 USDT0 (6 decimals).
  const DESTINATION_POOL = "0x000000000000000000000000000000000000dEaD";
  const ARBITRUM_ONE_EID = 30110n;
  // Must match RepayerUSDT0Tempo.EXPECTED_ADDRESS, and is pre-funded with real USDT0 on Tempo.
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

    const factory = await hre.ethers.getContractFactory("RepayerUSDT0Tempo");
    const deployTx = await factory.getDeployTransaction(
      forkNetworkConfig.USDT0OFT!,
      forkNetworkConfig.USDT0FeeNativeToken!,
      DESTINATION_POOL,
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

    const factory = await hre.ethers.getContractFactory("RepayerUSDT0Tempo");
    const deployTx = await factory.getDeployTransaction(
      forkNetworkConfig.USDT0OFT!,
      forkNetworkConfig.USDT0FeeNativeToken!,
      DESTINATION_POOL,
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
      repayer, usdt0, feeToken, bridgeAmount, nativeFeeUsed, dstEid,
      startingBalance, repayerBalanceBeforeSend, repayerBalanceAfterSend,
    ] = decoded.args;
    expect(bridgeAmount).to.equal(BRIDGE_AMOUNT);
    expect(dstEid).to.equal(ARBITRUM_ONE_EID);
    expect(repayerBalanceBeforeSend).to.equal(BRIDGE_AMOUNT);
    expect(usdt0).to.equal(forkNetworkConfig.Tokens.USDT?.Address);
    expect(feeToken).to.equal(forkNetworkConfig.USDT0FeeNativeToken);
    // The OFT must have actually pulled/burned at least bridgeAmount from the Repayer.
    expect(repayerBalanceBeforeSend - repayerBalanceAfterSend).to.be.greaterThanOrEqual(BRIDGE_AMOUNT);

    console.log(`Simulated Repayer: ${repayer}`);
    console.log(`Starting balance (before funding): ${startingBalance}`);
    console.log(`Repayer USDT0 balance after send: ${repayerBalanceAfterSend}`);
    console.log(`Native (LZD) fee used: ${nativeFeeUsed}`);
  });
});
