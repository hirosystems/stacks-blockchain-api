import { Transaction, SmartContractTransaction, ContractCallTransaction } from '@entities';

import {
  DataStore,
  DbTxStatus,
  DbTxTypeId,
  DbEventTypeId,
  DbAssetEventTypeId,
  DbStxEvent,
  DbBlock,
} from '../../datastore/common';
import {
  assertNotNullish as unwrapOptional,
  bufferToHexPrefixString,
  ElementType,
} from '../../helpers';
import { NotImplementedError } from '../../errors';
import { readClarityValueArray, readTransactionPostConditions } from '../../p2p/tx';
import { serializeCV } from '@blockstack/stacks-transactions';
import { BufferReader } from '../../binary-reader';

import { serializePostCondition, serializePostConditionMode } from '../serializers/post-conditions';
import { TransactionEvent } from '../../../.tmp/index';
import { DbEvent, DbSmartContractEvent, DbFtEvent, DbNftEvent } from '../../datastore/common';

function getTypeString(typeId: DbTxTypeId): Transaction['tx_type'] {
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

function getTxStatusString(txStatus: DbTxStatus): Transaction['tx_status'] {
  switch (txStatus) {
    case DbTxStatus.Pending:
      return 'pending';
    case DbTxStatus.Success:
      return 'success';
    case DbTxStatus.Failed:
      return 'failed';
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

export type Block = DbBlock;

export async function getBlockFromDataStore(blockHash: string, db: DataStore): Promise<Block> {
  const dbBlock = await db.getBlock(blockHash);
  return dbBlock;
}

export async function getTxFromDataStore(txId: string, db: DataStore): Promise<Transaction> {
  const dbTx = await db.getTx(txId);
  const dbTxEvents = await db.getTxEvents(txId);

  const apiTx: Partial<Transaction> = {
    block_hash: dbTx.block_hash,
    block_height: dbTx.block_height,
    burn_block_time: dbTx.burn_block_time,

    canonical: dbTx.canonical,

    tx_id: dbTx.tx_id,
    tx_index: dbTx.tx_index,
    tx_status: getTxStatusString(dbTx.status),
    tx_type: getTypeString(dbTx.type_id),

    fee_rate: dbTx.fee_rate.toString(10),
    sender_address: dbTx.sender_address,
    sponsored: dbTx.sponsored,

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
      apiTx.post_conditions = postConditions.map(serializePostCondition);
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
      apiTx.post_conditions = postConditions.map(serializePostCondition);
      apiTx.contract_call = {
        contract_id: unwrapOptional(
          dbTx.contract_call_contract_id,
          () => 'Unexpected nullish contract_call_contract_id'
        ),
        function_name: unwrapOptional(
          dbTx.contract_call_function_name,
          () => 'Unexpected nullish contract_call_function_name'
        ),
      };
      if (dbTx.contract_call_function_args) {
        apiTx.contract_call.function_args = readClarityValueArray(dbTx.contract_call_function_args)
          .map(c => serializeCV(c))
          .map(b => bufferToHexPrefixString(b));
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
    dbTx.type_id === DbTxTypeId.ContractCall ||
    dbTx.type_id === DbTxTypeId.SmartContract ||
    dbTx.type_id === DbTxTypeId.TokenTransfer;
  if (!canHaveEvents && dbTxEvents.length > 0) {
    throw new Error(`Events exist for unexpected tx type_id: ${dbTx.type_id}`);
  }

  if (
    apiTx.tx_type === 'token_transfer' ||
    apiTx.tx_type === 'smart_contract' ||
    apiTx.tx_type === 'contract_call'
  ) {
    apiTx.events = new Array(dbTxEvents.length);
    const events: Partial<TransactionEvent>[] = apiTx.events;
    for (let i = 0; i < events.length; i++) {
      const dbEvent = dbTxEvents[i];
      events[i] = {
        event_index: dbEvent.event_index,
        event_type: getEventTypeString(dbEvent.event_type),
      };
      const event = events[i];
      switch (event.event_type) {
        case 'smart_contract_log': {
          event.contract_log = {
            contract_id: (dbEvent as DbSmartContractEvent).contract_identifier,
            topic: (dbEvent as DbSmartContractEvent).topic,
            value: bufferToHexPrefixString((dbEvent as DbSmartContractEvent).value),
          };
          break;
        }
        case 'stx_asset': {
          event.asset = {
            asset_event_type: getAssetEventTypeString((dbEvent as DbStxEvent).asset_event_type_id),
            sender: (dbEvent as DbStxEvent).sender,
            recipient: (dbEvent as DbStxEvent).recipient,
            amount: (dbEvent as DbStxEvent).amount.toString(10),
          };
          break;
        }
        case 'fungible_token_asset': {
          event.asset = {
            asset_event_type: getAssetEventTypeString((dbEvent as DbFtEvent).asset_event_type_id),
            asset_id: (dbEvent as DbFtEvent).asset_identifier,
            sender: (dbEvent as DbFtEvent).sender || '',
            amount: (dbEvent as DbFtEvent).amount.toString(10),
          };
          break;
        }
        case 'non_fungible_token_asset': {
          event.asset = {
            asset_event_type: getAssetEventTypeString((dbEvent as DbNftEvent).asset_event_type_id),
            asset_id: (dbEvent as DbNftEvent).asset_identifier,
            sender: (dbEvent as DbNftEvent).sender || '',
            value: bufferToHexPrefixString((dbEvent as DbNftEvent).value),
          };
          break;
        }
        default:
          throw new Error(`Unexpected event_type in: ${JSON.stringify(dbEvent)}`);
      }
    }
  }

  return { ...apiTx } as Transaction;
}
