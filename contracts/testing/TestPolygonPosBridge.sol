// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPolygonRootChainManager, IPolygonChildERC20} from "../interfaces/IPolygonPosBridge.sol";

/// @notice Stands in for a Polygon PoS child token on Polygon. withdraw() burns, exactly like
/// the real child tokens, which is what the exit on Ethereum is later proven against.
contract TestPolygonChildERC20 is ERC20, IPolygonChildERC20 {
    error SimulatedRevert();

    constructor() ERC20("Polygon Child Token", "pCHILD") {
        _mint(msg.sender, 1000 * 10 ** decimals());
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function withdraw(uint256 amount) external override {
        require(amount != 2000, SimulatedRevert());
        _burn(msg.sender, amount);
    }
}

/// @notice Stands in for the Polygon PoS RootChainManager on Ethereum.
/// Deposits are pulled by this contract acting as its own predicate, mirroring how the real
/// manager delegates the transfer to the predicate registered for the token type.
contract TestPolygonRootChainManager is IPolygonRootChainManager {
    using SafeERC20 for IERC20;

    bytes32 public constant ERC20_TYPE = keccak256("ERC20");

    address public immutable ROOT_TOKEN;
    address public immutable CHILD_TOKEN;
    /// @dev Set to address(0) to simulate a token type with no registered predicate.
    address public predicate;

    error InvalidToken();
    error SimulatedRevert();

    event DepositedFor(address indexed user, address indexed rootToken, uint256 amount);

    constructor(address rootToken, address childToken) {
        ROOT_TOKEN = rootToken;
        CHILD_TOKEN = childToken;
        predicate = address(this);
    }

    function setPredicate(address newPredicate) external {
        predicate = newPredicate;
    }

    function rootToChildToken(address rootToken) external view override returns (address) {
        if (rootToken != ROOT_TOKEN) {
            return address(0);
        }
        return CHILD_TOKEN;
    }

    function tokenToType(address) external pure override returns (bytes32) {
        return keccak256("ERC20");
    }

    function typeToPredicate(bytes32 tokenType) external view override returns (address) {
        if (tokenType != keccak256("ERC20")) {
            return address(0);
        }
        return predicate;
    }

    function depositFor(address user, address rootToken, bytes calldata depositData) external override {
        require(rootToken == ROOT_TOKEN, InvalidToken());
        uint256 amount = abi.decode(depositData, (uint256));
        require(amount != 2000, SimulatedRevert());
        IERC20(rootToken).safeTransferFrom(msg.sender, predicate, amount);
        emit DepositedFor(user, rootToken, amount);
    }

    /// @dev inputData encodes (address token, address to, uint256 amount), standing in for the
    /// RLP burn proof. The real manager always releases to the burner; the tests pass the
    /// Repayer as `to` to match that.
    function exit(bytes calldata inputData) external override {
        (address token, address to, uint256 amount) = abi.decode(inputData, (address, address, uint256));
        require(amount != 2000, SimulatedRevert());
        IERC20(token).safeTransfer(to, amount);
    }
}
