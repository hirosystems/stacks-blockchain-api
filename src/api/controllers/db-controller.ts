import { Transaction, SmartContractTransaction, ContractCallTransaction } from '.tmp/index';

import {
  DataStore,
  DbTxStatus,
  DbTxTypeId,
  DbEventTypeId,
  DbAssetEventTypeId,
} from '../../datastore/common';
import {
  assertNotNullish as unwrapOptional,
  bufferToHexPrefixString,
  ElementType,
} from '../../helpers';
import { NotImplementedError } from '../../errors';

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

export async function getTxFromDataStore(txId: string, db: DataStore): Promise<Transaction> {
  const dbTx = await db.getTx(txId);
  const dbTxEvents = await db.getTxEvents(txId);

  const apiTx: Partial<Transaction> = {
    block_hash: dbTx.block_hash,
    block_height: dbTx.block_height,

    tx_id: dbTx.tx_id,
    tx_index: dbTx.tx_index,
    tx_status: getTxStatusString(dbTx.status),
    tx_type: getTypeString(dbTx.type_id),

    fee_rate: dbTx.fee_rate.toString(10),
    sender_address: dbTx.sender_address,
    sponsored: dbTx.sponsored,
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
      apiTx.post_conditions = dbTx.post_conditions?.toString('hex');
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
      apiTx.post_conditions = dbTx.post_conditions?.toString('hex');
      apiTx.contract_call = {
        contract_id: unwrapOptional(
          dbTx.contract_call_contract_id,
          () => 'Unexpected nullish contract_call_contract_id'
        ),
        function_name: unwrapOptional(
          dbTx.contract_call_function_name,
          () => 'Unexpected nullish contract_call_function_name'
        ),
        function_args: unwrapOptional(
          dbTx.contract_call_function_args,
          () => 'Unexpected nullish contract_call_function_args'
        ).map(b => bufferToHexPrefixString(b)),
      };
      break;
    }
    case 'poison_microblock': {
      throw new NotImplementedError('Create poison_microblock tx API response');
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
    const events = apiTx.events;
    for (let i = 0; i < events.length; i++) {
      const dbEvent = dbTxEvents[i];
      events[i] = {
        event_index: dbEvent.event_index,
        event_type: getEventTypeString(dbEvent.event_type),
      };
      const event = events[i];
      switch (dbEvent.event_type) {
        case DbEventTypeId.SmartContractLog: {
          event.contract_log = {
            contract_id: dbEvent.contract_identifier,
            topic: dbEvent.topic,
            value: bufferToHexPrefixString(dbEvent.value),
          };
          break;
        }
        case DbEventTypeId.StxAsset: {
          event.asset = {
            asset_event_type: getAssetEventTypeString(dbEvent.asset_event_type_id),
            sender: dbEvent.sender,
            recipient: dbEvent.recipient,
            amount: dbEvent.amount.toString(10),
          };
          break;
        }
        case DbEventTypeId.FungibleTokenAsset: {
          event.asset = {
            asset_event_type: getAssetEventTypeString(dbEvent.asset_event_type_id),
            asset_id: dbEvent.asset_identifier,
            sender: dbEvent.sender,
            amount: dbEvent.amount.toString(10),
          };
          break;
        }
        case DbEventTypeId.NonFungibleTokenAsset: {
          event.asset = {
            asset_event_type: getAssetEventTypeString(dbEvent.asset_event_type_id),
            asset_id: dbEvent.asset_identifier,
            sender: dbEvent.sender,
            value: bufferToHexPrefixString(dbEvent.value),
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
