// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {MulticallUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/MulticallUpgradeable.sol";
import {IRoyco} from "./interfaces/IRoyco.sol";
import {IERC7540} from "./interfaces/IERC7540.sol";

/// @title Processor for unwinding vault tokens.
/// @author Sprinter
contract Processor is AccessControlUpgradeable, MulticallUpgradeable {
    using SafeERC20 for IERC20;

    IERC20 public immutable TARGET_ASSET;
    address public immutable RECEIVER;

    bytes32 internal constant CALLER_ROLE = "CALLER_ROLE";

    event Forwarded(address caller, IERC20 token);

    error ZeroAddress();

    constructor(address asset, address receiver) {
        _disableInitializers();
        require(asset != address(0), ZeroAddress());
        require(receiver != address(0), ZeroAddress());
        TARGET_ASSET = IERC20(asset);
        RECEIVER = receiver;
    }

    function initialize(
        address admin,
        address caller
    ) public initializer {
        require(admin != address(0), ZeroAddress());
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CALLER_ROLE, caller);
    }

    function forward(IERC20 token) external onlyRole(CALLER_ROLE) {
        token.safeTransfer(RECEIVER, token.balanceOf(address(this)));

        emit Forwarded(msg.sender, token);
    }

    function redeem7540(IERC7540 token) external onlyRole(CALLER_ROLE) {
        uint256 balance = token.balanceOf(address(this));
        token.requestRedeem(balance, address(this), address(this));
    }

    function claim7540(IERC7540 token) external {
        withdraw4626(token);
    }

    function redeem4626(IERC4626 token) external onlyRole(CALLER_ROLE) {
        uint256 balance = token.maxRedeem(address(this));
        token.redeem(balance, address(this), address(this));
    }

    function withdraw4626(IERC4626 token) public onlyRole(CALLER_ROLE) {
        uint256 balance = token.maxWithdraw(address(this));
        token.withdraw(balance, address(this), address(this));
    }
    
    function claimRoyco(IRoyco token, uint256[] calldata epochIDs) external onlyRole(CALLER_ROLE) {
        token.claimWithdrawal(epochIDs);
    }
}
