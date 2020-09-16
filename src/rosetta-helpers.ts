import { DbMempoolTx, DbTx } from './datastore/common';
import { getTxTypeString, getTxStatusString } from './api/controllers/db-controller';

import { assertNotNullish as unwrapOptional, bufferToHexPrefixString } from './helpers';
import { RosettaOperation } from '@blockstack/stacks-blockchain-api-types';

import * as btc from 'bitcoinjs-lib';
import * as c32check from 'c32check';
import { RosettaNetworks } from './api/rosetta-constants';

enum CoinAction {
  CoinSpent = 'coin_spent',
  CoinCreated = 'coin_created',
}

export function getOperations(tx: DbMempoolTx | DbTx): RosettaOperation[] {
  const operations: RosettaOperation[] = [];
  const txType = getTxTypeString(tx.type_id);
  switch (txType) {
    case 'token_transfer':
      operations.push(makeFeeOperation(tx));
      operations.push(makeSenderOperation(tx, operations.length));
      operations.push(makeReceiverOperation(tx, operations.length));
      break;
    case 'contract_call':
      operations.push(makeFeeOperation(tx));
      operations.push(makeCallContractOperation(tx, operations.length));
      break;
    case 'smart_contract':
      operations.push(makeFeeOperation(tx));
      operations.push(makeDeployContractOperation(tx, operations.length));
      break;
    case 'coinbase':
      operations.push(makeCoinbaseOperation(tx, 0));
      break;
    case 'poison_microblock':
      operations.push(makePoisonMicroblockOperation(tx, 0));
      break;
    default:
      throw new Error(`Unexpected tx type: ${JSON.stringify(txType)}`);
  }
  return operations;
}

function makeFeeOperation(tx: DbMempoolTx | DbTx): RosettaOperation {
  const fee: RosettaOperation = {
    operation_identifier: { index: 0 },
    type: 'fee',
    status: getTxStatusString(tx.status),
    account: { address: tx.sender_address },
    amount: {
      value: (BigInt(0) - tx.fee_rate).toString(10),
      currency: { symbol: 'STX', decimals: 6 },
    },
  };

  return fee;
}

function makeSenderOperation(tx: DbMempoolTx | DbTx, index: number): RosettaOperation {
  const sender: RosettaOperation = {
    operation_identifier: { index: index },
    type: getTxTypeString(tx.type_id),
    status: getTxStatusString(tx.status),
    account: {
      address: unwrapOptional(tx.sender_address, () => 'Unexpected nullish sender_address'),
    },
    amount: {
      value:
        '-' +
        unwrapOptional(
          tx.token_transfer_amount,
          () => 'Unexpected nullish token_transfer_amount'
        ).toString(10),
      currency: { symbol: 'STX', decimals: 6 },
    },
    coin_change: {
      coin_action: CoinAction.CoinSpent,
      coin_identifier: { identifier: tx.tx_id + ':' + index },
    },
  };

  return sender;
}

function makeReceiverOperation(tx: DbMempoolTx | DbTx, index: number): RosettaOperation {
  const receiver: RosettaOperation = {
    operation_identifier: { index: index },
    related_operations: [{ index: 0, operation_identifier: { index: 1 } }],
    type: getTxTypeString(tx.type_id),
    status: getTxStatusString(tx.status),
    account: {
      address: unwrapOptional(
        tx.token_transfer_recipient_address,
        () => 'Unexpected nullish token_transfer_recipient_address'
      ),
    },
    amount: {
      value: unwrapOptional(
        tx.token_transfer_amount,
        () => 'Unexpected nullish token_transfer_amount'
      ).toString(10),
      currency: { symbol: 'STX', decimals: 6 },
    },
    coin_change: {
      coin_action: CoinAction.CoinCreated,
      coin_identifier: { identifier: tx.tx_id + ':' + index },
    },
  };

  return receiver;
}

function makeDeployContractOperation(tx: DbMempoolTx | DbTx, index: number): RosettaOperation {
  const deployer: RosettaOperation = {
    operation_identifier: { index: index },
    type: getTxTypeString(tx.type_id),
    status: getTxStatusString(tx.status),
    account: {
      address: unwrapOptional(tx.sender_address, () => 'Unexpected nullish sender_address'),
    },
  };

  return deployer;
}

function makeCallContractOperation(tx: DbMempoolTx | DbTx, index: number): RosettaOperation {
  const caller: RosettaOperation = {
    operation_identifier: { index: index },
    type: getTxTypeString(tx.type_id),
    status: getTxStatusString(tx.status),
    account: {
      address: unwrapOptional(tx.sender_address, () => 'Unexpected nullish sender_address'),
      sub_account: {
        address: tx.contract_call_contract_id ? tx.contract_call_contract_id : '',
        metadata: {
          contract_call_function_name: tx.contract_call_function_name,
          contract_call_function_args: bufferToHexPrefixString(
            unwrapOptional(tx.contract_call_function_args, () => '')
          ),
          raw_result: tx.raw_result,
        },
      },
    },
  };

  return caller;
}
function makeCoinbaseOperation(tx: DbMempoolTx | DbTx, index: number): RosettaOperation {
  // TODO : Add more mappings in operations for coinbase
  const sender: RosettaOperation = {
    operation_identifier: { index: index },
    type: getTxTypeString(tx.type_id),
    status: getTxStatusString(tx.status),
    account: {
      address: unwrapOptional(tx.sender_address, () => 'Unexpected nullish sender_address'),
    },
  };

  return sender;
}

function makePoisonMicroblockOperation(tx: DbMempoolTx | DbTx, index: number): RosettaOperation {
  // TODO : add more mappings in operations for poison-microblock
  const sender: RosettaOperation = {
    operation_identifier: { index: index },
    type: getTxTypeString(tx.type_id),
    status: getTxStatusString(tx.status),
    account: {
      address: unwrapOptional(tx.sender_address, () => 'Unexpected nullish sender_address'),
    },
  };

  return sender;
}

export function publicKeyToBitcoinAddress(publicKey: string, network: string): string | undefined {
  const publicKeyBuffer = Buffer.from(publicKey, 'hex');

  let btcNetwork: btc.Network;
  if (network == RosettaNetworks.mainnet) {
    btcNetwork = btc.networks.bitcoin;
  } else {
    btcNetwork = btc.networks.regtest;
  }

  const address = btc.payments.p2pkh({
    pubkey: publicKeyBuffer,
    network: btcNetwork,
  });
  return address.address;
}

export function bitcoinAddressToSTXAddress(btcAddress: string): string {
  return c32check.b58ToC32(btcAddress);
}
