import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import StrictEventEmitter from 'strict-event-emitter-types';
import { hexToBuffer, parseEnum, FoundOrNot } from '../helpers';
import {
  CoreNodeDropMempoolTxReasonType,
  CoreNodeParsedTxMessage,
  CoreNodeTxStatus,
} from '../event-stream/core-node-message';
import {
  TransactionAuthTypeID,
  TransactionPayloadTypeID,
  RecipientPrincipalTypeId,
  Transaction,
} from '../p2p/tx';
import { c32address } from 'c32check';
import { TransactionType } from '@blockstack/stacks-blockchain-api-types';
import { getTxSenderAddress } from '../event-stream/reader';

export interface DbBlock {
  block_hash: string;
  burn_block_time: number;
  burn_block_hash: string;
  burn_block_height: number;
  miner_txid: string;
  index_block_hash: string;
  parent_index_block_hash: string;
  parent_block_hash: string;
  parent_microblock: string;
  block_height: number;
  /** Set to `true` if entry corresponds to the canonical chain tip */
  canonical: boolean;
}

export interface DbBurnchainReward {
  canonical: boolean;
  burn_block_hash: string;
  burn_block_height: number;
  burn_amount: bigint;
  reward_recipient: string;
  reward_amount: bigint;
  reward_index: number;
}

export interface DbMinerReward {
  block_hash: string;
  index_block_hash: string;
  from_index_block_hash: string;
  mature_block_height: number;
  /** Set to `true` if entry corresponds to the canonical chain tip */
  canonical: boolean;
  /** STX principal */
  recipient: string;
  coinbase_amount: bigint;
  tx_fees_anchored: bigint;
  tx_fees_streamed_confirmed: bigint;
  tx_fees_streamed_produced: bigint;
}

export enum DbTxTypeId {
  TokenTransfer = 0x00,
  SmartContract = 0x01,
  ContractCall = 0x02,
  PoisonMicroblock = 0x03,
  Coinbase = 0x04,
}

export enum DbTxStatus {
  Pending = 0,
  Success = 1,
  AbortByResponse = -1,
  AbortByPostCondition = -2,
  /** Replaced by a transaction with the same nonce, but a higher fee. */
  DroppedReplaceByFee = -10,
  /** Replaced by a transaction with the same nonce but in the canonical fork. */
  DroppedReplaceAcrossFork = -11,
  /** The transaction is too expensive to include in a block. */
  DroppedTooExpensive = -12,
  /** Transaction was dropped because it became stale. */
  DroppedStaleGarbageCollect = -13,
}

export interface BaseTx {
  /** u64 */
  fee_rate: bigint;
  sender_address: string;
  sponsored: boolean;
  sponsor_address?: string;
  nonce: number;
  tx_id: string;
  /** Only valid for `token_transfer` tx types. */
  token_transfer_recipient_address?: string;
  /** 64-bit unsigned integer. */
  token_transfer_amount?: bigint;
  /** Hex encoded arbitrary message, up to 34 bytes length (should try decoding to an ASCII string). */
  token_transfer_memo?: Buffer;
  status: DbTxStatus;
  type_id: DbTxTypeId;
  /** Only valid for `contract_call` tx types */
  contract_call_contract_id?: string;
  contract_call_function_name?: string;
  /** Hex encoded Clarity values. Undefined if function defines no args. */
  contract_call_function_args?: Buffer;
  raw_result?: string;
}

export interface DbTx extends BaseTx {
  index_block_hash: string;
  block_hash: string;
  block_height: number;
  burn_block_time: number;

  raw_tx: Buffer;
  tx_index: number;

  /** Set to `true` if entry corresponds to the canonical chain tip */
  canonical: boolean;
  post_conditions: Buffer;

  /** u8 */
  origin_hash_mode: number;

  /** Only valid for `smart_contract` tx types. */
  smart_contract_contract_id?: string;
  smart_contract_source_code?: string;

  /** Only valid for `poison_microblock` tx types. */
  poison_microblock_header_1?: Buffer;
  poison_microblock_header_2?: Buffer;

  /** Only valid for `coinbase` tx types. Hex encoded 32-bytes. */
  coinbase_payload?: Buffer;
}

export interface DbMempoolTx extends BaseTx {
  pruned: boolean;
  raw_tx: Buffer;

  receipt_time: number;

  post_conditions: Buffer;
  /** u8 */
  origin_hash_mode: number;

  /** Only valid for `smart_contract` tx types. */
  smart_contract_contract_id?: string;
  smart_contract_source_code?: string;

  /** Only valid for `poison_microblock` tx types. */
  poison_microblock_header_1?: Buffer;
  poison_microblock_header_2?: Buffer;

  /** Only valid for `coinbase` tx types. Hex encoded 32-bytes. */
  coinbase_payload?: Buffer;
}

export interface DbMempoolTxId {
  tx_id: string;
}

export interface DbSmartContract {
  tx_id: string;
  canonical: boolean;
  contract_id: string;
  block_height: number;
  source_code: string;
  abi: string;
}

export enum DbFaucetRequestCurrency {
  BTC = 'btc',
  STX = 'stx',
}

export interface DbFaucetRequest {
  currency: DbFaucetRequestCurrency;
  address: string;
  ip: string;
  occurred_at: number;
}

export enum DbEventTypeId {
  SmartContractLog = 1,
  StxAsset = 2,
  FungibleTokenAsset = 3,
  NonFungibleTokenAsset = 4,
  StxLock = 5,
}

export interface DbEventBase {
  event_index: number;
  tx_id: string;
  tx_index: number;
  block_height: number;
  /** Set to `true` if entry corresponds to the canonical chain tip */
  canonical: boolean;
}

export interface DbSmartContractEvent extends DbEventBase {
  event_type: DbEventTypeId.SmartContractLog;
  contract_identifier: string;
  topic: string;
  value: Buffer;
}

export interface DbStxLockEvent extends DbEventBase {
  event_type: DbEventTypeId.StxLock;
  locked_amount: BigInt;
  unlock_height: number;
  locked_address: string;
}

export enum DbAssetEventTypeId {
  Transfer = 1,
  Mint = 2,
  Burn = 3,
}

export interface DbAssetEvent extends DbEventBase {
  asset_event_type_id: DbAssetEventTypeId;
  sender?: string;
  recipient?: string;
}

export interface DbStxEvent extends DbAssetEvent {
  event_type: DbEventTypeId.StxAsset;
  amount: bigint;
}

export interface DbContractAssetEvent extends DbAssetEvent {
  asset_identifier: string;
}

export interface DbFtEvent extends DbContractAssetEvent {
  event_type: DbEventTypeId.FungibleTokenAsset;
  /** unsigned 128-bit integer */
  amount: bigint;
}

export interface DbNftEvent extends DbContractAssetEvent {
  event_type: DbEventTypeId.NonFungibleTokenAsset;
  /** Raw Clarity value */
  value: Buffer;
}

export type DbEvent = DbSmartContractEvent | DbStxEvent | DbStxLockEvent | DbFtEvent | DbNftEvent;

export interface AddressTxUpdateInfo {
  address: string;
  txs: DbTx[];
}

export type DataStoreEventEmitter = StrictEventEmitter<
  EventEmitter,
  {
    txUpdate: (info: DbTx | DbMempoolTx) => void;
    blockUpdate: (block: DbBlock) => void;
    addressUpdate: (info: AddressTxUpdateInfo) => void;
  }
>;

export interface DataStoreUpdateData {
  block: DbBlock;
  minerRewards: DbMinerReward[];
  txs: {
    tx: DbTx;
    stxEvents: DbStxEvent[];
    stxLockEvents: DbStxLockEvent[];
    ftEvents: DbFtEvent[];
    nftEvents: DbNftEvent[];
    contractLogEvents: DbSmartContractEvent[];
    smartContracts: DbSmartContract[];
  }[];
}

export interface DbSearchResult {
  entity_type: 'standard_address' | 'contract_address' | 'block_hash' | 'tx_id' | 'mempool_tx_id';
  entity_id: string;
  entity_data?: DbBlock | DbMempoolTx | DbTx;
}

export interface DbFtBalance {
  balance: bigint;
  totalSent: bigint;
  totalReceived: bigint;
}

export interface DbStxBalance {
  balance: bigint;
  totalSent: bigint;
  totalReceived: bigint;
  totalFeesSent: bigint;
  totalMinerRewardsReceived: bigint;
  lockTxId: string;
  locked: bigint;
  lockHeight: number;
  burnchainLockHeight: number;
  burnchainUnlockHeight: number;
}

export interface DbInboundStxTransfer {
  sender: string;
  amount: bigint;
  memo: string;
  block_height: number;
  tx_id: string;
  transfer_type: string;
  tx_index: number;
}

export interface DataStore extends DataStoreEventEmitter {
  getBlock(blockHash: string): Promise<FoundOrNot<DbBlock>>;
  getBlockByHeight(block_height: number): Promise<FoundOrNot<DbBlock>>;
  getCurrentBlock(): Promise<FoundOrNot<DbBlock>>;
  getBlocks(args: {
    limit: number;
    offset: number;
  }): Promise<{ results: DbBlock[]; total: number }>;
  getBlockTxs(indexBlockHash: string): Promise<{ results: string[] }>;
  getBlockTxsRows(blockHash: string): Promise<FoundOrNot<DbTx[]>>;

  getMempoolTx(args: { txId: string; includePruned?: boolean }): Promise<FoundOrNot<DbMempoolTx>>;
  getMempoolTxList(args: {
    limit: number;
    offset: number;
    senderAddress?: string;
    recipientAddress?: string;
    address?: string;
  }): Promise<{ results: DbMempoolTx[]; total: number }>;
  getDroppedTxs(args: {
    limit: number;
    offset: number;
  }): Promise<{ results: DbMempoolTx[]; total: number }>;
  getMempoolTxIdList(): Promise<{ results: DbMempoolTxId[] }>;
  getTx(txId: string): Promise<FoundOrNot<DbTx>>;
  getTxList(args: {
    limit: number;
    offset: number;
    txTypeFilter: TransactionType[];
  }): Promise<{ results: DbTx[]; total: number }>;

  getTxEvents(args: {
    txId: string;
    indexBlockHash: string;
    limit: number;
    offset: number;
  }): Promise<{ results: DbEvent[] }>;

  getSmartContract(contractId: string): Promise<FoundOrNot<DbSmartContract>>;

  getSmartContractEvents(args: {
    contractId: string;
    limit: number;
    offset: number;
  }): Promise<FoundOrNot<DbSmartContractEvent[]>>;

  update(data: DataStoreUpdateData): Promise<void>;
  updateMempoolTxs(args: { mempoolTxs: DbMempoolTx[] }): Promise<void>;
  dropMempoolTxs(args: { status: DbTxStatus; txIds: string[] }): Promise<void>;

  updateBurnchainRewards(args: {
    burnchainBlockHash: string;
    burnchainBlockHeight: number;
    rewards: DbBurnchainReward[];
  }): Promise<void>;
  getBurnchainRewards(args: {
    /** Optionally search for rewards for a given address. */
    burnchainRecipient?: string;
    limit: number;
    offset: number;
  }): Promise<DbBurnchainReward[]>;
  getBurnchainRewardsTotal(
    burnchainRecipient: string
  ): Promise<{ reward_recipient: string; reward_amount: bigint }>;

  getStxBalance(stxAddress: string): Promise<DbStxBalance>;
  getStxBalanceAtBlock(stxAddress: string, blockHeight: number): Promise<DbStxBalance>;
  getFungibleTokenBalances(stxAddress: string): Promise<Map<string, DbFtBalance>>;
  getNonFungibleTokenCounts(
    stxAddress: string
  ): Promise<Map<string, { count: bigint; totalSent: bigint; totalReceived: bigint }>>;

  getUnlockedStxSupply(args: {
    blockHeight?: number;
  }): Promise<{ stx: bigint; blockHeight: number }>;

  getBTCFaucetRequests(address: string): Promise<{ results: DbFaucetRequest[] }>;

  getSTXFaucetRequests(address: string): Promise<{ results: DbFaucetRequest[] }>;

  getAddressTxs(args: {
    stxAddress: string;
    limit: number;
    offset: number;
    height?: number;
  }): Promise<{ results: DbTx[]; total: number }>;

  getAddressAssetEvents(args: {
    stxAddress: string;
    limit: number;
    offset: number;
  }): Promise<{ results: DbEvent[]; total: number }>;

  getInboundTransfers(args: {
    stxAddress: string;
    limit: number;
    offset: number;
    sendManyContractId: string;
    height?: number;
  }): Promise<{ results: DbInboundStxTransfer[]; total: number }>;

  searchHash(args: { hash: string }): Promise<FoundOrNot<DbSearchResult>>;

  searchPrincipal(args: { principal: string }): Promise<FoundOrNot<DbSearchResult>>;

  insertFaucetRequest(faucetRequest: DbFaucetRequest): Promise<void>;
}

export function getAssetEventId(event_index: number, event_tx_id: string): string {
  const buff = Buffer.alloc(4 + 32);
  buff.writeUInt32BE(event_index, 0);
  hexToBuffer(event_tx_id).copy(buff, 4);
  const hashed = crypto.createHash('sha256').update(buff).digest().slice(16).toString('hex');
  return '0x' + hashed;
}

export function getTxDbStatus(
  txCoreStatus: CoreNodeTxStatus | CoreNodeDropMempoolTxReasonType
): DbTxStatus {
  switch (txCoreStatus) {
    case 'success':
      return DbTxStatus.Success;
    case 'abort_by_response':
      return DbTxStatus.AbortByResponse;
    case 'abort_by_post_condition':
      return DbTxStatus.AbortByPostCondition;
    case 'ReplaceByFee':
      return DbTxStatus.DroppedReplaceByFee;
    case 'ReplaceAcrossFork':
      return DbTxStatus.DroppedReplaceAcrossFork;
    case 'TooExpensive':
      return DbTxStatus.DroppedTooExpensive;
    case 'StaleGarbageCollect':
      return DbTxStatus.DroppedStaleGarbageCollect;
    default:
      throw new Error(`Unexpected tx status: ${txCoreStatus}`);
  }
}

/**
 * Extract tx-type specific data from a Transaction and into a tx db model.
 * @param txData - Transaction data to extract from.
 * @param dbTx - The tx db object to write to.
 */
function extractTransactionPayload(txData: Transaction, dbTx: DbTx | DbMempoolTx) {
  switch (txData.payload.typeId) {
    case TransactionPayloadTypeID.TokenTransfer: {
      let recipientPrincipal = c32address(
        txData.payload.recipient.address.version,
        txData.payload.recipient.address.bytes.toString('hex')
      );
      if (txData.payload.recipient.typeId === RecipientPrincipalTypeId.Contract) {
        recipientPrincipal += '.' + txData.payload.recipient.contractName;
      }
      dbTx.token_transfer_recipient_address = recipientPrincipal;
      dbTx.token_transfer_amount = txData.payload.amount;
      dbTx.token_transfer_memo = txData.payload.memo;
      break;
    }
    case TransactionPayloadTypeID.SmartContract: {
      const sender_address = getTxSenderAddress(txData);
      dbTx.smart_contract_contract_id = sender_address + '.' + txData.payload.name;
      dbTx.smart_contract_source_code = txData.payload.codeBody;
      break;
    }
    case TransactionPayloadTypeID.ContractCall: {
      const contractAddress = c32address(
        txData.payload.address.version,
        txData.payload.address.bytes.toString('hex')
      );
      dbTx.contract_call_contract_id = `${contractAddress}.${txData.payload.contractName}`;
      dbTx.contract_call_function_name = txData.payload.functionName;
      dbTx.contract_call_function_args = txData.payload.rawFunctionArgs;
      break;
    }
    case TransactionPayloadTypeID.PoisonMicroblock: {
      dbTx.poison_microblock_header_1 = txData.payload.microblockHeader1;
      dbTx.poison_microblock_header_2 = txData.payload.microblockHeader2;
      break;
    }
    case TransactionPayloadTypeID.Coinbase: {
      dbTx.coinbase_payload = txData.payload.payload;
      break;
    }
    default:
      throw new Error(`Unexpected transaction type ID: ${JSON.stringify(txData.payload)}`);
  }
}

export function createDbMempoolTxFromCoreMsg(msg: {
  txData: Transaction;
  txId: string;
  sender: string;
  sponsorAddress?: string;
  rawTx: Buffer;
  receiptDate: number;
}): DbMempoolTx {
  const dbTx: DbMempoolTx = {
    pruned: false,
    nonce: Number(msg.txData.auth.originCondition.nonce),
    tx_id: msg.txId,
    raw_tx: msg.rawTx,
    type_id: parseEnum(DbTxTypeId, msg.txData.payload.typeId as number),
    status: DbTxStatus.Pending,
    receipt_time: msg.receiptDate,
    fee_rate: msg.txData.auth.originCondition.feeRate,
    sender_address: msg.sender,
    origin_hash_mode: msg.txData.auth.originCondition.hashMode as number,
    sponsored: msg.txData.auth.typeId === TransactionAuthTypeID.Sponsored,
    sponsor_address: msg.sponsorAddress,
    post_conditions: msg.txData.rawPostConditions,
  };
  extractTransactionPayload(msg.txData, dbTx);
  return dbTx;
}

export function createDbTxFromCoreMsg(msg: CoreNodeParsedTxMessage): DbTx {
  const coreTx = msg.core_tx;
  const parsedTx = msg.parsed_tx;
  const dbTx: DbTx = {
    tx_id: coreTx.txid,
    tx_index: coreTx.tx_index,
    nonce: Number(parsedTx.auth.originCondition.nonce),
    raw_tx: msg.raw_tx,
    index_block_hash: msg.index_block_hash,
    block_hash: msg.block_hash,
    block_height: msg.block_height,
    burn_block_time: msg.burn_block_time,
    type_id: parseEnum(DbTxTypeId, parsedTx.payload.typeId as number),
    status: getTxDbStatus(coreTx.status),
    raw_result: coreTx.raw_result,
    fee_rate: parsedTx.auth.originCondition.feeRate,
    sender_address: msg.sender_address,
    sponsor_address: msg.sponsor_address,
    origin_hash_mode: parsedTx.auth.originCondition.hashMode as number,
    sponsored: parsedTx.auth.typeId === TransactionAuthTypeID.Sponsored,
    canonical: true,
    post_conditions: parsedTx.rawPostConditions,
  };
  extractTransactionPayload(parsedTx, dbTx);
  return dbTx;
}
