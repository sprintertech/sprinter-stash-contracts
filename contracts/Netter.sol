// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IOracle} from "./interfaces/IOracle.sol";
import {IProcessor} from "./interfaces/IProcessor.sol";

/// @title Netter — nets two Processor balances against each other at oracle fair value.
/// @notice Instead of selling tokens on the open market, two processors can swap their
///         accumulated foreign-asset balances through this contract, avoiding market slippage.
///         The oracle ensures both sides carry equal value before any transfer is made.
/// @author Sprinter
contract Netter is AccessControl {
    IOracle public immutable ORACLE;

    bytes32 public constant CALLER_ROLE = "CALLER_ROLE";

    error ZeroAddress();
    error ValuesNotEqual();

    event Netted(
        address processorA,
        address processorB,
        uint256 amountFromA,
        uint256 amountFromB
    );

    constructor(address oracle, address admin, address caller) {
        require(oracle != address(0), ZeroAddress());
        require(admin != address(0), ZeroAddress());
        ORACLE = IOracle(oracle);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CALLER_ROLE, caller);
    }

    /// @notice Net processorA's balance of processorB's asset against processorB's balance of processorA's asset.
    /// @param processorA Processor that holds amountFromA of processorB.TARGET_ASSET and will forward it.
    /// @param processorB Processor that holds amountFromB of processorA.TARGET_ASSET and will forward it.
    /// @param amountFromA Amount of processorB.TARGET_ASSET that processorA forwards.
    /// @param amountFromB Amount of processorA.TARGET_ASSET that processorB forwards.
    function net(
        IProcessor processorA,
        IProcessor processorB,
        uint256 amountFromA,
        uint256 amountFromB
    ) external onlyRole(CALLER_ROLE) {
        IERC20 assetA = processorA.TARGET_ASSET();
        IERC20 assetB = processorB.TARGET_ASSET();

        uint256 precision = 10**12;
        uint256 valueA = ORACLE.getAssetValue(_toAssetId(assetA), amountFromB * precision);
        uint256 valueB = ORACLE.getAssetValue(_toAssetId(assetB), amountFromA * precision);
        require(valueA == valueB, ValuesNotEqual());

        processorA.forwardAmount(assetB, amountFromA);
        processorB.forwardAmount(assetA, amountFromB);

        emit Netted(address(processorA), address(processorB), amountFromA, amountFromB);
    }

    function _toAssetId(IERC20 token) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(address(token))));
    }
}
