// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {ERC20, ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {IManagedToken} from "./interfaces/IManagedToken.sol";

contract ManagedToken is IManagedToken, ERC20Permit {
    address immutable public MANAGER;

    error AccessDenied();

    constructor(string memory name_, string memory symbol_, address manager)
        ERC20(name_, symbol_)
        ERC20Permit(name_)
    {
        MANAGER = manager;
    }

    modifier onlyManager() {
        require(_msgSender() == MANAGER, AccessDenied());
        _;
    }

    function mint(address to, uint256 amount) external onlyManager() {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyManager() {
        _burn(from, amount);
    }

    function spendAllowance(address owner, address spender, uint256 value) external onlyManager() {
        _spendAllowance(owner, spender, value);
    }
}
