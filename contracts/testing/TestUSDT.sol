// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

/// @notice Minimal mock replicating real USDT's non-standard ERC20 behavior for testing:
/// transfer/transferFrom/approve return no value (unlike the standard bool-returning ERC20),
/// and approve() reverts when changing an existing nonzero allowance to another nonzero value
/// without resetting it to zero first. Exercises SafeERC20/forceApprove usage in production code.
contract TestUSDT {
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error InsufficientBalance();
    error InsufficientAllowance();
    error ApproveRaceCondition();

    constructor() {
        _mint(msg.sender, 1000 * 10 ** decimals());
    }

    function name() public pure returns (string memory) {
        return "Tether USD";
    }

    function symbol() public pure returns (string memory) {
        return "USDT";
    }

    function decimals() public pure returns (uint8) {
        return 6;
    }

    function transfer(address to, uint256 amount) external {
        _transfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, InsufficientAllowance());
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
    }

    /// @dev Reverts on a nonzero -> nonzero allowance change, matching real USDT's approve race
    /// condition mitigation. Callers must approve(spender, 0) before setting a new nonzero value.
    function approve(address spender, uint256 amount) external {
        require(amount == 0 || allowance[msg.sender][spender] == 0, ApproveRaceCondition());
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, InsufficientBalance());
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
        emit Transfer(msg.sender, address(0), amount);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, InsufficientBalance());
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}
