import { hexToBuffer, logError, parseEnum, unwrapOptionalProp } from '../helpers';
import {
  BlockQueryResult,
  ContractTxQueryResult,
  DbBlock,
  DbEvent,
  DbEventBase,
  DbEventTypeId,
  DbFaucetRequest,
  DbFaucetRequestCurrency,
  DbFtEvent,
  DbMempoolStats,
  DbMempoolTx,
  DbMempoolTxRaw,
  DbMicroblock,
  DbNftEvent,
  DbPox2BaseEventData,
  DbPox2DelegateStackExtendEvent,
  DbPox2DelegateStackIncreaseEvent,
  DbPox2DelegateStackStxEvent,
  DbPox2DelegateStxEvent,
  DbPox2Event,
  DbPox2HandleUnlockEvent,
  DbPox2StackAggregationCommitEvent,
  DbPox2StackAggregationCommitIndexedEvent,
  DbPox2StackAggregationIncreaseEvent,
  DbPox2StackExtendEvent,
  DbPox2StackIncreaseEvent,
  DbPox2StackStxEvent,
  DbSmartContract,
  DbSmartContractEvent,
  DbStxEvent,
  DbStxLockEvent,
  DbTx,
  DbTxAnchorMode,
  DbTxRaw,
  DbTxStatus,
  DbTxTypeId,
  FaucetRequestQueryResult,
  MempoolTxQueryResult,
  MicroblockQueryResult,
  Pox2EventQueryResult,
  TxQueryResult,
} from './common';
import {
  CoreNodeDropMempoolTxReasonType,
  CoreNodeParsedTxMessage,
  CoreNodeTxStatus,
} from '../event-stream/core-node-message';
import {
  decodeClarityValueToRepr,
  DecodedTxResult,
  PostConditionAuthFlag,
  PrincipalTypeID,
  TxPayloadTypeID,
} from 'stacks-encoding-native-js';
import { getTxSenderAddress } from '../event-stream/reader';
import postgres = require('postgres');
import * as prom from 'prom-client';
import { PgSqlClient } from './connection';
import { NftEvent } from 'docs/generated';
import { getAssetEventTypeString } from '../api/controllers/db-controller';
import { PgStoreEventEmitter } from './pg-store-event-emitter';
import { Pox2EventName } from '../pox-helpers';

export const TX_COLUMNS = [
  'tx_id',
  'tx_index',
  'index_block_hash',
  'parent_index_block_hash',
  'block_hash',
  'parent_block_hash',
  'block_height',
  'burn_block_time',
  'parent_burn_block_time',
  'type_id',
  'anchor_mode',
  'status',
  'canonical',
  'post_conditions',
  'nonce',
  'fee_rate',
  'sponsored',
  'sponsor_nonce',
  'sponsor_address',
  'sender_address',
  'origin_hash_mode',
  'microblock_canonical',
  'microblock_sequence',
  'microblock_hash',
  'token_transfer_recipient_address',
  'token_transfer_amount',
  'token_transfer_memo',
  'smart_contract_clarity_version',
  'smart_contract_contract_id',
  'smart_contract_source_code',
  'contract_call_contract_id',
  'contract_call_function_name',
  'contract_call_function_args',
  'poison_microblock_header_1',
  'poison_microblock_header_2',
  'coinbase_payload',
  'coinbase_alt_recipient',
  'raw_result',
  'event_count',
  'execution_cost_read_count',
  'execution_cost_read_length',
  'execution_cost_runtime',
  'execution_cost_write_count',
  'execution_cost_write_length',
];

export const MEMPOOL_TX_COLUMNS = [
  'pruned',
  'tx_id',
  'type_id',
  'anchor_mode',
  'status',
  'receipt_time',
  'receipt_block_height',
  'post_conditions',
  'nonce',
  'fee_rate',
  'sponsored',
  'sponsor_nonce',
  'sponsor_address',
  'sender_address',
  'origin_hash_mode',
  'token_transfer_recipient_address',
  'token_transfer_amount',
  'token_transfer_memo',
  'smart_contract_clarity_version',
  'smart_contract_contract_id',
  'smart_contract_source_code',
  'contract_call_contract_id',
  'contract_call_function_name',
  'contract_call_function_args',
  'poison_microblock_header_1',
  'poison_microblock_header_2',
  'coinbase_payload',
  'coinbase_alt_recipient',
];

export const BLOCK_COLUMNS = [
  'block_hash',
  'index_block_hash',
  'parent_index_block_hash',
  'parent_block_hash',
  'parent_microblock_hash',
  'parent_microblock_sequence',
  'block_height',
  'burn_block_time',
  'burn_block_hash',
  'burn_block_height',
  'miner_txid',
  'canonical',
  'execution_cost_read_count',
  'execution_cost_read_length',
  'execution_cost_runtime',
  'execution_cost_write_count',
  'execution_cost_write_length',
];

export const MICROBLOCK_COLUMNS = [
  'canonical',
  'microblock_canonical',
  'microblock_hash',
  'microblock_sequence',
  'microblock_parent_hash',
  'parent_index_block_hash',
  'block_height',
  'parent_block_height',
  'parent_block_hash',
  'parent_burn_block_height',
  'parent_burn_block_time',
  'parent_burn_block_hash',
  'index_block_hash',
  'block_hash',
];

// Tables containing tx metadata, like events (stx, ft, nft transfers), contract logs, bns data, etc.
export const TX_METADATA_TABLES = [
  'stx_events',
  'ft_events',
  'nft_events',
  'pox2_events',
  'pox3_events',
  'contract_logs',
  'stx_lock_events',
  'smart_contracts',
  'names',
  'namespaces',
  'subdomains',
] as const;

export const POX2_EVENT_COLUMNS = [
  'event_index',
  'tx_id',
  'tx_index',
  'block_height',
  'index_block_hash',
  'parent_index_block_hash',
  'microblock_hash',
  'microblock_sequence',
  'canonical',
  'microblock_canonical',
  'stacker',
  'locked',
  'balance',
  'burnchain_unlock_height',
  'name',
  'pox_addr',
  'pox_addr_raw',
  'first_cycle_locked',
  'first_unlocked_cycle',
  'lock_period',
  'lock_amount',
  'start_burn_height',
  'unlock_burn_height',
  'delegator',
  'delegate_to',
  'increase_by',
  'total_locked',
  'extend_count',
  'reward_cycle',
  'amount_ustx',
];

export const POX3_EVENT_COLUMNS = POX2_EVENT_COLUMNS;

/**
 * Checks if a given error from the pg lib is a connection error (i.e. the query is retryable).
 * If true then returns a normalized error message, otherwise returns false.
 */
export function isPgConnectionError(error: any): string | false {
  if (error.code === 'ECONNREFUSED') {
    return 'Postgres connection ECONNREFUSED';
  } else if (error.code === 'ETIMEDOUT') {
    return 'Postgres connection ETIMEDOUT';
  } else if (error.code === 'ENOTFOUND') {
    return 'Postgres connection ENOTFOUND';
  } else if (error.code === 'ECONNRESET') {
    return 'Postgres connection ECONNRESET';
  } else if (error.code === 'CONNECTION_CLOSED') {
    return 'Postgres connection CONNECTION_CLOSED';
  } else if (error.code === 'CONNECTION_ENDED') {
    return 'Postgres connection CONNECTION_ENDED';
  } else if (error.code === 'CONNECTION_DESTROYED') {
    return 'Postgres connection CONNECTION_DESTROYED';
  } else if (error.code === 'CONNECTION_CONNECT_TIMEOUT') {
    return 'Postgres connection CONNECTION_CONNECT_TIMEOUT';
  } else if (error.code === 'CONNECT_TIMEOUT') {
    return 'Postgres connection CONNECT_TIMEOUT';
  } else if (error.message) {
    const msg = (error as Error).message.toLowerCase();
    if (msg.includes('database system is starting up')) {
      return 'Postgres connection failed while database system is starting up';
    } else if (msg.includes('database system is shutting down')) {
      return 'Postgres connection failed while database system is shutting down';
    } else if (msg.includes('connection terminated unexpectedly')) {
      return 'Postgres connection terminated unexpectedly';
    } else if (msg.includes('connection terminated')) {
      return 'Postgres connection terminated';
    } else if (msg.includes('connection error')) {
      return 'Postgres client has encountered a connection error and is not queryable';
    } else if (msg.includes('terminating connection due to unexpected postmaster exit')) {
      return 'Postgres connection terminating due to unexpected postmaster exit';
    } else if (msg.includes('getaddrinfo eai_again')) {
      return 'Postgres connection failed due to a DNS lookup error';
    }
  }
  return false;
}

/**
 * Adds a table name prefix to an array of column names.
 * @param columns - array of column names
 * @param prefix - table name prefix
 * @returns array with prefixed columns
 */
export function prefixedCols(columns: string[], prefix: string): string[] {
  return columns.map(c => `${prefix}.${c}`);
}

/**
 * Concatenates column names to use on a query. Necessary when one or more of those columns is complex enough
 * so that postgres.js can't figure out how to list it (e.g. abi column, aggregates, partitions, etc.).
 * @param sql - SQL client
 * @param columns - list of columns
 * @returns raw SQL column list string
 */
export function unsafeCols(sql: PgSqlClient, columns: string[]): postgres.PendingQuery<any> {
  return sql.unsafe(columns.join(', '));
}

/**
 * Shorthand function that returns a column query to retrieve the smart contract abi when querying transactions
 * that may be of type `contract_call`. Usually used alongside `TX_COLUMNS` or `MEMPOOL_TX_COLUMNS`.
 * @param tableName - Name of the table that will determine the transaction type. Defaults to `txs`.
 * @returns `string` - abi column select statement portion
 */
export function abiColumn(tableName: string = 'txs'): string {
  return `
    CASE WHEN ${tableName}.type_id = ${DbTxTypeId.ContractCall} THEN (
      SELECT abi
      FROM smart_contracts
      WHERE smart_contracts.contract_id = ${tableName}.contract_call_contract_id
      ORDER BY abi != 'null' DESC, canonical DESC, microblock_canonical DESC, block_height DESC
      LIMIT 1
    ) END as abi
    `;
}

export function parseMempoolTxQueryResult(result: MempoolTxQueryResult): DbMempoolTx {
  const tx: DbMempoolTx = {
    pruned: result.pruned,
    tx_id: result.tx_id,
    nonce: result.nonce,
    sponsor_nonce: result.sponsor_nonce ?? undefined,
    type_id: result.type_id as DbTxTypeId,
    anchor_mode: result.anchor_mode as DbTxAnchorMode,
    status: result.status,
    receipt_time: result.receipt_time,
    post_conditions: result.post_conditions,
    fee_rate: BigInt(result.fee_rate),
    sponsored: result.sponsored,
    sponsor_address: result.sponsor_address ?? undefined,
    sender_address: result.sender_address,
    origin_hash_mode: result.origin_hash_mode,
    abi: parseAbiColumn(result.abi),
  };
  parseTxTypeSpecificQueryResult(result, tx);
  return tx;
}

/**
 * The consumers of db responses expect `abi` fields to be a stringified JSON if
 * exists, otherwise `undefined`.
 * The pg query returns a JSON object, `null` (or the string 'null').
 * @returns Returns the stringify JSON if exists, or undefined if `null` or 'null' string.
 */
function parseAbiColumn(abi: unknown | null): string | undefined {
  if (!abi || abi === 'null') {
    return undefined;
  } else {
    return JSON.stringify(abi);
  }
}

export function parseTxQueryResult(result: ContractTxQueryResult): DbTx {
  const tx: DbTx = {
    tx_id: result.tx_id,
    tx_index: result.tx_index,
    nonce: result.nonce,
    sponsor_nonce: result.sponsor_nonce ?? undefined,
    index_block_hash: result.index_block_hash,
    parent_index_block_hash: result.parent_index_block_hash,
    block_hash: result.block_hash,
    parent_block_hash: result.parent_block_hash,
    block_height: result.block_height,
    burn_block_time: result.burn_block_time,
    parent_burn_block_time: result.parent_burn_block_time,
    type_id: result.type_id as DbTxTypeId,
    anchor_mode: result.anchor_mode as DbTxAnchorMode,
    status: result.status,
    raw_result: result.raw_result,
    canonical: result.canonical,
    microblock_canonical: result.microblock_canonical,
    microblock_sequence: result.microblock_sequence,
    microblock_hash: result.microblock_hash,
    post_conditions: result.post_conditions,
    fee_rate: BigInt(result.fee_rate),
    sponsored: result.sponsored,
    sponsor_address: result.sponsor_address ?? undefined,
    sender_address: result.sender_address,
    origin_hash_mode: result.origin_hash_mode,
    event_count: result.event_count,
    execution_cost_read_count: Number.parseInt(result.execution_cost_read_count),
    execution_cost_read_length: Number.parseInt(result.execution_cost_read_length),
    execution_cost_runtime: Number.parseInt(result.execution_cost_runtime),
    execution_cost_write_count: Number.parseInt(result.execution_cost_write_count),
    execution_cost_write_length: Number.parseInt(result.execution_cost_write_length),
    abi: parseAbiColumn(result.abi),
  };
  parseTxTypeSpecificQueryResult(result, tx);
  return tx;
}

function parseTxTypeSpecificQueryResult(
  result: MempoolTxQueryResult | TxQueryResult,
  target: DbTx | DbMempoolTx
) {
  if (target.type_id === DbTxTypeId.TokenTransfer) {
    target.token_transfer_recipient_address = result.token_transfer_recipient_address;
    target.token_transfer_amount = BigInt(result.token_transfer_amount ?? 0);
    target.token_transfer_memo = result.token_transfer_memo;
  } else if (target.type_id === DbTxTypeId.SmartContract) {
    target.smart_contract_contract_id = result.smart_contract_contract_id;
    target.smart_contract_source_code = result.smart_contract_source_code;
  } else if (target.type_id === DbTxTypeId.VersionedSmartContract) {
    target.smart_contract_clarity_version = result.smart_contract_clarity_version;
    target.smart_contract_contract_id = result.smart_contract_contract_id;
    target.smart_contract_source_code = result.smart_contract_source_code;
  } else if (target.type_id === DbTxTypeId.ContractCall) {
    target.contract_call_contract_id = result.contract_call_contract_id;
    target.contract_call_function_name = result.contract_call_function_name;
    target.contract_call_function_args = result.contract_call_function_args;
  } else if (target.type_id === DbTxTypeId.PoisonMicroblock) {
    target.poison_microblock_header_1 = result.poison_microblock_header_1;
    target.poison_microblock_header_2 = result.poison_microblock_header_2;
  } else if (target.type_id === DbTxTypeId.Coinbase) {
    target.coinbase_payload = result.coinbase_payload;
  } else if (target.type_id === DbTxTypeId.CoinbaseToAltRecipient) {
    target.coinbase_payload = result.coinbase_payload;
    target.coinbase_alt_recipient = result.coinbase_alt_recipient;
  } else {
    throw new Error(`Received unexpected tx type_id from db query: ${target.type_id}`);
  }
}

export function parseMicroblockQueryResult(result: MicroblockQueryResult): DbMicroblock {
  const microblock: DbMicroblock = {
    canonical: result.canonical,
    microblock_canonical: result.microblock_canonical,
    microblock_hash: result.microblock_hash,
    microblock_sequence: result.microblock_sequence,
    microblock_parent_hash: result.microblock_parent_hash,
    parent_index_block_hash: result.parent_index_block_hash,
    block_height: result.block_height,
    parent_block_height: result.parent_block_height,
    parent_block_hash: result.parent_block_hash,
    index_block_hash: result.index_block_hash,
    block_hash: result.block_hash,
    parent_burn_block_height: result.parent_burn_block_height,
    parent_burn_block_hash: result.parent_burn_block_hash,
    parent_burn_block_time: result.parent_burn_block_time,
  };
  return microblock;
}

export function parseFaucetRequestQueryResult(result: FaucetRequestQueryResult): DbFaucetRequest {
  const tx: DbFaucetRequest = {
    currency: result.currency as DbFaucetRequestCurrency,
    address: result.address,
    ip: result.ip,
    occurred_at: parseInt(result.occurred_at),
  };
  return tx;
}

export function parseBlockQueryResult(row: BlockQueryResult): DbBlock {
  // TODO(mb): is the tx_index preserved between microblocks and committed anchor blocks?
  const block: DbBlock = {
    block_hash: row.block_hash,
    index_block_hash: row.index_block_hash,
    parent_index_block_hash: row.parent_index_block_hash,
    parent_block_hash: row.parent_block_hash,
    parent_microblock_hash: row.parent_microblock_hash,
    parent_microblock_sequence: row.parent_microblock_sequence,
    block_height: row.block_height,
    burn_block_time: row.burn_block_time,
    burn_block_hash: row.burn_block_hash,
    burn_block_height: row.burn_block_height,
    miner_txid: row.miner_txid,
    canonical: row.canonical,
    execution_cost_read_count: Number.parseInt(row.execution_cost_read_count),
    execution_cost_read_length: Number.parseInt(row.execution_cost_read_length),
    execution_cost_runtime: Number.parseInt(row.execution_cost_runtime),
    execution_cost_write_count: Number.parseInt(row.execution_cost_write_count),
    execution_cost_write_length: Number.parseInt(row.execution_cost_write_length),
  };
  return block;
}

export function parseDbEvents(
  stxLockResults: {
    event_index: number;
    tx_id: string;
    tx_index: number;
    block_height: number;
    canonical: boolean;
    locked_amount: string;
    unlock_height: string;
    locked_address: string;
    contract_name: string;
  }[],
  stxResults: {
    event_index: number;
    tx_id: string;
    tx_index: number;
    block_height: number;
    canonical: boolean;
    asset_event_type_id: number;
    sender?: string | undefined;
    recipient?: string | undefined;
    amount: string;
    memo?: string;
  }[],
  ftResults: {
    event_index: number;
    tx_id: string;
    tx_index: number;
    block_height: number;
    canonical: boolean;
    asset_event_type_id: number;
    sender?: string | undefined;
    recipient?: string | undefined;
    asset_identifier: string;
    amount: string;
  }[],
  nftResults: {
    event_index: number;
    tx_id: string;
    tx_index: number;
    block_height: number;
    canonical: boolean;
    asset_event_type_id: number;
    sender?: string | undefined;
    recipient?: string | undefined;
    asset_identifier: string;
    value: string;
  }[],
  logResults: {
    event_index: number;
    tx_id: string;
    tx_index: number;
    block_height: number;
    canonical: boolean;
    contract_identifier: string;
    topic: string;
    value: string;
  }[]
) {
  const events = new Array<DbEvent>(
    stxResults.length +
      nftResults.length +
      ftResults.length +
      logResults.length +
      stxLockResults.length
  );
  let rowIndex = 0;
  for (const result of stxLockResults) {
    const event: DbStxLockEvent = {
      event_type: DbEventTypeId.StxLock,
      event_index: result.event_index,
      tx_id: result.tx_id,
      tx_index: result.tx_index,
      block_height: result.block_height,
      canonical: result.canonical,
      locked_amount: BigInt(result.locked_amount),
      unlock_height: Number(result.unlock_height),
      locked_address: result.locked_address,
      contract_name: result.contract_name,
    };
    events[rowIndex++] = event;
  }
  for (const result of stxResults) {
    const event: DbStxEvent = {
      event_index: result.event_index,
      tx_id: result.tx_id,
      tx_index: result.tx_index,
      block_height: result.block_height,
      canonical: result.canonical,
      asset_event_type_id: result.asset_event_type_id,
      sender: result.sender,
      recipient: result.recipient,
      event_type: DbEventTypeId.StxAsset,
      amount: BigInt(result.amount),
    };
    if (result.memo) {
      event.memo = result.memo;
    }
    events[rowIndex++] = event;
  }
  for (const result of ftResults) {
    const event: DbFtEvent = {
      event_index: result.event_index,
      tx_id: result.tx_id,
      tx_index: result.tx_index,
      block_height: result.block_height,
      canonical: result.canonical,
      asset_event_type_id: result.asset_event_type_id,
      sender: result.sender,
      recipient: result.recipient,
      asset_identifier: result.asset_identifier,
      event_type: DbEventTypeId.FungibleTokenAsset,
      amount: BigInt(result.amount),
    };
    events[rowIndex++] = event;
  }
  for (const result of nftResults) {
    const event: DbNftEvent = {
      event_index: result.event_index,
      tx_id: result.tx_id,
      tx_index: result.tx_index,
      block_height: result.block_height,
      canonical: result.canonical,
      asset_event_type_id: result.asset_event_type_id,
      sender: result.sender,
      recipient: result.recipient,
      asset_identifier: result.asset_identifier,
      event_type: DbEventTypeId.NonFungibleTokenAsset,
      value: result.value,
    };
    events[rowIndex++] = event;
  }
  for (const result of logResults) {
    const event: DbSmartContractEvent = {
      event_index: result.event_index,
      tx_id: result.tx_id,
      tx_index: result.tx_index,
      block_height: result.block_height,
      canonical: result.canonical,
      event_type: DbEventTypeId.SmartContractLog,
      contract_identifier: result.contract_identifier,
      topic: result.topic,
      value: result.value,
    };
    events[rowIndex++] = event;
  }
  events.sort((a, b) => a.event_index - b.event_index);
  return events;
}

export function parseDbPox2Event(row: Pox2EventQueryResult): DbPox2Event {
  const baseEvent: DbEventBase = {
    event_index: row.event_index,
    tx_id: row.tx_id,
    tx_index: row.tx_index,
    block_height: row.block_height,
    canonical: row.canonical,
  };
  const basePox2Event: DbPox2BaseEventData = {
    stacker: row.stacker,
    locked: BigInt(row.locked ?? 0),
    balance: BigInt(row.balance),
    burnchain_unlock_height: BigInt(row.burnchain_unlock_height),
    pox_addr: row.pox_addr ?? null,
    pox_addr_raw: row.pox_addr_raw ?? null,
  };
  const rowName = row.name as Pox2EventName;
  switch (rowName) {
    case Pox2EventName.HandleUnlock: {
      const eventData: DbPox2HandleUnlockEvent = {
        ...basePox2Event,
        name: rowName,
        data: {
          first_cycle_locked: BigInt(unwrapOptionalProp(row, 'first_unlocked_cycle')),
          first_unlocked_cycle: BigInt(unwrapOptionalProp(row, 'first_unlocked_cycle')),
        },
      };
      return {
        ...baseEvent,
        ...eventData,
      };
    }
    case Pox2EventName.StackStx: {
      const eventData: DbPox2StackStxEvent = {
        ...basePox2Event,
        name: rowName,
        data: {
          lock_amount: BigInt(unwrapOptionalProp(row, 'lock_amount')),
          lock_period: BigInt(unwrapOptionalProp(row, 'lock_period')),
          start_burn_height: BigInt(unwrapOptionalProp(row, 'start_burn_height')),
          unlock_burn_height: BigInt(unwrapOptionalProp(row, 'unlock_burn_height')),
        },
      };
      return {
        ...baseEvent,
        ...eventData,
      };
    }
    case Pox2EventName.StackIncrease: {
      const eventData: DbPox2StackIncreaseEvent = {
        ...basePox2Event,
        name: rowName,
        data: {
          increase_by: BigInt(unwrapOptionalProp(row, 'increase_by')),
          total_locked: BigInt(unwrapOptionalProp(row, 'total_locked')),
        },
      };
      return {
        ...baseEvent,
        ...eventData,
      };
    }
    case Pox2EventName.StackExtend: {
      const eventData: DbPox2StackExtendEvent = {
        ...basePox2Event,
        name: rowName,
        data: {
          extend_count: BigInt(unwrapOptionalProp(row, 'extend_count')),
          unlock_burn_height: BigInt(unwrapOptionalProp(row, 'unlock_burn_height')),
        },
      };
      return {
        ...baseEvent,
        ...eventData,
      };
    }
    case Pox2EventName.DelegateStx: {
      const eventData: DbPox2DelegateStxEvent = {
        ...basePox2Event,
        name: rowName,
        data: {
          amount_ustx: BigInt(unwrapOptionalProp(row, 'amount_ustx')),
          delegate_to: unwrapOptionalProp(row, 'delegate_to'),
          unlock_burn_height: row.unlock_burn_height
            ? BigInt(unwrapOptionalProp(row, 'unlock_burn_height'))
            : null,
        },
      };
      return {
        ...baseEvent,
        ...eventData,
      };
    }
    case Pox2EventName.DelegateStackStx: {
      const eventData: DbPox2DelegateStackStxEvent = {
        ...basePox2Event,
        name: rowName,
        data: {
          lock_amount: BigInt(unwrapOptionalProp(row, 'lock_amount')),
          unlock_burn_height: BigInt(unwrapOptionalProp(row, 'unlock_burn_height')),
          start_burn_height: BigInt(unwrapOptionalProp(row, 'start_burn_height')),
          lock_period: BigInt(unwrapOptionalProp(row, 'lock_period')),
          delegator: unwrapOptionalProp(row, 'delegator'),
        },
      };
      return {
        ...baseEvent,
        ...eventData,
      };
    }
    case Pox2EventName.DelegateStackIncrease: {
      const eventData: DbPox2DelegateStackIncreaseEvent = {
        ...basePox2Event,
        name: rowName,
        data: {
          increase_by: BigInt(unwrapOptionalProp(row, 'increase_by')),
          total_locked: BigInt(unwrapOptionalProp(row, 'total_locked')),
          delegator: unwrapOptionalProp(row, 'delegator'),
        },
      };
      return {
        ...baseEvent,
        ...eventData,
      };
    }
    case Pox2EventName.DelegateStackExtend: {
      const eventData: DbPox2DelegateStackExtendEvent = {
        ...basePox2Event,
        name: rowName,
        data: {
          unlock_burn_height: BigInt(unwrapOptionalProp(row, 'unlock_burn_height')),
          extend_count: BigInt(unwrapOptionalProp(row, 'extend_count')),
          delegator: unwrapOptionalProp(row, 'delegator'),
        },
      };
      return {
        ...baseEvent,
        ...eventData,
      };
    }
    case Pox2EventName.StackAggregationCommit: {
      const eventData: DbPox2StackAggregationCommitEvent = {
        ...basePox2Event,
        name: rowName,
        data: {
          reward_cycle: BigInt(unwrapOptionalProp(row, 'reward_cycle')),
          amount_ustx: BigInt(unwrapOptionalProp(row, 'amount_ustx')),
        },
      };
      return {
        ...baseEvent,
        ...eventData,
      };
    }
    case Pox2EventName.StackAggregationCommitIndexed: {
      const eventData: DbPox2StackAggregationCommitIndexedEvent = {
        ...basePox2Event,
        name: rowName,
        data: {
          reward_cycle: BigInt(unwrapOptionalProp(row, 'reward_cycle')),
          amount_ustx: BigInt(unwrapOptionalProp(row, 'amount_ustx')),
        },
      };
      return {
        ...baseEvent,
        ...eventData,
      };
    }
    case Pox2EventName.StackAggregationIncrease: {
      const eventData: DbPox2StackAggregationIncreaseEvent = {
        ...basePox2Event,
        name: rowName,
        data: {
          reward_cycle: BigInt(unwrapOptionalProp(row, 'reward_cycle')),
          amount_ustx: BigInt(unwrapOptionalProp(row, 'amount_ustx')),
        },
      };
      return {
        ...baseEvent,
        ...eventData,
      };
    }
    default: {
      throw new Error(`Unexpected event name ${rowName}`);
    }
  }
}

export function parseQueryResultToSmartContract(row: {
  tx_id: string;
  canonical: boolean;
  contract_id: string;
  block_height: number;
  clarity_version: number | null;
  source_code: string;
  abi: unknown | null;
}) {
  const smartContract: DbSmartContract = {
    tx_id: row.tx_id,
    canonical: row.canonical,
    contract_id: row.contract_id,
    block_height: row.block_height,
    clarity_version: row.clarity_version,
    source_code: row.source_code,
    // The consumers of this object expect the value to be stringify
    // JSON if exists, otherwise null rather than undefined.
    abi: parseAbiColumn(row.abi) ?? null,
  };
  return { found: true, result: smartContract };
}

export function parseTxsWithAssetTransfers(
  resultQuery: (TxQueryResult & {
    count: number;
    event_index?: number | undefined;
    event_type?: number | undefined;
    event_amount?: string | undefined;
    event_sender?: string | undefined;
    event_recipient?: string | undefined;
    event_asset_identifier?: string | undefined;
    event_value?: string | undefined;
    event_memo?: string | undefined;
  })[],
  stxAddress: string
) {
  const txs = new Map<
    string,
    {
      tx: DbTx;
      stx_sent: bigint;
      stx_received: bigint;
      stx_transfers: {
        amount: bigint;
        sender?: string;
        recipient?: string;
        memo?: string;
      }[];
      ft_transfers: {
        asset_identifier: string;
        amount: bigint;
        sender?: string;
        recipient?: string;
      }[];
      nft_transfers: {
        asset_identifier: string;
        value: string;
        sender?: string;
        recipient?: string;
      }[];
    }
  >();
  for (const r of resultQuery) {
    let txResult = txs.get(r.tx_id);
    if (!txResult) {
      txResult = {
        tx: parseTxQueryResult(r),
        stx_sent: 0n,
        stx_received: 0n,
        stx_transfers: [],
        ft_transfers: [],
        nft_transfers: [],
      };
      if (txResult.tx.sender_address === stxAddress) {
        txResult.stx_sent += txResult.tx.fee_rate;
      }
      txs.set(r.tx_id, txResult);
    }
    if (r.event_index !== undefined && r.event_index !== null) {
      const eventAmount = BigInt(r.event_amount as string);
      switch (r.event_type) {
        case DbEventTypeId.StxAsset:
          txResult.stx_transfers.push({
            amount: eventAmount,
            sender: r.event_sender,
            recipient: r.event_recipient,
            memo: r.event_memo,
          });
          if (r.event_sender === stxAddress) {
            txResult.stx_sent += eventAmount;
          }
          if (r.event_recipient === stxAddress) {
            txResult.stx_received += eventAmount;
          }
          break;

        case DbEventTypeId.FungibleTokenAsset:
          txResult.ft_transfers.push({
            asset_identifier: r.event_asset_identifier as string,
            amount: eventAmount,
            sender: r.event_sender,
            recipient: r.event_recipient,
          });
          break;

        case DbEventTypeId.NonFungibleTokenAsset:
          txResult.nft_transfers.push({
            asset_identifier: r.event_asset_identifier as string,
            value: r.event_value ?? '',
            sender: r.event_sender,
            recipient: r.event_recipient,
          });
          break;
      }
    }
  }
  return txs;
}

export function parseNftEvent(dbEvent: DbNftEvent): NftEvent {
  const event: NftEvent = {
    asset_identifier: dbEvent.asset_identifier,
    asset_event_type: getAssetEventTypeString(dbEvent.asset_event_type_id),
    value: {
      hex: dbEvent.value,
      repr: decodeClarityValueToRepr(dbEvent.value),
    },
    tx_id: dbEvent.tx_id,
    tx_index: dbEvent.tx_index,
    block_height: dbEvent.block_height,
    event_index: dbEvent.event_index,
    sender: dbEvent.sender,
    recipient: dbEvent.recipient,
  };
  return event;
}

/**
 * Removes the `0x` from the incoming zonefile hash, either for insertion or search.
 */
export function validateZonefileHash(zonefileHash: string) {
  const index = zonefileHash.indexOf('0x');
  if (index === 0) {
    return zonefileHash.slice(2);
  }
  return zonefileHash;
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
function extractTransactionPayload(txData: DecodedTxResult, dbTx: DbTx | DbMempoolTx) {
  switch (txData.payload.type_id) {
    case TxPayloadTypeID.TokenTransfer: {
      let recipientPrincipal = txData.payload.recipient.address;
      if (txData.payload.recipient.type_id === PrincipalTypeID.Contract) {
        recipientPrincipal += '.' + txData.payload.recipient.contract_name;
      }
      dbTx.token_transfer_recipient_address = recipientPrincipal;
      dbTx.token_transfer_amount = BigInt(txData.payload.amount);
      dbTx.token_transfer_memo = txData.payload.memo_hex;
      break;
    }
    case TxPayloadTypeID.SmartContract: {
      const sender_address = getTxSenderAddress(txData);
      dbTx.smart_contract_contract_id = sender_address + '.' + txData.payload.contract_name;
      dbTx.smart_contract_source_code = txData.payload.code_body;
      break;
    }
    case TxPayloadTypeID.VersionedSmartContract: {
      const sender_address = getTxSenderAddress(txData);
      dbTx.smart_contract_contract_id = sender_address + '.' + txData.payload.contract_name;
      dbTx.smart_contract_source_code = txData.payload.code_body;
      dbTx.smart_contract_clarity_version = txData.payload.clarity_version;
      break;
    }
    case TxPayloadTypeID.ContractCall: {
      const contractAddress = txData.payload.address;
      dbTx.contract_call_contract_id = `${contractAddress}.${txData.payload.contract_name}`;
      dbTx.contract_call_function_name = txData.payload.function_name;
      dbTx.contract_call_function_args = txData.payload.function_args_buffer;
      break;
    }
    case TxPayloadTypeID.PoisonMicroblock: {
      dbTx.poison_microblock_header_1 = txData.payload.microblock_header_1.buffer;
      dbTx.poison_microblock_header_2 = txData.payload.microblock_header_2.buffer;
      break;
    }
    case TxPayloadTypeID.Coinbase: {
      dbTx.coinbase_payload = txData.payload.payload_buffer;
      break;
    }
    case TxPayloadTypeID.CoinbaseToAltRecipient: {
      dbTx.coinbase_payload = txData.payload.payload_buffer;
      if (txData.payload.recipient.type_id === PrincipalTypeID.Standard) {
        dbTx.coinbase_alt_recipient = txData.payload.recipient.address;
      } else {
        dbTx.coinbase_alt_recipient = `${txData.payload.recipient.address}.${txData.payload.recipient.contract_name}`;
      }
      break;
    }
    default:
      throw new Error(`Unexpected transaction type ID: ${JSON.stringify(txData.payload)}`);
  }
}

export function createDbMempoolTxFromCoreMsg(msg: {
  txData: DecodedTxResult;
  txId: string;
  sender: string;
  sponsorAddress: string | undefined;
  rawTx: string;
  receiptDate: number;
}): DbMempoolTxRaw {
  const dbTx: DbMempoolTxRaw = {
    pruned: false,
    nonce: Number(msg.txData.auth.origin_condition.nonce),
    sponsor_nonce:
      msg.txData.auth.type_id === PostConditionAuthFlag.Sponsored
        ? Number(msg.txData.auth.sponsor_condition.nonce)
        : undefined,
    tx_id: msg.txId,
    raw_tx: msg.rawTx,
    type_id: parseEnum(DbTxTypeId, msg.txData.payload.type_id as number),
    anchor_mode: parseEnum(DbTxAnchorMode, msg.txData.anchor_mode as number),
    status: DbTxStatus.Pending,
    receipt_time: msg.receiptDate,
    fee_rate:
      msg.txData.auth.type_id === PostConditionAuthFlag.Sponsored
        ? BigInt(msg.txData.auth.sponsor_condition.tx_fee)
        : BigInt(msg.txData.auth.origin_condition.tx_fee),
    sender_address: msg.sender,
    origin_hash_mode: msg.txData.auth.origin_condition.hash_mode as number,
    sponsored: msg.txData.auth.type_id === PostConditionAuthFlag.Sponsored,
    sponsor_address: msg.sponsorAddress,
    post_conditions: msg.txData.post_conditions_buffer,
  };
  extractTransactionPayload(msg.txData, dbTx);
  return dbTx;
}

export function createDbTxFromCoreMsg(msg: CoreNodeParsedTxMessage): DbTxRaw {
  const coreTx = msg.core_tx;
  const parsedTx = msg.parsed_tx;
  const dbTx: DbTxRaw = {
    tx_id: coreTx.txid,
    tx_index: coreTx.tx_index,
    nonce: Number(parsedTx.auth.origin_condition.nonce),
    sponsor_nonce:
      parsedTx.auth.type_id === PostConditionAuthFlag.Sponsored
        ? Number(parsedTx.auth.sponsor_condition.nonce)
        : undefined,
    raw_tx: msg.raw_tx,
    index_block_hash: msg.index_block_hash,
    parent_index_block_hash: msg.parent_index_block_hash,
    parent_block_hash: msg.parent_block_hash,
    block_hash: msg.block_hash,
    block_height: msg.block_height,
    burn_block_time: msg.burn_block_time,
    parent_burn_block_time: msg.parent_burn_block_time,
    type_id: parseEnum(DbTxTypeId, parsedTx.payload.type_id as number),
    anchor_mode: parseEnum(DbTxAnchorMode, parsedTx.anchor_mode as number),
    status: getTxDbStatus(coreTx.status),
    raw_result: coreTx.raw_result,
    fee_rate:
      parsedTx.auth.type_id === PostConditionAuthFlag.Sponsored
        ? BigInt(parsedTx.auth.sponsor_condition.tx_fee)
        : BigInt(parsedTx.auth.origin_condition.tx_fee),
    sender_address: msg.sender_address,
    sponsor_address: msg.sponsor_address,
    origin_hash_mode: parsedTx.auth.origin_condition.hash_mode as number,
    sponsored: parsedTx.auth.type_id === PostConditionAuthFlag.Sponsored,
    canonical: true,
    microblock_canonical: true,
    microblock_sequence: msg.microblock_sequence,
    microblock_hash: msg.microblock_hash,
    post_conditions: parsedTx.post_conditions_buffer,
    event_count: 0,
    execution_cost_read_count: coreTx.execution_cost.read_count,
    execution_cost_read_length: coreTx.execution_cost.read_length,
    execution_cost_runtime: coreTx.execution_cost.runtime,
    execution_cost_write_count: coreTx.execution_cost.write_count,
    execution_cost_write_length: coreTx.execution_cost.write_length,
  };
  extractTransactionPayload(parsedTx, dbTx);
  return dbTx;
}

export function registerMempoolPromStats(pgEvents: PgStoreEventEmitter) {
  const mempoolTxCountGauge = new prom.Gauge({
    name: `mempool_tx_count`,
    help: 'Number of txs in the mempool, by tx type',
    labelNames: ['type'] as const,
  });
  const mempoolTxFeeAvgGauge = new prom.Gauge({
    name: `mempool_tx_fee_average`,
    help: 'Simple average of tx fees in the mempool, by tx type',
    labelNames: ['type', 'percentile'] as const,
  });
  const mempoolTxAgeGauge = new prom.Gauge({
    name: `mempool_tx_age`,
    help: 'Average age (by block) of txs in the mempool, by tx type',
    labelNames: ['type', 'percentile'] as const,
  });
  const mempoolTxSizeGauge = new prom.Gauge({
    name: `mempool_tx_byte_size`,
    help: 'Average byte size of txs in the mempool, by tx type',
    labelNames: ['type', 'percentile'] as const,
  });
  const updatePromMempoolStats = (mempoolStats: DbMempoolStats) => {
    for (const txType in mempoolStats.tx_type_counts) {
      const entry = mempoolStats.tx_type_counts[txType];
      mempoolTxCountGauge.set({ type: txType }, entry);
    }
    for (const txType in mempoolStats.tx_simple_fee_averages) {
      const entries = mempoolStats.tx_simple_fee_averages[txType];
      Object.entries(entries).forEach(([p, num]) => {
        mempoolTxFeeAvgGauge.set({ type: txType, percentile: p }, num ?? -1);
      });
    }
    for (const txType in mempoolStats.tx_ages) {
      const entries = mempoolStats.tx_ages[txType];
      Object.entries(entries).forEach(([p, num]) => {
        mempoolTxAgeGauge.set({ type: txType, percentile: p }, num ?? -1);
      });
    }
    for (const txType in mempoolStats.tx_byte_sizes) {
      const entries = mempoolStats.tx_byte_sizes[txType];
      Object.entries(entries).forEach(([p, num]) => {
        mempoolTxSizeGauge.set({ type: txType, percentile: p }, num ?? -1);
      });
    }
  };
  pgEvents.addListener('mempoolStatsUpdate', mempoolStats => {
    setImmediate(() => {
      try {
        updatePromMempoolStats(mempoolStats);
      } catch (error) {
        logError(`Error updating prometheus mempool stats`, error);
      }
    });
  });
}

export function convertTxQueryResultToDbMempoolTx(txs: TxQueryResult[]): DbMempoolTxRaw[] {
  const dbMempoolTxs: DbMempoolTxRaw[] = [];
  for (const tx of txs) {
    const dbMempoolTx: DbMempoolTxRaw = Object.assign(tx, {
      pruned: false,
      receipt_time: tx.burn_block_time,
      fee_rate: BigInt(tx.fee_rate),
      raw_tx: tx.raw_result,
      token_transfer_amount:
        tx.token_transfer_amount != null
          ? BigInt(tx.token_transfer_amount)
          : tx.token_transfer_amount,
      sponsor_address: tx.sponsor_address ?? undefined,
    });
    dbMempoolTxs.push(dbMempoolTx);
  }
  return dbMempoolTxs;
}
