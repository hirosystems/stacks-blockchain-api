/*
  This file is generated automatically. **DO NOT MODIFY THIS FILE DIRECTLY**
  Updates are made by editing the JSON Schema files in the 'docs/' directory,
  then running the 'npm build' script.
*/

export type SchemaMergeRootStub =
  | AddressAssetsListResponse
  | AddressBalanceResponse
  | AddressNftListResponse
  | AddressStxBalanceResponse
  | AddressStxInboundListResponse
  | AddressTransactionsWithTransfersListResponse
  | AddressTransactionsListResponse
  | BlockListResponse
  | BnsError
  | BnsFetchFileZoneResponse
  | BnsGetAllNamesResponse
  | BnsGetAllSubdomainsResponse
  | BnsFetchHistoricalZoneFileResponse
  | BnsGetNameHistoryResponse
  | BnsGetNameInfoResponse
  | BnsGetNamePriceResponse
  | BnsNamesOwnByAddressResponse
  | BnsGetSubdomainAtTx
  | BnsGetAllNamespacesNamesResponse
  | BnsGetAllNamespacesResponse
  | BnsGetNamespacePriceResponse
  | BurnchainRewardSlotHolderListResponse
  | BurnchainRewardListResponse
  | ReadOnlyFunctionSuccessResponse
  | AccountDataResponse
  | MapEntryResponse
  | ContractInterfaceResponse
  | ContractSourceResponse
  | CoreNodeFeeResponse
  | CoreNodeInfoResponse
  | CoreNodePoxResponse
  | RunFaucetResponse
  | FeeRateRequest
  | FeeRate
  | NetworkBlockTimeResponse
  | NetworkBlockTimesResponse
  | ServerStatusResponse
  | GetStxCirculatingSupplyPlainResponse
  | GetStxSupplyLegacyFormatResponse
  | GetStxTotalSupplyPlainResponse
  | GetStxSupplyResponse
  | MicroblockListResponse
  | UnanchoredTransactionListResponse
  | RosettaAccountBalanceRequest
  | RosettaAccountBalanceResponse
  | RosettaBlockRequest
  | RosettaBlockResponse
  | RosettaBlockTransactionRequest
  | RosettaBlockTransactionResponse
  | RosettaConstructionCombineRequest
  | RosettaConstructionCombineResponse
  | RosettaConstructionDeriveRequest
  | RosettaConstructionDeriveResponse
  | RosettaConstructionHashRequest
  | RosettaConstructionHashResponse
  | RosettaConstructionMetadataRequest
  | RosettaConstructionMetadataResponse
  | RosettaConstructionParseRequest
  | RosettaConstructionParseResponse
  | RosettaConstructionPayloadsRequest
  | RosettaConstructionPayloadResponse
  | RosettaConstructionPreprocessRequest
  | RosettaConstructionPreprocessResponse
  | RosettaConstructionSubmitRequest
  | RosettaConstructionSubmitResponse
  | RosettaMempoolRequest
  | RosettaMempoolResponse
  | RosettaMempoolTransactionRequest
  | RosettaMempoolTransactionResponse
  | RosettaNetworkListRequest
  | RosettaNetworkListResponse
  | RosettaOptionsRequest
  | RosettaNetworkOptionsResponse
  | RosettaStatusRequest
  | RosettaNetworkStatusResponse
  | AddressSearchResult
  | BlockSearchResult
  | ContractSearchResult
  | SearchErrorResult
  | MempoolTxSearchResult
  | SearchSuccessResult
  | TxSearchResult
  | SearchResult
  | {
      [k: string]: unknown | undefined;
    }
  | FungibleTokensMetadataList
  | NonFungibleTokensMetadataList
  | MempoolTransactionListResponse
  | GetRawTransactionResult
  | TransactionResults
  | PostCoreNodeTransactionsError
  | AddressNonces
  | AddressTokenOfferingLocked
  | AddressTransactionWithTransfers
  | AddressUnlockSchedule
  | {
      balance: string;
      total_sent: string;
      total_received: string;
    }
  | {
      count: string;
      total_sent: string;
      total_received: string;
    }
  | {
      balance: string;
      total_sent: string;
      total_received: string;
      total_fees_sent: string;
      total_miner_rewards_received: string;
      /**
       * The transaction where the lock event occurred. Empty if no tokens are locked.
       */
      lock_tx_id: string;
      /**
       * The amount of locked STX, as string quoted micro-STX. Zero if no tokens are locked.
       */
      locked: string;
      /**
       * The STX chain block height of when the lock event occurred. Zero if no tokens are locked.
       */
      lock_height: number;
      /**
       * The burnchain block height of when the lock event occurred. Zero if no tokens are locked.
       */
      burnchain_lock_height: number;
      /**
       * The burnchain block height of when the tokens unlock. Zero if no tokens are locked.
       */
      burnchain_unlock_height: number;
    }
  | Block
  | BurnchainRewardSlotHolder
  | BurnchainReward
  | BurnchainRewardsTotal
  | ReadOnlyFunctionArgs
  | {
      target_block_time: number;
    }
  | AbstractMempoolTransaction
  | MempoolTokenTransferTransaction
  | MempoolSmartContractTransaction
  | MempoolContractCallTransaction
  | MempoolPoisonMicroblockTransaction
  | MempoolCoinbaseTransaction
  | MempoolTransactionStatus1
  | MempoolTransaction
  | Microblock
  | NftEvent
  | PostConditionStx
  | PostConditionFungible
  | PostConditionNonFungible
  | PostConditionFungibleConditionCode
  | PostConditionMode
  | PostConditionNonFungibleConditionCode
  | PostConditionPrincipalType
  | PostConditionPrincipal
  | PostConditionType
  | PostCondition
  | RosettaAccountIdentifier
  | RosettaAccount
  | RosettaMaxFeeAmount
  | RosettaAmount
  | RosettaBlockIdentifierHash
  | RosettaBlockIdentifierHeight
  | RosettaBlockIdentifier
  | RosettaBlock
  | RosettaCoinChange
  | RosettaCoin
  | RosettaOptions
  | RosettaCurrency2
  | RosettaErrorNoDetails
  | RosettaError
  | RosettaGenesisBlockIdentifier
  | NetworkIdentifier
  | RosettaPeers
  | RosettaOldestBlockIdentifier
  | RosettaOperationIdentifier1
  | RosettaOperationStatus
  | RosettaOperation
  | OtherTransactionIdentifier
  | RosettaParentBlockIdentifier
  | RosettaPartialBlockIdentifier
  | RosettaPublicKey
  | RosettaRelatedOperation
  | ("ecdsa" | "ecdsa_recovery" | "ed25519" | "schnorr_1" | "schnorr_poseidon")
  | RosettaSignature
  | SigningPayload
  | RosettaSubAccount
  | RosettaSyncStatus
  | TransactionIdentifier
  | RosettaTransaction
  | FungibleTokenMetadata
  | NonFungibleTokenMetadata
  | {
      event_index: number;
      [k: string]: unknown | undefined;
    }
  | TransactionEventAssetType
  | TransactionEventAsset
  | TransactionEventFungibleAsset
  | TransactionEventNonFungibleAsset
  | TransactionEventSmartContractLog
  | TransactionEventStxAsset
  | TransactionEventStxLock
  | TransactionEventType
  | TransactionEvent
  | AbstractTransaction
  | TransactionAnchorModeType
  | BaseTransaction
  | TokenTransferTransactionMetadata
  | TokenTransferTransaction
  | SmartContractTransactionMetadata
  | SmartContractTransaction
  | ContractCallTransactionMetadata
  | ContractCallTransaction
  | PoisonMicroblockTransactionMetadata
  | PoisonMicroblockTransaction
  | CoinbaseTransactionMetadata
  | CoinbaseTransaction
  | TransactionFound
  | TransactionList
  | TransactionMetadata
  | TransactionNotFound
  | TransactionStatus1
  | TransactionType
  | Transaction
  | InboundStxTransfer
  | RpcAddressBalanceNotificationParams
  | RpcAddressBalanceNotificationResponse
  | RpcAddressBalanceSubscriptionParams
  | RpcAddressBalanceSubscriptionRequest
  | RpcAddressTxNotificationParams
  | RpcAddressTxNotificationResponse
  | RpcAddressTxSubscriptionParams
  | RpcAddressTxSubscriptionRequest
  | RpcSubscriptionType
  | RpcTxUpdateNotificationParams
  | RpcTxUpdateNotificationResponse
  | RpcTxUpdateSubscriptionParams
  | RpcTxUpdateSubscriptionRequest;
export type TransactionEvent =
  | TransactionEventSmartContractLog
  | TransactionEventStxLock
  | TransactionEventStxAsset
  | TransactionEventFungibleAsset
  | TransactionEventNonFungibleAsset;
/**
 * Only present in `smart_contract` and `contract_call` tx types.
 */
export type TransactionEventSmartContractLog = {
  event_index: number;
  [k: string]: unknown | undefined;
} & {
  event_type: "smart_contract_log";
  tx_id: string;
  contract_log: {
    contract_id: string;
    topic: string;
    value: {
      hex: string;
      repr: string;
    };
  };
  [k: string]: unknown | undefined;
};
/**
 * Only present in `smart_contract` and `contract_call` tx types.
 */
export type TransactionEventStxLock = {
  event_index: number;
  [k: string]: unknown | undefined;
} & {
  event_type: "stx_lock";
  tx_id: string;
  stx_lock_event: {
    locked_amount: string;
    unlock_height: number;
    locked_address: string;
  };
  [k: string]: unknown | undefined;
};
/**
 * Only present in `smart_contract` and `contract_call` tx types.
 */
export type TransactionEventStxAsset = {
  event_index: number;
  [k: string]: unknown | undefined;
} & {
  event_type: "stx_asset";
  tx_id: string;
  asset: TransactionEventAsset;
  [k: string]: unknown | undefined;
};
export type TransactionEventAssetType = "transfer" | "mint" | "burn";
export type TransactionEventFungibleAsset = {
  event_index: number;
  [k: string]: unknown | undefined;
} & {
  event_type: "fungible_token_asset";
  tx_id: string;
  asset: {
    asset_event_type: string;
    asset_id: string;
    sender: string;
    recipient: string;
    amount: string;
  };
  [k: string]: unknown | undefined;
};
export type TransactionEventNonFungibleAsset = {
  event_index: number;
  [k: string]: unknown | undefined;
} & {
  event_type: "non_fungible_token_asset";
  tx_id: string;
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
  [k: string]: unknown | undefined;
};
/**
 * GET request that returns address balances
 */
export type AddressStxBalanceResponse = {
  balance: string;
  total_sent: string;
  total_received: string;
  total_fees_sent: string;
  total_miner_rewards_received: string;
  /**
   * The transaction where the lock event occurred. Empty if no tokens are locked.
   */
  lock_tx_id: string;
  /**
   * The amount of locked STX, as string quoted micro-STX. Zero if no tokens are locked.
   */
  locked: string;
  /**
   * The STX chain block height of when the lock event occurred. Zero if no tokens are locked.
   */
  lock_height: number;
  /**
   * The burnchain block height of when the lock event occurred. Zero if no tokens are locked.
   */
  burnchain_lock_height: number;
  /**
   * The burnchain block height of when the tokens unlock. Zero if no tokens are locked.
   */
  burnchain_unlock_height: number;
} & {
  token_offering_locked?: AddressTokenOfferingLocked;
  [k: string]: unknown | undefined;
};
/**
 * Describes all transaction types on Stacks 2.0 blockchain
 */
export type Transaction =
  | TokenTransferTransaction
  | SmartContractTransaction
  | ContractCallTransaction
  | PoisonMicroblockTransaction
  | CoinbaseTransaction;
/**
 * Describes representation of a Type-0 Stacks 2.0 transaction. https://github.com/blockstack/stacks-blockchain/blob/master/sip/sip-005-blocks-and-transactions.md#type-0-transferring-an-asset
 */
export type TokenTransferTransaction = AbstractTransaction & TokenTransferTransactionMetadata;
/**
 * Anchored transaction metadata. All mined/anchored Stacks transactions have these properties.
 */
export type AbstractTransaction = BaseTransaction & {
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
   * Unix timestamp (in seconds) indicating when this parent block was mined
   */
  parent_burn_block_time: number;
  /**
   * An ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) timestamp indicating when this parent block was mined.
   */
  parent_burn_block_time_iso: string;
  /**
   * Set to `true` if block corresponds to the canonical chain tip
   */
  canonical: boolean;
  /**
   * Index of the transaction, indicating the order. Starts at `0` and increases with each transaction
   */
  tx_index: number;
  tx_status: TransactionStatus;
  /**
   * Result of the transaction. For contract calls, this will show the value returned by the call. For other transaction types, this will return a boolean indicating the success of the transaction.
   */
  tx_result: {
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
   * Number of transaction events
   */
  event_count: number;
  /**
   * Hash of the previous block.
   */
  parent_block_hash: string;
  /**
   * True if the transaction is included in a microblock that has not been confirmed by an anchor block.
   */
  is_unanchored: boolean;
  /**
   * The microblock hash that this transaction was streamed in. If the transaction was batched in an anchor block (not included within a microblock) then this value will be an empty string.
   */
  microblock_hash: string;
  /**
   * The microblock sequence number that this transaction was streamed in. If the transaction was batched in an anchor block (not included within a microblock) then this value will be 2147483647 (0x7fffffff, the max int32 value), this value preserves logical transaction ordering on (block_height, microblock_sequence, tx_index).
   */
  microblock_sequence: number;
  /**
   * Set to `true` if microblock is anchored in the canonical chain tip, `false` if the transaction was orphaned in a micro-fork.
   */
  microblock_canonical: boolean;
  /**
   * Execution cost read count.
   */
  execution_cost_read_count: number;
  /**
   * Execution cost read length.
   */
  execution_cost_read_length: number;
  /**
   * Execution cost runtime.
   */
  execution_cost_runtime: number;
  /**
   * Execution cost write count.
   */
  execution_cost_write_count: number;
  /**
   * Execution cost write length.
   */
  execution_cost_write_length: number;
  /**
   * List of transaction events
   */
  events: TransactionEvent[];
};
export type PostConditionMode = "allow" | "deny";
/**
 * Post-conditionscan limit the damage done to a user's assets
 */
export type PostCondition = PostConditionStx | PostConditionFungible | PostConditionNonFungible;
export type PostConditionStx = {
  principal: PostConditionPrincipal;
  [k: string]: unknown | undefined;
} & {
  condition_code: PostConditionFungibleConditionCode;
  amount: string;
  type: "stx";
  [k: string]: unknown | undefined;
};
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
/**
 * A fungible condition code encodes a statement being made for either STX or a fungible token, with respect to the originating account.
 */
export type PostConditionFungibleConditionCode =
  | "sent_equal_to"
  | "sent_greater_than"
  | "sent_greater_than_or_equal_to"
  | "sent_less_than"
  | "sent_less_than_or_equal_to";
export type PostConditionFungible = {
  principal: PostConditionPrincipal;
  [k: string]: unknown | undefined;
} & {
  condition_code: PostConditionFungibleConditionCode;
  type: "fungible";
  amount: string;
  asset: {
    asset_name: string;
    contract_address: string;
    contract_name: string;
  };
  [k: string]: unknown | undefined;
};
export type PostConditionNonFungible = {
  principal: PostConditionPrincipal;
  [k: string]: unknown | undefined;
} & {
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
  [k: string]: unknown | undefined;
};
/**
 * A non-fungible condition code encodes a statement being made about a non-fungible token, with respect to whether or not the particular non-fungible token is owned by the account.
 */
export type PostConditionNonFungibleConditionCode = "sent" | "not_sent";
/**
 * `on_chain_only`: the transaction MUST be included in an anchored block, `off_chain_only`: the transaction MUST be included in a microblock, `any`: the leader can choose where to include the transaction.
 */
export type TransactionAnchorModeType = "on_chain_only" | "off_chain_only" | "any";
/**
 * Status of the transaction. Can be included in a block with a success or aborted status. Or pending in the mempool. Or dropped from the mempool from being replaced by a transaction with the same nonce but a higher fee, replaced by a transaction with the same nonce but in the canonical fork, the transaction is too expensive to include in a block, or because it became stale.
 */
export type TransactionStatus = "success" | "abort_by_response" | "abort_by_post_condition";
/**
 * Describes representation of a Type-1 Stacks 2.0 transaction. https://github.com/blockstack/stacks-blockchain/blob/master/sip/sip-005-blocks-and-transactions.md#type-1-instantiating-a-smart-contract
 */
export type SmartContractTransaction = AbstractTransaction & SmartContractTransactionMetadata;
/**
 * Describes representation of a Type 2 Stacks 2.0 transaction: Contract Call
 */
export type ContractCallTransaction = AbstractTransaction & ContractCallTransactionMetadata;
/**
 * Describes representation of a Type 3 Stacks 2.0 transaction: Poison Microblock
 */
export type PoisonMicroblockTransaction = AbstractTransaction & PoisonMicroblockTransactionMetadata;
/**
 * Describes representation of a Type 3 Stacks 2.0 transaction: Poison Microblock
 */
export type CoinbaseTransaction = AbstractTransaction & CoinbaseTransactionMetadata;
/**
 * Describes all transaction types on Stacks 2.0 blockchain
 */
export type MempoolTransaction =
  | MempoolTokenTransferTransaction
  | MempoolSmartContractTransaction
  | MempoolContractCallTransaction
  | MempoolPoisonMicroblockTransaction
  | MempoolCoinbaseTransaction;
/**
 * Describes representation of a Type-0 Stacks 2.0 transaction. https://github.com/blockstack/stacks-blockchain/blob/master/sip/sip-005-blocks-and-transactions.md#type-0-transferring-an-asset
 */
export type MempoolTokenTransferTransaction = AbstractMempoolTransaction & TokenTransferTransactionMetadata;
/**
 * Abstract transaction. This schema makes up all properties common between all Stacks 2.0 transaction types
 */
export type AbstractMempoolTransaction = BaseTransaction & {
  tx_status: MempoolTransactionStatus;
  /**
   * A unix timestamp (in seconds) indicating when the transaction broadcast was received by the node.
   */
  receipt_time: number;
  /**
   * An ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) timestamp indicating when the transaction broadcast was received by the node.
   */
  receipt_time_iso: string;
};
/**
 * Status of the transaction in the mempool. Can be pending in the mempool. Or dropped from the mempool from being replaced by a transaction with the same nonce but a higher fee, replaced by a transaction with the same nonce but in the canonical fork, the transaction is too expensive to include in a block, or because it became stale.
 */
export type MempoolTransactionStatus =
  | "pending"
  | "dropped_replace_by_fee"
  | "dropped_replace_across_fork"
  | "dropped_too_expensive"
  | "dropped_stale_garbage_collect";
/**
 * Describes representation of a Type-1 Stacks 2.0 transaction. https://github.com/blockstack/stacks-blockchain/blob/master/sip/sip-005-blocks-and-transactions.md#type-1-instantiating-a-smart-contract
 */
export type MempoolSmartContractTransaction = AbstractMempoolTransaction & SmartContractTransactionMetadata;
/**
 * Describes representation of a Type 2 Stacks 2.0 transaction: Contract Call
 */
export type MempoolContractCallTransaction = AbstractMempoolTransaction & ContractCallTransactionMetadata;
/**
 * Describes representation of a Type 3 Stacks 2.0 transaction: Poison Microblock
 */
export type MempoolPoisonMicroblockTransaction = AbstractMempoolTransaction & PoisonMicroblockTransactionMetadata;
/**
 * Describes representation of a Type 3 Stacks 2.0 transaction: Poison Microblock
 */
export type MempoolCoinbaseTransaction = AbstractMempoolTransaction & CoinbaseTransactionMetadata;
/**
 * Fetch a user’s raw zone file. This only works for RFC-compliant zone files. This method returns an error for names that have non-standard zone files.
 */
export type BnsFetchFileZoneResponse =
  | {
      zonefile?: string;
      [k: string]: unknown | undefined;
    }
  | {
      error?: string;
      [k: string]: unknown | undefined;
    };
/**
 * Fetch a list of all names known to the node.
 */
export type BnsGetAllNamesResponse = string[];
/**
 * Fetch a list of all subdomains known to the node.
 */
export type BnsGetAllSubdomainsResponse = string[];
/**
 * Fetches the historical zonefile specified by the username and zone hash.
 */
export type BnsFetchHistoricalZoneFileResponse =
  | {
      zonefile?: string;
      [k: string]: unknown | undefined;
    }
  | {
      error?: string;
      [k: string]: unknown | undefined;
    };
/**
 * Fetches the list of subdomain operations processed by a given transaction. The returned array includes subdomain operations that have not yet been accepted as part of any subdomain’s history (checkable via the accepted field). If the given transaction ID does not correspond to a Blockstack transaction that introduced new subdomain operations, and empty array will be returned.
 */
export type BnsGetSubdomainAtTx = {
  accepted?: number;
  block_height?: number;
  domain?: string;
  fully_qualified_subdomain?: string;
  missing?: string;
  owner?: string;
  parent_zonefile_hash?: string;
  parent_zonefile_index?: number;
  resolver?: string;
  sequence?: number;
  signature?: string;
  txid?: string;
  zonefile_hash?: string;
  zonefile_offset?: number;
  [k: string]: unknown | undefined;
}[];
/**
 * Fetch a list of names from the namespace.
 */
export type BnsGetAllNamespacesNamesResponse = string[];
/**
 * GET fee estimates
 */
export type CoreNodeFeeResponse = string;
/**
 * GET request that returns network target block times
 */
export type GetStxCirculatingSupplyPlainResponse = string;
/**
 * GET request that returns network target block times
 */
export type GetStxTotalSupplyPlainResponse = string;
/**
 * When fetching data by BlockIdentifier, it may be possible to only specify the index or hash. If neither property is specified, it is assumed that the client is making a request at the current block.
 */
export type RosettaPartialBlockIdentifier = RosettaBlockIdentifierHash | RosettaBlockIdentifierHeight;
/**
 * The block_identifier uniquely identifies a block in a particular network.
 */
export type RosettaBlockIdentifier = RosettaBlockIdentifierHash1 & RosettaBlockIdentifierHeight1;
/**
 * Search success result
 */
export type SearchSuccessResult =
  | AddressSearchResult
  | BlockSearchResult
  | ContractSearchResult
  | MempoolTxSearchResult
  | TxSearchResult;
/**
 * complete search result for terms
 */
export type SearchResult = SearchErrorResult | SearchSuccessResult;
/**
 * Status of the transaction
 */
export type MempoolTransactionStatus1 =
  | "pending"
  | "dropped_replace_by_fee"
  | "dropped_replace_across_fork"
  | "dropped_too_expensive"
  | "dropped_stale_garbage_collect";
export type PostConditionPrincipalType = "principal_origin" | "principal_standard" | "principal_contract";
export type PostConditionType = "stx" | "non_fungible" | "fungible";
/**
 * Events types
 */
export type TransactionEventType =
  | "smart_contract_log"
  | "stx_lock"
  | "stx_asset"
  | "fungible_token_asset"
  | "non_fungible_token_asset";
export type TransactionMetadata =
  | TokenTransferTransactionMetadata
  | SmartContractTransactionMetadata
  | ContractCallTransactionMetadata
  | PoisonMicroblockTransactionMetadata
  | CoinbaseTransactionMetadata;
/**
 * Status of the transaction
 */
export type TransactionStatus1 = "success" | "abort_by_response" | "abort_by_post_condition";
/**
 * String literal of all Stacks 2.0 transaction types
 */
export type TransactionType = "token_transfer" | "smart_contract" | "contract_call" | "poison_microblock" | "coinbase";
export type RpcSubscriptionType = "tx_update" | "address_tx_update" | "address_balance_update";

/**
 * GET request that returns address assets
 */
export interface AddressAssetsListResponse {
  limit: number;
  offset: number;
  total: number;
  results: TransactionEvent[];
  [k: string]: unknown | undefined;
}
export interface TransactionEventAsset {
  asset_event_type?: TransactionEventAssetType;
  asset_id?: string;
  sender?: string;
  recipient?: string;
  amount?: string;
  value?: string;
}
/**
 * GET request that returns address balances
 */
export interface AddressBalanceResponse {
  /**
   * StxBalance
   */
  stx: {
    balance: string;
    total_sent: string;
    total_received: string;
    total_fees_sent: string;
    total_miner_rewards_received: string;
    /**
     * The transaction where the lock event occurred. Empty if no tokens are locked.
     */
    lock_tx_id: string;
    /**
     * The amount of locked STX, as string quoted micro-STX. Zero if no tokens are locked.
     */
    locked: string;
    /**
     * The STX chain block height of when the lock event occurred. Zero if no tokens are locked.
     */
    lock_height: number;
    /**
     * The burnchain block height of when the lock event occurred. Zero if no tokens are locked.
     */
    burnchain_lock_height: number;
    /**
     * The burnchain block height of when the tokens unlock. Zero if no tokens are locked.
     */
    burnchain_unlock_height: number;
  };
  fungible_tokens: {
    /**
     * FtBalance
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
  token_offering_locked?: AddressTokenOfferingLocked;
  [k: string]: unknown | undefined;
}
/**
 * Token Offering Locked
 */
export interface AddressTokenOfferingLocked {
  /**
   * Micro-STX amount still locked at current block height.
   */
  total_locked: string;
  /**
   * Micro-STX amount unlocked at current block height.
   */
  total_unlocked: string;
  unlock_schedule: AddressUnlockSchedule[];
}
/**
 * Unlock schedule amount and block height
 */
export interface AddressUnlockSchedule {
  /**
   * Micro-STX amount locked at this block height.
   */
  amount: string;
  block_height: number;
}
export interface AddressNftListResponse {
  limit: number;
  offset: number;
  total: number;
  nft_events: NftEvent[];
  [k: string]: unknown | undefined;
}
export interface NftEvent {
  sender: string;
  recipient: string;
  asset_identifier: string;
  /**
   * Identifier of the NFT
   */
  value: {
    /**
     * Hex string representing the identifier of the NFT
     */
    hex: string;
    /**
     * Readable string of the NFT identifier
     */
    repr: string;
  };
  tx_id: string;
  block_height: number;
  [k: string]: unknown | undefined;
}
/**
 * GET request that returns a list of inbound STX transfers with a memo
 */
export interface AddressStxInboundListResponse {
  limit: number;
  offset: number;
  total: number;
  results: InboundStxTransfer[];
  [k: string]: unknown | undefined;
}
/**
 * A inbound STX transfer with a memo
 */
export interface InboundStxTransfer {
  /**
   * Principal that sent this transfer
   */
  sender: string;
  /**
   * Transfer amount in micro-STX as integer string
   */
  amount: string;
  /**
   * Hex encoded memo bytes associated with the transfer
   */
  memo: string;
  /**
   * Block height at which this transfer occurred
   */
  block_height: number;
  /**
   * The transaction ID in which this transfer occurred
   */
  tx_id: string;
  /**
   * Indicates if the transfer is from a stx-transfer transaction or a contract-call transaction
   */
  transfer_type: "bulk-send" | "stx-transfer";
  /**
   * Index of the transaction within a block
   */
  tx_index: number;
  [k: string]: unknown | undefined;
}
/**
 * GET request that returns account transactions
 */
export interface AddressTransactionsWithTransfersListResponse {
  limit: number;
  offset: number;
  total: number;
  results: AddressTransactionWithTransfers[];
}
/**
 * Transaction with STX transfers for a given address
 */
export interface AddressTransactionWithTransfers {
  tx: Transaction;
  /**
   * Total sent from the given address, including the tx fee, in micro-STX as an integer string.
   */
  stx_sent: string;
  /**
   * Total received by the given address in micro-STX as an integer string.
   */
  stx_received: string;
  stx_transfers: {
    /**
     * Amount transferred in micro-STX as an integer string.
     */
    amount: string;
    /**
     * Principal that sent STX. This is unspecified if the STX were minted.
     */
    sender?: string;
    /**
     * Principal that received STX. This is unspecified if the STX were burned.
     */
    recipient?: string;
  }[];
  ft_transfers?: {
    /**
     * Fungible Token asset identifier.
     */
    asset_identifier: string;
    /**
     * Amount transferred as an integer string. This balance does not factor in possible SIP-010 decimals.
     */
    amount: string;
    /**
     * Principal that sent the asset.
     */
    sender?: string;
    /**
     * Principal that received the asset.
     */
    recipient?: string;
  }[];
  nft_transfers?: {
    /**
     * Non Fungible Token asset identifier.
     */
    asset_identifier: string;
    /**
     * Non Fungible Token asset value.
     */
    value: string;
    /**
     * Principal that sent the asset.
     */
    sender?: string;
    /**
     * Principal that received the asset.
     */
    recipient?: string;
  }[];
}
/**
 * Transaction properties that are available from a raw serialized transactions. These are available for transactions in the mempool as well as mined transactions.
 */
export interface BaseTransaction {
  /**
   * Transaction ID
   */
  tx_id: string;
  /**
   * Used for ordering the transactions originating from and paying from an account. The nonce ensures that a transaction is processed at most once. The nonce counts the number of times an account's owner(s) have authorized a transaction. The first transaction from an account will have a nonce value equal to 0, the second will have a nonce value equal to 1, and so on.
   */
  nonce: number;
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
  sponsor_address?: string;
  post_condition_mode: PostConditionMode;
  post_conditions: PostCondition[];
  anchor_mode: TransactionAnchorModeType;
}
/**
 * Metadata associated with token-transfer type transactions
 */
export interface TokenTransferTransactionMetadata {
  tx_type: "token_transfer";
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
 * Metadata associated with a contract-deploy type transaction. https://github.com/blockstack/stacks-blockchain/blob/master/sip/sip-005-blocks-and-transactions.md#type-1-instantiating-a-smart-contract
 */
export interface SmartContractTransactionMetadata {
  tx_type: "smart_contract";
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
}
/**
 * Metadata associated with a contract-call type transaction
 */
export interface ContractCallTransactionMetadata {
  tx_type: "contract_call";
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
}
/**
 * Metadata associated with a poison-microblock type transaction
 */
export interface PoisonMicroblockTransactionMetadata {
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
export interface CoinbaseTransactionMetadata {
  tx_type: "coinbase";
  coinbase_payload: {
    /**
     * Hex encoded 32-byte scratch space for block leader's use
     */
    data: string;
  };
}
/**
 * GET request that returns account transactions
 */
export interface AddressTransactionsListResponse {
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
   * Hash of the parent block
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
   * Hash of the anchor chain block
   */
  burn_block_hash: string;
  /**
   * Height of the anchor chain block
   */
  burn_block_height: number;
  /**
   * Anchor chain transaction ID
   */
  miner_txid: string;
  /**
   * The hash of the last streamed block that precedes this block to which this block is to be appended. Not every anchored block will have a parent microblock stream. An anchored block that does not have a parent microblock stream has the parent microblock hash set to an empty string, and the parent microblock sequence number set to -1.
   */
  parent_microblock_hash: string;
  /**
   * The hash of the last streamed block that precedes this block to which this block is to be appended. Not every anchored block will have a parent microblock stream. An anchored block that does not have a parent microblock stream has the parent microblock hash set to an empty string, and the parent microblock sequence number set to -1.
   */
  parent_microblock_sequence: number;
  /**
   * List of transactions included in the block
   */
  txs: string[];
  /**
   * List of microblocks that were accepted in this anchor block. Not every anchored block will have a accepted all (or any) of the previously streamed microblocks. Microblocks that were orphaned are not included in this list.
   */
  microblocks_accepted: string[];
  /**
   * List of microblocks that were streamed/produced by this anchor block's miner. This list only includes microblocks that were accepted in the following anchor block. Microblocks that were orphaned are not included in this list.
   */
  microblocks_streamed: string[];
  /**
   * Execution cost read count.
   */
  execution_cost_read_count: number;
  /**
   * Execution cost read length.
   */
  execution_cost_read_length: number;
  /**
   * Execution cost runtime.
   */
  execution_cost_runtime: number;
  /**
   * Execution cost write count.
   */
  execution_cost_write_count: number;
  /**
   * Execution cost write length.
   */
  execution_cost_write_length: number;
  [k: string]: unknown | undefined;
}
/**
 * Error
 */
export interface BnsError {
  error?: string;
  [k: string]: unknown | undefined;
}
/**
 * Get a history of all blockchain records of a registered name.
 */
export interface BnsGetNameHistoryResponse {
  /**
   * This interface was referenced by `BnsGetNameHistoryResponse`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9]+".
   */
  [k: string]: {
    address?: string;
    base?: number;
    buckets?: number[] | null;
    block_number?: number;
    coeff?: number | null;
    consensus_hash?: string | null;
    domain?: string;
    fee?: number;
    first_registered?: number;
    history_snapshot?: boolean;
    importer?: string | null;
    importer_address?: string | null;
    last_renewed?: number;
    name?: string;
    op?: string;
    op_fee?: number;
    opcode?: string;
    revoked?: boolean;
    sender?: string;
    sender_pubkey?: string | null;
    sequence?: number;
    recipient?: string | null;
    recipient_address?: string | null;
    recipient_pubkey?: string | null;
    txid: string;
    value_hash?: string | null;
    vtxindex: number;
    [k: string]: unknown | undefined;
  }[];
}
/**
 * Get name details
 */
export interface BnsGetNameInfoResponse {
  address: string;
  blockchain: string;
  expire_block?: number;
  grace_period?: number;
  last_txid: string;
  resolver?: string;
  status: string;
  zonefile: string;
  zonefile_hash: string;
  [k: string]: unknown | undefined;
}
/**
 * Fetch price for name.
 */
export interface BnsGetNamePriceResponse {
  units: string;
  amount: string;
  [k: string]: unknown | undefined;
}
/**
 * Retrieves a list of names owned by the address provided.
 */
export interface BnsNamesOwnByAddressResponse {
  names?: string[];
  [k: string]: unknown | undefined;
}
/**
 * Fetch a list of all namespaces known to the node.
 */
export interface BnsGetAllNamespacesResponse {
  namespaces: string[];
  [k: string]: unknown | undefined;
}
/**
 * Fetch price for namespace.
 */
export interface BnsGetNamespacePriceResponse {
  units: string;
  amount: string;
  [k: string]: unknown | undefined;
}
/**
 * GET request that returns reward slot holders
 */
export interface BurnchainRewardSlotHolderListResponse {
  /**
   * The number of items to return
   */
  limit: number;
  /**
   * The number of items to skip (starting at `0`)
   */
  offset: number;
  /**
   * Total number of available items
   */
  total: number;
  results: BurnchainRewardSlotHolder[];
}
/**
 * Reward slot holder on the burnchain
 */
export interface BurnchainRewardSlotHolder {
  /**
   * Set to `true` if block corresponds to the canonical burchchain tip
   */
  canonical: boolean;
  /**
   * The hash representing the burnchain block
   */
  burn_block_hash: string;
  /**
   * Height of the burnchain block
   */
  burn_block_height: number;
  /**
   * The recipient address that validly received PoX commitments, in the format native to the burnchain (e.g. B58 encoded for Bitcoin)
   */
  address: string;
  /**
   * The index position of the reward entry, useful for ordering when there's more than one slot per burnchain block
   */
  slot_index: number;
  [k: string]: unknown | undefined;
}
/**
 * GET request that returns blocks
 */
export interface BurnchainRewardListResponse {
  /**
   * The number of burnchain rewards to return
   */
  limit: number;
  /**
   * The number to burnchain rewards to skip (starting at `0`)
   */
  offset: number;
  results: BurnchainReward[];
}
/**
 * Reward payment made on the burnchain
 */
export interface BurnchainReward {
  /**
   * Set to `true` if block corresponds to the canonical burchchain tip
   */
  canonical: boolean;
  /**
   * The hash representing the burnchain block
   */
  burn_block_hash: string;
  /**
   * Height of the burnchain block
   */
  burn_block_height: number;
  /**
   * The total amount of burnchain tokens burned for this burnchain block, in the smallest unit (e.g. satoshis for Bitcoin)
   */
  burn_amount: string;
  /**
   * The recipient address that received the burnchain rewards, in the format native to the burnchain (e.g. B58 encoded for Bitcoin)
   */
  reward_recipient: string;
  /**
   * The amount of burnchain tokens rewarded to the recipient, in the smallest unit (e.g. satoshis for Bitcoin)
   */
  reward_amount: string;
  /**
   * The index position of the reward entry, useful for ordering when there's more than one recipient per burnchain block
   */
  reward_index: number;
  [k: string]: unknown | undefined;
}
/**
 * GET request to get contract source
 */
export interface ReadOnlyFunctionSuccessResponse {
  okay: boolean;
  result?: string;
  cause?: string;
}
/**
 * GET request for account data
 */
export interface AccountDataResponse {
  balance: string;
  locked: string;
  unlock_height: number;
  nonce: number;
  balance_proof: string;
  nonce_proof: string;
}
/**
 * Response of get data map entry request
 */
export interface MapEntryResponse {
  /**
   * Hex-encoded string of clarity value. It is always an optional tuple.
   */
  data: string;
  /**
   * Hex-encoded string of the MARF proof for the data
   */
  proof?: string;
  [k: string]: unknown | undefined;
}
/**
 * GET request to get contract interface
 */
export interface ContractInterfaceResponse {
  /**
   * List of defined methods
   */
  functions: {
    [k: string]: unknown | undefined;
  }[];
  /**
   * List of defined variables
   */
  variables: {
    [k: string]: unknown | undefined;
  }[];
  /**
   * List of defined data-maps
   */
  maps: {
    [k: string]: unknown | undefined;
  }[];
  /**
   * List of fungible tokens in the contract
   */
  fungible_tokens: {
    [k: string]: unknown | undefined;
  }[];
  /**
   * List of non-fungible tokens in the contract
   */
  non_fungible_tokens: {
    [k: string]: unknown | undefined;
  }[];
  [k: string]: unknown | undefined;
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
  /**
   * identifies the version number for the networking communication, this should not change while a node is running, and will only change if there's an upgrade
   */
  peer_version: number;
  /**
   * is a hash used to identify the burnchain view for a node. it incorporates bitcoin chain information and PoX information. nodes that disagree on this value will appear to each other as forks. this value will change after every block
   */
  pox_consensus: string;
  /**
   * latest bitcoin chain height
   */
  burn_block_height: number;
  /**
   * same as burn_consensus, but evaluated at stable_burn_block_height
   */
  stable_pox_consensus: string;
  /**
   * leftover from stacks 1.0, basically always burn_block_height - 1
   */
  stable_burn_block_height: number;
  /**
   * is a version descriptor
   */
  server_version: string;
  /**
   * is similar to peer_version and will be used to differentiate between different testnets. this value will be different between mainnet and testnet. once launched, this value will not change
   */
  network_id: number;
  /**
   * same as network_id, but for bitcoin
   */
  parent_network_id: number;
  /**
   * the latest Stacks chain height. Stacks forks can occur independent of the Bitcoin chain, that height doesn't increase 1-to-1 with the Bitcoin height
   */
  stacks_tip_height: number;
  /**
   * the best known block hash for the Stack chain (not including any pending microblocks)
   */
  stacks_tip: string;
  /**
   * the burn chain (i.e., bitcoin) consensus hash at the time that stacks_tip was mined
   */
  stacks_tip_consensus_hash: string;
  /**
   * the latest microblock hash if any microblocks were processed. if no microblock has been processed for the current block, a 000.., hex array is returned
   */
  unanchored_tip: string;
  /**
   * the block height at which the testnet network will be reset. not applicable for mainnet
   */
  exit_at_block_height: number;
}
/**
 * Get Proof of Transfer (PoX) information
 */
export interface CoreNodePoxResponse {
  contract_id: string;
  first_burnchain_block_height: number;
  min_amount_ustx: number;
  registration_window_length: number;
  rejection_fraction: number;
  reward_cycle_id: number;
  reward_cycle_length: number;
  rejection_votes_left_required: number;
  total_liquid_supply_ustx: number;
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
 * Request to fetch fee for a transaction
 */
export interface FeeRateRequest {
  /**
   * A serialized transaction
   */
  transaction: string;
}
/**
 * Get fee rate information.
 */
export interface FeeRate {
  fee_rate: number;
}
/**
 * GET request that target block time for a given network
 */
export interface NetworkBlockTimeResponse {
  target_block_time: number;
}
/**
 * GET request that returns network target block times
 */
export interface NetworkBlockTimesResponse {
  /**
   * TargetBlockTime
   */
  mainnet: {
    target_block_time: number;
  };
  /**
   * TargetBlockTime
   */
  testnet: {
    target_block_time: number;
  };
}
/**
 * GET blockchain API status
 */
export interface ServerStatusResponse {
  /**
   * the server version that is currently running
   */
  server_version?: string;
  /**
   * the current server status
   */
  status: string;
}
/**
 * GET request that returns network target block times
 */
export interface GetStxSupplyLegacyFormatResponse {
  /**
   * String quoted decimal number of the percentage of STX that have unlocked
   */
  unlockedPercent: string;
  /**
   * String quoted decimal number of the total possible number of STX
   */
  totalStacks: string;
  /**
   * Same as `totalStacks` but formatted with comma thousands separators
   */
  totalStacksFormatted: string;
  /**
   * String quoted decimal number of the STX that have been mined or unlocked
   */
  unlockedSupply: string;
  /**
   * Same as `unlockedSupply` but formatted with comma thousands separators
   */
  unlockedSupplyFormatted: string;
  /**
   * The block height at which this information was queried
   */
  blockHeight: string;
}
/**
 * GET request that returns network target block times
 */
export interface GetStxSupplyResponse {
  /**
   * String quoted decimal number of the percentage of STX that have unlocked
   */
  unlocked_percent: string;
  /**
   * String quoted decimal number of the total possible number of STX
   */
  total_stx: string;
  /**
   * String quoted decimal number of the STX that have been mined or unlocked
   */
  unlocked_stx: string;
  /**
   * The block height at which this information was queried
   */
  block_height: number;
}
/**
 * GET request that returns microblocks
 */
export interface MicroblockListResponse {
  /**
   * The number of microblocks to return
   */
  limit: number;
  /**
   * The number to microblocks to skip (starting at `0`)
   */
  offset: number;
  /**
   * The number of microblocks available
   */
  total: number;
  results: Microblock[];
}
/**
 * A microblock
 */
export interface Microblock {
  /**
   * Set to `true` if the microblock corresponds to the canonical chain tip.
   */
  canonical: boolean;
  /**
   * Set to `true` if the microblock was not orphaned in a following anchor block. Defaults to `true` if the following anchor block has not yet been created.
   */
  microblock_canonical: boolean;
  /**
   * The SHA512/256 hash of this microblock.
   */
  microblock_hash: string;
  /**
   * A hint to describe how to order a set of microblocks. Starts at 0.
   */
  microblock_sequence: number;
  /**
   * The SHA512/256 hash of the previous signed microblock in this stream.
   */
  microblock_parent_hash: string;
  /**
   * The anchor block height that confirmed this microblock.
   */
  block_height: number;
  /**
   * The height of the anchor block that preceded this microblock.
   */
  parent_block_height: number;
  /**
   * The hash of the anchor block that preceded this microblock.
   */
  parent_block_hash: string;
  /**
   * The hash of the Bitcoin block that preceded this microblock.
   */
  parent_burn_block_hash: string;
  /**
   * The block timestamp of the Bitcoin block that preceded this microblock.
   */
  parent_burn_block_time: number;
  /**
   * The ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) formatted block time of the bitcoin block that preceded this microblock.
   */
  parent_burn_block_time_iso: string;
  /**
   * The height of the Bitcoin block that preceded this microblock.
   */
  parent_burn_block_height: number;
  /**
   * The hash of the anchor block that confirmed this microblock. This wil be empty for unanchored microblocks
   */
  block_hash: string;
  /**
   * List of transactions included in the microblock
   */
  txs: string[];
}
/**
 * GET request that returns unanchored transactions
 */
export interface UnanchoredTransactionListResponse {
  /**
   * The number of unanchored transactions available
   */
  total: number;
  results: Transaction[];
}
/**
 * An AccountBalanceRequest is utilized to make a balance request on the /account/balance endpoint. If the block_identifier is populated, a historical balance query should be performed.
 */
export interface RosettaAccountBalanceRequest {
  network_identifier: NetworkIdentifier;
  account_identifier: RosettaAccount;
  block_identifier?: RosettaPartialBlockIdentifier;
}
/**
 * The network_identifier specifies which network a particular object is associated with.
 */
export interface NetworkIdentifier {
  /**
   * Blockchain name
   */
  blockchain: string;
  /**
   * If a blockchain has a specific chain-id or network identifier, it should go in this field. It is up to the client to determine which network-specific identifier is mainnet or testnet.
   */
  network: string;
  /**
   * In blockchains with sharded state, the SubNetworkIdentifier is required to query some object on a specific shard. This identifier is optional for all non-sharded blockchains.
   */
  sub_network_identifier?: {
    /**
     * Network name
     */
    network: string;
    /**
     * Meta data from subnetwork identifier
     */
    metadata?: {
      /**
       * producer
       */
      producer: string;
      [k: string]: unknown | undefined;
    };
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * The account_identifier uniquely identifies an account within a network. All fields in the account_identifier are utilized to determine this uniqueness (including the metadata field, if populated).
 */
export interface RosettaAccount {
  /**
   * The address may be a cryptographic public key (or some encoding of it) or a provided username.
   */
  address: string;
  sub_account?: RosettaSubAccount;
  /**
   * Blockchains that utilize a username model (where the address is not a derivative of a cryptographic public key) should specify the public key(s) owned by the address in metadata.
   */
  metadata?: {
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * An account may have state specific to a contract address (ERC-20 token) and/or a stake (delegated balance). The sub_account_identifier should specify which state (if applicable) an account instantiation refers to.
 */
export interface RosettaSubAccount {
  /**
   * The address may be a cryptographic public key (or some encoding of it) or a provided username.
   */
  address: string;
  /**
   * If the SubAccount address is not sufficient to uniquely specify a SubAccount, any other identifying information can be stored here. It is important to note that two SubAccounts with identical addresses but differing metadata will not be considered equal by clients.
   */
  metadata?: {
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * This is also known as the block hash.
 */
export interface RosettaBlockIdentifierHash {
  /**
   * This is also known as the block hash.
   */
  hash?: string;
  [k: string]: unknown | undefined;
}
/**
 * This is also known as the block height.
 */
export interface RosettaBlockIdentifierHeight {
  /**
   * This is also known as the block height.
   */
  index?: number;
  [k: string]: unknown | undefined;
}
/**
 * An AccountBalanceResponse is returned on the /account/balance endpoint. If an account has a balance for each AccountIdentifier describing it (ex: an ERC-20 token balance on a few smart contracts), an account balance request must be made with each AccountIdentifier.
 */
export interface RosettaAccountBalanceResponse {
  block_identifier: RosettaBlockIdentifier;
  /**
   * A single account balance may have multiple currencies
   */
  balances: RosettaAmount[];
  /**
   * If a blockchain is UTXO-based, all unspent Coins owned by an account_identifier should be returned alongside the balance. It is highly recommended to populate this field so that users of the Rosetta API implementation don't need to maintain their own indexer to track their UTXOs.
   */
  coins?: RosettaCoin[];
  /**
   * Account-based blockchains that utilize a nonce or sequence number should include that number in the metadata. This number could be unique to the identifier or global across the account address.
   */
  metadata?: {
    sequence_number: number;
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * This is also known as the block hash.
 */
export interface RosettaBlockIdentifierHash1 {
  /**
   * This is also known as the block hash.
   */
  hash: string;
  [k: string]: unknown | undefined;
}
/**
 * This is also known as the block height.
 */
export interface RosettaBlockIdentifierHeight1 {
  /**
   * This is also known as the block height.
   */
  index: number;
  [k: string]: unknown | undefined;
}
/**
 * Amount is some Value of a Currency. It is considered invalid to specify a Value without a Currency.
 */
export interface RosettaAmount {
  /**
   * Value of the transaction in atomic units represented as an arbitrary-sized signed integer. For example, 1 BTC would be represented by a value of 100000000.
   */
  value: string;
  currency: RosettaCurrency;
  metadata?: {
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * Currency is composed of a canonical Symbol and Decimals. This Decimals value is used to convert an Amount.Value from atomic units (Satoshis) to standard units (Bitcoins).
 */
export interface RosettaCurrency {
  /**
   * Canonical symbol associated with a currency.
   */
  symbol: string;
  /**
   * Number of decimal places in the standard unit representation of the amount. For example, BTC has 8 decimals. Note that it is not possible to represent the value of some currency in atomic units that is not base 10.
   */
  decimals: number;
  /**
   * Any additional information related to the currency itself. For example, it would be useful to populate this object with the contract address of an ERC-20 token.
   */
  metadata?: {
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * If a blockchain is UTXO-based, all unspent Coins owned by an account_identifier should be returned alongside the balance. It is highly recommended to populate this field so that users of the Rosetta API implementation don't need to maintain their own indexer to track their UTXOs.
 */
export interface RosettaCoin {
  /**
   * CoinIdentifier uniquely identifies a Coin.
   */
  coin_identifier: {
    /**
     * Identifier should be populated with a globally unique identifier of a Coin. In Bitcoin, this identifier would be transaction_hash:index.
     */
    identifier: string;
    [k: string]: unknown | undefined;
  };
  amount: RosettaAmount1;
  [k: string]: unknown | undefined;
}
/**
 * Amount is some Value of a Currency. It is considered invalid to specify a Value without a Currency.
 */
export interface RosettaAmount1 {
  /**
   * Value of the transaction in atomic units represented as an arbitrary-sized signed integer. For example, 1 BTC would be represented by a value of 100000000.
   */
  value: string;
  currency: RosettaCurrency;
  metadata?: {
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * A BlockRequest is utilized to make a block request on the /block endpoint.
 */
export interface RosettaBlockRequest {
  network_identifier: NetworkIdentifier;
  block_identifier: RosettaPartialBlockIdentifier;
}
/**
 * A BlockResponse includes a fully-populated block or a partially-populated block with a list of other transactions to fetch (other_transactions). As a result of the consensus algorithm of some blockchains, blocks can be omitted (i.e. certain block indexes can be skipped). If a query for one of these omitted indexes is made, the response should not include a Block object. It is VERY important to note that blocks MUST still form a canonical, connected chain of blocks where each block has a unique index. In other words, the PartialBlockIdentifier of a block after an omitted block should reference the last non-omitted block.
 */
export interface RosettaBlockResponse {
  block?: RosettaBlock;
  /**
   * Some blockchains may require additional transactions to be fetched that weren't returned in the block response (ex: block only returns transaction hashes). For blockchains with a lot of transactions in each block, this can be very useful as consumers can concurrently fetch all transactions returned.
   */
  other_transactions?: OtherTransactionIdentifier[];
  [k: string]: unknown | undefined;
}
/**
 * Blocks contain an array of Transactions that occurred at a particular BlockIdentifier. A hard requirement for blocks returned by Rosetta implementations is that they MUST be inalterable: once a client has requested and received a block identified by a specific BlockIndentifier, all future calls for that same BlockIdentifier must return the same block contents.
 */
export interface RosettaBlock {
  block_identifier: RosettaBlockIdentifier;
  parent_block_identifier: RosettaParentBlockIdentifier;
  /**
   * The timestamp of the block in milliseconds since the Unix Epoch. The timestamp is stored in milliseconds because some blockchains produce blocks more often than once a second.
   */
  timestamp: number;
  /**
   * All the transactions in the block
   */
  transactions: RosettaTransaction[];
  /**
   * meta data
   */
  metadata?: {
    transactions_root: string;
    difficulty: string;
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * The block_identifier uniquely identifies a block in a particular network.
 */
export interface RosettaParentBlockIdentifier {
  /**
   * This is also known as the block height.
   */
  index: number;
  /**
   * Block hash
   */
  hash: string;
  [k: string]: unknown | undefined;
}
/**
 * Transactions contain an array of Operations that are attributable to the same TransactionIdentifier.
 */
export interface RosettaTransaction {
  transaction_identifier: TransactionIdentifier;
  /**
   * List of operations
   */
  operations: RosettaOperation[];
  /**
   * Transactions that are related to other transactions (like a cross-shard transaction) should include the tranaction_identifier of these transactions in the metadata.
   */
  metadata?: {
    /**
     * STX token transfer memo.
     */
    memo?: string;
    /**
     * The Size
     */
    size?: number;
    /**
     * The locktime
     */
    lockTime?: number;
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * The transaction_identifier uniquely identifies a transaction in a particular network and block or in the mempool.
 */
export interface TransactionIdentifier {
  /**
   * Any transactions that are attributable only to a block (ex: a block event) should use the hash of the block as the identifier.
   */
  hash: string;
  [k: string]: unknown | undefined;
}
/**
 * Operations contain all balance-changing information within a transaction. They are always one-sided (only affect 1 AccountIdentifier) and can succeed or fail independently from a Transaction.
 */
export interface RosettaOperation {
  operation_identifier: RosettaOperationIdentifier;
  /**
   * Restrict referenced related_operations to identifier indexes < the current operation_identifier.index. This ensures there exists a clear DAG-structure of relations. Since operations are one-sided, one could imagine relating operations in a single transfer or linking operations in a call tree.
   */
  related_operations?: RosettaRelatedOperation[];
  /**
   * The network-specific type of the operation. Ensure that any type that can be returned here is also specified in the NetworkStatus. This can be very useful to downstream consumers that parse all block data.
   */
  type: string;
  /**
   * The network-specific status of the operation. Status is not defined on the transaction object because blockchains with smart contracts may have transactions that partially apply. Blockchains with atomic transactions (all operations succeed or all operations fail) will have the same status for each operation.
   */
  status?: string;
  account?: RosettaAccount;
  amount?: RosettaAmount;
  coin_change?: RosettaCoinChange;
  /**
   * Operations Meta Data
   */
  metadata?: {
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * The operation_identifier uniquely identifies an operation within a transaction.
 */
export interface RosettaOperationIdentifier {
  /**
   * The operation index is used to ensure each operation has a unique identifier within a transaction. This index is only relative to the transaction and NOT GLOBAL. The operations in each transaction should start from index 0. To clarify, there may not be any notion of an operation index in the blockchain being described.
   */
  index: number;
  /**
   * Some blockchains specify an operation index that is essential for client use. For example, Bitcoin uses a network_index to identify which UTXO was used in a transaction. network_index should not be populated if there is no notion of an operation index in a blockchain (typically most account-based blockchains).
   */
  network_index?: number;
  [k: string]: unknown | undefined;
}
/**
 * Restrict referenced related_operations to identifier indexes < the current operation_identifier.index. This ensures there exists a clear DAG-structure of relations. Since operations are one-sided, one could imagine relating operations in a single transfer or linking operations in a call tree.
 */
export interface RosettaRelatedOperation {
  /**
   * Describes the index of related operation.
   */
  index: number;
  /**
   * Some blockchains specify an operation index that is essential for client use. network_index should not be populated if there is no notion of an operation index in a blockchain (typically most account-based blockchains).
   */
  network_index?: number;
  [k: string]: unknown | undefined;
}
/**
 * CoinChange is used to represent a change in state of a some coin identified by a coin_identifier. This object is part of the Operation model and must be populated for UTXO-based blockchains. Coincidentally, this abstraction of UTXOs allows for supporting both account-based transfers and UTXO-based transfers on the same blockchain (when a transfer is account-based, don't populate this model).
 */
export interface RosettaCoinChange {
  /**
   * CoinIdentifier uniquely identifies a Coin.
   */
  coin_identifier: {
    /**
     * Identifier should be populated with a globally unique identifier of a Coin. In Bitcoin, this identifier would be transaction_hash:index.
     */
    identifier: string;
    [k: string]: unknown | undefined;
  };
  /**
   * CoinActions are different state changes that a Coin can undergo. When a Coin is created, it is coin_created. When a Coin is spent, it is coin_spent. It is assumed that a single Coin cannot be created or spent more than once.
   */
  coin_action: "coin_created" | "coin_spent";
  [k: string]: unknown | undefined;
}
/**
 * The transaction_identifier uniquely identifies a transaction in a particular network and block or in the mempool.
 */
export interface OtherTransactionIdentifier {
  /**
   * Any transactions that are attributable only to a block (ex: a block event) should use the hash of the block as the identifier.
   */
  hash: string;
  [k: string]: unknown | undefined;
}
/**
 * A BlockTransactionRequest is used to fetch a Transaction included in a block that is not returned in a BlockResponse.
 */
export interface RosettaBlockTransactionRequest {
  network_identifier: NetworkIdentifier;
  block_identifier: RosettaPartialBlockIdentifier;
  transaction_identifier: TransactionIdentifier;
}
/**
 * A BlockTransactionResponse contains information about a block transaction.
 */
export interface RosettaBlockTransactionResponse {
  transaction: RosettaTransaction;
  [k: string]: unknown | undefined;
}
/**
 * RosettaConstructionCombineRequest is the input to the /construction/combine endpoint. It contains the unsigned transaction blob returned by /construction/payloads and all required signatures to create a network transaction.
 */
export interface RosettaConstructionCombineRequest {
  network_identifier: NetworkIdentifier;
  unsigned_transaction: string;
  signatures: RosettaSignature[];
  [k: string]: unknown | undefined;
}
/**
 * Signature contains the payload that was signed, the public keys of the keypairs used to produce the signature, the signature (encoded in hex), and the SignatureType. PublicKey is often times not known during construction of the signing payloads but may be needed to combine signatures properly.
 */
export interface RosettaSignature {
  signing_payload: SigningPayload;
  public_key: RosettaPublicKey;
  /**
   * SignatureType is the type of a cryptographic signature.
   */
  signature_type: "ecdsa" | "ecdsa_recovery" | "ed25519" | "schnorr_1" | "schnorr_poseidon";
  hex_bytes: string;
  [k: string]: unknown | undefined;
}
/**
 * SigningPayload is signed by the client with the keypair associated with an address using the specified SignatureType. SignatureType can be optionally populated if there is a restriction on the signature scheme that can be used to sign the payload.
 */
export interface SigningPayload {
  /**
   * [DEPRECATED by account_identifier in v1.4.4] The network-specific address of the account that should sign the payload.
   */
  address?: string;
  account_identifier?: RosettaAccount;
  hex_bytes: string;
  /**
   * SignatureType is the type of a cryptographic signature.
   */
  signature_type?: "ecdsa" | "ecdsa_recovery" | "ed25519" | "schnorr_1" | "schnorr_poseidon";
  [k: string]: unknown | undefined;
}
/**
 * PublicKey contains a public key byte array for a particular CurveType encoded in hex. Note that there is no PrivateKey struct as this is NEVER the concern of an implementation.
 */
export interface RosettaPublicKey {
  /**
   * Hex-encoded public key bytes in the format specified by the CurveType.
   */
  hex_bytes: string;
  /**
   * CurveType is the type of cryptographic curve associated with a PublicKey.
   */
  curve_type: "secp256k1" | "edwards25519";
  [k: string]: unknown | undefined;
}
/**
 * RosettaConstructionCombineResponse is returned by /construction/combine. The network payload will be sent directly to the construction/submit endpoint.
 */
export interface RosettaConstructionCombineResponse {
  /**
   * Signed transaction bytes in hex
   */
  signed_transaction: string;
  [k: string]: unknown | undefined;
}
/**
 * Network is provided in the request because some blockchains have different address formats for different networks
 */
export interface RosettaConstructionDeriveRequest {
  network_identifier: NetworkIdentifier;
  public_key: RosettaPublicKey;
  metadata?: {
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * ConstructionDeriveResponse is returned by the /construction/derive endpoint.
 */
export interface RosettaConstructionDeriveResponse {
  /**
   * [DEPRECATED by account_identifier in v1.4.4] Address in network-specific format.
   */
  address?: string;
  account_identifier?: RosettaAccountIdentifier;
  metadata?: {
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * The account_identifier uniquely identifies an account within a network. All fields in the account_identifier are utilized to determine this uniqueness (including the metadata field, if populated).
 */
export interface RosettaAccountIdentifier {
  /**
   * The address may be a cryptographic public key (or some encoding of it) or a provided username.
   */
  address: string;
  sub_account?: RosettaSubAccount;
  /**
   * Blockchains that utilize a username model (where the address is not a derivative of a cryptographic public key) should specify the public key(s) owned by the address in metadata.
   */
  metadata?: {
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * TransactionHash returns the network-specific transaction hash for a signed transaction.
 */
export interface RosettaConstructionHashRequest {
  network_identifier: NetworkIdentifier;
  /**
   * Signed transaction
   */
  signed_transaction: string;
  [k: string]: unknown | undefined;
}
/**
 * TransactionIdentifier contains the transaction_identifier of a transaction that was submitted to either /construction/hash or /construction/submit.
 */
export interface RosettaConstructionHashResponse {
  transaction_identifier: TransactionIdentifier;
  metadata?: {
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * A ConstructionMetadataRequest is utilized to get information required to construct a transaction. The Options object used to specify which metadata to return is left purposely unstructured to allow flexibility for implementers. Optionally, the request can also include an array of PublicKeys associated with the AccountIdentifiers returned in ConstructionPreprocessResponse.
 */
export interface RosettaConstructionMetadataRequest {
  network_identifier: NetworkIdentifier;
  options: RosettaOptions;
  public_keys?: RosettaPublicKey[];
  [k: string]: unknown | undefined;
}
/**
 * The options that will be sent directly to /construction/metadata by the caller.
 */
export interface RosettaOptions {
  /**
   * sender's address
   */
  sender_address?: string;
  /**
   * Type of operation e.g transfer
   */
  type?: string;
  /**
   * This value indicates the state of the operations
   */
  status?: string | null;
  /**
   * Recipient's address
   */
  token_transfer_recipient_address?: string;
  /**
   * Amount to be transfered.
   */
  amount?: string;
  /**
   * Currency symbol e.g STX
   */
  symbol?: string;
  /**
   * Number of decimal places
   */
  decimals?: number;
  /**
   * Maximum price a user is willing to pay.
   */
  gas_limit?: number;
  /**
   * Cost necessary to perform a transaction on the network
   */
  gas_price?: number;
  /**
   *  A suggested fee multiplier to indicate that the suggested fee should be scaled. This may be used to set higher fees for urgent transactions or to pay lower fees when there is less urgency.
   */
  suggested_fee_multiplier?: number;
  /**
   * Maximum fee user is willing to pay
   */
  max_fee?: string;
  /**
   * Fee for this transaction
   */
  fee?: string;
  /**
   * Transaction approximative size (used to calculate total fee).
   */
  size?: number;
  /**
   * STX token transfer memo.
   */
  memo?: string;
  /**
   * Number of cycles when stacking.
   */
  number_of_cycles?: number;
  /**
   * Address of the contract to call.
   */
  contract_address?: string;
  /**
   * Name of the contract to call.
   */
  contract_name?: string;
  /**
   * Set the burnchain (BTC) block for stacking lock to start.
   */
  burn_block_height?: number;
  /**
   * Delegator address for when calling `delegate-stacking`.
   */
  delegate_to?: string;
  /**
   * The reward address for stacking transaction. It should be a valid Bitcoin address
   */
  pox_addr?: string;
  [k: string]: unknown | undefined;
}
/**
 * The ConstructionMetadataResponse returns network-specific metadata used for transaction construction. Optionally, the implementer can return the suggested fee associated with the transaction being constructed. The caller may use this info to adjust the intent of the transaction or to create a transaction with a different account that can pay the suggested fee. Suggested fee is an array in case fee payment must occur in multiple currencies.
 */
export interface RosettaConstructionMetadataResponse {
  metadata: {
    account_sequence?: number;
    recent_block_hash?: string;
    [k: string]: unknown | undefined;
  };
  suggested_fee?: RosettaAmount[];
  [k: string]: unknown | undefined;
}
/**
 * Parse is called on both unsigned and signed transactions to understand the intent of the formulated transaction. This is run as a sanity check before signing (after /construction/payloads) and before broadcast (after /construction/combine).
 */
export interface RosettaConstructionParseRequest {
  network_identifier: NetworkIdentifier;
  /**
   * Signed is a boolean indicating whether the transaction is signed.
   */
  signed: boolean;
  /**
   * This must be either the unsigned transaction blob returned by /construction/payloads or the signed transaction blob returned by /construction/combine.
   */
  transaction: string;
  [k: string]: unknown | undefined;
}
/**
 * RosettaConstructionParseResponse contains an array of operations that occur in a transaction blob. This should match the array of operations provided to /construction/preprocess and /construction/payloads.
 */
export interface RosettaConstructionParseResponse {
  operations: RosettaOperation[];
  /**
   * [DEPRECATED by account_identifier_signers in v1.4.4] All signers (addresses) of a particular transaction. If the transaction is unsigned, it should be empty.
   */
  signers?: string[];
  account_identifier_signers?: RosettaAccountIdentifier[];
  metadata?: {
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * ConstructionPayloadsRequest is the request to /construction/payloads. It contains the network, a slice of operations, and arbitrary metadata that was returned by the call to /construction/metadata. Optionally, the request can also include an array of PublicKeys associated with the AccountIdentifiers returned in ConstructionPreprocessResponse.
 */
export interface RosettaConstructionPayloadsRequest {
  network_identifier: NetworkIdentifier;
  operations: RosettaOperation[];
  public_keys?: RosettaPublicKey[];
  metadata?: {
    account_sequence?: number;
    recent_block_hash?: string;
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * RosettaConstructionPayloadResponse is returned by /construction/payloads. It contains an unsigned transaction blob (that is usually needed to construct the a network transaction from a collection of signatures) and an array of payloads that must be signed by the caller.
 */
export interface RosettaConstructionPayloadResponse {
  /**
   * This is an unsigned transaction blob (that is usually needed to construct the a network transaction from a collection of signatures)
   */
  unsigned_transaction: string;
  /**
   * An array of payloads that must be signed by the caller
   */
  payloads: SigningPayload[];
  [k: string]: unknown | undefined;
}
/**
 * ConstructionPreprocessRequest is passed to the /construction/preprocess endpoint so that a Rosetta implementation can determine which metadata it needs to request for construction
 */
export interface RosettaConstructionPreprocessRequest {
  network_identifier: NetworkIdentifier;
  operations: RosettaOperation[];
  metadata?: {
    [k: string]: unknown | undefined;
  };
  max_fee?: RosettaMaxFeeAmount[];
  /**
   *  The caller can also provide a suggested fee multiplier to indicate that the suggested fee should be scaled. This may be used to set higher fees for urgent transactions or to pay lower fees when there is less urgency. It is assumed that providing a very low multiplier (like 0.0001) will never lead to a transaction being created with a fee less than the minimum network fee (if applicable). In the case that the caller provides both a max fee and a suggested fee multiplier, the max fee will set an upper bound on the suggested fee (regardless of the multiplier provided).
   */
  suggested_fee_multiplier?: number;
  [k: string]: unknown | undefined;
}
/**
 * Amount is some Value of a Currency. It is considered invalid to specify a Value without a Currency.
 */
export interface RosettaMaxFeeAmount {
  /**
   * Value of the transaction in atomic units represented as an arbitrary-sized signed integer. For example, 1 BTC would be represented by a value of 100000000.
   */
  value: string;
  currency: RosettaCurrency1;
  metadata?: {
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * Currency is composed of a canonical Symbol and Decimals. This Decimals value is used to convert an Amount.Value from atomic units (Satoshis) to standard units (Bitcoins).
 */
export interface RosettaCurrency1 {
  /**
   * Canonical symbol associated with a currency.
   */
  symbol: string;
  /**
   * Number of decimal places in the standard unit representation of the amount. For example, BTC has 8 decimals. Note that it is not possible to represent the value of some currency in atomic units that is not base 10.
   */
  decimals: number;
  /**
   * Any additional information related to the currency itself. For example, it would be useful to populate this object with the contract address of an ERC-20 token.
   */
  metadata?: {
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * RosettaConstructionPreprocessResponse contains options that will be sent unmodified to /construction/metadata. If it is not necessary to make a request to /construction/metadata, options should be omitted. Some blockchains require the PublicKey of particular AccountIdentifiers to construct a valid transaction. To fetch these PublicKeys, populate required_public_keys with the AccountIdentifiers associated with the desired PublicKeys. If it is not necessary to retrieve any PublicKeys for construction, required_public_keys should be omitted.
 */
export interface RosettaConstructionPreprocessResponse {
  options?: RosettaOptions;
  required_public_keys?: RosettaAccount[];
  [k: string]: unknown | undefined;
}
/**
 * Submit the transaction in blockchain
 */
export interface RosettaConstructionSubmitRequest {
  network_identifier: NetworkIdentifier;
  /**
   * Signed transaction
   */
  signed_transaction: string;
  [k: string]: unknown | undefined;
}
/**
 * TransactionIdentifier contains the transaction_identifier of a transaction that was submitted to either /construction/submit.
 */
export interface RosettaConstructionSubmitResponse {
  transaction_identifier: TransactionIdentifier;
  metadata?: {
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * Get all Transaction Identifiers in the mempool
 */
export interface RosettaMempoolRequest {
  network_identifier: NetworkIdentifier1;
  metadata?: {
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * The network_identifier specifies which network a particular object is associated with.
 */
export interface NetworkIdentifier1 {
  /**
   * Blockchain name
   */
  blockchain: string;
  /**
   * If a blockchain has a specific chain-id or network identifier, it should go in this field. It is up to the client to determine which network-specific identifier is mainnet or testnet.
   */
  network: string;
  /**
   * In blockchains with sharded state, the SubNetworkIdentifier is required to query some object on a specific shard. This identifier is optional for all non-sharded blockchains.
   */
  sub_network_identifier?: {
    /**
     * Network name
     */
    network: string;
    /**
     * Meta data from subnetwork identifier
     */
    metadata?: {
      /**
       * producer
       */
      producer: string;
      [k: string]: unknown | undefined;
    };
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * A MempoolResponse contains all transaction identifiers in the mempool for a particular network_identifier.
 */
export interface RosettaMempoolResponse {
  transaction_identifiers: TransactionIdentifier[];
  metadata?: {
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * A MempoolTransactionRequest is utilized to retrieve a transaction from the mempool.
 */
export interface RosettaMempoolTransactionRequest {
  network_identifier: NetworkIdentifier;
  transaction_identifier: TransactionIdentifier;
}
/**
 * A MempoolTransactionResponse contains an estimate of a mempool transaction. It may not be possible to know the full impact of a transaction in the mempool (ex: fee paid).
 */
export interface RosettaMempoolTransactionResponse {
  transaction: RosettaTransaction;
  metadata?: {
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * This endpoint returns a list of NetworkIdentifiers that the Rosetta server supports.
 */
export interface RosettaNetworkListRequest {
  /**
   * A MetadataRequest is utilized in any request where the only argument is optional metadata.
   */
  metadata?: {
    [k: string]: unknown | undefined;
  };
}
/**
 * A NetworkListResponse contains all NetworkIdentifiers that the node can serve information for.
 */
export interface RosettaNetworkListResponse {
  /**
   * The network_identifier specifies which network a particular object is associated with.
   */
  network_identifiers: NetworkIdentifier[];
  [k: string]: unknown | undefined;
}
/**
 * This endpoint returns the version information and allowed network-specific types for a NetworkIdentifier. Any NetworkIdentifier returned by /network/list should be accessible here. Because options are retrievable in the context of a NetworkIdentifier, it is possible to define unique options for each network.
 */
export interface RosettaOptionsRequest {
  network_identifier: NetworkIdentifier;
  metadata?: {
    [k: string]: unknown | undefined;
  };
}
/**
 * NetworkOptionsResponse contains information about the versioning of the node and the allowed operation statuses, operation types, and errors.
 */
export interface RosettaNetworkOptionsResponse {
  /**
   * The Version object is utilized to inform the client of the versions of different components of the Rosetta implementation.
   */
  version: {
    /**
     * The rosetta_version is the version of the Rosetta interface the implementation adheres to. This can be useful for clients looking to reliably parse responses.
     */
    rosetta_version: string;
    /**
     * The node_version is the canonical version of the node runtime. This can help clients manage deployments.
     */
    node_version: string;
    /**
     * When a middleware server is used to adhere to the Rosetta interface, it should return its version here. This can help clients manage deployments.
     */
    middleware_version?: string;
    /**
     * Any other information that may be useful about versioning of dependent services should be returned here.
     */
    metadata?: {
      [k: string]: unknown | undefined;
    };
    [k: string]: unknown | undefined;
  };
  /**
   * Allow specifies supported Operation status, Operation types, and all possible error statuses. This Allow object is used by clients to validate the correctness of a Rosetta Server implementation. It is expected that these clients will error if they receive some response that contains any of the above information that is not specified here.
   */
  allow: {
    /**
     * All Operation.Status this implementation supports. Any status that is returned during parsing that is not listed here will cause client validation to error.
     */
    operation_statuses: RosettaOperationStatus[];
    /**
     * All Operation.Type this implementation supports. Any type that is returned during parsing that is not listed here will cause client validation to error.
     */
    operation_types: string[];
    /**
     * All Errors that this implementation could return. Any error that is returned during parsing that is not listed here will cause client validation to error.
     */
    errors: RosettaErrorNoDetails[];
    /**
     * Any Rosetta implementation that supports querying the balance of an account at any height in the past should set this to true.
     */
    historical_balance_lookup: boolean;
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * OperationStatus is utilized to indicate which Operation status are considered successful.
 */
export interface RosettaOperationStatus {
  /**
   * The status is the network-specific status of the operation.
   */
  status: string;
  /**
   * An Operation is considered successful if the Operation.Amount should affect the Operation.Account. Some blockchains (like Bitcoin) only include successful operations in blocks but other blockchains (like Ethereum) include unsuccessful operations that incur a fee. To reconcile the computed balance from the stream of Operations, it is critical to understand which Operation.Status indicate an Operation is successful and should affect an Account.
   */
  successful: boolean;
  [k: string]: unknown | undefined;
}
/**
 * Instead of utilizing HTTP status codes to describe node errors (which often do not have a good analog), rich errors are returned using this object. Both the code and message fields can be individually used to correctly identify an error. Implementations MUST use unique values for both fields.
 */
export interface RosettaErrorNoDetails {
  /**
   * Code is a network-specific error code. If desired, this code can be equivalent to an HTTP status code.
   */
  code: number;
  /**
   * Message is a network-specific error message. The message MUST NOT change for a given code. In particular, this means that any contextual information should be included in the details field.
   */
  message: string;
  /**
   * An error is retriable if the same request may succeed if submitted again.
   */
  retriable: boolean;
}
/**
 * This endpoint returns the current status of the network requested. Any NetworkIdentifier returned by /network/list should be accessible here.
 */
export interface RosettaStatusRequest {
  network_identifier: NetworkIdentifier;
  metadata?: {
    [k: string]: unknown | undefined;
  };
}
/**
 * NetworkStatusResponse contains basic information about the node's view of a blockchain network. It is assumed that any BlockIdentifier.Index less than or equal to CurrentBlockIdentifier.Index can be queried. If a Rosetta implementation prunes historical state, it should populate the optional oldest_block_identifier field with the oldest block available to query. If this is not populated, it is assumed that the genesis_block_identifier is the oldest queryable block. If a Rosetta implementation performs some pre-sync before it is possible to query blocks, sync_status should be populated so that clients can still monitor healthiness. Without this field, it may appear that the implementation is stuck syncing and needs to be terminated.
 */
export interface RosettaNetworkStatusResponse {
  current_block_identifier: RosettaBlockIdentifier;
  /**
   * The timestamp of the block in milliseconds since the Unix Epoch. The timestamp is stored in milliseconds because some blockchains produce blocks more often than once a second.
   */
  current_block_timestamp: number;
  genesis_block_identifier: RosettaGenesisBlockIdentifier;
  oldest_block_identifier?: RosettaOldestBlockIdentifier;
  sync_status?: RosettaSyncStatus;
  /**
   * Peers information
   */
  peers: RosettaPeers[];
  [k: string]: unknown | undefined;
}
/**
 * The block_identifier uniquely identifies a block in a particular network.
 */
export interface RosettaGenesisBlockIdentifier {
  /**
   * This is also known as the block height.
   */
  index: number;
  /**
   * Block hash
   */
  hash: string;
  [k: string]: unknown | undefined;
}
/**
 * The block_identifier uniquely identifies a block in a particular network.
 */
export interface RosettaOldestBlockIdentifier {
  /**
   * This is also known as the block height.
   */
  index: number;
  /**
   * Block hash
   */
  hash: string;
  [k: string]: unknown | undefined;
}
/**
 * SyncStatus is used to provide additional context about an implementation's sync status. It is often used to indicate that an implementation is healthy when it cannot be queried until some sync phase occurs. If an implementation is immediately queryable, this model is often not populated.
 */
export interface RosettaSyncStatus {
  /**
   * CurrentIndex is the index of the last synced block in the current stage.
   */
  current_index: number;
  /**
   * TargetIndex is the index of the block that the implementation is attempting to sync to in the current stage.
   */
  target_index?: number;
  /**
   * Stage is the phase of the sync process.
   */
  stage?: string;
  /**
   * Synced indicates if an implementation has synced up to the most recent block.
   */
  synced?: boolean;
  [k: string]: unknown | undefined;
}
/**
 * A Peer is a representation of a node's peer.
 */
export interface RosettaPeers {
  /**
   * peer id
   */
  peer_id: string;
  /**
   * meta data
   */
  metadata?: {
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * Address search result
 */
export interface AddressSearchResult {
  /**
   * Indicates if the requested object was found or not
   */
  found: boolean;
  /**
   * This object carries the search result
   */
  result: {
    /**
     * The id used to search this query.
     */
    entity_id: string;
    entity_type: "standard_address";
  };
}
/**
 * Block search result
 */
export interface BlockSearchResult {
  /**
   * Indicates if the requested object was found or not
   */
  found: boolean;
  /**
   * This object carries the search result
   */
  result: {
    /**
     * The id used to search this query.
     */
    entity_id: string;
    entity_type: "block_hash";
    /**
     * Returns basic search result information about the requested id
     */
    block_data: {
      /**
       * If the block lies within the canonical chain
       */
      canonical: boolean;
      /**
       * Refers to the hash of the block
       */
      hash: string;
      parent_block_hash: string;
      burn_block_time: number;
      height: number;
    };
  };
}
/**
 * Contract search result
 */
export interface ContractSearchResult {
  /**
   * Indicates if the requested object was found or not
   */
  found: boolean;
  /**
   * This object carries the search result
   */
  result: {
    /**
     * The id used to search this query.
     */
    entity_id: string;
    entity_type: "contract_address";
    /**
     * Returns basic search result information about the requested id
     */
    tx_data?: {
      /**
       * If the transaction lies within the canonical chain
       */
      canonical?: boolean;
      /**
       * Refers to the hash of the block for searched transaction
       */
      block_hash?: string;
      burn_block_time?: number;
      block_height?: number;
      tx_type?: string;
      /**
       * Corresponding tx_id for smart_contract
       */
      tx_id?: string;
    };
  };
}
/**
 * Error search result
 */
export interface SearchErrorResult {
  /**
   * Indicates if the requested object was found or not
   */
  found: boolean;
  result: {
    /**
     * Shows the currenty category of entity it is searched in.
     */
    entity_type: "standard_address" | "unknown_hash" | "contract_address" | "invalid_term";
  };
  error: string;
}
/**
 * Contract search result
 */
export interface MempoolTxSearchResult {
  /**
   * Indicates if the requested object was found or not
   */
  found: boolean;
  /**
   * This object carries the search result
   */
  result: {
    /**
     * The id used to search this query.
     */
    entity_id: string;
    entity_type: "mempool_tx_id";
    /**
     * Returns basic search result information about the requested id
     */
    tx_data: {
      tx_type: string;
    };
  };
}
/**
 * Transaction search result
 */
export interface TxSearchResult {
  /**
   * Indicates if the requested object was found or not
   */
  found: boolean;
  /**
   * This object carries the search result
   */
  result: {
    /**
     * The id used to search this query.
     */
    entity_id: string;
    entity_type: "tx_id";
    /**
     * Returns basic search result information about the requested id
     */
    tx_data: {
      /**
       * If the transaction lies within the canonical chain
       */
      canonical: boolean;
      /**
       * Refers to the hash of the block for searched transaction
       */
      block_hash: string;
      burn_block_time: number;
      block_height: number;
      tx_type: string;
    };
  };
}
/**
 * List of fungible tokens metadata
 */
export interface FungibleTokensMetadataList {
  /**
   * The number of tokens metadata to return
   */
  limit: number;
  /**
   * The number to tokens metadata to skip (starting at `0`)
   */
  offset: number;
  /**
   * The number of tokens metadata available
   */
  total: number;
  results: FungibleTokenMetadata[];
  [k: string]: unknown | undefined;
}
export interface FungibleTokenMetadata {
  /**
   * An optional string that is a valid URI which resolves to this token's metadata. Can be empty.
   */
  token_uri: string;
  /**
   * Identifies the asset to which this token represents
   */
  name: string;
  /**
   * Describes the asset to which this token represents
   */
  description: string;
  /**
   * A URI pointing to a resource with mime type image/* representing the asset to which this token represents. The API may provide a URI to a cached resource, dependending on configuration. Otherwise, this can be the same value as the canonical image URI.
   */
  image_uri: string;
  /**
   * The original image URI specified by the contract. A URI pointing to a resource with mime type image/* representing the asset to which this token represents. Consider making any images at a width between 320 and 1080 pixels and aspect ratio between 1.91:1 and 4:5 inclusive.
   */
  image_canonical_uri: string;
  /**
   * A shorter representation of a token. This is sometimes referred to as a "ticker". Examples: "STX", "COOL", etc. Typically, a token could be referred to as $SYMBOL when referencing it in writing.
   */
  symbol: string;
  /**
   * The number of decimal places in a token.
   */
  decimals: number;
  /**
   * Tx id that deployed the contract
   */
  tx_id: string;
  /**
   * principle that deployed the contract
   */
  sender_address: string;
}
/**
 * List of non fungible tokens metadata
 */
export interface NonFungibleTokensMetadataList {
  /**
   * The number of tokens metadata to return
   */
  limit: number;
  /**
   * The number to tokens metadata to skip (starting at `0`)
   */
  offset: number;
  /**
   * The number of tokens metadata available
   */
  total: number;
  results: NonFungibleTokenMetadata[];
  [k: string]: unknown | undefined;
}
export interface NonFungibleTokenMetadata {
  /**
   * An optional string that is a valid URI which resolves to this token's metadata. Can be empty.
   */
  token_uri: string;
  /**
   * Identifies the asset to which this token represents
   */
  name: string;
  /**
   * Describes the asset to which this token represents
   */
  description: string;
  /**
   * A URI pointing to a resource with mime type image/* representing the asset to which this token represents. The API may provide a URI to a cached resource, dependending on configuration. Otherwise, this can be the same value as the canonical image URI.
   */
  image_uri: string;
  /**
   * The original image URI specified by the contract. A URI pointing to a resource with mime type image/* representing the asset to which this token represents. Consider making any images at a width between 320 and 1080 pixels and aspect ratio between 1.91:1 and 4:5 inclusive.
   */
  image_canonical_uri: string;
  /**
   * Tx id that deployed the contract
   */
  tx_id: string;
  /**
   * principle that deployed the contract
   */
  sender_address: string;
}
/**
 * GET request that returns transactions
 */
export interface MempoolTransactionListResponse {
  limit: number;
  offset: number;
  total: number;
  results: MempoolTransaction[];
  [k: string]: unknown | undefined;
}
/**
 * GET raw transaction
 */
export interface GetRawTransactionResult {
  /**
   * A hex encoded serialized transaction
   */
  raw_tx: string;
  [k: string]: unknown | undefined;
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
  [k: string]: unknown | undefined;
}
/**
 * GET request that returns transactions
 */
export interface PostCoreNodeTransactionsError {
  /**
   * The error
   */
  error: string;
  /**
   * The reason for the error
   */
  reason: string;
  /**
   * More details about the reason
   */
  reason_data: {
    [k: string]: unknown | undefined;
  };
  /**
   * The relevant transaction id
   */
  txid: string;
  [k: string]: unknown | undefined;
}
/**
 * The latest nonce values used by an account by inspecting the mempool, microblock transactions, and anchored transactions
 */
export interface AddressNonces {
  /**
   * The latest nonce found within mempool transactions sent by this address. Will be null if there are no current mempool transactions for this address.
   */
  last_mempool_tx_nonce: number;
  /**
   * The latest nonce found within transactions sent by this address, including unanchored microblock transactions. Will be null if there are no current transactions for this address.
   */
  last_executed_tx_nonce: number;
  /**
   * The likely nonce required for creating the next transaction, based on the last nonces seen by the API. This can be incorrect if the API's mempool or transactions aren't fully synchronized, even by a small amount, or if a previous transaction is still propagating through the Stacks blockchain network when this endpoint is called.
   */
  possible_next_nonce: number;
  /**
   * Nonces that appear to be missing and likely causing a mempool transaction to be stuck.
   */
  detected_missing_nonces: number[];
}
/**
 * Total burnchain rewards made to a recipient
 */
export interface BurnchainRewardsTotal {
  /**
   * The recipient address that received the burnchain rewards, in the format native to the burnchain (e.g. B58 encoded for Bitcoin)
   */
  reward_recipient: string;
  /**
   * The total amount of burnchain tokens rewarded to the recipient, in the smallest unit (e.g. satoshis for Bitcoin)
   */
  reward_amount: string;
  [k: string]: unknown | undefined;
}
/**
 * Describes representation of a Type-0 Stacks 2.0 transaction. https://github.com/blockstack/stacks-blockchain/blob/master/sip/sip-005-blocks-and-transactions.md#type-0-transferring-an-asset
 */
export interface ReadOnlyFunctionArgs {
  /**
   * The simulated tx-sender
   */
  sender: string;
  /**
   * An array of hex serialized Clarity values
   */
  arguments: string[];
  [k: string]: unknown | undefined;
}
/**
 * Currency is composed of a canonical Symbol and Decimals. This Decimals value is used to convert an Amount.Value from atomic units (Satoshis) to standard units (Bitcoins).
 */
export interface RosettaCurrency2 {
  /**
   * Canonical symbol associated with a currency.
   */
  symbol: string;
  /**
   * Number of decimal places in the standard unit representation of the amount. For example, BTC has 8 decimals. Note that it is not possible to represent the value of some currency in atomic units that is not base 10.
   */
  decimals: number;
  /**
   * Any additional information related to the currency itself. For example, it would be useful to populate this object with the contract address of an ERC-20 token.
   */
  metadata?: {
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * Instead of utilizing HTTP status codes to describe node errors (which often do not have a good analog), rich errors are returned using this object. Both the code and message fields can be individually used to correctly identify an error. Implementations MUST use unique values for both fields.
 */
export interface RosettaError {
  /**
   * Code is a network-specific error code. If desired, this code can be equivalent to an HTTP status code.
   */
  code: number;
  /**
   * Message is a network-specific error message. The message MUST NOT change for a given code. In particular, this means that any contextual information should be included in the details field.
   */
  message: string;
  /**
   * An error is retriable if the same request may succeed if submitted again.
   */
  retriable: boolean;
  /**
   * Often times it is useful to return context specific to the request that caused the error (i.e. a sample of the stack trace or impacted account) in addition to the standard error message.
   */
  details?: {
    address?: string;
    error?: string;
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * The operation_identifier uniquely identifies an operation within a transaction.
 */
export interface RosettaOperationIdentifier1 {
  /**
   * The operation index is used to ensure each operation has a unique identifier within a transaction. This index is only relative to the transaction and NOT GLOBAL. The operations in each transaction should start from index 0. To clarify, there may not be any notion of an operation index in the blockchain being described.
   */
  index: number;
  /**
   * Some blockchains specify an operation index that is essential for client use. For example, Bitcoin uses a network_index to identify which UTXO was used in a transaction. network_index should not be populated if there is no notion of an operation index in a blockchain (typically most account-based blockchains).
   */
  network_index?: number;
  [k: string]: unknown | undefined;
}
/**
 * This object returns transaction for found true
 */
export interface TransactionFound {
  found: true;
  result: MempoolTransaction | Transaction;
}
export interface TransactionList {
  [k: string]: (TransactionFound | TransactionNotFound) | undefined;
}
/**
 * This object returns the id for not found transaction
 */
export interface TransactionNotFound {
  found: false;
  result: {
    tx_id: string;
  };
}
export interface RpcAddressBalanceNotificationParams {
  address: string;
  balance: string;
  [k: string]: unknown | undefined;
}
export interface RpcAddressBalanceNotificationResponse {
  jsonrpc: "2.0";
  method: "address_balance_update";
  params: RpcAddressBalanceNotificationParams;
  [k: string]: unknown | undefined;
}
export interface RpcAddressBalanceSubscriptionParams {
  event: "address_balance_update";
  address: string;
  [k: string]: unknown | undefined;
}
export interface RpcAddressBalanceSubscriptionRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: "address_balance_update";
  params: RpcAddressBalanceSubscriptionParams;
  [k: string]: unknown | undefined;
}
export interface RpcAddressTxNotificationParams {
  address: string;
  tx_id: string;
  tx_type: TransactionType;
  tx_status: TransactionStatus1 | MempoolTransactionStatus1;
  [k: string]: unknown | undefined;
}
export interface RpcAddressTxNotificationResponse {
  jsonrpc: "2.0";
  method: "address_tx_update";
  params: RpcAddressTxNotificationParams;
  [k: string]: unknown | undefined;
}
export interface RpcAddressTxSubscriptionParams {
  event: "address_tx_update";
  address: string;
  [k: string]: unknown | undefined;
}
export interface RpcAddressTxSubscriptionRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: "address_tx_update";
  params: RpcAddressTxSubscriptionParams;
  [k: string]: unknown | undefined;
}
export interface RpcTxUpdateNotificationParams {
  tx_id: string;
  tx_type: TransactionType;
  tx_status: TransactionStatus1 | MempoolTransactionStatus1;
  [k: string]: unknown | undefined;
}
export interface RpcTxUpdateNotificationResponse {
  jsonrpc: "2.0";
  method: "tx_update";
  params: RpcTxUpdateNotificationParams;
  [k: string]: unknown | undefined;
}
export interface RpcTxUpdateSubscriptionParams {
  event: "tx_update";
  tx_id: string;
  [k: string]: unknown | undefined;
}
export interface RpcTxUpdateSubscriptionRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: "tx_update";
  params: RpcTxUpdateSubscriptionParams;
  [k: string]: unknown | undefined;
}
