/**
  This file is generated automatically. **DO NOT MODIFY THIS FILE DIRECTLY**
  Updates are made by editing the JSON Schema files in the 'docs/' directory,
  then running the 'yarn build' script.
*/

/**
 * GET request that returns address assets
 */
export interface AddressAssetsListResponse {
  limit: number;
  offset: number;
  total: number;
  results: TransactionEvent[];
}

/**
 * GET request that returns address balances
 */
export interface AddressBalanceResponse {
  /**
   * Balance
   */
  stx: {
    balance: string;
    total_sent: string;
    total_received: string;
  };
  fungible_tokens: {
    /**
     * Balance
     *
     * This interface was referenced by `undefined`'s JSON-Schema definition
     * via the `patternProperty` "*".
     */
    [k: string]: {
      balance: string;
      total_sent: string;
      total_received: string;
    };
  };
  non_fungible_tokens: {
    /**
     * NftBalance
     *
     * This interface was referenced by `undefined`'s JSON-Schema definition
     * via the `patternProperty` "*".
     */
    [k: string]: {
      count: string;
      total_sent: string;
      total_received: string;
    };
  };
}

/**
 * GET request that returns account transactions
 */
export interface AccountTransactionsListResponse {
  limit: number;
  offset: number;
  total: number;
  results: (MempoolTransaction | Transaction)[];
}

/**
 * GET request that returns blocks
 */
export interface BlockListResponse {
  /**
   * The number of blocks to return
   */
  limit: number;
  /**
   * The number to blocks to skip (starting at `0`)
   */
  offset: number;
  /**
   * The number of blocks available
   */
  total: number;
  results: Block[];
}

/**
 * GET request for account data
 */
export interface AccountDataResponse {
  balance: string;
  nonce: number;
  balance_proof: string;
  nonce_proof: string;
}

/**
 * GET request to get contract interface
 */
export interface ContractInterfaceResponse {
  /**
   * List of defined methods
   */
  functions: unknown[];
  /**
   * List of defined variables
   */
  variables: unknown[];
  /**
   * List of defined data-maps
   */
  maps: unknown[];
  /**
   * List of fungible tokens in the contract
   */
  fungible_tokens: unknown[];
  /**
   * List of non-fungible tokens in the contract
   */
  non_fungible_tokens: unknown[];
}

/**
 * GET request to get contract source
 */
export interface ContractSourceResponse {
  source: string;
  publish_height: number;
  proof: string;
}

/**
 * GET request that core node information
 */
export interface CoreNodeInfoResponse {
  limit?: number;
  peer_version: number;
  burn_consensus: string;
  burn_block_height: number;
  stable_burn_consensus: string;
  stable_burn_block_height: number;
  server_version: string;
  network_id: number;
  parent_network_id: number;
  stacks_tip_height: number;
  stacks_tip: string;
  stacks_tip_burn_block: string;
  exit_at_block_height: number;
}

/**
 * POST request that runs the faucet
 */
export interface RunFaucetResponse {
  /**
   * Indicates if the faucet call was successful
   */
  success: boolean;
  /**
   * The transaction ID for the faucet call
   */
  txId?: string;
  /**
   * Raw transaction in hex string representation
   */
  txRaw?: string;
}

/**
 * GET request that returns transactions
 */
export interface MempoolTransactionListResponse {
  limit: number;
  offset: number;
  total: number;
  results: MempoolTransaction[];
}

/**
 * GET request that returns transactions
 */
export interface TransactionResults {
  /**
   * The number of transactions to return
   */
  limit: number;
  /**
   * The number to transactions to skip (starting at `0`)
   */
  offset: number;
  /**
   * The number of transactions available
   */
  total: number;
  results: Transaction[];
}

/**
 * A block
 */
export interface Block {
  /**
   * Set to `true` if block corresponds to the canonical chain tip
   */
  canonical: boolean;
  /**
   * Height of the block
   */
  height: number;
  /**
   * Hash representing the block
   */
  hash: string;
  /**
   * Hash of the prant block
   */
  parent_block_hash: string;
  /**
   * Unix timestamp (in seconds) indicating when this block was mined.
   */
  burn_block_time: number;
  /**
   * An ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) indicating when this block was mined.
   */
  burn_block_time_iso: string;
  /**
   * List of transactions included in the block
   */
  txs: string[];
}

/**
 * Describes representation of a Type-0 Stacks 2.0 transaction. https://github.com/blockstack/stacks-blockchain/blob/master/sip/sip-005-blocks-and-transactions.md#type-0-transferring-an-asset
 */
export interface MempoolTokenTransferTransaction {
  tx_id: string;
  tx_status: "pending";
  tx_result?: {
    hex: string;
    repr: string;
  };
  /**
   * Integer string (64-bit unsigned integer).
   */
  fee_rate: string;
  sender_address: string;
  /**
   * Denotes whether the originating account is the same as the paying account
   */
  sponsored: boolean;
  post_condition_mode: PostConditionMode;
  /**
   * A unix timestamp (in seconds) indicating when the transaction broadcast was received by the node.
   */
  receipt_time: number;
  /**
   * An ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) timestamp indicating when the transaction broadcast was received by the node.
   */
  receipt_time_iso: string;
  tx_type: "token_transfer";
  token_transfer: {
    recipient_address: string;
    /**
     * Integer string (64-bit unsigned integer)
     */
    amount: string;
    /**
     * Hex encoded arbitrary message, up to 34 bytes length (should try decoding to an ASCII string)
     */
    memo: string;
  };
}

/**
 * Describes representation of a Type-1 Stacks 2.0 transaction. https://github.com/blockstack/stacks-blockchain/blob/master/sip/sip-005-blocks-and-transactions.md#type-1-instantiating-a-smart-contract
 */
export interface MempoolSmartContractTransaction {
  tx_id: string;
  tx_status: "pending";
  tx_result?: {
    hex: string;
    repr: string;
  };
  /**
   * Integer string (64-bit unsigned integer).
   */
  fee_rate: string;
  sender_address: string;
  /**
   * Denotes whether the originating account is the same as the paying account
   */
  sponsored: boolean;
  post_condition_mode: PostConditionMode;
  /**
   * A unix timestamp (in seconds) indicating when the transaction broadcast was received by the node.
   */
  receipt_time: number;
  /**
   * An ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) timestamp indicating when the transaction broadcast was received by the node.
   */
  receipt_time_iso: string;
  tx_type: "smart_contract";
  smart_contract: {
    contract_id: string;
    /**
     * Clarity code of the smart contract being deployed
     */
    source_code: string;
  };
  post_conditions?: PostCondition[];
}

/**
 * Describes representation of a Type 2 Stacks 2.0 transaction: Contract Call
 */
export interface MempoolContractCallTransaction {
  tx_id: string;
  tx_status: "pending";
  tx_result?: {
    hex: string;
    repr: string;
  };
  /**
   * Integer string (64-bit unsigned integer).
   */
  fee_rate: string;
  sender_address: string;
  /**
   * Denotes whether the originating account is the same as the paying account
   */
  sponsored: boolean;
  post_condition_mode: PostConditionMode;
  /**
   * A unix timestamp (in seconds) indicating when the transaction broadcast was received by the node.
   */
  receipt_time: number;
  /**
   * An ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) timestamp indicating when the transaction broadcast was received by the node.
   */
  receipt_time_iso: string;
  tx_type: "contract_call";
  contract_call: {
    contract_id: string;
    /**
     * Name of the Clarity function to be invoked
     */
    function_name: string;
  };
  post_conditions: PostCondition[];
}

/**
 * Describes representation of a Type 3 Stacks 2.0 transaction: Poison Microblock
 */
export interface MempoolPoisonMicroblockTransaction {
  tx_id: string;
  tx_status: "pending";
  tx_result?: {
    hex: string;
    repr: string;
  };
  /**
   * Integer string (64-bit unsigned integer).
   */
  fee_rate: string;
  sender_address: string;
  /**
   * Denotes whether the originating account is the same as the paying account
   */
  sponsored: boolean;
  post_condition_mode: PostConditionMode;
  /**
   * A unix timestamp (in seconds) indicating when the transaction broadcast was received by the node.
   */
  receipt_time: number;
  /**
   * An ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) timestamp indicating when the transaction broadcast was received by the node.
   */
  receipt_time_iso: string;
  tx_type: "poison_microblock";
  poison_microblock: {
    /**
     * Hex encoded microblock header
     */
    microblock_header_1: string;
    /**
     * Hex encoded microblock header
     */
    microblock_header_2: string;
  };
}

/**
 * Describes representation of a Type 3 Stacks 2.0 transaction: Poison Microblock
 */
export interface MempoolCoinbaseTransaction {
  tx_id: string;
  tx_status: "pending";
  tx_result?: {
    hex: string;
    repr: string;
  };
  /**
   * Integer string (64-bit unsigned integer).
   */
  fee_rate: string;
  sender_address: string;
  /**
   * Denotes whether the originating account is the same as the paying account
   */
  sponsored: boolean;
  post_condition_mode: PostConditionMode;
  /**
   * A unix timestamp (in seconds) indicating when the transaction broadcast was received by the node.
   */
  receipt_time: number;
  /**
   * An ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) timestamp indicating when the transaction broadcast was received by the node.
   */
  receipt_time_iso: string;
  tx_type: "coinbase";
  coinbase_payload: {
    /**
     * Hex encoded 32-byte scratch space for block leader's use
     */
    data: string;
  };
}

/**
 * Describes all transaction types on Stacks 2.0 blockchain
 */
export type MempoolTransaction =
  | MempoolTokenTransferTransaction
  | MempoolSmartContractTransaction
  | MempoolContractCallTransaction
  | MempoolPoisonMicroblockTransaction
  | MempoolCoinbaseTransaction;

export interface PostConditionStx {
  principal: PostConditionPrincipal;
  condition_code: PostConditionFungibleConditionCode;
  amount: string;
  type: "stx";
}

export interface PostConditionFungible {
  principal: PostConditionPrincipal;
  condition_code: PostConditionFungibleConditionCode;
  type: "fungible";
  amount: string;
  asset: {
    asset_name: string;
    contract_address: string;
    contract_name: string;
  };
}

export interface PostConditionNonFungible {
  principal: PostConditionPrincipal;
  condition_code: PostConditionNonFungibleConditionCode;
  type: "non_fungible";
  asset_value: {
    hex: string;
    repr: string;
  };
  asset: {
    asset_name: string;
    contract_address: string;
    contract_name: string;
  };
}

/**
 * A fungible condition code encodes a statement being made for either STX or a fungible token, with respect to the originating account.
 */
export type PostConditionFungibleConditionCode =
  | "sent_equal_to"
  | "sent_greater_than"
  | "sent_greater_than_or_equal_to"
  | "sent_less_than"
  | "sent_less_than_or_equal_to";

export type PostConditionMode = "allow" | "deny";

/**
 * A non-fungible condition code encodes a statement being made about a non-fungible token, with respect to whether or not the particular non-fungible token is owned by the account.
 */
export type PostConditionNonFungibleConditionCode = "sent" | "not_sent";

export type PostConditionPrincipalType = "principal_origin" | "principal_standard" | "principal_contract";

export type PostConditionPrincipal =
  | {
      /**
       * String literal of type `PostConditionPrincipalType`
       */
      type_id: "principal_origin";
    }
  | {
      /**
       * String literal of type `PostConditionPrincipalType`
       */
      type_id: "principal_standard";
      address: string;
    }
  | {
      /**
       * String literal of type `PostConditionPrincipalType`
       */
      type_id: "principal_contract";
      address: string;
      contract_name: string;
    };

export type PostConditionType = "stx" | "non_fungible" | "fungible";

/**
 * Post-conditionscan limit the damage done to a user's assets
 */
export type PostCondition = PostConditionStx | PostConditionFungible | PostConditionNonFungible;

export type TransactionEventAssetType = "transfer" | "mint" | "burn";

export interface TransactionEventAsset {
  asset_event_type?: TransactionEventAssetType;
  asset_id?: string;
  sender?: string;
  recipient?: string;
  amount?: string;
  value?: string;
}

export interface TransactionEventFungibleAsset {
  event_index: number;
  event_type: "fungible_token_asset";
  asset: {
    asset_event_type: string;
    asset_id: string;
    sender: string;
    recipient: string;
    amount: string;
  };
}

export interface TransactionEventNonFungibleAsset {
  event_index: number;
  event_type: "non_fungible_token_asset";
  asset: {
    asset_event_type: string;
    asset_id: string;
    sender: string;
    recipient: string;
    value: {
      hex: string;
      repr: string;
    };
  };
}

/**
 * Only present in `smart_contract` and `contract_call` tx types.
 */
export interface TransactionEventSmartContractLog {
  event_index: number;
  event_type: "smart_contract_log";
  contract_log: {
    contract_id: string;
    topic: string;
    value: {
      hex: string;
      repr: string;
    };
  };
}

/**
 * Only present in `smart_contract` and `contract_call` tx types.
 */
export interface TransactionEventStxAsset {
  event_index: number;
  event_type: "stx_asset";
  asset: TransactionEventAsset;
}

/**
 * Events types
 */
export type TransactionEventType =
  | "smart_contract_log"
  | "stx_asset"
  | "fungible_token_asset"
  | "non_fungible_token_asset";

export type TransactionEvent =
  | TransactionEventSmartContractLog
  | TransactionEventStxAsset
  | TransactionEventFungibleAsset
  | TransactionEventNonFungibleAsset;

/**
 * Describes representation of a Type-0 Stacks 2.0 transaction. https://github.com/blockstack/stacks-blockchain/blob/master/sip/sip-005-blocks-and-transactions.md#type-0-transferring-an-asset
 */
export interface TokenTransferTransaction {
  /**
   * Hash of the blocked this transactions was associated with
   */
  block_hash: string;
  /**
   * Height of the block this transactions was associated with
   */
  block_height: number;
  /**
   * Unix timestamp (in seconds) indicating when this block was mined
   */
  burn_block_time: number;
  /**
   * An ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) timestamp indicating when this block was mined.
   */
  burn_block_time_iso: string;
  /**
   * Set to `true` if block corresponds to the canonical chain tip
   */
  canonical: boolean;
  /**
   * Transaction ID
   */
  tx_id: string;
  /**
   * Index of the transaction, indicating the order. Starts at `0` and increases with each transaction
   */
  tx_index: number;
  tx_status: TransactionStatus;
  /**
   * Result of the transaction. For contract calls, this will show the value returned by the call. For other transaction types, this will return a boolean indicating the success of the transaction.
   */
  tx_result?: {
    /**
     * Hex string representing the value fo the transaction result
     */
    hex: string;
    /**
     * Readable string of the transaction result
     */
    repr: string;
  };
  /**
   * Transaction fee as Integer string (64-bit unsigned integer).
   */
  fee_rate: string;
  /**
   * Address of the transaction initiator
   */
  sender_address: string;
  /**
   * Denotes whether the originating account is the same as the paying account
   */
  sponsored: boolean;
  post_condition_mode: PostConditionMode;
  tx_type: "token_transfer";
  /**
   * List of transaction events
   */
  events: TransactionEvent[];
  token_transfer: {
    recipient_address: string;
    /**
     * Transfer amount as Integer string (64-bit unsigned integer)
     */
    amount: string;
    /**
     * Hex encoded arbitrary message, up to 34 bytes length (should try decoding to an ASCII string)
     */
    memo: string;
  };
}

/**
 * Describes representation of a Type-1 Stacks 2.0 transaction. https://github.com/blockstack/stacks-blockchain/blob/master/sip/sip-005-blocks-and-transactions.md#type-1-instantiating-a-smart-contract
 */
export interface SmartContractTransaction {
  /**
   * Hash of the blocked this transactions was associated with
   */
  block_hash: string;
  /**
   * Height of the block this transactions was associated with
   */
  block_height: number;
  /**
   * Unix timestamp (in seconds) indicating when this block was mined
   */
  burn_block_time: number;
  /**
   * An ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) timestamp indicating when this block was mined.
   */
  burn_block_time_iso: string;
  /**
   * Set to `true` if block corresponds to the canonical chain tip
   */
  canonical: boolean;
  /**
   * Transaction ID
   */
  tx_id: string;
  /**
   * Index of the transaction, indicating the order. Starts at `0` and increases with each transaction
   */
  tx_index: number;
  tx_status: TransactionStatus;
  /**
   * Result of the transaction. For contract calls, this will show the value returned by the call. For other transaction types, this will return a boolean indicating the success of the transaction.
   */
  tx_result?: {
    /**
     * Hex string representing the value fo the transaction result
     */
    hex: string;
    /**
     * Readable string of the transaction result
     */
    repr: string;
  };
  /**
   * Transaction fee as Integer string (64-bit unsigned integer).
   */
  fee_rate: string;
  /**
   * Address of the transaction initiator
   */
  sender_address: string;
  /**
   * Denotes whether the originating account is the same as the paying account
   */
  sponsored: boolean;
  post_condition_mode: PostConditionMode;
  tx_type: "smart_contract";
  /**
   * List of transaction events
   */
  events: TransactionEvent[];
  smart_contract: {
    /**
     * Contract identifier formatted as `<principaladdress>.<contract_name>`
     */
    contract_id: string;
    /**
     * Clarity code of the smart contract being deployed
     */
    source_code: string;
  };
  post_conditions?: PostCondition[];
}

/**
 * Describes representation of a Type 2 Stacks 2.0 transaction: Contract Call
 */
export interface ContractCallTransaction {
  /**
   * Hash of the blocked this transactions was associated with
   */
  block_hash: string;
  /**
   * Height of the block this transactions was associated with
   */
  block_height: number;
  /**
   * Unix timestamp (in seconds) indicating when this block was mined
   */
  burn_block_time: number;
  /**
   * An ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) timestamp indicating when this block was mined.
   */
  burn_block_time_iso: string;
  /**
   * Set to `true` if block corresponds to the canonical chain tip
   */
  canonical: boolean;
  /**
   * Transaction ID
   */
  tx_id: string;
  /**
   * Index of the transaction, indicating the order. Starts at `0` and increases with each transaction
   */
  tx_index: number;
  tx_status: TransactionStatus;
  /**
   * Result of the transaction. For contract calls, this will show the value returned by the call. For other transaction types, this will return a boolean indicating the success of the transaction.
   */
  tx_result?: {
    /**
     * Hex string representing the value fo the transaction result
     */
    hex: string;
    /**
     * Readable string of the transaction result
     */
    repr: string;
  };
  /**
   * Transaction fee as Integer string (64-bit unsigned integer).
   */
  fee_rate: string;
  /**
   * Address of the transaction initiator
   */
  sender_address: string;
  /**
   * Denotes whether the originating account is the same as the paying account
   */
  sponsored: boolean;
  post_condition_mode: PostConditionMode;
  tx_type: "contract_call";
  /**
   * List of transaction events
   */
  events: TransactionEvent[];
  contract_call: {
    /**
     * Contract identifier formatted as `<principaladdress>.<contract_name>`
     */
    contract_id: string;
    /**
     * Name of the Clarity function to be invoked
     */
    function_name: string;
    /**
     * Function definition, including function name and type as well as parameter names and types
     */
    function_signature: string;
    /**
     * List of arguments used to invoke the function
     */
    function_args?: {
      hex: string;
      repr: string;
      name: string;
      type: string;
    }[];
  };
  post_conditions: PostCondition[];
}

/**
 * Describes representation of a Type 3 Stacks 2.0 transaction: Poison Microblock
 */
export interface PoisonMicroblockTransaction {
  /**
   * Hash of the blocked this transactions was associated with
   */
  block_hash: string;
  /**
   * Height of the block this transactions was associated with
   */
  block_height: number;
  /**
   * Unix timestamp (in seconds) indicating when this block was mined
   */
  burn_block_time: number;
  /**
   * An ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) timestamp indicating when this block was mined.
   */
  burn_block_time_iso: string;
  /**
   * Set to `true` if block corresponds to the canonical chain tip
   */
  canonical: boolean;
  /**
   * Transaction ID
   */
  tx_id: string;
  /**
   * Index of the transaction, indicating the order. Starts at `0` and increases with each transaction
   */
  tx_index: number;
  tx_status: TransactionStatus;
  /**
   * Result of the transaction. For contract calls, this will show the value returned by the call. For other transaction types, this will return a boolean indicating the success of the transaction.
   */
  tx_result?: {
    /**
     * Hex string representing the value fo the transaction result
     */
    hex: string;
    /**
     * Readable string of the transaction result
     */
    repr: string;
  };
  /**
   * Transaction fee as Integer string (64-bit unsigned integer).
   */
  fee_rate: string;
  /**
   * Address of the transaction initiator
   */
  sender_address: string;
  /**
   * Denotes whether the originating account is the same as the paying account
   */
  sponsored: boolean;
  post_condition_mode: PostConditionMode;
  tx_type: "poison_microblock";
  poison_microblock: {
    /**
     * Hex encoded microblock header
     */
    microblock_header_1: string;
    /**
     * Hex encoded microblock header
     */
    microblock_header_2: string;
  };
}

/**
 * Describes representation of a Type 3 Stacks 2.0 transaction: Poison Microblock
 */
export interface CoinbaseTransaction {
  /**
   * Hash of the blocked this transactions was associated with
   */
  block_hash: string;
  /**
   * Height of the block this transactions was associated with
   */
  block_height: number;
  /**
   * Unix timestamp (in seconds) indicating when this block was mined
   */
  burn_block_time: number;
  /**
   * An ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) timestamp indicating when this block was mined.
   */
  burn_block_time_iso: string;
  /**
   * Set to `true` if block corresponds to the canonical chain tip
   */
  canonical: boolean;
  /**
   * Transaction ID
   */
  tx_id: string;
  /**
   * Index of the transaction, indicating the order. Starts at `0` and increases with each transaction
   */
  tx_index: number;
  tx_status: TransactionStatus;
  /**
   * Result of the transaction. For contract calls, this will show the value returned by the call. For other transaction types, this will return a boolean indicating the success of the transaction.
   */
  tx_result?: {
    /**
     * Hex string representing the value fo the transaction result
     */
    hex: string;
    /**
     * Readable string of the transaction result
     */
    repr: string;
  };
  /**
   * Transaction fee as Integer string (64-bit unsigned integer).
   */
  fee_rate: string;
  /**
   * Address of the transaction initiator
   */
  sender_address: string;
  /**
   * Denotes whether the originating account is the same as the paying account
   */
  sponsored: boolean;
  post_condition_mode: PostConditionMode;
  tx_type: "coinbase";
  coinbase_payload: {
    /**
     * Hex encoded 32-byte scratch space for block leader's use
     */
    data: string;
  };
}

/**
 * Status of the transaction
 */
export type TransactionStatus = "success" | "pending" | "abort_by_response" | "abort_by_post_condition";

/**
 * String literal of all Stacks 2.0 transaction types
 */
export type TransactionType = "token_transfer" | "smart_contract" | "contract_call" | "poison_microblock" | "coinbase";

/**
 * Describes all transaction types on Stacks 2.0 blockchain
 */
export type Transaction =
  | TokenTransferTransaction
  | SmartContractTransaction
  | ContractCallTransaction
  | PoisonMicroblockTransaction
  | CoinbaseTransaction;

