import {
  abiFunctionToString,
  BufferReader,
  ClarityAbi,
  cvToString,
  deserializeCV,
  getTypeString,
  serializeCV,
} from '@stacks/transactions';

import {
  Block,
  ContractCallTransaction,
  MempoolTransaction,
  MempoolTransactionStatus,
  RosettaBlock,
  RosettaParentBlockIdentifier,
  RosettaTransaction,
  SmartContractTransaction,
  Transaction,
  TransactionEvent,
  TransactionEventFungibleAsset,
  TransactionEventNonFungibleAsset,
  TransactionEventSmartContractLog,
  TransactionEventStxAsset,
  TransactionEventStxLock,
  TransactionStatus,
  TransactionType,
} from '@blockstack/stacks-blockchain-api-types';

import {
  DataStore,
  DbAssetEventTypeId,
  DbBlock,
  DbEvent,
  DbEventTypeId,
  DbMempoolTx,
  DbTx,
  DbTxStatus,
  DbTxTypeId,
} from '../../datastore/common';
import {
  assertNotNullish as unwrapOptional,
  bufferToHexPrefixString,
  ElementType,
  FoundOrNot,
  hexToBuffer,
  logger,
  unixEpochToIso,
} from '../../helpers';
import { readClarityValueArray, readTransactionPostConditions } from '../../p2p/tx';
import { serializePostCondition, serializePostConditionMode } from '../serializers/post-conditions';
import { getMinerOperations, getOperations, processEvents } from '../../rosetta-helpers';

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

type HasEventTransaction = SmartContractTransaction | ContractCallTransaction;

export function getEventTypeString(
  eventTypeId: DbEventTypeId
): ElementType<Exclude<HasEventTransaction['events'], undefined>>['event_type'] {
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
  if (blockHeight && blockHeight > 0) {
    query = db.getBlockByHeight(blockHeight);
  } else if (blockHash) {
    query = db.getBlock(blockHash);
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
    blockTxs = await getRosettaBlockTransactionsFromDataStore(
      dbBlock.block_hash,
      dbBlock.index_block_hash,
      db
    );
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
    const parentBlockQuery = await db.getBlock(parentBlockHash);
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

export async function getBlockFromDataStore({
  blockIdentifer,
  db,
}: {
  blockIdentifer: { hash: string } | { height: number };
  db: DataStore;
}): Promise<FoundOrNot<Block>> {
  let blockQuery: FoundOrNot<DbBlock>;
  if ('hash' in blockIdentifer) {
    blockQuery = await db.getBlock(blockIdentifer.hash);
  } else {
    blockQuery = await db.getBlockByHeight(blockIdentifer.height);
  }
  if (!blockQuery.found) {
    return { found: false };
  }
  const dbBlock = blockQuery.result;
  const txIds = await db.getBlockTxs(dbBlock.index_block_hash);

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
    txs: txIds.results,
  };
  return { found: true, result: apiBlock };
}

export async function getRosettaBlockTransactionsFromDataStore(
  blockHash: string,
  indexBlockHash: string,
  db: DataStore
): Promise<FoundOrNot<RosettaTransaction[]>> {
  const blockQuery = await db.getBlock(blockHash);
  if (!blockQuery.found) {
    return { found: false };
  }

  const txsQuery = await db.getBlockTxsRows(blockHash);
  const minerRewards = await db.getMinerRewards({
    blockHeight: blockQuery.result.block_height,
  });

  if (!txsQuery.found) {
    return { found: false };
  }

  const transactions: RosettaTransaction[] = [];

  for (const tx of txsQuery.result) {
    let events: DbEvent[] = [];
    if (blockQuery.result.block_height > 1) {
      // only return events of blocks at height greater than 1
      const eventsQuery = await db.getTxEvents({
        txId: tx.tx_id,
        indexBlockHash: indexBlockHash,
        limit: 5000,
        offset: 0,
      });
      events = eventsQuery.results;
    }

    const operations = getOperations(tx, minerRewards, events);

    transactions.push({
      transaction_identifier: { hash: tx.tx_id },
      operations: operations,
    });
  }

  return { found: true, result: transactions };
}

export async function getRosettaTransactionFromDataStore(
  txId: string,
  db: DataStore
): Promise<FoundOrNot<RosettaTransaction>> {
  const txQuery = await db.getTx(txId);
  if (!txQuery.found) {
    return { found: false };
  }
  const operations = getOperations(txQuery.result);
  const result = {
    transaction_identifier: { hash: txId },
    operations: operations,
  };
  return { found: true, result: result };
}

export function parseDbMempoolTx(dbTx: DbMempoolTx): MempoolTransaction {
  const apiTx: Partial<MempoolTransaction> = {
    tx_id: dbTx.tx_id,
    tx_status: getTxStatusString(dbTx.status) as 'pending',
    tx_type: getTxTypeString(dbTx.type_id),
    receipt_time: dbTx.receipt_time,
    receipt_time_iso: unixEpochToIso(dbTx.receipt_time),

    nonce: dbTx.nonce,
    fee_rate: dbTx.fee_rate.toString(10),
    sender_address: dbTx.sender_address,
    sponsored: dbTx.sponsored,
    sponsor_address: dbTx.sponsor_address,

    post_condition_mode: serializePostConditionMode(dbTx.post_conditions.readUInt8(0)),
  };

  switch (apiTx.tx_type) {
    case 'token_transfer': {
      apiTx.token_transfer = {
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
      };
      break;
    }
    case 'smart_contract': {
      const postConditions = readTransactionPostConditions(
        BufferReader.fromBuffer(dbTx.post_conditions.slice(1))
      );
      apiTx.post_conditions = postConditions.map(pc => serializePostCondition(pc));
      apiTx.smart_contract = {
        contract_id: unwrapOptional(
          dbTx.smart_contract_contract_id,
          () => 'Unexpected nullish smart_contract_contract_id'
        ),
        source_code: unwrapOptional(
          dbTx.smart_contract_source_code,
          () => 'Unexpected nullish smart_contract_source_code'
        ),
      };
      break;
    }
    case 'contract_call': {
      const postConditions = readTransactionPostConditions(
        BufferReader.fromBuffer(dbTx.post_conditions.slice(1))
      );
      const contractId = unwrapOptional(
        dbTx.contract_call_contract_id,
        () => 'Unexpected nullish contract_call_contract_id'
      );
      const functionName = unwrapOptional(
        dbTx.contract_call_function_name,
        () => 'Unexpected nullish contract_call_function_name'
      );
      apiTx.post_conditions = postConditions.map(pc => serializePostCondition(pc));
      apiTx.contract_call = { contract_id: contractId, function_name: functionName };
      break;
    }
    case 'poison_microblock': {
      apiTx.poison_microblock = {
        microblock_header_1: bufferToHexPrefixString(
          unwrapOptional(dbTx.poison_microblock_header_1)
        ),
        microblock_header_2: bufferToHexPrefixString(
          unwrapOptional(dbTx.poison_microblock_header_2)
        ),
      };
      break;
    }
    case 'coinbase': {
      apiTx.coinbase_payload = {
        data: bufferToHexPrefixString(
          unwrapOptional(dbTx.coinbase_payload, () => 'Unexpected nullish coinbase_payload')
        ),
      };
      break;
    }
    default:
      throw new Error(`Unexpected DbTxTypeId: ${dbTx.type_id}`);
  }
  return apiTx as MempoolTransaction;
}

export interface GetTxArgs {
  txId: string;
}

export interface GetTxWithEventsArgs extends GetTxArgs {
  eventLimit: number;
  eventOffset: number;
}

export async function getTxFromDataStore(
  db: DataStore,
  args: GetTxArgs | GetTxWithEventsArgs
): Promise<FoundOrNot<Transaction>> {
  let dbTx: DbTx | DbMempoolTx;
  let dbTxEvents: DbEvent[] = [];
  let eventCount = 0;

  const txQuery = await db.getTx(args.txId);
  const mempoolTxQuery = await db.getMempoolTx({ txId: args.txId, includePruned: true });
  // First, check the happy path: the tx is mined and in the canonical chain.
  if (txQuery.found && txQuery.result.canonical) {
    dbTx = txQuery.result;
    eventCount = dbTx.event_count;
  }

  // Otherwise, if not mined or not canonical, check in the mempool.
  else if (mempoolTxQuery.found) {
    dbTx = mempoolTxQuery.result;
  }
  // Fallback for a situation where the tx was only mined in a non-canonical chain, but somehow not in the mempool table.
  else if (txQuery.found) {
    logger.warn(`Tx only exists in a non-canonical chain, missing from mempool: ${args.txId}`);
    dbTx = txQuery.result;
    eventCount = dbTx.event_count;
  }
  // Tx not found in db.
  else {
    return { found: false };
  }

  // if tx is included in a block
  if ('tx_index' in dbTx) {
    // if tx events are requested
    if ('eventLimit' in args) {
      const eventsQuery = await db.getTxEvents({
        txId: args.txId,
        indexBlockHash: dbTx.index_block_hash,
        limit: args.eventLimit,
        offset: args.eventOffset,
      });
      dbTxEvents = eventsQuery.results;
    }
  }

  const apiTx: Partial<Transaction | MempoolTransaction> = {
    tx_id: dbTx.tx_id,
    tx_type: getTxTypeString(dbTx.type_id),

    nonce: dbTx.nonce,
    fee_rate: dbTx.fee_rate.toString(10),
    sender_address: dbTx.sender_address,
    sponsored: dbTx.sponsored,
    sponsor_address: dbTx.sponsor_address,

    post_condition_mode: serializePostConditionMode(dbTx.post_conditions.readUInt8(0)),
  };

  (apiTx as Transaction | MempoolTransaction).tx_status = getTxStatusString(dbTx.status);

  // If not a mempool transaction then block info is available
  if ('tx_index' in dbTx) {
    const tx = apiTx as Transaction;
    tx.block_hash = dbTx.block_hash;
    tx.block_height = dbTx.block_height;
    tx.burn_block_time = dbTx.burn_block_time;
    tx.burn_block_time_iso = unixEpochToIso(dbTx.burn_block_time);
    tx.canonical = dbTx.canonical;
    tx.tx_index = dbTx.tx_index;

    if (dbTx.raw_result) {
      tx.tx_result = {
        hex: dbTx.raw_result,
        repr: cvToString(deserializeCV(hexToBuffer(dbTx.raw_result))),
      };
    }
  } else if ('receipt_time') {
    const tx = apiTx as MempoolTransaction;
    tx.receipt_time = dbTx.receipt_time;
    tx.receipt_time_iso = unixEpochToIso(dbTx.receipt_time);
  } else {
    throw new Error(`Unexpected transaction object type. Expected a mined TX or a mempool TX`);
  }

  switch (apiTx.tx_type) {
    case 'token_transfer': {
      apiTx.token_transfer = {
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
      };
      break;
    }
    case 'smart_contract': {
      const postConditions = readTransactionPostConditions(
        BufferReader.fromBuffer(dbTx.post_conditions.slice(1))
      );
      apiTx.post_conditions = postConditions.map(pc => serializePostCondition(pc));
      apiTx.smart_contract = {
        contract_id: unwrapOptional(
          dbTx.smart_contract_contract_id,
          () => 'Unexpected nullish smart_contract_contract_id'
        ),
        source_code: unwrapOptional(
          dbTx.smart_contract_source_code,
          () => 'Unexpected nullish smart_contract_source_code'
        ),
      };
      break;
    }
    case 'contract_call': {
      const postConditions = readTransactionPostConditions(
        BufferReader.fromBuffer(dbTx.post_conditions.slice(1))
      );
      const contractId = unwrapOptional(
        dbTx.contract_call_contract_id,
        () => 'Unexpected nullish contract_call_contract_id'
      );
      const functionName = unwrapOptional(
        dbTx.contract_call_function_name,
        () => 'Unexpected nullish contract_call_function_name'
      );
      apiTx.post_conditions = postConditions.map(pc => serializePostCondition(pc));
      const contract = await db.getSmartContract(contractId);
      if (!contract.found) {
        throw new Error(`Failed to lookup smart contract by ID ${contractId}`);
      }
      const contractAbi: ClarityAbi = JSON.parse(contract.result.abi);
      const functionAbi = contractAbi.functions.find(fn => fn.name === functionName);
      if (!functionAbi) {
        throw new Error(`Could not find function name "${functionName}" in ABI for ${contractId}`);
      }
      apiTx.contract_call = {
        contract_id: contractId,
        function_name: functionName,
        function_signature: abiFunctionToString(functionAbi),
      };
      if (dbTx.contract_call_function_args) {
        let fnArgIndex = 0;
        apiTx.contract_call.function_args = readClarityValueArray(
          dbTx.contract_call_function_args
        ).map(c => {
          const functionArgAbi = functionAbi.args[fnArgIndex++];
          return {
            hex: bufferToHexPrefixString(serializeCV(c)),
            repr: cvToString(c),
            name: functionArgAbi.name,
            type: getTypeString(functionArgAbi.type),
          };
        });
      }
      break;
    }
    case 'poison_microblock': {
      apiTx.poison_microblock = {
        microblock_header_1: bufferToHexPrefixString(
          unwrapOptional(dbTx.poison_microblock_header_1)
        ),
        microblock_header_2: bufferToHexPrefixString(
          unwrapOptional(dbTx.poison_microblock_header_2)
        ),
      };
      break;
    }
    case 'coinbase': {
      apiTx.coinbase_payload = {
        data: bufferToHexPrefixString(
          unwrapOptional(dbTx.coinbase_payload, () => 'Unexpected nullish coinbase_payload')
        ),
      };
      break;
    }
    default:
      throw new Error(`Unexpected DbTxTypeId: ${dbTx.type_id}`);
  }

  (apiTx as Transaction).events = dbTxEvents.map(event => parseDbEvent(event));
  (apiTx as Transaction).event_count = eventCount;

  return {
    found: true,
    result: apiTx as Transaction,
  };
}
