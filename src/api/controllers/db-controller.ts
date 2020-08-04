import {
  serializeCV,
  deserializeCV,
  ClarityAbi,
  abiFunctionToString,
  getTypeString,
} from '@blockstack/stacks-transactions';
import { cvToString } from '@blockstack/stacks-transactions/lib/clarity';

import {
  Transaction,
  SmartContractTransaction,
  ContractCallTransaction,
  TransactionEvent,
  Block,
  TransactionType,
  TransactionEventSmartContractLog,
  TransactionEventStxAsset,
  TransactionEventFungibleAsset,
  TransactionEventNonFungibleAsset,
  MempoolTransaction,
} from '@blockstack/stacks-blockchain-api-types';

import {
  DataStore,
  DbTxStatus,
  DbTxTypeId,
  DbEventTypeId,
  DbAssetEventTypeId,
  DbStxEvent,
  DbEvent,
  DbTx,
  DbMempoolTx,
} from '../../datastore/common';
import {
  assertNotNullish as unwrapOptional,
  bufferToHexPrefixString,
  ElementType,
  hexToBuffer,
  unixEpochToIso,
} from '../../helpers';
import { readClarityValueArray, readTransactionPostConditions } from '../../p2p/tx';
import { BufferReader } from '../../binary-reader';
import { serializePostCondition, serializePostConditionMode } from '../serializers/post-conditions';
import { DbSmartContractEvent, DbFtEvent, DbNftEvent } from '../../datastore/common';

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

export function getTxStatusString(txStatus: DbTxStatus): Transaction['tx_status'] {
  switch (txStatus) {
    case DbTxStatus.Pending:
      return 'pending';
    case DbTxStatus.Success:
      return 'success';
    case DbTxStatus.AbortByResponse:
      return 'abort_by_response';
    case DbTxStatus.AbortByPostCondition:
      return 'abort_by_post_condition';
    default:
      throw new Error(`Unexpected DbTxStatus: ${txStatus}`);
  }
}

type HasEventTransaction = SmartContractTransaction | ContractCallTransaction;

function getEventTypeString(
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
    default:
      throw new Error(`Unexpected DbEventTypeId: ${eventTypeId}`);
  }
}

function getAssetEventTypeString(
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

export async function getBlockFromDataStore(
  blockHash: string,
  db: DataStore
): Promise<{ found: true; result: Block } | { found: false }> {
  const blockQuery = await db.getBlock(blockHash);
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
    txs: txIds.results,
  };
  return { found: true, result: apiBlock };
}

export function parseDbMempoolTx(dbTx: DbMempoolTx): MempoolTransaction {
  const apiTx: Partial<MempoolTransaction> = {
    tx_id: dbTx.tx_id,
    tx_status: getTxStatusString(dbTx.status) as 'pending',
    tx_type: getTxTypeString(dbTx.type_id),
    receipt_time: dbTx.receipt_time,
    receipt_time_iso: unixEpochToIso(dbTx.receipt_time),

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

export async function getTxFromDataStore(
  txId: string,
  db: DataStore
): Promise<{ found: true; result: Transaction } | { found: false }> {
  let dbTx: DbTx | DbMempoolTx;
  let dbTxEvents: DbEvent[] = [];
  // First check mempool
  const mempoolTxQuery = await db.getMempoolTx(txId);
  if (mempoolTxQuery.found) {
    dbTx = mempoolTxQuery.result;
  } else {
    const txQuery = await db.getTx(txId);
    if (!txQuery.found) {
      return { found: false };
    }
    dbTx = txQuery.result;
    const eventsQuery = await db.getTxEvents(txId, txQuery.result.index_block_hash);
    dbTxEvents = eventsQuery.results;
  }

  const apiTx: Partial<Transaction & MempoolTransaction> = {
    tx_id: dbTx.tx_id,
    tx_type: getTxTypeString(dbTx.type_id),

    fee_rate: dbTx.fee_rate.toString(10),
    sender_address: dbTx.sender_address,
    sponsored: dbTx.sponsored,
    sponsor_address: dbTx.sponsor_address,

    post_condition_mode: serializePostConditionMode(dbTx.post_conditions.readUInt8(0)),
  };

  (apiTx as Transaction | MempoolTransaction).tx_status = getTxStatusString(dbTx.status);

  // If not a mempool transaction then block info is available
  if (dbTx.status !== DbTxStatus.Pending) {
    const fullTx = dbTx as DbTx;
    apiTx.block_hash = fullTx.block_hash;
    apiTx.block_height = fullTx.block_height;
    apiTx.burn_block_time = fullTx.burn_block_time;
    apiTx.burn_block_time_iso = unixEpochToIso(fullTx.burn_block_time);
    apiTx.canonical = fullTx.canonical;
    apiTx.tx_index = fullTx.tx_index;

    if (fullTx.raw_result) {
      apiTx.tx_result = {
        hex: fullTx.raw_result,
        repr: cvToString(deserializeCV(hexToBuffer(fullTx.raw_result))),
      };
    }
  }

  if ((dbTx as DbMempoolTx).receipt_time) {
    const mempoolTx = dbTx as DbMempoolTx;
    apiTx.receipt_time = mempoolTx.receipt_time;
    apiTx.receipt_time_iso = unixEpochToIso(mempoolTx.receipt_time);
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

  const canHaveEvents =
    dbTx.type_id === DbTxTypeId.TokenTransfer ||
    dbTx.type_id === DbTxTypeId.ContractCall ||
    dbTx.type_id === DbTxTypeId.SmartContract;
  if (!canHaveEvents && dbTxEvents.length > 0) {
    throw new Error(`Events exist for unexpected tx type_id: ${dbTx.type_id}`);
  }

  if (
    apiTx.tx_type === 'token_transfer' ||
    apiTx.tx_type === 'smart_contract' ||
    apiTx.tx_type === 'contract_call'
  ) {
    apiTx.events = dbTxEvents.map(event => parseDbEvent(event));
  }

  return {
    found: true,
    result: apiTx as Transaction,
  };
}
