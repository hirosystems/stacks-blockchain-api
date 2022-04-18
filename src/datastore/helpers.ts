import * as path from 'path';
import PgMigrate, { RunnerOption } from 'node-pg-migrate';
import {
  APP_DIR,
  bufferToHexPrefixString,
  isDevEnv,
  isTestEnv,
  logError,
  logger,
  parseArgBoolean,
  parsePort,
} from '../helpers';
import { Client, ClientConfig, PoolConfig, QueryConfig, QueryResult } from 'pg';
import {
  DbBlock,
  DbEvent,
  DbEventTypeId,
  DbFaucetRequest,
  DbFaucetRequestCurrency,
  DbFtEvent,
  DbMempoolTx,
  DbMicroblock,
  DbNftEvent,
  DbSmartContract,
  DbSmartContractEvent,
  DbStxEvent,
  DbStxLockEvent,
  DbTx,
  DbTxAnchorMode,
  DbTxTypeId,
} from './common';

export interface BlockQueryResult {
  block_hash: Buffer;
  index_block_hash: Buffer;
  parent_index_block_hash: Buffer;
  parent_block_hash: Buffer;
  parent_microblock_hash: Buffer;
  parent_microblock_sequence: number;
  block_height: number;
  burn_block_time: number;
  burn_block_hash: Buffer;
  burn_block_height: number;
  miner_txid: Buffer;
  canonical: boolean;
  execution_cost_read_count: string;
  execution_cost_read_length: string;
  execution_cost_runtime: string;
  execution_cost_write_count: string;
  execution_cost_write_length: string;
}

export interface MicroblockQueryResult {
  canonical: boolean;
  microblock_canonical: boolean;
  microblock_hash: Buffer;
  microblock_sequence: number;
  microblock_parent_hash: Buffer;
  parent_index_block_hash: Buffer;
  block_height: number;
  parent_block_height: number;
  parent_block_hash: Buffer;
  index_block_hash: Buffer;
  block_hash: Buffer;
  parent_burn_block_height: number;
  parent_burn_block_hash: Buffer;
  parent_burn_block_time: number;
}

export interface MempoolTxQueryResult {
  pruned: boolean;
  tx_id: Buffer;

  nonce: number;
  sponsor_nonce?: number;
  type_id: number;
  anchor_mode: number;
  status: number;
  receipt_time: number;
  receipt_block_height: number;

  canonical: boolean;
  post_conditions: Buffer;
  fee_rate: string;
  sponsored: boolean;
  sponsor_address: string | null;
  sender_address: string;
  origin_hash_mode: number;
  raw_tx: Buffer;

  // `token_transfer` tx types
  token_transfer_recipient_address?: string;
  token_transfer_amount?: string;
  token_transfer_memo?: Buffer;

  // `smart_contract` tx types
  smart_contract_contract_id?: string;
  smart_contract_source_code?: string;

  // `contract_call` tx types
  contract_call_contract_id?: string;
  contract_call_function_name?: string;
  contract_call_function_args?: Buffer;

  // `poison_microblock` tx types
  poison_microblock_header_1?: Buffer;
  poison_microblock_header_2?: Buffer;

  // `coinbase` tx types
  coinbase_payload?: Buffer;

  // sending abi in case tx is contract call
  abi: unknown | null;
}

export interface TxQueryResult {
  tx_id: Buffer;
  tx_index: number;
  index_block_hash: Buffer;
  parent_index_block_hash: Buffer;
  block_hash: Buffer;
  parent_block_hash: Buffer;
  block_height: number;
  burn_block_time: number;
  parent_burn_block_time: number;
  nonce: number;
  sponsor_nonce?: number;
  type_id: number;
  anchor_mode: number;
  status: number;
  raw_result: Buffer;
  canonical: boolean;

  microblock_canonical: boolean;
  microblock_sequence: number;
  microblock_hash: Buffer;

  post_conditions: Buffer;
  fee_rate: string;
  sponsored: boolean;
  sponsor_address: string | null;
  sender_address: string;
  origin_hash_mode: number;
  raw_tx: Buffer;

  // `token_transfer` tx types
  token_transfer_recipient_address?: string;
  token_transfer_amount?: string;
  token_transfer_memo?: Buffer;

  // `smart_contract` tx types
  smart_contract_contract_id?: string;
  smart_contract_source_code?: string;

  // `contract_call` tx types
  contract_call_contract_id?: string;
  contract_call_function_name?: string;
  contract_call_function_args?: Buffer;

  // `poison_microblock` tx types
  poison_microblock_header_1?: Buffer;
  poison_microblock_header_2?: Buffer;

  // `coinbase` tx types
  coinbase_payload?: Buffer;

  // events count
  event_count: number;

  execution_cost_read_count: string;
  execution_cost_read_length: string;
  execution_cost_runtime: string;
  execution_cost_write_count: string;
  execution_cost_write_length: string;
}

export interface ContractTxQueryResult extends TxQueryResult {
  abi?: unknown | null;
}

export interface MempoolTxIdQueryResult {
  tx_id: Buffer;
}

export interface FaucetRequestQueryResult {
  currency: string;
  ip: string;
  address: string;
  occurred_at: string;
}

export interface UpdatedEntities {
  markedCanonical: {
    blocks: number;
    microblocks: number;
    minerRewards: number;
    txs: number;
    stxLockEvents: number;
    stxEvents: number;
    ftEvents: number;
    nftEvents: number;
    contractLogs: number;
    smartContracts: number;
    names: number;
    namespaces: number;
    subdomains: number;
  };
  markedNonCanonical: {
    blocks: number;
    microblocks: number;
    minerRewards: number;
    txs: number;
    stxLockEvents: number;
    stxEvents: number;
    ftEvents: number;
    nftEvents: number;
    contractLogs: number;
    smartContracts: number;
    names: number;
    namespaces: number;
    subdomains: number;
  };
}

export interface TransferQueryResult {
  sender: string;
  memo: Buffer;
  block_height: number;
  tx_index: number;
  tx_id: Buffer;
  transfer_type: string;
  amount: string;
}

export interface NonFungibleTokenMetadataQueryResult {
  token_uri: string;
  name: string;
  description: string;
  image_uri: string;
  image_canonical_uri: string;
  contract_id: string;
  tx_id: Buffer;
  sender_address: string;
}

export interface FungibleTokenMetadataQueryResult {
  token_uri: string;
  name: string;
  description: string;
  image_uri: string;
  image_canonical_uri: string;
  contract_id: string;
  symbol: string;
  decimals: number;
  tx_id: Buffer;
  sender_address: string;
}

export interface DbTokenMetadataQueueEntryQuery {
  queue_id: number;
  tx_id: Buffer;
  contract_id: string;
  contract_abi: string;
  block_height: number;
  processed: boolean;
}

export interface StxEventQueryResult {
  event_index: number;
  tx_id: Buffer;
  tx_index: number;
  block_height: number;
  canonical: boolean;
  asset_event_type_id: number;
  sender?: string;
  recipient?: string;
  amount: string;
}

export interface StxLockEventQueryResult {
  event_index: number;
  tx_id: Buffer;
  tx_index: number;
  block_height: number;
  canonical: boolean;
  locked_amount: string;
  unlock_height: string;
  locked_address: string;
}

export interface FungibleTokenEventQueryResult {
  event_index: number;
  tx_id: Buffer;
  tx_index: number;
  block_height: number;
  canonical: boolean;
  asset_event_type_id: number;
  sender?: string;
  recipient?: string;
  asset_identifier: string;
  amount: string;
}

export interface NonFungibleTokenEventQueryResult {
  event_index: number;
  tx_id: Buffer;
  tx_index: number;
  block_height: number;
  canonical: boolean;
  asset_event_type_id: number;
  sender?: string;
  recipient?: string;
  asset_identifier: string;
  value: Buffer;
}

export interface SmartContractLogEventResult {
  event_index: number;
  tx_id: Buffer;
  tx_index: number;
  block_height: number;
  canonical: boolean;
  contract_identifier: string;
  topic: string;
  value: Buffer;
}

export interface RawTxQueryResult {
  raw_tx: Buffer;
}

/**
 * @deprecated use `txColumns()` instead.
 */
export const TX_COLUMNS = `
  -- required columns
  tx_id, raw_tx, tx_index, index_block_hash, parent_index_block_hash, block_hash, parent_block_hash, block_height, burn_block_time, parent_burn_block_time,
  type_id, anchor_mode, status, canonical, post_conditions, nonce, fee_rate, sponsored, sponsor_nonce, sponsor_address, sender_address, origin_hash_mode,
  microblock_canonical, microblock_sequence, microblock_hash,

  -- token-transfer tx columns
  token_transfer_recipient_address, token_transfer_amount, token_transfer_memo,

  -- smart-contract tx columns
  smart_contract_contract_id, smart_contract_source_code,

  -- contract-call tx columns
  contract_call_contract_id, contract_call_function_name, contract_call_function_args,

  -- poison-microblock tx columns
  poison_microblock_header_1, poison_microblock_header_2,

  -- coinbase tx columns
  coinbase_payload,

  -- tx result
  raw_result,

  -- event count
  event_count,

  -- execution cost
  execution_cost_read_count, execution_cost_read_length, execution_cost_runtime, execution_cost_write_count, execution_cost_write_length
`;

export const MEMPOOL_TX_COLUMNS = `
  -- required columns
  pruned, tx_id, raw_tx, type_id, anchor_mode, status, receipt_time, receipt_block_height,
  post_conditions, nonce, fee_rate, sponsored, sponsor_nonce, sponsor_address, sender_address, origin_hash_mode,

  -- token-transfer tx columns
  token_transfer_recipient_address, token_transfer_amount, token_transfer_memo,

  -- smart-contract tx columns
  smart_contract_contract_id, smart_contract_source_code,

  -- contract-call tx columns
  contract_call_contract_id, contract_call_function_name, contract_call_function_args,

  -- poison-microblock tx columns
  poison_microblock_header_1, poison_microblock_header_2,

  -- coinbase tx columns
  coinbase_payload
`;

export const BLOCK_COLUMNS = `
  block_hash, index_block_hash,
  parent_index_block_hash, parent_block_hash, parent_microblock_hash, parent_microblock_sequence,
  block_height, burn_block_time, burn_block_hash, burn_block_height, miner_txid, canonical,
  execution_cost_read_count, execution_cost_read_length, execution_cost_runtime,
  execution_cost_write_count, execution_cost_write_length
`;

export const MICROBLOCK_COLUMNS = `
  canonical, microblock_canonical, microblock_hash, microblock_sequence, microblock_parent_hash,
  parent_index_block_hash, block_height, parent_block_height, parent_block_hash,
  parent_burn_block_height, parent_burn_block_time, parent_burn_block_hash,
  index_block_hash, block_hash
`;

/**
 * Shorthand function to generate a list of common columns to query from the `txs` table. A parameter
 * is specified in case the table is aliased into something else and a prefix is required.
 * @param tableName - Name of the table to query against. Defaults to `txs`.
 * @returns `string` - Column list to insert in SELECT statement.
 */
export function txColumns(tableName: string = 'txs'): string {
  const columns: string[] = [
    // required columns
    'tx_id',
    'raw_tx',
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
    'sponsor_address',
    'sponsor_nonce',
    'sender_address',
    'origin_hash_mode',
    'microblock_canonical',
    'microblock_sequence',
    'microblock_hash',
    // token-transfer tx columns
    'token_transfer_recipient_address',
    'token_transfer_amount',
    'token_transfer_memo',
    // smart-contract tx columns
    'smart_contract_contract_id',
    'smart_contract_source_code',
    // contract-call tx columns
    'contract_call_contract_id',
    'contract_call_function_name',
    'contract_call_function_args',
    // poison-microblock tx columns
    'poison_microblock_header_1',
    'poison_microblock_header_2',
    // coinbase tx columns
    'coinbase_payload',
    // tx result
    'raw_result',
    // event count
    'event_count',
    // execution cost
    'execution_cost_read_count',
    'execution_cost_read_length',
    'execution_cost_runtime',
    'execution_cost_write_count',
    'execution_cost_write_length',
  ];
  return columns.map(c => `${tableName}.${c}`).join(',');
}

/**
 * Shorthand function that returns a column query to retrieve the smart contract abi when querying transactions
 * that may be of type `contract_call`. Usually used alongside `txColumns()`, `TX_COLUMNS` or `MEMPOOL_TX_COLUMNS`.
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

/**
 * Shorthand for a count column that aggregates over the complete query window outside of LIMIT/OFFSET.
 * @param alias - Count column alias
 * @returns `string` - count column select statement portion
 */
export function countOverColumn(alias: string = 'count'): string {
  return `(COUNT(*) OVER())::INTEGER AS ${alias}`;
}

// Enable this when debugging potential sql leaks.
export const SQL_QUERY_LEAK_DETECTION = false;

// Tables containing tx metadata, like events (stx, ft, nft transfers), contract logs, bns data, etc.
export const TX_METADATA_TABLES = [
  'stx_events',
  'ft_events',
  'nft_events',
  'contract_logs',
  'stx_lock_events',
  'smart_contracts',
  'names',
  'namespaces',
  'subdomains',
] as const;

export function getSqlQueryString(query: QueryConfig | string): string {
  if (typeof query === 'string') {
    return query;
  } else {
    return query.text;
  }
}

export function parseMempoolTxQueryResult(result: MempoolTxQueryResult): DbMempoolTx {
  const tx: DbMempoolTx = {
    pruned: result.pruned,
    tx_id: bufferToHexPrefixString(result.tx_id),
    nonce: result.nonce,
    sponsor_nonce: result.sponsor_nonce ?? undefined,
    raw_tx: result.raw_tx,
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
export function parseAbiColumn(abi: unknown | null): string | undefined {
  if (!abi || abi === 'null') {
    return undefined;
  } else {
    return JSON.stringify(abi);
  }
}

export function parseTxQueryResult(result: ContractTxQueryResult): DbTx {
  const tx: DbTx = {
    tx_id: bufferToHexPrefixString(result.tx_id),
    tx_index: result.tx_index,
    nonce: result.nonce,
    sponsor_nonce: result.sponsor_nonce ?? undefined,
    raw_tx: result.raw_tx,
    index_block_hash: bufferToHexPrefixString(result.index_block_hash),
    parent_index_block_hash: bufferToHexPrefixString(result.parent_index_block_hash),
    block_hash: bufferToHexPrefixString(result.block_hash),
    parent_block_hash: bufferToHexPrefixString(result.parent_block_hash),
    block_height: result.block_height,
    burn_block_time: result.burn_block_time,
    parent_burn_block_time: result.parent_burn_block_time,
    type_id: result.type_id as DbTxTypeId,
    anchor_mode: result.anchor_mode as DbTxAnchorMode,
    status: result.status,
    raw_result: bufferToHexPrefixString(result.raw_result),
    canonical: result.canonical,
    microblock_canonical: result.microblock_canonical,
    microblock_sequence: result.microblock_sequence,
    microblock_hash: bufferToHexPrefixString(result.microblock_hash),
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

export function parseTxTypeSpecificQueryResult(
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
  } else if (target.type_id === DbTxTypeId.ContractCall) {
    target.contract_call_contract_id = result.contract_call_contract_id;
    target.contract_call_function_name = result.contract_call_function_name;
    target.contract_call_function_args = result.contract_call_function_args;
  } else if (target.type_id === DbTxTypeId.PoisonMicroblock) {
    target.poison_microblock_header_1 = result.poison_microblock_header_1;
    target.poison_microblock_header_2 = result.poison_microblock_header_2;
  } else if (target.type_id === DbTxTypeId.Coinbase) {
    target.coinbase_payload = result.coinbase_payload;
  } else {
    throw new Error(`Received unexpected tx type_id from db query: ${target.type_id}`);
  }
}

export function parseMicroblockQueryResult(result: MicroblockQueryResult): DbMicroblock {
  const microblock: DbMicroblock = {
    canonical: result.canonical,
    microblock_canonical: result.microblock_canonical,
    microblock_hash: bufferToHexPrefixString(result.microblock_hash),
    microblock_sequence: result.microblock_sequence,
    microblock_parent_hash: bufferToHexPrefixString(result.microblock_parent_hash),
    parent_index_block_hash: bufferToHexPrefixString(result.parent_index_block_hash),
    block_height: result.block_height,
    parent_block_height: result.parent_block_height,
    parent_block_hash: bufferToHexPrefixString(result.parent_block_hash),
    index_block_hash: bufferToHexPrefixString(result.index_block_hash),
    block_hash: bufferToHexPrefixString(result.block_hash),
    parent_burn_block_height: result.parent_burn_block_height,
    parent_burn_block_hash: bufferToHexPrefixString(result.parent_burn_block_hash),
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
    block_hash: bufferToHexPrefixString(row.block_hash),
    index_block_hash: bufferToHexPrefixString(row.index_block_hash),
    parent_index_block_hash: bufferToHexPrefixString(row.parent_index_block_hash),
    parent_block_hash: bufferToHexPrefixString(row.parent_block_hash),
    parent_microblock_hash: bufferToHexPrefixString(row.parent_microblock_hash),
    parent_microblock_sequence: row.parent_microblock_sequence,
    block_height: row.block_height,
    burn_block_time: row.burn_block_time,
    burn_block_hash: bufferToHexPrefixString(row.burn_block_hash),
    burn_block_height: row.burn_block_height,
    miner_txid: bufferToHexPrefixString(row.miner_txid),
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
  stxLockResults: QueryResult<{
    event_index: number;
    tx_id: Buffer;
    tx_index: number;
    block_height: number;
    canonical: boolean;
    locked_amount: string;
    unlock_height: string;
    locked_address: string;
  }>,
  stxResults: QueryResult<{
    event_index: number;
    tx_id: Buffer;
    tx_index: number;
    block_height: number;
    canonical: boolean;
    asset_event_type_id: number;
    sender?: string | undefined;
    recipient?: string | undefined;
    amount: string;
  }>,
  ftResults: QueryResult<{
    event_index: number;
    tx_id: Buffer;
    tx_index: number;
    block_height: number;
    canonical: boolean;
    asset_event_type_id: number;
    sender?: string | undefined;
    recipient?: string | undefined;
    asset_identifier: string;
    amount: string;
  }>,
  nftResults: QueryResult<{
    event_index: number;
    tx_id: Buffer;
    tx_index: number;
    block_height: number;
    canonical: boolean;
    asset_event_type_id: number;
    sender?: string | undefined;
    recipient?: string | undefined;
    asset_identifier: string;
    value: Buffer;
  }>,
  logResults: QueryResult<{
    event_index: number;
    tx_id: Buffer;
    tx_index: number;
    block_height: number;
    canonical: boolean;
    contract_identifier: string;
    topic: string;
    value: Buffer;
  }>
) {
  const events = new Array<DbEvent>(
    stxResults.rowCount +
      nftResults.rowCount +
      ftResults.rowCount +
      logResults.rowCount +
      stxLockResults.rowCount
  );
  let rowIndex = 0;
  for (const result of stxLockResults.rows) {
    const event: DbStxLockEvent = {
      event_type: DbEventTypeId.StxLock,
      event_index: result.event_index,
      tx_id: bufferToHexPrefixString(result.tx_id),
      tx_index: result.tx_index,
      block_height: result.block_height,
      canonical: result.canonical,
      locked_amount: BigInt(result.locked_amount),
      unlock_height: Number(result.unlock_height),
      locked_address: result.locked_address,
    };
    events[rowIndex++] = event;
  }
  for (const result of stxResults.rows) {
    const event: DbStxEvent = {
      event_index: result.event_index,
      tx_id: bufferToHexPrefixString(result.tx_id),
      tx_index: result.tx_index,
      block_height: result.block_height,
      canonical: result.canonical,
      asset_event_type_id: result.asset_event_type_id,
      sender: result.sender,
      recipient: result.recipient,
      event_type: DbEventTypeId.StxAsset,
      amount: BigInt(result.amount),
    };
    events[rowIndex++] = event;
  }
  for (const result of ftResults.rows) {
    const event: DbFtEvent = {
      event_index: result.event_index,
      tx_id: bufferToHexPrefixString(result.tx_id),
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
  for (const result of nftResults.rows) {
    const event: DbNftEvent = {
      event_index: result.event_index,
      tx_id: bufferToHexPrefixString(result.tx_id),
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
  for (const result of logResults.rows) {
    const event: DbSmartContractEvent = {
      event_index: result.event_index,
      tx_id: bufferToHexPrefixString(result.tx_id),
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

export function parseQueryResultToSmartContract(row: {
  tx_id: Buffer;
  canonical: boolean;
  contract_id: string;
  block_height: number;
  source_code: string;
  abi: unknown | null;
}) {
  const smartContract: DbSmartContract = {
    tx_id: bufferToHexPrefixString(row.tx_id),
    canonical: row.canonical,
    contract_id: row.contract_id,
    block_height: row.block_height,
    source_code: row.source_code,
    // The consumers of this object expect the value to be stringify
    // JSON if exists, otherwise null rather than undefined.
    abi: parseAbiColumn(row.abi) ?? null,
  };
  return { found: true, result: smartContract };
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
