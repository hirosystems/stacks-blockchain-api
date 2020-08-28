import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import StrictEventEmitter from 'strict-event-emitter-types';
import { hexToBuffer, parseEnum, FoundOrNot } from '../helpers';
import { CoreNodeParsedTxMessage, CoreNodeTxStatus } from '../event-stream/core-node-message';
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
  index_block_hash: string;
  parent_index_block_hash: string;
  parent_block_hash: string;
  parent_microblock: string;
  block_height: number;
  /** Set to `true` if entry corresponds to the canonical chain tip */
  canonical: boolean;
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
}

// TODO: create a base interface for DbTx and DbMempoolTx, rename DbTx to DbTxMined?

export interface DbTx {
  index_block_hash: string;
  block_hash: string;
  block_height: number;
  burn_block_time: number;

  tx_id: string;
  raw_tx: Buffer;
  tx_index: number;
  type_id: DbTxTypeId;

  status: DbTxStatus;
  raw_result?: string;

  /** Set to `true` if entry corresponds to the canonical chain tip */
  canonical: boolean;
  post_conditions: Buffer;
  /** u64 */
  fee_rate: bigint;
  sender_address: string;
  /** u8 */
  origin_hash_mode: number;
  sponsored: boolean;
  sponsor_address?: string;

  /** Only valid for `token_transfer` tx types. */
  token_transfer_recipient_address?: string;
  /** 64-bit unsigned integer. */
  token_transfer_amount?: bigint;
  /** Hex encoded arbitrary message, up to 34 bytes length (should try decoding to an ASCII string). */
  token_transfer_memo?: Buffer;

  /** Only valid for `contract_call` tx types */
  contract_call_contract_id?: string;
  contract_call_function_name?: string;
  /** Hex encoded Clarity values. Undefined if function defines no args. */
  contract_call_function_args?: Buffer;

  /** Only valid for `smart_contract` tx types. */
  smart_contract_contract_id?: string;
  smart_contract_source_code?: string;

  /** Only valid for `poison_microblock` tx types. */
  poison_microblock_header_1?: Buffer;
  poison_microblock_header_2?: Buffer;

  /** Only valid for `coinbase` tx types. Hex encoded 32-bytes. */
  coinbase_payload?: Buffer;
}

export interface DbMempoolTx {
  tx_id: string;
  raw_tx: Buffer;
  type_id: DbTxTypeId;

  status: DbTxStatus;

  receipt_time: number;

  post_conditions: Buffer;
  /** u64 */
  fee_rate: bigint;
  sender_address: string;
  /** u8 */
  origin_hash_mode: number;
  sponsored: boolean;
  sponsor_address?: string;

  /** Only valid for `token_transfer` tx types. */
  token_transfer_recipient_address?: string;
  /** 64-bit unsigned integer. */
  token_transfer_amount?: bigint;
  /** Hex encoded arbitrary message, up to 34 bytes length (should try decoding to an ASCII string). */
  token_transfer_memo?: Buffer;

  /** Only valid for `contract_call` tx types */
  contract_call_contract_id?: string;
  contract_call_function_name?: string;
  /** Hex encoded Clarity values. Undefined if function defines no args. */
  contract_call_function_args?: Buffer;

  /** Only valid for `smart_contract` tx types. */
  smart_contract_contract_id?: string;
  smart_contract_source_code?: string;

  /** Only valid for `poison_microblock` tx types. */
  poison_microblock_header_1?: Buffer;
  poison_microblock_header_2?: Buffer;

  /** Only valid for `coinbase` tx types. Hex encoded 32-bytes. */
  coinbase_payload?: Buffer;

  /** Added for consistency. */
  raw_result?: string;
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

export type DbEvent = DbSmartContractEvent | DbStxEvent | DbFtEvent | DbNftEvent;

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
  txs: {
    tx: DbTx;
    stxEvents: DbStxEvent[];
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

export interface DataStore extends DataStoreEventEmitter {
  getBlock(blockHash: string): Promise<FoundOrNot<DbBlock>>;
  getBlockByHeight(block_height: number): Promise<FoundOrNot<DbBlock>>;
  getCurrentBlock(): Promise<FoundOrNot<DbBlock>>;
  getBlocks(args: {
    limit: number;
    offset: number;
  }): Promise<{ results: DbBlock[]; total: number }>;
  getBlockTxs(indexBlockHash: string): Promise<{ results: string[] }>;
  getBlockTxsRows(indexBlockHash: string): Promise<FoundOrNot<DbTx[]>>;

  getMempoolTx(txId: string): Promise<FoundOrNot<DbMempoolTx>>;
  getMempoolTxList(args: {
    limit: number;
    offset: number;
  }): Promise<{ results: DbMempoolTx[]; total: number }>;
  getTx(txId: string): Promise<FoundOrNot<DbTx>>;
  getTxList(args: {
    limit: number;
    offset: number;
    txTypeFilter: TransactionType[];
  }): Promise<{ results: DbTx[]; total: number }>;

  getTxEvents(txId: string, indexBlockHash: string): Promise<{ results: DbEvent[] }>;

  getSmartContract(contractId: string): Promise<FoundOrNot<DbSmartContract>>;

  getSmartContractEvents(args: {
    contractId: string;
    limit: number;
    offset: number;
  }): Promise<FoundOrNot<DbSmartContractEvent[]>>;

  update(data: DataStoreUpdateData): Promise<void>;

  updateMempoolTx(args: { mempoolTx: DbMempoolTx }): Promise<void>;

  getStxBalance(
    stxAddress: string
  ): Promise<{ balance: bigint; totalSent: bigint; totalReceived: bigint }>;
  getFungibleTokenBalances(
    stxAddress: string
  ): Promise<Map<string, { balance: bigint; totalSent: bigint; totalReceived: bigint }>>;
  getNonFungibleTokenCounts(
    stxAddress: string
  ): Promise<Map<string, { count: bigint; totalSent: bigint; totalReceived: bigint }>>;

  getBTCFaucetRequests(address: string): Promise<{ results: DbFaucetRequest[] }>;

  getSTXFaucetRequests(address: string): Promise<{ results: DbFaucetRequest[] }>;

  getAddressTxs(args: {
    stxAddress: string;
    limit: number;
    offset: number;
  }): Promise<{ results: DbTx[]; total: number }>;

  getAddressAssetEvents(args: {
    stxAddress: string;
    limit: number;
    offset: number;
  }): Promise<{ results: DbEvent[]; total: number }>;

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

function getTxDbStatus(txCoreStatus: CoreNodeTxStatus): DbTxStatus {
  switch (txCoreStatus) {
    case 'success':
      return DbTxStatus.Success;
    case 'abort_by_response':
      return DbTxStatus.AbortByResponse;
    case 'abort_by_post_condition':
      return DbTxStatus.AbortByPostCondition;
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
