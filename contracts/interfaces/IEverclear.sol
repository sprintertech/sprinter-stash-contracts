// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title IEverclear
 * @notice Common interface for EverclearHub and EverclearSpoke
 */
interface IEverclear {
  /*//////////////////////////////////////////////////////////////
                                ENUMS
    //////////////////////////////////////////////////////////////*/
  /**
   * @notice Enum representing statuses of an intent
   */
  enum IntentStatus {
    NONE, // 0
    ADDED, // 1
    DEPOSIT_PROCESSED, // 2
    FILLED, // 3
    ADDED_AND_FILLED, // 4
    INVOICED, // 5
    SETTLED, // 6
    SETTLED_AND_MANUALLY_EXECUTED, // 7
    UNSUPPORTED, // 8
    UNSUPPORTED_RETURNED // 9

  }

  /**
   * @notice Enum representing asset strategies
   */
  enum Strategy {
    DEFAULT,
    XERC20
  }

  /*///////////////////////////////////////////////////////////////
                            STRUCTS
  //////////////////////////////////////////////////////////////*/

  /**
   * @notice The structure of an intent
   * @param initiator The address of the intent initiator
   * @param receiver The address of the intent receiver
   * @param inputAsset The address of the intent asset on origin
   * @param outputAsset The address of the intent asset on destination
   * @param maxFee The maximum fee that can be taken by solvers
   * @param origin The origin chain of the intent
   * @param destinations The possible destination chains of the intent
   * @param nonce The nonce of the intent
   * @param timestamp The timestamp of the intent
   * @param ttl The time to live of the intent
   * @param amount The amount of the intent asset normalized to 18 decimals
   * @param data The data of the intent
   */
  struct Intent {
    bytes32 initiator;
    bytes32 receiver;
    bytes32 inputAsset;
    bytes32 outputAsset;
    uint24 maxFee;
    uint32 origin;
    uint64 nonce;
    uint48 timestamp;
    uint48 ttl;
    uint256 amount;
    uint32[] destinations;
    bytes data;
  }

  /**
   * @notice The structure of a fill message
   * @param intentId The ID of the intent
   * @param solver The address of the intent solver in bytes32 format
   * @param initiator The address of the intent initiator
   * @param fee The total fee of the expressed in dbps, represents the solver fee plus the sum of protocol fees for the token
   * @param executionTimestamp The execution timestamp of the intent
   */
  struct FillMessage {
    bytes32 intentId;
    bytes32 solver;
    bytes32 initiator;
    uint24 fee;
    uint48 executionTimestamp;
  }

  /**
   * @notice The structure of a settlement
   * @param intentId The ID of the intent
   * @param amount The amount of the asset
   * @param asset The address of the asset
   * @param recipient The address of the recipient
   * @param updateVirtualBalance If set to true, the settlement will not be transferred to the recipient in spoke domain and the virtual balance will be increased
   */
  struct Settlement {
    bytes32 intentId;
    uint256 amount;
    bytes32 asset;
    bytes32 recipient;
    bool updateVirtualBalance;
  }
}

interface IFeeAdapter {
  struct OrderParameters {
    uint32[] destinations;
    address receiver;
    address inputAsset;
    address outputAsset;
    uint256 amount;
    uint24 maxFee;
    uint48 ttl;
    bytes data;
  }

  struct FeeParams {
    uint256 fee;
    uint256 deadline;
    bytes sig;
  }

  /**
   * @notice Emitted when a new intent is created with fees
   * @param _intentId The ID of the created intent
   * @param _initiator The address of the user who initiated the intent
   * @param _tokenFee The amount of token fees paid
   * @param _nativeFee The amount of native token fees paid
   */
  event IntentWithFeesAdded(
    bytes32 indexed _intentId, bytes32 indexed _initiator, uint256 _tokenFee, uint256 _nativeFee
  );

  /**
   * @notice Creates a new intent with fees
   * @param _destinations Array of destination domains, preference ordered
   * @param _receiver Address of the receiver on the destination chain
   * @param _inputAsset Address of the input asset
   * @param _outputAsset Address of the output asset
   * @param _amount Amount of input asset to use for the intent
   * @param _maxFee Maximum fee percentage allowed for the intent
   * @param _ttl Time-to-live for the intent in seconds
   * @param _data Additional data for the intent
   * @param _feeParams Fee parameters including fee amount, deadline, and signature
   * @return _intentId The ID of the created intent
   * @return _intent The created intent object
   */
  function newIntent(
    uint32[] memory _destinations,
    bytes32 _receiver,
    address _inputAsset,
    bytes32 _outputAsset,
    uint256 _amount,
    uint24 _maxFee,
    uint48 _ttl,
    bytes calldata _data,
    FeeParams calldata _feeParams
  ) external payable returns (bytes32, IEverclear.Intent memory);
}
