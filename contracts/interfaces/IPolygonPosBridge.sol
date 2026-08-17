// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

/**
 * @title Interface for the Polygon PoS RootChainManager on Ethereum.
 * Ethereum RootChainManager: 0xA0c68C638235ee32657e8f720a23ceC1bFc77C77
 */
interface IPolygonRootChainManager {
    /**
     * @notice Locks the root token and mints its child token to `user` on Polygon.
     * @dev The caller must approve the token type's predicate (not this contract) for the amount.
     * @param user Recipient on Polygon. Gets the child token of `rootToken`.
     * @param rootToken Token on Ethereum. Must have a mapped child token.
     * @param depositData ABI encoded amount for ERC20 tokens.
     */
    function depositFor(address user, address rootToken, bytes calldata depositData) external;

    /**
     * @notice Finalises a Polygon -> Ethereum transfer by proving the burn on Polygon.
     * @dev Callable by anyone, but the tokens are always released to the address that burned
     * the child token on Polygon, not to the caller.
     * @param inputData RLP encoded burn proof, valid only after the burn has been checkpointed.
     */
    function exit(bytes calldata inputData) external;

    /// @notice The child token minted on Polygon for a given Ethereum token. Zero if unmapped.
    function rootToChildToken(address rootToken) external view returns (address);

    /// @notice The token type of a given Ethereum token, used to look up its predicate.
    function tokenToType(address rootToken) external view returns (bytes32);

    /// @notice The predicate that escrows deposits of a given token type.
    function typeToPredicate(bytes32 tokenType) external view returns (address);
}

/**
 * @title Interface for a Polygon PoS child token on Polygon.
 * @notice Every token bridged in via the PoS bridge exposes withdraw() to bridge back out.
 */
interface IPolygonChildERC20 {
    /**
     * @notice Burns `amount` of the caller's tokens, starting the exit to Ethereum.
     * @dev The root tokens are later released to the caller's address on Ethereum
     * by IPolygonRootChainManager.exit().
     */
    function withdraw(uint256 amount) external;
}
