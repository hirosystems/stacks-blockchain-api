import {
  abiFunctionToString,
  BufferReader,
  ClarityAbi,
  ClarityAbiFunction,
  cvToString,
  deserializeCV,
  getTypeString,
  serializeCV,
} from '@stacks/transactions';

import {
  AbstractMempoolTransaction,
  AbstractTransaction,
  BaseTransaction,
  Block,
  CoinbaseTransactionMetadata,
  ContractCallTransaction,
  ContractCallTransactionMetadata,
  MempoolContractCallTransaction,
  MempoolTransaction,
  MempoolTransactionStatus,
  Microblock,
  PoisonMicroblockTransactionMetadata,
  RosettaBlock,
  RosettaParentBlockIdentifier,
  RosettaTransaction,
  SmartContractTransaction,
  SmartContractTransactionMetadata,
  TokenTransferTransactionMetadata,
  Transaction,
  TransactionAnchorModeType,
  TransactionEvent,
  TransactionEventFungibleAsset,
  TransactionEventNonFungibleAsset,
  TransactionEventSmartContractLog,
  TransactionEventStxAsset,
  TransactionEventStxLock,
  TransactionFound,
  TransactionList,
  TransactionMetadata,
  TransactionNotFound,
  TransactionStatus,
  TransactionType,
} from '@stacks/stacks-blockchain-api-types';

import {
  BlockIdentifier,
  DataStore,
  DbAssetEventTypeId,
  DbBlock,
  DbEvent,
  DbEventTypeId,
  DbMempoolTx,
  DbMicroblock,
  DbTx,
  DbTxStatus,
  DbTxTypeId,
  DbSmartContract,
  DbSearchResultWithMetadata,
  BaseTx,
} from '../../datastore/common';
import {
  unwrapOptional,
  bufferToHexPrefixString,
  ElementType,
  FoundOrNot,
  hexToBuffer,
  logger,
  unixEpochToIso,
  EMPTY_HASH_256,
} from '../../helpers';
import { readClarityValueArray, readTransactionPostConditions } from '../../p2p/tx';
import { serializePostCondition, serializePostConditionMode } from '../serializers/post-conditions';
import { getOperations, parseTransactionMemo, processUnlockingEvents } from '../../rosetta-helpers';

export function parseTxTypeStrings(values: string[]): TransactionType[] {
  return values.map(v => {
    switch (v) {
      case 'contract_call':
      case 'smart_contract':
      case 'token_transfer':
      case 'coinbase':
      case 'poison_microblock':
        return v;
      default:
        throw new Error(`Unexpected tx type: ${JSON.stringify(v)}`);
    }
  });
}

export function getTxTypeString(typeId: DbTxTypeId): Transaction['tx_type'] {
  switch (typeId) {
    case DbTxTypeId.TokenTransfer:
      return 'token_transfer';
    case DbTxTypeId.SmartContract:
      return 'smart_contract';
    case DbTxTypeId.ContractCall:
      return 'contract_call';
    case DbTxTypeId.PoisonMicroblock:
      return 'poison_microblock';
    case DbTxTypeId.Coinbase:
      return 'coinbase';
    default:
      throw new Error(`Unexpected DbTxTypeId: ${typeId}`);
  }
}

function getTxAnchorModeString(anchorMode: number): TransactionAnchorModeType {
  switch (anchorMode) {
    case 0x01:
      return 'on_chain_only';
    case 0x02:
      return 'off_chain_only';
    case 0x03:
      return 'any';
    default:
      throw new Error(`Unexpected anchor mode value ${anchorMode}`);
  }
}

export function getTxTypeId(typeString: Transaction['tx_type']): DbTxTypeId {
  switch (typeString) {
    case 'token_transfer':
      return DbTxTypeId.TokenTransfer;
    case 'smart_contract':
      return DbTxTypeId.SmartContract;
    case 'contract_call':
      return DbTxTypeId.ContractCall;
    case 'poison_microblock':
      return DbTxTypeId.PoisonMicroblock;
    case 'coinbase':
      return DbTxTypeId.Coinbase;
    default:
      throw new Error(`Unexpected tx type string: ${typeString}`);
  }
}

export function getTxStatusString(
  txStatus: DbTxStatus
): TransactionStatus | MempoolTransactionStatus {
  switch (txStatus) {
    case DbTxStatus.Pending:
      return 'pending';
    case DbTxStatus.Success:
      return 'success';
    case DbTxStatus.AbortByResponse:
      return 'abort_by_response';
    case DbTxStatus.AbortByPostCondition:
      return 'abort_by_post_condition';
    case DbTxStatus.DroppedReplaceByFee:
      return 'dropped_replace_by_fee';
    case DbTxStatus.DroppedReplaceAcrossFork:
      return 'dropped_replace_across_fork';
    case DbTxStatus.DroppedTooExpensive:
      return 'dropped_too_expensive';
    case DbTxStatus.DroppedStaleGarbageCollect:
      return 'dropped_stale_garbage_collect';
    default:
      throw new Error(`Unexpected DbTxStatus: ${txStatus}`);
  }
}

export function getTxStatus(txStatus: DbTxStatus | string): string {
  if (txStatus == '') {
    return '';
  } else {
    return getTxStatusString(txStatus as DbTxStatus);
  }
}

type EventTypeString =
  | 'smart_contract_log'
  | 'stx_asset'
  | 'fungible_token_asset'
  | 'non_fungible_token_asset'
  | 'stx_lock';

export function getEventTypeString(eventTypeId: DbEventTypeId): EventTypeString {
  switch (eventTypeId) {
    case DbEventTypeId.SmartContractLog:
      return 'smart_contract_log';
    case DbEventTypeId.StxAsset:
      return 'stx_asset';
    case DbEventTypeId.FungibleTokenAsset:
      return 'fungible_token_asset';
    case DbEventTypeId.NonFungibleTokenAsset:
      return 'non_fungible_token_asset';
    case DbEventTypeId.StxLock:
      return 'stx_lock';
    default:
      throw new Error(`Unexpected DbEventTypeId: ${eventTypeId}`);
  }
}

export function getAssetEventTypeString(
  assetEventTypeId: DbAssetEventTypeId
): 'transfer' | 'mint' | 'burn' {
  switch (assetEventTypeId) {
    case DbAssetEventTypeId.Transfer:
      return 'transfer';
    case DbAssetEventTypeId.Mint:
      return 'mint';
    case DbAssetEventTypeId.Burn:
      return 'burn';
    default:
      throw new Error(`Unexpected DbAssetEventTypeId: ${assetEventTypeId}`);
  }
}

export function parseDbEvent(dbEvent: DbEvent): TransactionEvent {
  switch (dbEvent.event_type) {
    case DbEventTypeId.SmartContractLog: {
      const valueBuffer = dbEvent.value;
      const valueHex = bufferToHexPrefixString(valueBuffer);
      const valueRepr = cvToString(deserializeCV(valueBuffer));
      const event: TransactionEventSmartContractLog = {
        event_index: dbEvent.event_index,
        event_type: 'smart_contract_log',
        tx_id: dbEvent.tx_id,
        contract_log: {
          contract_id: dbEvent.contract_identifier,
          topic: dbEvent.topic,
          value: { hex: valueHex, repr: valueRepr },
        },
      };
      return event;
    }
    case DbEventTypeId.StxLock: {
      const event: TransactionEventStxLock = {
        event_index: dbEvent.event_index,
        event_type: 'stx_lock',
        tx_id: dbEvent.tx_id,
        stx_lock_event: {
          locked_amount: dbEvent.locked_amount.toString(10),
          unlock_height: Number(dbEvent.unlock_height),
          locked_address: dbEvent.locked_address,
        },
      };
      return event;
    }
    case DbEventTypeId.StxAsset: {
      const event: TransactionEventStxAsset = {
        event_index: dbEvent.event_index,
        event_type: 'stx_asset',
        tx_id: dbEvent.tx_id,
        asset: {
          asset_event_type: getAssetEventTypeString(dbEvent.asset_event_type_id),
          sender: dbEvent.sender || '',
          recipient: dbEvent.recipient || '',
          amount: dbEvent.amount.toString(10),
        },
      };
      return event;
    }
    case DbEventTypeId.FungibleTokenAsset: {
      const event: TransactionEventFungibleAsset = {
        event_index: dbEvent.event_index,
        event_type: 'fungible_token_asset',
        tx_id: dbEvent.tx_id,
        asset: {
          asset_event_type: getAssetEventTypeString(dbEvent.asset_event_type_id),
          asset_id: dbEvent.asset_identifier,
          sender: dbEvent.sender || '',
          recipient: dbEvent.recipient || '',
          amount: dbEvent.amount.toString(10),
        },
      };
      return event;
    }
    case DbEventTypeId.NonFungibleTokenAsset: {
      const valueBuffer = dbEvent.value;
      const valueHex = bufferToHexPrefixString(valueBuffer);
      const valueRepr = cvToString(deserializeCV(valueBuffer));
      const event: TransactionEventNonFungibleAsset = {
        event_index: dbEvent.event_index,
        event_type: 'non_fungible_token_asset',
        tx_id: dbEvent.tx_id,
        asset: {
          asset_event_type: getAssetEventTypeString(dbEvent.asset_event_type_id),
          asset_id: dbEvent.asset_identifier,
          sender: dbEvent.sender || '',
          recipient: dbEvent.recipient || '',
          value: {
            hex: valueHex,
            repr: valueRepr,
          },
        },
      };
      return event;
    }
    default:
      throw new Error(`Unexpected event_type in: ${JSON.stringify(dbEvent)}`);
  }
}

/**
 * Fetch block from datastore by blockHash or blockHeight (index)
 * If both blockHeight and blockHash are provided, blockHeight is used.
 * If neither argument is present, the most recent block is returned.
 * @param db -- datastore
 * @param fetchTransactions -- return block transactions
 * @param blockHash -- hexadecimal hash string
 * @param blockHeight -- number
 */
export async function getRosettaBlockFromDataStore(
  db: DataStore,
  fetchTransactions: boolean,
  blockHash?: string,
  blockHeight?: number
): Promise<FoundOrNot<RosettaBlock>> {
  let query;
  if (blockHash) {
    query = db.getBlock({ hash: blockHash });
  } else if (blockHeight && blockHeight > 0) {
    query = db.getBlock({ height: blockHeight });
  } else {
    query = db.getCurrentBlock();
  }
  const blockQuery = await query;

  if (!blockQuery.found) {
    return { found: false };
  }
  const dbBlock = blockQuery.result;
  let blockTxs = {} as FoundOrNot<RosettaTransaction[]>;
  blockTxs.found = false;
  if (fetchTransactions) {
    blockTxs = await getRosettaBlockTransactionsFromDataStore({
      blockHash: dbBlock.block_hash,
      indexBlockHash: dbBlock.index_block_hash,
      db,
    });
  }

  const parentBlockHash = dbBlock.parent_block_hash;
  let parent_block_identifier: RosettaParentBlockIdentifier;

  if (dbBlock.block_height <= 1) {
    // case for genesis block
    parent_block_identifier = {
      index: dbBlock.block_height,
      hash: dbBlock.block_hash,
    };
  } else {
    const parentBlockQuery = await db.getBlock({ hash: parentBlockHash });
    if (parentBlockQuery.found) {
      const parentBlock = parentBlockQuery.result;
      parent_block_identifier = {
        index: parentBlock.block_height,
        hash: parentBlock.block_hash,
      };
    } else {
      return { found: false };
    }
  }

  const apiBlock: RosettaBlock = {
    block_identifier: { index: dbBlock.block_height, hash: dbBlock.block_hash },
    parent_block_identifier,
    timestamp: dbBlock.burn_block_time * 1000,
    transactions: blockTxs.found ? blockTxs.result : [],
  };
  return { found: true, result: apiBlock };
}

export async function getUnanchoredTxsFromDataStore(db: DataStore): Promise<Transaction[]> {
  const dbTxs = await db.getUnanchoredTxs();
  const parsedTxs = dbTxs.txs.map(dbTx => parseDbTx(dbTx));
  return parsedTxs;
}

function parseDbMicroblock(mb: DbMicroblock, txs: string[]): Microblock {
  const microblock: Microblock = {
    canonical: mb.canonical,
    microblock_canonical: mb.microblock_canonical,
    microblock_hash: mb.microblock_hash,
    microblock_sequence: mb.microblock_sequence,
    microblock_parent_hash: mb.microblock_parent_hash,
    block_height: mb.block_height,
    parent_block_height: mb.parent_block_height,
    parent_block_hash: mb.parent_block_hash,
    block_hash: mb.block_hash,
    txs: txs,
    parent_burn_block_height: mb.parent_burn_block_height,
    parent_burn_block_hash: mb.parent_burn_block_hash,
    parent_burn_block_time: mb.parent_burn_block_time,
    parent_burn_block_time_iso:
      mb.parent_burn_block_time > 0 ? unixEpochToIso(mb.parent_burn_block_time) : '',
  };
  return microblock;
}

export async function getMicroblockFromDataStore({
  db,
  microblockHash,
}: {
  db: DataStore;
  microblockHash: string;
}): Promise<FoundOrNot<Microblock>> {
  const query = await db.getMicroblock({ microblockHash: microblockHash });
  if (!query.found) {
    return {
      found: false,
    };
  }
  const microblock = parseDbMicroblock(query.result.microblock, query.result.txs);
  return {
    found: true,
    result: microblock,
  };
}

export async function getMicroblocksFromDataStore(args: {
  db: DataStore;
  limit: number;
  offset: number;
}): Promise<{ total: number; result: Microblock[] }> {
  const query = await args.db.getMicroblocks({ limit: args.limit, offset: args.offset });
  const result = query.result.map(r => parseDbMicroblock(r.microblock, r.txs));
  return {
    total: query.total,
    result: result,
  };
}

export async function getBlockFromDataStore({
  blockIdentifer,
  db,
}: {
  blockIdentifer: BlockIdentifier;
  db: DataStore;
}): Promise<FoundOrNot<Block>> {
  const blockQuery = await db.getBlockWithMetadata(blockIdentifer, {
    txs: true,
    microblocks: true,
  });
  if (!blockQuery.found) {
    return { found: false };
  }
  const result = blockQuery.result;
  const apiBlock = parseDbBlock(
    result.block,
    result.txs.map(tx => tx.tx_id),
    result.microblocks.accepted.map(mb => mb.microblock_hash),
    result.microblocks.streamed.map(mb => mb.microblock_hash)
  );
  return { found: true, result: apiBlock };
}

function parseDbBlock(
  dbBlock: DbBlock,
  txIds: string[],
  microblocksAccepted: string[],
  microblocksStreamed: string[]
): Block {
  const apiBlock: Block = {
    canonical: dbBlock.canonical,
    height: dbBlock.block_height,
    hash: dbBlock.block_hash,
    parent_block_hash: dbBlock.parent_block_hash,
    burn_block_time: dbBlock.burn_block_time,
    burn_block_time_iso: unixEpochToIso(dbBlock.burn_block_time),
    burn_block_hash: dbBlock.burn_block_hash,
    burn_block_height: dbBlock.burn_block_height,
    miner_txid: dbBlock.miner_txid,
    parent_microblock_hash:
      dbBlock.parent_microblock_hash === EMPTY_HASH_256 ? '' : dbBlock.parent_microblock_hash,
    parent_microblock_sequence:
      dbBlock.parent_microblock_hash === EMPTY_HASH_256 ? -1 : dbBlock.parent_microblock_sequence,
    txs: [...txIds],
    microblocks_accepted: [...microblocksAccepted],
    microblocks_streamed: [...microblocksStreamed],
    execution_cost_read_count: dbBlock.execution_cost_read_count,
    execution_cost_read_length: dbBlock.execution_cost_read_length,
    execution_cost_runtime: dbBlock.execution_cost_runtime,
    execution_cost_write_count: dbBlock.execution_cost_write_count,
    execution_cost_write_length: dbBlock.execution_cost_write_length,
  };
  return apiBlock;
}

async function getRosettaBlockTransactionsFromDataStore(opts: {
  blockHash: string;
  indexBlockHash: string;
  db: DataStore;
}): Promise<FoundOrNot<RosettaTransaction[]>> {
  const blockQuery = await opts.db.getBlock({ hash: opts.blockHash });
  if (!blockQuery.found) {
    return { found: false };
  }

  const txsQuery = await opts.db.getBlockTxsRows(opts.blockHash);
  const minerRewards = await opts.db.getMinersRewardsAtHeight({
    blockHeight: blockQuery.result.block_height,
  });

  if (!txsQuery.found) {
    return { found: false };
  }

  const unlockingEvents = await opts.db.getUnlockedAddressesAtBlock(blockQuery.result);

  const transactions: RosettaTransaction[] = [];

  for (const tx of txsQuery.result) {
    let events: DbEvent[] = [];
    if (blockQuery.result.block_height > 1) {
      // only return events of blocks at height greater than 1
      const eventsQuery = await opts.db.getTxEvents({
        txId: tx.tx_id,
        indexBlockHash: opts.indexBlockHash,
        limit: 5000,
        offset: 0,
      });
      events = eventsQuery.results;
    }
    const operations = await getOperations(tx, opts.db, minerRewards, events, unlockingEvents);
    const txMemo = parseTransactionMemo(tx);
    const rosettaTx: RosettaTransaction = {
      transaction_identifier: { hash: tx.tx_id },
      operations: operations,
    };
    if (txMemo) {
      rosettaTx.metadata = {
        memo: txMemo,
      };
    }
    transactions.push(rosettaTx);
  }

  return { found: true, result: transactions };
}

export async function getRosettaTransactionFromDataStore(
  txId: string,
  db: DataStore
): Promise<FoundOrNot<RosettaTransaction>> {
  const txQuery = await db.getTx({ txId, includeUnanchored: false });
  if (!txQuery.found) {
    return { found: false };
  }
  const blockOperations = await getRosettaBlockTransactionsFromDataStore({
    blockHash: txQuery.result.block_hash,
    indexBlockHash: txQuery.result.index_block_hash,
    db,
  });
  if (!blockOperations.found) {
    throw new Error(
      `Could not find block for tx: ${txId}, block_hash: ${txQuery.result.block_hash}, index_block_hash: ${txQuery.result.index_block_hash}`
    );
  }
  const rosettaTx = blockOperations.result.find(
    op => op.transaction_identifier.hash === txQuery.result.tx_id
  );
  if (!rosettaTx) {
    throw new Error(
      `Rosetta block missing operations for tx: ${txId}, block_hash: ${txQuery.result.block_hash}, index_block_hash: ${txQuery.result.index_block_hash}`
    );
  }
  const result: RosettaTransaction = {
    transaction_identifier: rosettaTx.transaction_identifier,
    operations: rosettaTx.operations,
    metadata: rosettaTx.metadata,
  };
  return { found: true, result };
}

interface GetTxArgs {
  txId: string;
  includeUnanchored: boolean;
}

interface GetTxFromDbTxArgs extends GetTxArgs {
  dbTx: DbTx;
}

interface GetTxsWithEventsArgs extends GetTxsArgs {
  eventLimit: number;
  eventOffset: number;
}

interface GetTxsArgs {
  txIds: string[];
  includeUnanchored: boolean;
}

interface GetTxWithEventsArgs extends GetTxArgs {
  eventLimit: number;
  eventOffset: number;
}

function parseDbBaseTx(dbTx: DbTx | DbMempoolTx): BaseTransaction {
  const postConditions =
    dbTx.post_conditions.byteLength > 2
      ? readTransactionPostConditions(
          BufferReader.fromBuffer(dbTx.post_conditions.slice(1))
        ).map(pc => serializePostCondition(pc))
      : [];

  const tx: BaseTransaction = {
    tx_id: dbTx.tx_id,
    nonce: dbTx.nonce,
    fee_rate: dbTx.fee_rate.toString(10),
    sender_address: dbTx.sender_address,
    sponsored: dbTx.sponsored,
    sponsor_address: dbTx.sponsor_address,
    post_condition_mode: serializePostConditionMode(dbTx.post_conditions.readUInt8(0)),
    post_conditions: postConditions,
    anchor_mode: getTxAnchorModeString(dbTx.anchor_mode),
  };
  return tx;
}

function parseDbTxTypeMetadata(dbTx: DbTx | DbMempoolTx): TransactionMetadata {
  switch (dbTx.type_id) {
    case DbTxTypeId.TokenTransfer: {
      const metadata: TokenTransferTransactionMetadata = {
        tx_type: 'token_transfer',
        token_transfer: {
          recipient_address: unwrapOptional(
            dbTx.token_transfer_recipient_address,
            () => 'Unexpected nullish token_transfer_recipient_address'
          ),
          amount: unwrapOptional(
            dbTx.token_transfer_amount,
            () => 'Unexpected nullish token_transfer_amount'
          ).toString(10),
          memo: bufferToHexPrefixString(
            unwrapOptional(dbTx.token_transfer_memo, () => 'Unexpected nullish token_transfer_memo')
          ),
        },
      };
      return metadata;
    }
    case DbTxTypeId.SmartContract: {
      const metadata: SmartContractTransactionMetadata = {
        tx_type: 'smart_contract',
        smart_contract: {
          contract_id: unwrapOptional(
            dbTx.smart_contract_contract_id,
            () => 'Unexpected nullish smart_contract_contract_id'
          ),
          source_code: unwrapOptional(
            dbTx.smart_contract_source_code,
            () => 'Unexpected nullish smart_contract_source_code'
          ),
        },
      };
      return metadata;
    }
    case DbTxTypeId.ContractCall: {
      return parseContractCallMetadata(dbTx);
    }
    case DbTxTypeId.PoisonMicroblock: {
      const metadata: PoisonMicroblockTransactionMetadata = {
        tx_type: 'poison_microblock',
        poison_microblock: {
          microblock_header_1: bufferToHexPrefixString(
            unwrapOptional(dbTx.poison_microblock_header_1)
          ),
          microblock_header_2: bufferToHexPrefixString(
            unwrapOptional(dbTx.poison_microblock_header_2)
          ),
        },
      };
      return metadata;
    }
    case DbTxTypeId.Coinbase: {
      const metadata: CoinbaseTransactionMetadata = {
        tx_type: 'coinbase',
        coinbase_payload: {
          data: bufferToHexPrefixString(
            unwrapOptional(dbTx.coinbase_payload, () => 'Unexpected nullish coinbase_payload')
          ),
        },
      };
      return metadata;
    }
    default: {
      throw new Error(`Unexpected DbTxTypeId: ${dbTx.type_id}`);
    }
  }
}

export function parseContractCallMetadata(tx: BaseTx): ContractCallTransactionMetadata {
  const contractId = unwrapOptional(
    tx.contract_call_contract_id,
    () => 'Unexpected nullish contract_call_contract_id'
  );
  const functionName = unwrapOptional(
    tx.contract_call_function_name,
    () => 'Unexpected nullish contract_call_function_name'
  );
  let functionAbi: ClarityAbiFunction | undefined;
  const abi = tx.abi;
  if (abi) {
    const contractAbi: ClarityAbi = JSON.parse(abi);
    functionAbi = contractAbi.functions.find(fn => fn.name === functionName);
    if (!functionAbi) {
      throw new Error(`Could not find function name "${functionName}" in ABI for ${contractId}`);
    }
  }
  const metadata: ContractCallTransactionMetadata = {
    tx_type: 'contract_call',
    contract_call: {
      contract_id: contractId,
      function_name: functionName,
      function_signature: functionAbi ? abiFunctionToString(functionAbi) : '',
      function_args: tx.contract_call_function_args
        ? readClarityValueArray(tx.contract_call_function_args).map((c, fnArgIndex) => {
            const functionArgAbi = functionAbi
              ? functionAbi.args[fnArgIndex++]
              : { name: '', type: undefined };
            return {
              hex: bufferToHexPrefixString(serializeCV(c)),
              repr: cvToString(c),
              name: functionArgAbi.name,
              // TODO: This stacks.js function throws when given an empty `list` clarity value.
              //    This is only used to provide function signature type information if the contract
              //    ABI is unavailable, which should only happen during rare re-org situations.
              //    Typically this will be filled in with more accurate type data in a later step before
              //    being sent to client.
              // type: getCVTypeString(c),
              type: functionArgAbi.type ? getTypeString(functionArgAbi.type) : '',
            };
          })
        : undefined,
    },
  };
  return metadata;
}

function parseDbAbstractTx(dbTx: DbTx, baseTx: BaseTransaction): AbstractTransaction {
  const abstractTx: AbstractTransaction = {
    ...baseTx,
    is_unanchored: !dbTx.block_hash,
    block_hash: dbTx.block_hash,
    parent_block_hash: dbTx.parent_block_hash,
    block_height: dbTx.block_height,
    burn_block_time: dbTx.burn_block_time,
    burn_block_time_iso: dbTx.burn_block_time > 0 ? unixEpochToIso(dbTx.burn_block_time) : '',
    parent_burn_block_time: dbTx.parent_burn_block_time,
    parent_burn_block_time_iso:
      dbTx.parent_burn_block_time > 0 ? unixEpochToIso(dbTx.parent_burn_block_time) : '',
    canonical: dbTx.canonical,
    tx_index: dbTx.tx_index,
    tx_status: getTxStatusString(dbTx.status) as TransactionStatus,
    tx_result: {
      hex: dbTx.raw_result,
      repr: cvToString(deserializeCV(hexToBuffer(dbTx.raw_result))),
    },
    microblock_hash: dbTx.microblock_hash,
    microblock_sequence: dbTx.microblock_sequence,
    microblock_canonical: dbTx.microblock_canonical,
    event_count: dbTx.event_count,
    events: [],
    execution_cost_read_count: dbTx.execution_cost_read_count,
    execution_cost_read_length: dbTx.execution_cost_read_length,
    execution_cost_runtime: dbTx.execution_cost_runtime,
    execution_cost_write_count: dbTx.execution_cost_write_count,
    execution_cost_write_length: dbTx.execution_cost_write_length,
  };
  return abstractTx;
}

function parseDbAbstractMempoolTx(
  dbMempoolTx: DbMempoolTx,
  baseTx: BaseTransaction
): AbstractMempoolTransaction {
  const abstractMempoolTx: AbstractMempoolTransaction = {
    ...baseTx,
    tx_status: getTxStatusString(dbMempoolTx.status) as MempoolTransactionStatus,
    receipt_time: dbMempoolTx.receipt_time,
    receipt_time_iso: unixEpochToIso(dbMempoolTx.receipt_time),
  };
  return abstractMempoolTx;
}

export function parseDbTx(dbTx: DbTx): Transaction {
  const baseTx = parseDbBaseTx(dbTx);
  const abstractTx = parseDbAbstractTx(dbTx, baseTx);
  const txMetadata = parseDbTxTypeMetadata(dbTx);
  const result: Transaction = {
    ...abstractTx,
    ...txMetadata,
  };
  return result;
}

export function parseDbMempoolTx(dbMempoolTx: DbMempoolTx): MempoolTransaction {
  const baseTx = parseDbBaseTx(dbMempoolTx);
  const abstractTx = parseDbAbstractMempoolTx(dbMempoolTx, baseTx);
  const txMetadata = parseDbTxTypeMetadata(dbMempoolTx);
  const result: MempoolTransaction = {
    ...abstractTx,
    ...txMetadata,
  };
  return result;
}

export async function getMempoolTxsFromDataStore(
  db: DataStore,
  args: GetTxsArgs
): Promise<MempoolTransaction[]> {
  const mempoolTxsQuery = await db.getMempoolTxs({
    txIds: args.txIds,
    includePruned: true,
    includeUnanchored: args.includeUnanchored,
  });
  if (mempoolTxsQuery.length === 0) {
    return [];
  }

  const parsedMempoolTxs = mempoolTxsQuery.map(tx => parseDbMempoolTx(tx));

  return parsedMempoolTxs;
}

async function getTxsFromDataStore(
  db: DataStore,
  args: GetTxsArgs | GetTxsWithEventsArgs
): Promise<Transaction[]> {
  // fetching all requested transactions from db
  const txQuery = await db.getTxListDetails({
    txIds: args.txIds,
    includeUnanchored: args.includeUnanchored,
  });

  // returning empty array if no transaction was found
  if (txQuery.length === 0) {
    return [];
  }

  // parsing txQuery
  const parsedTxs = txQuery.map(tx => parseDbTx(tx));

  // incase transaction events are requested
  if ('eventLimit' in args) {
    const txIdsAndIndexHash = txQuery.map(tx => {
      return {
        txId: tx.tx_id,
        indexBlockHash: tx.index_block_hash,
      };
    });
    const txListEvents = await db.getTxListEvents({
      txs: txIdsAndIndexHash,
      limit: args.eventLimit,
      offset: args.eventOffset,
    });
    // this will insert all events in a single parsedTransaction. Only specific ones are to be added.
    const txsWithEvents: Transaction[] = parsedTxs.map(ptx => {
      return {
        ...ptx,
        events: txListEvents.results
          .filter(event => event.tx_id === ptx.tx_id)
          .map(event => parseDbEvent(event)),
      };
    });
    return txsWithEvents;
  } else {
    return parsedTxs;
  }
}

export async function getTxFromDataStore(
  db: DataStore,
  args: GetTxArgs | GetTxWithEventsArgs | GetTxFromDbTxArgs
): Promise<FoundOrNot<Transaction>> {
  let dbTx: DbTx;
  if ('dbTx' in args) {
    dbTx = args.dbTx;
  } else {
    const txQuery = await db.getTx({ txId: args.txId, includeUnanchored: args.includeUnanchored });
    if (!txQuery.found) {
      return { found: false };
    }
    dbTx = txQuery.result;
  }

  const parsedTx = parseDbTx(dbTx);

  // If tx events are requested
  if ('eventLimit' in args) {
    const eventsQuery = await db.getTxEvents({
      txId: args.txId,
      indexBlockHash: dbTx.index_block_hash,
      limit: args.eventLimit,
      offset: args.eventOffset,
    });
    const txWithEvents: Transaction = {
      ...parsedTx,
      events: eventsQuery.results.map(event => parseDbEvent(event)),
    };
    return { found: true, result: txWithEvents };
  } else {
    return {
      found: true,
      result: parsedTx,
    };
  }
}

export async function searchTxs(
  db: DataStore,
  args: GetTxsArgs | GetTxsWithEventsArgs
): Promise<TransactionList> {
  const minedTxs = await getTxsFromDataStore(db, args);

  const foundTransactions: TransactionFound[] = [];
  const mempoolTxs: string[] = [];
  minedTxs.forEach(tx => {
    // filtering out mined transactions in canonical chain
    if (tx.canonical && tx.microblock_canonical) {
      foundTransactions.push({ found: true, result: tx });
    }
    // filtering out non canonical transactions to look into mempool table
    if (!tx.canonical && !tx.microblock_canonical) {
      mempoolTxs.push(tx.tx_id);
    }
  });

  // filtering out tx_ids that were not mined / found
  const notMinedTransactions: string[] = args.txIds.filter(
    txId => !minedTxs.find(minedTx => txId === minedTx.tx_id)
  );

  // finding transactions that are not mined and are not canonical in mempool
  mempoolTxs.push(...notMinedTransactions);
  const mempoolTxsQuery = await getMempoolTxsFromDataStore(db, {
    txIds: mempoolTxs,
    includeUnanchored: args.includeUnanchored,
  });

  // merging found mempool transaction in found transactions object
  foundTransactions.push(
    ...mempoolTxsQuery.map((mtx: Transaction | MempoolTransaction) => {
      return { found: true, result: mtx } as TransactionFound;
    })
  );

  // filtering out transactions that were not found anywhere
  const notFoundTransactions: TransactionNotFound[] = args.txIds
    .filter(txId => foundTransactions.findIndex(ftx => ftx.result?.tx_id === txId) < 0)
    .map(txId => {
      return { found: false, result: { tx_id: txId } };
    });

  // generating response
  const resp = [...foundTransactions, ...notFoundTransactions].reduce(
    (map: TransactionList, obj) => {
      if (obj.result) {
        map[obj.result.tx_id] = obj;
      }
      return map;
    },
    {}
  );
  return resp;
}

export async function searchTx(
  db: DataStore,
  args: GetTxArgs | GetTxWithEventsArgs
): Promise<FoundOrNot<Transaction | MempoolTransaction>> {
  // First, check the happy path: the tx is mined and in the canonical chain.
  const minedTxs = await getTxsFromDataStore(db, { ...args, txIds: [args.txId] });
  const minedTx = minedTxs[0] ?? undefined;
  if (minedTx && minedTx.canonical && minedTx.microblock_canonical) {
    return { found: true, result: minedTx };
  } else {
    // Otherwise, if not mined or not canonical, check in the mempool.
    const mempoolTxQuery = await getMempoolTxsFromDataStore(db, { ...args, txIds: [args.txId] });
    const mempoolTx = mempoolTxQuery[0] ?? undefined;
    if (mempoolTx) {
      return { found: true, result: mempoolTx };
    }
    // Fallback for a situation where the tx was only mined in a non-canonical chain, but somehow not in the mempool table.
    else if (minedTx) {
      logger.warn(`Tx only exists in a non-canonical chain, missing from mempool: ${args.txId}`);
      return { found: true, result: minedTx };
    }
    // Tx not found in db.
    else {
      return { found: false };
    }
  }
}

export async function searchHashWithMetadata(
  hash: string,
  db: DataStore
): Promise<FoundOrNot<DbSearchResultWithMetadata>> {
  // checking for tx
  const txQuery = await db.getTxListDetails({ txIds: [hash], includeUnanchored: true });
  if (txQuery.length > 0) {
    // tx found
    const tx = txQuery[0];
    return {
      found: true,
      result: {
        entity_type: 'tx_id',
        entity_id: tx.tx_id,
        entity_data: tx,
      },
    };
  }
  // checking for mempool tx
  const mempoolTxQuery = await db.getMempoolTxs({
    txIds: [hash],
    includeUnanchored: true,
    includePruned: true,
  });
  if (mempoolTxQuery.length > 0) {
    // mempool tx found
    const mempoolTx = mempoolTxQuery[0];
    return {
      found: true,
      result: {
        entity_type: 'mempool_tx_id',
        entity_id: mempoolTx.tx_id,
        entity_data: mempoolTx,
      },
    };
  }
  // checking for block
  const blockQuery = await db.getBlockWithMetadata({ hash }, { txs: true, microblocks: true });
  if (blockQuery.found) {
    // block found
    const result = parseDbBlock(
      blockQuery.result.block,
      blockQuery.result.txs.map(tx => tx.tx_id),
      blockQuery.result.microblocks.accepted.map(mb => mb.microblock_hash),
      blockQuery.result.microblocks.streamed.map(mb => mb.microblock_hash)
    );
    return {
      found: true,
      result: {
        entity_type: 'block_hash',
        entity_id: result.hash,
        entity_data: result,
      },
    };
  }
  // found nothing
  return { found: false };
}
