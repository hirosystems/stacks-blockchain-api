/**
 * GET request that returns transactions
 */
export interface BlockResults {
  limit: number;
  offset: number;
  total: number;
  results: Block[];
}

/**
 * GET request that returns transactions
 */
export interface TransactionResults {
  limit: number;
  offset: number;
  total: number;
  results: Transaction[];
}

/**
 * A block
 */
export interface Block {
  canonical: boolean;
  height: number;
  hash: string;
  parent_block_hash: string;
  /**
   * A unix timestamp (in seconds) indicating when this block was mined.
   */
  burn_block_time: number;
  txs: string[];
}

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
  block_hash: string;
  block_height: number;
  /**
   * A unix timestamp (in seconds) indicating when this block was mined.
   */
  burn_block_time: number;
  canonical: boolean;
  tx_id: string;
  tx_index: number;
  tx_status: TransactionStatus;
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
export interface SmartContractTransaction {
  block_hash: string;
  block_height: number;
  /**
   * A unix timestamp (in seconds) indicating when this block was mined.
   */
  burn_block_time: number;
  canonical: boolean;
  tx_id: string;
  tx_index: number;
  tx_status: TransactionStatus;
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
  tx_type: "smart_contract";
  events: TransactionEvent[];
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
export interface ContractCallTransaction {
  block_hash: string;
  block_height: number;
  /**
   * A unix timestamp (in seconds) indicating when this block was mined.
   */
  burn_block_time: number;
  canonical: boolean;
  tx_id: string;
  tx_index: number;
  tx_status: TransactionStatus;
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
  tx_type: "contract_call";
  events: TransactionEvent[];
  contract_call: {
    contract_id: string;
    /**
     * Name of the Clarity function to be invoked
     */
    function_name: string;
    function_signature: string;
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
  block_hash: string;
  block_height: number;
  /**
   * A unix timestamp (in seconds) indicating when this block was mined.
   */
  burn_block_time: number;
  canonical: boolean;
  tx_id: string;
  tx_index: number;
  tx_status: TransactionStatus;
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
  block_hash: string;
  block_height: number;
  /**
   * A unix timestamp (in seconds) indicating when this block was mined.
   */
  burn_block_time: number;
  canonical: boolean;
  tx_id: string;
  tx_index: number;
  tx_status: TransactionStatus;
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
  tx_type: "coinbase";
  coinbase_payload: {
    /**
     * Hex encoded 32-byte scratch space for block leader's use
     */
    data: string;
  };
}

/**
 * All states a transaction can have
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

