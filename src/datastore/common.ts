import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import StrictEventEmitter from 'strict-event-emitter-types';
import { hexToBuffer, parseEnum } from '../helpers';
import { CoreNodeParsedTxMessage } from '../event-stream/core-node-message';
import {
  TransactionAuthTypeID,
  TransactionPayloadTypeID,
  RecipientPrincipalTypeId,
} from '../p2p/tx';
import { c32address } from 'c32check';
import { addressFromHashMode, addressToString } from '@blockstack/stacks-transactions';

export interface DbBlock {
  block_hash: string;
  burn_block_time: number;
  index_block_hash: string;
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
  Failed = -1,
}

export interface DbTx {
  index_block_hash: string;
  block_hash: string;
  block_height: number;
  burn_block_time: number;

  tx_id: string;
  tx_index: number;
  type_id: DbTxTypeId;

  status: DbTxStatus;
  /** Set to `true` if entry corresponds to the canonical chain tip */
  canonical: boolean;
  post_conditions: Buffer;
  /** u64 */
  fee_rate: bigint;
  sender_address: string;
  /** u8 */
  origin_hash_mode: number;
  sponsored: boolean;

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

export interface DbSmartContract {
  tx_id: string;
  canonical: boolean;
  contract_id: string;
  block_height: number;
  source_code: string;
  abi: string;
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

export type DataStoreEventEmitter = StrictEventEmitter<
  EventEmitter,
  {
    txUpdate: (tx: DbTx) => void;
    blockUpdate: (block: DbBlock) => void;
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

export interface DataStore extends DataStoreEventEmitter {
  getBlock(blockHash: string): Promise<{ found: true; result: DbBlock } | { found: false }>;
  getBlocks(count?: number): Promise<{ results: DbBlock[] }>;

  getTx(txId: string): Promise<{ found: true; result: DbTx } | { found: false }>;
  getTxList(args: { limit: number; offset: number }): Promise<{ results: DbTx[]; total: number }>;

  getTxEvents(txId: string, indexBlockHash: string): Promise<{ results: DbEvent[] }>;

  getSmartContract(
    contractId: string
  ): Promise<{ found: true; result: DbSmartContract } | { found: false }>;

  update(data: DataStoreUpdateData): Promise<void>;
}

export function getAssetEventId(event_index: number, event_tx_id: string): string {
  const buff = Buffer.alloc(4 + 32);
  buff.writeUInt32BE(event_index, 0);
  hexToBuffer(event_tx_id).copy(buff, 4);
  const hashed = crypto.createHash('sha256').update(buff).digest().slice(16).toString('hex');
  return '0x' + hashed;
}

export function createDbTxFromCoreMsg(msg: CoreNodeParsedTxMessage): DbTx {
  const coreTx = msg.core_tx;
  const rawTx = msg.raw_tx;
  const dbTx: DbTx = {
    tx_id: coreTx.txid,
    tx_index: coreTx.tx_index,
    index_block_hash: msg.index_block_hash,
    block_hash: msg.block_hash,
    block_height: msg.block_height,
    burn_block_time: msg.burn_block_time,
    type_id: parseEnum(DbTxTypeId, rawTx.payload.typeId as number),
    status: coreTx.success ? DbTxStatus.Success : DbTxStatus.Failed,
    fee_rate: rawTx.auth.originCondition.feeRate,
    sender_address: msg.sender_address,
    origin_hash_mode: rawTx.auth.originCondition.hashMode as number,
    sponsored: rawTx.auth.typeId === TransactionAuthTypeID.Sponsored,
    canonical: true,
    post_conditions: rawTx.rawPostConditions,
  };
  switch (rawTx.payload.typeId) {
    case TransactionPayloadTypeID.TokenTransfer: {
      let recipientPrincipal = c32address(
        rawTx.payload.recipient.address.version,
        rawTx.payload.recipient.address.bytes.toString('hex')
      );
      if (rawTx.payload.recipient.typeId === RecipientPrincipalTypeId.Contract) {
        recipientPrincipal += '.' + rawTx.payload.recipient.contractName;
      }
      dbTx.token_transfer_recipient_address = recipientPrincipal;
      dbTx.token_transfer_amount = rawTx.payload.amount;
      dbTx.token_transfer_memo = rawTx.payload.memo;
      break;
    }
    case TransactionPayloadTypeID.SmartContract: {
      const sender_address = addressToString(
        addressFromHashMode(
          rawTx.auth.originCondition.hashMode as number,
          rawTx.version as number,
          rawTx.auth.originCondition.signer.toString('hex')
        )
      );
      dbTx.smart_contract_contract_id = sender_address + '.' + rawTx.payload.name;
      dbTx.smart_contract_source_code = rawTx.payload.codeBody;
      break;
    }
    case TransactionPayloadTypeID.ContractCall: {
      const contractAddress = c32address(
        rawTx.payload.address.version,
        rawTx.payload.address.bytes.toString('hex')
      );
      dbTx.contract_call_contract_id = `${contractAddress}.${rawTx.payload.contractName}`;
      dbTx.contract_call_function_name = rawTx.payload.functionName;
      dbTx.contract_call_function_args = rawTx.payload.rawFunctionArgs;
      break;
    }
    case TransactionPayloadTypeID.PoisonMicroblock: {
      dbTx.poison_microblock_header_1 = rawTx.payload.microblockHeader1;
      dbTx.poison_microblock_header_2 = rawTx.payload.microblockHeader2;
      break;
    }
    case TransactionPayloadTypeID.Coinbase: {
      dbTx.coinbase_payload = rawTx.payload.payload;
      break;
    }
    default:
      throw new Error(`Unexpected transaction type ID: ${JSON.stringify(rawTx.payload)}`);
  }
  return dbTx;
}
