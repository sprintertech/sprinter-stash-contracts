// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

/**
 * @title Interface for Arbitrum Gateway Router
 */
interface IArbitrumGatewayRouter {

    event TransferRouted(
        address indexed token,
        address indexed _userFrom,
        address indexed _userTo,
        address gateway
    );

    /**
    * @notice For new versions of gateways it's recommended to use outboundTransferCustomRefund() method.
    * @notice Some legacy gateways (for example, DAI) don't have the outboundTransferCustomRefund method
    * @notice so using outboundTransfer() method is a universal solution
    */
    function outboundTransfer(
        address _token,
        address _to,
        uint256 _amount,
        uint256 _maxGas,
        uint256 _gasPriceBid,
        bytes calldata _data
    ) external payable returns (bytes memory);

    /**
     * @notice Calculate the address used when bridging an ERC20 token
     * @dev the L1 and L2 address oracles may not always be in sync.
     * For example, a custom token may have been registered but not deploy or the contract self destructed.
     * @param l1ERC20 address of L1 token
     * @return L2 address of a bridged ERC20 token
     */
    function calculateL2TokenAddress(address l1ERC20) external view returns (address);

    function getGateway(address _token) external view returns (address gateway);
}
