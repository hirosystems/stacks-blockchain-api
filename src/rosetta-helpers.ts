import {
  RosettaAccountIdentifier,
  RosettaCurrency,
  RosettaOperation,
  RosettaOptions,
} from '@blockstack/stacks-blockchain-api-types';
import {
  addressToString,
  AuthType,
  ContractCallPayload,
  ChainID,
  PayloadType,
  TokenTransferPayload,
  emptyMessageSignature,
  isSingleSig,
  makeSigHashPreSign,
  MessageSignature,
  parseRecoverableSignature,
  deserializeTransaction,
  StacksTransaction,
  BufferReader,
  txidFromData,
} from '@stacks/transactions';
import { StacksMainnet, StacksTestnet } from '@stacks/network';
import { ec as EC } from 'elliptic';
import * as btc from 'bitcoinjs-lib';
import * as c32check from 'c32check';
import {
  getAssetEventTypeString,
  getEventTypeString,
  getTxStatus,
  getTxTypeString,
} from './api/controllers/db-controller';
import { RosettaConstants, RosettaNetworks } from './api/rosetta-constants';
import {
  BaseTx,
  DbAssetEventTypeId,
  DbEvent,
  DbEventTypeId,
  DbMempoolTx,
  DbMinerReward,
  DbStxEvent,
  DbStxLockEvent,
  DbTx,
  DbTxStatus,
  DbTxTypeId,
} from './datastore/common';
import { getTxSenderAddress, getTxSponsorAddress } from './event-stream/reader';
import {
  assertNotNullish as unwrapOptional,
  bufferToHexPrefixString,
  hexToBuffer,
} from './helpers';
import { readTransaction, TransactionPayloadTypeID } from './p2p/tx';

import { getCoreNodeEndpoint } from './core-rpc/client';

enum CoinAction {
  CoinSpent = 'coin_spent',
  CoinCreated = 'coin_created',
}

export function getOperations(
  tx: DbTx | DbMempoolTx | BaseTx,
  minerRewards?: DbMinerReward[],
  events?: DbEvent[]
): RosettaOperation[] {
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
      if (minerRewards !== undefined) {
        getMinerOperations(minerRewards, operations);
      }
      break;
    case 'poison_microblock':
      operations.push(makePoisonMicroblockOperation(tx, 0));
      break;
    default:
      throw new Error(`Unexpected tx type: ${JSON.stringify(txType)}`);
  }

  if (events !== undefined) {
    processEvents(events, tx, operations);
  }

  return operations;
}

export function processEvents(events: DbEvent[], baseTx: BaseTx, operations: RosettaOperation[]) {
  events.forEach(event => {
    const txEventType = event.event_type;
    switch (txEventType) {
      case DbEventTypeId.StxAsset:
        const stxAssetEvent = event as DbStxEvent;
        const txAssetEventType = stxAssetEvent.asset_event_type_id;
        switch (txAssetEventType) {
          case DbAssetEventTypeId.Transfer:
            if (baseTx.type_id == DbTxTypeId.TokenTransfer) {
              // each token_transfer has a transfer event associated with
              // we break here to avoid operation duplication
              break;
            }
            const tx = baseTx;
            tx.sender_address = unwrapOptional(
              stxAssetEvent.sender,
              () => 'Unexpected nullish sender'
            );
            tx.token_transfer_recipient_address = unwrapOptional(
              stxAssetEvent.recipient,
              () => 'Unexpected nullish recipient'
            );
            tx.token_transfer_amount = unwrapOptional(
              stxAssetEvent.amount,
              () => 'Unexpected nullish amount'
            );
            operations.push(makeSenderOperation(tx, operations.length));
            operations.push(makeReceiverOperation(tx, operations.length));
            break;
          case DbAssetEventTypeId.Burn:
            operations.push(makeBurnOperation(stxAssetEvent, baseTx, operations.length));
            break;
          case DbAssetEventTypeId.Mint:
            operations.push(makeMintOperation(stxAssetEvent, baseTx, operations.length));
            break;
          default:
            throw new Error(`Unexpected StxAsset event: ${txAssetEventType}`);
        }
        break;
      case DbEventTypeId.StxLock:
        const stxLockEvent = event as DbStxLockEvent;
        operations.push(makeStakeLockOperation(stxLockEvent, baseTx, operations.length));
        break;
      case DbEventTypeId.NonFungibleTokenAsset:
        break;
      case DbEventTypeId.FungibleTokenAsset:
        break;
      case DbEventTypeId.SmartContractLog:
        break;
      default:
        throw new Error(`Unexpected DbEventTypeId: ${txEventType}`);
    }
  });
}

function makeStakeLockOperation(
  tx: DbStxLockEvent,
  baseTx: BaseTx,
  index: number
): RosettaOperation {
  const stake: RosettaOperation = {
    operation_identifier: { index: index },
    type: getEventTypeString(tx.event_type),
    status: getTxStatus(baseTx.status),
    account: {
      address: unwrapOptional(tx.locked_address, () => 'Unexpected nullish locked_address'),
    },
  };

  return stake;
}

export function getMinerOperations(minerRewards: DbMinerReward[], operations: RosettaOperation[]) {
  minerRewards.forEach(reward => {
    operations.push(makeMinerRewardOperation(reward, operations.length));
  });
}

function makeMinerRewardOperation(reward: DbMinerReward, index: number): RosettaOperation {
  const value =
    reward.coinbase_amount +
    reward.tx_fees_anchored +
    reward.tx_fees_streamed_confirmed +
    reward.tx_fees_streamed_produced;
  const minerRewardOp: RosettaOperation = {
    operation_identifier: { index: index },
    status: getTxStatus(DbTxStatus.Success),
    type: 'miner_reward',
    account: {
      address: unwrapOptional(reward.recipient, () => 'Unexpected nullish recipient'),
    },
    amount: {
      value: unwrapOptional(value, () => 'Unexpected nullish coinbase_amount').toString(10),
      currency: getStxCurrencyMetadata(),
    },
  };

  return minerRewardOp;
}

function makeFeeOperation(tx: BaseTx): RosettaOperation {
  const fee: RosettaOperation = {
    operation_identifier: { index: 0 },
    type: 'fee',
    status: getTxStatus(DbTxStatus.Success),
    account: { address: tx.sender_address },
    amount: {
      value: (0n - tx.fee_rate).toString(10),
      currency: getStxCurrencyMetadata(),
    },
  };

  return fee;
}

function makeBurnOperation(tx: DbStxEvent, baseTx: BaseTx, index: number): RosettaOperation {
  const burn: RosettaOperation = {
    operation_identifier: { index: index },
    type: getAssetEventTypeString(tx.asset_event_type_id),
    status: getTxStatus(baseTx.status),
    account: {
      address: unwrapOptional(baseTx.sender_address, () => 'Unexpected nullish sender_address'),
    },
    amount: {
      value: '-' + unwrapOptional(tx.amount, () => 'Unexpected nullish amount').toString(10),
      currency: getStxCurrencyMetadata(),
    },
  };

  return burn;
}

function makeMintOperation(tx: DbStxEvent, baseTx: BaseTx, index: number): RosettaOperation {
  const mint: RosettaOperation = {
    operation_identifier: { index: index },
    type: getAssetEventTypeString(tx.asset_event_type_id),
    status: getTxStatus(baseTx.status),
    account: {
      address: unwrapOptional(tx.recipient, () => 'Unexpected nullish sender_address'),
    },
    amount: {
      value: unwrapOptional(tx.amount, () => 'Unexpected nullish token_transfer_amount').toString(
        10
      ),
      currency: getStxCurrencyMetadata(),
    },
  };

  return mint;
}

function makeSenderOperation(tx: BaseTx, index: number): RosettaOperation {
  const sender: RosettaOperation = {
    operation_identifier: { index: index },
    type: getTxTypeString(tx.type_id),
    status: getTxStatus(tx.status),
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
      currency: getStxCurrencyMetadata(),
    },
    coin_change: {
      coin_action: CoinAction.CoinSpent,
      coin_identifier: { identifier: tx.tx_id + ':' + index },
    },
  };

  return sender;
}

function makeReceiverOperation(tx: BaseTx, index: number): RosettaOperation {
  const receiver: RosettaOperation = {
    operation_identifier: { index: index },
    related_operations: [{ index: index - 1 }],
    type: getTxTypeString(tx.type_id),
    status: getTxStatus(tx.status),
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
      currency: getStxCurrencyMetadata(),
    },
    coin_change: {
      coin_action: CoinAction.CoinCreated,
      coin_identifier: { identifier: tx.tx_id + ':' + index },
    },
  };

  return receiver;
}

function makeDeployContractOperation(tx: BaseTx, index: number): RosettaOperation {
  const deployer: RosettaOperation = {
    operation_identifier: { index: index },
    type: getTxTypeString(tx.type_id),
    status: getTxStatus(tx.status),
    account: {
      address: unwrapOptional(tx.sender_address, () => 'Unexpected nullish sender_address'),
    },
  };

  return deployer;
}

function makeCallContractOperation(tx: BaseTx, index: number): RosettaOperation {
  const caller: RosettaOperation = {
    operation_identifier: { index: index },
    type: getTxTypeString(tx.type_id),
    status: getTxStatus(tx.status),
    account: {
      address: unwrapOptional(tx.sender_address, () => 'Unexpected nullish sender_address'),
      sub_account: {
        address: tx.contract_call_contract_id ? tx.contract_call_contract_id : '',
        metadata: {
          contract_call_function_name: tx.contract_call_function_name,
          contract_call_function_args: bufferToHexPrefixString(
            tx.contract_call_function_args ? tx.contract_call_function_args : Buffer.from('')
          ),
          raw_result: tx.raw_result,
        },
      },
    },
  };

  return caller;
}
function makeCoinbaseOperation(tx: BaseTx, index: number): RosettaOperation {
  // TODO : Add more mappings in operations for coinbase
  const sender: RosettaOperation = {
    operation_identifier: { index: index },
    type: getTxTypeString(tx.type_id),
    status: getTxStatus(tx.status),
    account: {
      address: unwrapOptional(tx.sender_address, () => 'Unexpected nullish sender_address'),
    },
  };

  return sender;
}

function makePoisonMicroblockOperation(tx: BaseTx, index: number): RosettaOperation {
  // TODO : add more mappings in operations for poison-microblock
  const sender: RosettaOperation = {
    operation_identifier: { index: index },
    type: getTxTypeString(tx.type_id),
    status: getTxStatus(tx.status),
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

export function getOptionsFromOperations(operations: RosettaOperation[]): RosettaOptions | null {
  const options: RosettaOptions = {};

  for (const operation of operations) {
    switch (operation.type) {
      case 'fee':
        options.fee = operation.amount?.value;
        break;
      case 'token_transfer':
        if (operation.amount) {
          if (BigInt(operation.amount.value) < 0) {
            options.sender_address = operation.account?.address;
            options.type = operation.type;
          } else {
            options.token_transfer_recipient_address = operation?.account?.address;
            options.amount = operation?.amount?.value;
            options.symbol = operation?.amount?.currency.symbol;
            options.decimals = operation?.amount?.currency.decimals;
          }
        }
        break;
      case 'stacking':
        if (operation.amount && BigInt(operation.amount.value) > 0) {
          return null;
        }
        if (!operation.metadata || typeof operation.metadata.number_of_cycles !== 'number') {
          return null;
        }

        options.sender_address = operation.account?.address;
        options.type = operation.type;
        options.number_of_cycles = operation.metadata.number_of_cycles;
        options.burn_block_height = operation.metadata?.burn_block_height as number;
        options.amount = operation.amount?.value.replace('-', '');
        options.symbol = operation.amount?.currency.symbol;
        options.decimals = operation.amount?.currency.decimals;

        break;
      default:
        return null;
    }
  }

  return options;
}

export function isSymbolSupported(operations: RosettaOperation[]): boolean {
  for (const operation of operations) {
    if (operation.amount?.currency.symbol !== RosettaConstants.symbol) {
      return false;
    }
  }

  return true;
}

export function isDecimalsSupported(operations: RosettaOperation[]): boolean {
  for (const operation of operations) {
    if (operation.amount?.currency.decimals !== RosettaConstants.decimals) {
      return false;
    }
  }

  return true;
}

export function getStxCurrencyMetadata(): RosettaCurrency {
  const currency: RosettaCurrency = {
    decimals: RosettaConstants.decimals,
    symbol: RosettaConstants.symbol,
  };

  return currency;
}

export function rawTxToStacksTransaction(raw_tx: string): StacksTransaction {
  const buffer = hexToBuffer(raw_tx);
  const transaction: StacksTransaction = deserializeTransaction(BufferReader.fromBuffer(buffer));
  return transaction;
}

export function isSignedTransaction(transaction: StacksTransaction): boolean {
  if (!transaction.auth.spendingCondition) {
    return false;
  }
  if (isSingleSig(transaction.auth.spendingCondition)) {
    /**Single signature Transaction has an empty signature, so the transaction is not signed */
    if (
      !transaction.auth.spendingCondition.signature.data ||
      emptyMessageSignature().data === transaction.auth.spendingCondition.signature.data
    ) {
      return false;
    }
  } else {
    /**Multi-signature transaction does not have signature fields thus the transaction not signed */
    if (transaction.auth.spendingCondition.fields.length === 0) {
      return false;
    }
  }
  return true;
}

export function rawTxToBaseTx(raw_tx: string): BaseTx {
  const txBuffer = Buffer.from(raw_tx.substring(2), 'hex');
  const txId = '0x' + txidFromData(txBuffer);
  const bufferReader = BufferReader.fromBuffer(txBuffer);
  const transaction = readTransaction(bufferReader);

  const txSender = getTxSenderAddress(transaction);
  const sponsorAddress = getTxSponsorAddress(transaction);
  const payload: any = transaction.payload;
  const fee = transaction.auth.originCondition.feeRate;
  const amount = payload.amount;
  transaction.auth.originCondition;
  const recipientAddr =
    payload.recipient && payload.recipient.address
      ? addressToString({
          type: payload.recipient.typeId,
          version: payload.recipient.address.version,
          hash160: payload.recipient.address.bytes.toString('hex'),
        })
      : '';
  const sponsored = sponsorAddress ? true : false;

  let transactionType = DbTxTypeId.TokenTransfer;
  switch (transaction.payload.typeId) {
    case TransactionPayloadTypeID.TokenTransfer:
      transactionType = DbTxTypeId.TokenTransfer;
      break;
    case TransactionPayloadTypeID.SmartContract:
      transactionType = DbTxTypeId.SmartContract;
      break;
    case TransactionPayloadTypeID.ContractCall:
      transactionType = DbTxTypeId.ContractCall;
      break;
    case TransactionPayloadTypeID.Coinbase:
      transactionType = DbTxTypeId.Coinbase;
      break;
    case TransactionPayloadTypeID.PoisonMicroblock:
      transactionType = DbTxTypeId.PoisonMicroblock;
      break;
  }
  const dbtx: BaseTx = {
    token_transfer_recipient_address: recipientAddr,
    tx_id: txId,
    type_id: transactionType,
    status: '' as any,
    nonce: Number(transaction.auth.originCondition.nonce),
    fee_rate: fee,
    sender_address: txSender,
    token_transfer_amount: amount,
    sponsored: sponsored,
    sponsor_address: sponsorAddress,
  };

  return dbtx;
}

export function getSigners(transaction: StacksTransaction): RosettaAccountIdentifier[] | undefined {
  let address;
  if (transaction.payload.payloadType == PayloadType.TokenTransfer) {
    address = transaction.payload.recipient.address;
  } else if (transaction.payload.payloadType == PayloadType.ContractCall) {
    address = transaction.payload.contractAddress;
  } else {
    return;
  }
  const { type, version } = address;

  const account_identifier_signers: RosettaAccountIdentifier[] = [];
  if (transaction.auth.authType == AuthType.Standard) {
    if (transaction.auth.spendingCondition) {
      const signer = {
        address: addressToString({
          version: version,
          hash160: transaction.auth.spendingCondition.signer,
          type: type,
        }),
      };
      account_identifier_signers.push(signer);
    }
  } else if (transaction.auth.authType == AuthType.Sponsored) {
    if (transaction.auth.spendingCondition) {
      const signer = {
        address: addressToString({
          version: version,
          hash160: transaction.auth.spendingCondition.signer,
          type: type,
        }),
      };
      account_identifier_signers.push(signer);
    }
    if (transaction.auth.sponsorSpendingCondition) {
      const sponsored = {
        address: addressToString({
          version: version,
          hash160: transaction.auth.sponsorSpendingCondition.signer,
          type: type,
        }),
      };
      account_identifier_signers.push(sponsored);
    }
  }
  return account_identifier_signers;
}

export function getStacksTestnetNetwork() {
  const stacksNetwork = new StacksTestnet();
  stacksNetwork.coreApiUrl = `http://${getCoreNodeEndpoint()}`;
  return stacksNetwork;
}

export function getStacksMainnetNetwork() {
  const stacksNetwork = new StacksMainnet();
  stacksNetwork.coreApiUrl = `http://${getCoreNodeEndpoint()}`;
  return stacksNetwork;
}

export function getStacksNetwork() {
  const configuredChainID: ChainID = parseInt(process.env['STACKS_CHAIN_ID'] as string);
  if (ChainID.Mainnet == configuredChainID) {
    return getStacksMainnetNetwork();
  }
  return getStacksTestnetNetwork();
}

export function verifySignature(
  message: string,
  publicAddress: string,
  signature: MessageSignature
): boolean {
  const { r, s } = parseRecoverableSignature(signature.data);

  try {
    const ec = new EC('secp256k1');
    const publicKeyPair = ec.keyFromPublic(publicAddress, 'hex'); // use the accessible public key to verify the signature
    const isVerified = publicKeyPair.verify(message, { r, s });
    return isVerified;
  } catch (error) {
    return false;
  }
}

export function makePresignHash(transaction: StacksTransaction): string | undefined {
  if (!transaction.auth.authType || !transaction.auth.spendingCondition?.nonce) {
    return undefined;
  }

  return makeSigHashPreSign(
    transaction.verifyBegin(),
    transaction.auth.authType,
    transaction.auth.spendingCondition?.fee,
    transaction.auth.spendingCondition?.nonce
  );
}

export function getSignature(transaction: StacksTransaction): MessageSignature | undefined {
  if (transaction.auth.spendingCondition && isSingleSig(transaction.auth.spendingCondition)) {
    return transaction.auth.spendingCondition.signature;
  }
  return undefined;
}
