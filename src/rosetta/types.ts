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
  };
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
}
/**
 * When fetching data by BlockIdentifier, it may be possible to only specify the index or hash. If neither property is specified, it is assumed that the client is making a request at the current block.
 */
export type RosettaPartialBlockIdentifier =
  | RosettaBlockIdentifierHash
  | RosettaBlockIdentifierHeight
  | {
      [k: string]: unknown | undefined;
    };

/**
 * The transaction_identifier uniquely identifies a transaction in a particular network and block or in the mempool.
 */
export interface TransactionIdentifier {
  /**
   * Any transactions that are attributable only to a block (ex: a block event) should use the hash of the block as the identifier.
   */
  hash: string;
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
}

/**
 * This is also known as the block hash.
 */
interface RosettaBlockIdentifierHash {
  /**
   * This is also known as the block hash.
   */
  hash: string;
}

/**
 * This is also known as the block height.
 */
interface RosettaBlockIdentifierHeight {
  /**
   * This is also known as the block height.
   */
  index: number;
}

/**
 * A BlockTransactionResponse contains information about a block transaction.
 */
export interface RosettaBlockTransactionResponse {
  transaction: RosettaTransaction;
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
}

/**
 * Operations contain all balance-changing information within a transaction. They are always one-sided (only affect 1 AccountIdentifier) and can succeed or fail independently from a Transaction.
 */
export interface RosettaOperation {
  operation_identifier: RosettaOperationIdentifier;
  /**
   * Restrict referenced related_operations to identifier indexes \< the current operation_identifier.index. This ensures there exists a clear DAG-structure of relations. Since operations are one-sided, one could imagine relating operations in a single transfer or linking operations in a call tree.
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
}

/**
 * The operation_identifier uniquely identifies an operation within a transaction.
 */
interface RosettaOperationIdentifier {
  /**
   * The operation index is used to ensure each operation has a unique identifier within a transaction. This index is only relative to the transaction and NOT GLOBAL. The operations in each transaction should start from index 0. To clarify, there may not be any notion of an operation index in the blockchain being described.
   */
  index: number;
  /**
   * Some blockchains specify an operation index that is essential for client use. For example, Bitcoin uses a network_index to identify which UTXO was used in a transaction. network_index should not be populated if there is no notion of an operation index in a blockchain (typically most account-based blockchains).
   */
  network_index?: number;
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
}

/**
 * CoinChange is used to represent a change in state of a some coin identified by a coin_identifier. This object is part of the Operation model and must be populated for UTXO-based blockchains. Coincidentally, this abstraction of UTXOs allows for supporting both account-based transfers and UTXO-based transfers on the same blockchain (when a transfer is account-based, don't populate this model).
 */
interface RosettaCoinChange {
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
  coin_action: 'coin_created' | 'coin_spent';
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
}

/**
 * Restrict referenced related_operations to identifier indexes \< the current operation_identifier.index. This ensures there exists a clear DAG-structure of relations. Since operations are one-sided, one could imagine relating operations in a single transfer or linking operations in a call tree.
 */
interface RosettaRelatedOperation {
  /**
   * Describes the index of related operation.
   */
  index: number;
  /**
   * Some blockchains specify an operation index that is essential for client use. network_index should not be populated if there is no notion of an operation index in a blockchain (typically most account-based blockchains).
   */
  network_index?: number;
}

/**
 *
 * A ConstructionMetadataRequest is utilized to get information required to construct a transaction. The Options object used to specify which metadata to return is left purposely unstructured to allow flexibility for implementers. Optionally, the request can also include an array of PublicKeys associated with the AccountIdentifiers returned in ConstructionPreprocessResponse.
 */
export interface RosettaConstructionMetadataRequest {
  network_identifier: NetworkIdentifier;
  options: RosettaOptions;
  public_keys?: RosettaPublicKey[];
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
  status?: string;
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
   * The reward cycle ID for stacking transaction.
   */
  reward_cycle_id?: number;
  /**
   * Delegator address for when calling `delegate-stacking`.
   */
  delegate_to?: string;
  /**
   * The reward address for stacking transaction. It should be a valid Bitcoin address
   */
  pox_addr?: string;
  /**
   * The hex-encoded signer key (buff 33) for PoX.
   */
  signer_key?: string;
  /**
   * The hex-encoded signer private key for PoX. Specify either this or `signer_signature`, otherwise the PoX transaction requires allow-listing from the signer.
   */
  signer_private_key?: string;
  /**
   * The hex-encoded signer signature for PoX. Specify either this or `signer_private_key`, otherwise the PoX transaction requires allow-listing from the signer.
   */
  signer_signature?: string;
  /**
   * The maximum amount of STX to stack for PoX. If not specified, the `amount` will be used as the `max-amount` for the PoX transaction.
   */
  pox_max_amount?: string;
  /**
   * The auth ID for the PoX transaction. If not specified, a random value will be generated.
   */
  pox_auth_id?: string;
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
  curve_type: 'secp256k1' | 'edwards25519';
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
}

/**
 * SigningPayload is signed by the client with the keypair associated with an address using the specified SignatureType. SignatureType can be optionally populated if there is a restriction on the signature scheme that can be used to sign the payload.
 */
interface SigningPayload {
  /**
   * [DEPRECATED by account_identifier in v1.4.4] The network-specific address of the account that should sign the payload.
   */
  address?: string;
  account_identifier?: RosettaAccount;
  hex_bytes: string;
  /**
   * SignatureType is the type of a cryptographic signature.
   */
  signature_type?: 'ecdsa' | 'ecdsa_recovery' | 'ed25519' | 'schnorr_1' | 'schnorr_poseidon';
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
}

/**
 * Amount is some Value of a Currency. It is considered invalid to specify a Value without a Currency.
 */
export interface RosettaMaxFeeAmount {
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
 * RosettaConstructionPreprocessResponse contains options that will be sent unmodified to /construction/metadata. If it is not necessary to make a request to /construction/metadata, options should be omitted. Some blockchains require the PublicKey of particular AccountIdentifiers to construct a valid transaction. To fetch these PublicKeys, populate required_public_keys with the AccountIdentifiers associated with the desired PublicKeys. If it is not necessary to retrieve any PublicKeys for construction, required_public_keys should be omitted.
 */
export interface RosettaConstructionPreprocessResponse {
  options?: RosettaOptions;
  required_public_keys?: RosettaAccount[];
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
}

/**
 * TransactionIdentifier contains the transaction_identifier of a transaction that was submitted to either /construction/submit.
 */
export interface RosettaConstructionSubmitResponse {
  transaction_identifier: TransactionIdentifier;
  metadata?: {
    [k: string]: unknown | undefined;
  };
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
 * A BlockRequest is utilized to make a block request on the /block endpoint.
 */
export interface RosettaBlockRequest {
  network_identifier: NetworkIdentifier;
  block_identifier: RosettaPartialBlockIdentifier;
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
 * A MempoolTransactionRequest is utilized to retrieve a transaction from the mempool.
 */
export interface RosettaMempoolTransactionRequest {
  network_identifier: NetworkIdentifier;
  transaction_identifier: TransactionIdentifier;
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
 * This endpoint returns the version information and allowed network-specific types for a NetworkIdentifier. Any NetworkIdentifier returned by /network/list should be accessible here. Because options are retrievable in the context of a NetworkIdentifier, it is possible to define unique options for each network.
 */
export interface RosettaOptionsRequest {
  network_identifier: NetworkIdentifier;
  metadata?: {
    [k: string]: unknown | undefined;
  };
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
  metadata: {
    burn_block_height: number;
    [k: string]: unknown | undefined;
  };
}

/**
 * The block_identifier uniquely identifies a block in a particular network.
 */
export type RosettaBlockIdentifier = RosettaBlockIdentifierHash & RosettaBlockIdentifierHeight;

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
}

/**
 * If a blockchain is UTXO-based, all unspent Coins owned by an account_identifier should be returned alongside the balance. It is highly recommended to populate this field so that users of the Rosetta API implementation don't need to maintain their own indexer to track their UTXOs.
 */
interface RosettaCoin {
  /**
   * CoinIdentifier uniquely identifies a Coin.
   */
  coin_identifier: {
    /**
     * Identifier should be populated with a globally unique identifier of a Coin. In Bitcoin, this identifier would be transaction_hash:index.
     */
    identifier: string;
  };
  amount: RosettaAmount;
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
}

/**
 * The transaction_identifier uniquely identifies a transaction in a particular network and block or in the mempool.
 */
interface OtherTransactionIdentifier {
  /**
   * Any transactions that are attributable only to a block (ex: a block event) should use the hash of the block as the identifier.
   */
  hash: string;
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
 * RosettaConstructionCombineRequest is the input to the /construction/combine endpoint. It contains the unsigned transaction blob returned by /construction/payloads and all required signatures to create a network transaction.
 */
export interface RosettaConstructionCombineRequest {
  network_identifier: NetworkIdentifier;
  unsigned_transaction: string;
  signatures: RosettaSignature[];
}

/**
 * Signature contains the payload that was signed, the public keys of the keypairs used to produce the signature, the signature (encoded in hex), and the SignatureType. PublicKey is often times not known during construction of the signing payloads but may be needed to combine signatures properly.
 */
interface RosettaSignature {
  signing_payload: SigningPayload;
  public_key: RosettaPublicKey;
  signature_type: SignatureType;
  hex_bytes: string;
}

/**
 * SignatureType is the type of a cryptographic signature.
 */
type SignatureType = 'ecdsa' | 'ecdsa_recovery' | 'ed25519' | 'schnorr_1' | 'schnorr_poseidon';

/**
 * RosettaConstructionCombineResponse is returned by /construction/combine. The network payload will be sent directly to the construction/submit endpoint.
 */
export interface RosettaConstructionCombineResponse {
  /**
   * Signed transaction bytes in hex
   */
  signed_transaction: string;
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
}

/**
 * TransactionIdentifier contains the transaction_identifier of a transaction that was submitted to either /construction/hash or /construction/submit.
 */
export interface RosettaConstructionHashResponse {
  transaction_identifier: TransactionIdentifier;
  metadata?: {
    [k: string]: unknown | undefined;
  };
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
}

/**
 * A MempoolResponse contains all transaction identifiers in the mempool for a particular network_identifier.
 */
export interface RosettaMempoolResponse {
  transaction_identifiers: TransactionIdentifier[];
  metadata?: {
    [k: string]: unknown | undefined;
  };
}

/**
 * A MempoolTransactionResponse contains an estimate of a mempool transaction. It may not be possible to know the full impact of a transaction in the mempool (ex: fee paid).
 */
export interface RosettaMempoolTransactionResponse {
  transaction: RosettaTransaction;
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
  };
}

/**
 * OperationStatus is utilized to indicate which Operation status are considered successful.
 */
interface RosettaOperationStatus {
  /**
   * The status is the network-specific status of the operation.
   */
  status: string;
  /**
   * An Operation is considered successful if the Operation.Amount should affect the Operation.Account. Some blockchains (like Bitcoin) only include successful operations in blocks but other blockchains (like Ethereum) include unsuccessful operations that incur a fee. To reconcile the computed balance from the stream of Operations, it is critical to understand which Operation.Status indicate an Operation is successful and should affect an Account.
   */
  successful: boolean;
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
  /**
   * The latest burn block height
   */
  current_burn_block_height: number;
}

/**
 * The block_identifier uniquely identifies a block in a particular network.
 */
interface RosettaGenesisBlockIdentifier {
  /**
   * This is also known as the block height.
   */
  index: number;
  /**
   * Block hash
   */
  hash: string;
}

/**
 * The block_identifier uniquely identifies a block in a particular network.
 */
interface RosettaOldestBlockIdentifier {
  /**
   * This is also known as the block height.
   */
  index: number;
  /**
   * Block hash
   */
  hash: string;
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
}

/**
 * A Peer is a representation of a node's peer.
 */
interface RosettaPeers {
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
}
/**
 * Get all Transaction Identifiers in the mempool
 */
export interface RosettaMempoolRequest {
  network_identifier: NetworkIdentifier;
  metadata?: {
    [k: string]: unknown | undefined;
  };
}
