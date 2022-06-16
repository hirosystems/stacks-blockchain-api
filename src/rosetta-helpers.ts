import {
  ContractCallTransaction,
  FungibleTokenMetadata,
  RosettaAccountIdentifier,
  RosettaCurrency,
  RosettaOperation,
  RosettaOptions,
} from '@stacks/stacks-blockchain-api-types';
import {
  addressToString,
  AuthType,
  BufferReader,
  ChainID,
  deserializeTransaction,
  emptyMessageSignature,
  isSingleSig,
  makeSigHashPreSign,
  MessageSignature,
  parseRecoverableSignature,
  PayloadType,
  StacksTransaction,
} from '@stacks/transactions';
import { StacksMainnet, StacksTestnet } from '@stacks/network';
import { ec as EC } from 'elliptic';
import * as btc from 'bitcoinjs-lib';
import {
  getAssetEventTypeString,
  getEventTypeString,
  getTxFromDataStore,
  getTxStatus,
  getTxTypeString,
  parseContractCallMetadata,
} from './api/controllers/db-controller';
import {
  PoxContractIdentifier,
  RosettaConstants,
  RosettaNetworks,
  RosettaOperationType,
} from './api/rosetta-constants';
import {
  BaseTx,
  DbAssetEventTypeId,
  DbEvent,
  DbEventTypeId,
  DbFtEvent,
  DbFungibleTokenMetadata,
  DbMempoolTx,
  DbMinerReward,
  DbStxEvent,
  DbStxLockEvent,
  DbTx,
  DbTxStatus,
  DbTxTypeId,
  StxUnlockEvent,
} from './datastore/common';
import { getTxSenderAddress, getTxSponsorAddress } from './event-stream/reader';
import { unwrapOptional, bufferToHexPrefixString, hexToBuffer, logger } from './helpers';

import { getCoreNodeEndpoint } from './core-rpc/client';
import { getBTCAddress, poxAddressToBtcAddress } from '@stacks/stacking';
import { TokenMetadataErrorMode } from './token-metadata/tokens-contract-handler';
import {
  ClarityTypeID,
  decodeClarityValue,
  decodeTransaction,
  ClarityValueBuffer,
  ClarityValueOptional,
  ClarityValueOptionalBool,
  ClarityValuePrincipalStandard,
  ClarityValueResponse,
  ClarityValueTuple,
  ClarityValueUInt,
  PrincipalTypeID,
  TxPayloadTokenTransfer,
  TxPayloadTypeID,
} from 'stacks-encoding-native-js';
import { PgStore } from './datastore/pg-store';
import { isFtMetadataEnabled, tokenMetadataErrorMode } from './token-metadata/helpers';

enum CoinAction {
  CoinSpent = 'coin_spent',
  CoinCreated = 'coin_created',
}

type RosettaStakeContractArgs = {
  amount_ustx: string;
  pox_addr: string;
  stacker_address: string;
  start_burn_height: string;
  unlock_burn_height: string;
  lock_period: string;
};

type RosettaDelegateContractArgs = {
  amount_ustx: string;
  pox_addr: string;
  delegate_to: string;
  until_burn_height: string;
  result: string;
};

type RosettaRevokeDelegateContractArgs = {
  result: string;
};

export function parseTransactionMemo(tx: BaseTx): string | null {
  if (tx.token_transfer_memo && tx.token_transfer_memo != '') {
    // Memos are a fixed-length 34 byte array. Any memo representing a string that is
    // less than 34 bytes long will have right-side padded null-bytes.
    return tx.token_transfer_memo.replace(/\0.*$/g, '');
  }
  return null;
}

export async function getOperations(
  tx: DbTx | DbMempoolTx | BaseTx,
  db: PgStore,
  minerRewards?: DbMinerReward[],
  events?: DbEvent[],
  stxUnlockEvents?: StxUnlockEvent[]
): Promise<RosettaOperation[]> {
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
      operations.push(await makeCallContractOperation(tx, db, operations.length));
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
      if (stxUnlockEvents && stxUnlockEvents?.length > 0) {
        processUnlockingEvents(stxUnlockEvents, operations);
      }
      break;
    case 'poison_microblock':
      operations.push(makePoisonMicroblockOperation(tx, 0));
      break;
    default:
      throw new Error(`Unexpected tx type: ${JSON.stringify(txType)}`);
  }

  if (events !== undefined) {
    await processEvents(db, events, tx, operations);
  }

  return operations;
}

function processUnlockingEvents(events: StxUnlockEvent[], operations: RosettaOperation[]) {
  events.forEach(event => {
    operations.push(makeStakeUnlockOperation(event, operations.length));
  });
}

async function processEvents(
  db: PgStore,
  events: DbEvent[],
  baseTx: BaseTx,
  operations: RosettaOperation[]
) {
  for (const event of events) {
    const txEventType = event.event_type;
    switch (txEventType) {
      case DbEventTypeId.StxAsset:
        const stxAssetEvent = event;
        const txAssetEventType = stxAssetEvent.asset_event_type_id;
        switch (txAssetEventType) {
          case DbAssetEventTypeId.Transfer:
            if (baseTx.type_id == DbTxTypeId.TokenTransfer) {
              // each 'token_transfer' transaction has a 'transfer' event associated with it.
              // We break here to avoid operation duplication
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
        const stxLockEvent = event;
        operations.push(makeStakeLockOperation(stxLockEvent, baseTx, operations.length));
        break;
      case DbEventTypeId.NonFungibleTokenAsset:
        break;
      case DbEventTypeId.FungibleTokenAsset:
        const ftMetadata = await getValidatedFtMetadata(db, event.asset_identifier);
        if (!ftMetadata) {
          break;
        }
        switch (event.asset_event_type_id) {
          case DbAssetEventTypeId.Transfer:
            operations.push(makeFtSenderOperation(event, ftMetadata, baseTx, operations.length));
            operations.push(makeFtReceiverOperation(event, ftMetadata, baseTx, operations.length));
            break;
          case DbAssetEventTypeId.Burn:
            operations.push(makeFtBurnOperation(event, ftMetadata, baseTx, operations.length));
            break;
          case DbAssetEventTypeId.Mint:
            operations.push(makeFtMintOperation(event, ftMetadata, baseTx, operations.length));
            break;
          default:
            throw new Error(`Unexpected FungibleTokenAsset event: ${event.asset_event_type_id}`);
        }
        break;
      case DbEventTypeId.SmartContractLog:
        break;
      default:
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        throw new Error(`Unexpected DbEventTypeId: ${txEventType}`);
    }
  }
}

function makeStakeLockOperation(
  tx: DbStxLockEvent,
  baseTx: BaseTx,
  index: number
): RosettaOperation {
  const stake_metadata: any = {};
  stake_metadata.locked = tx.locked_amount.toString();
  stake_metadata.unlock_height = tx.unlock_height.toString();
  const lock: RosettaOperation = {
    operation_identifier: { index: index },
    type: getEventTypeString(tx.event_type),
    status: getTxStatus(baseTx.status),
    account: {
      address: unwrapOptional(tx.locked_address, () => 'Unexpected nullish locked_address'),
    },
    amount: {
      value: (
        0n - unwrapOptional(tx.locked_amount.valueOf(), () => 'Unexpected nullish locked_amount')
      ).toString(10),
      currency: getStxCurrencyMetadata(),
    },
    metadata: stake_metadata,
  };

  return lock;
}

function makeStakeUnlockOperation(tx: StxUnlockEvent, index: number): RosettaOperation {
  const unlock_metadata: any = {};
  unlock_metadata.tx_id = tx.tx_id;
  const unlock: RosettaOperation = {
    operation_identifier: { index: index },
    type: RosettaOperationType.StxUnlock,
    status: 'success',
    account: {
      address: unwrapOptional(tx.stacker_address, () => 'Unexpected nullish address'),
    },
    amount: {
      value: unwrapOptional(tx.unlocked_amount, () => 'Unexpected nullish amount'),
      currency: getStxCurrencyMetadata(),
    },
    metadata: unlock_metadata,
  };

  return unlock;
}

function getMinerOperations(minerRewards: DbMinerReward[], operations: RosettaOperation[]) {
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
    type: RosettaOperationType.MinerReward,
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
    type: RosettaOperationType.Fee,
    status: getTxStatus(tx.status),
    account: { address: tx.sender_address },
    amount: {
      value: (0n - unwrapOptional(tx.fee_rate, () => 'Unexpected nullish amount')).toString(10),
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
      value: (0n - unwrapOptional(tx.amount, () => 'Unexpected nullish amount')).toString(10),
      currency: getStxCurrencyMetadata(),
    },
  };

  return burn;
}

function makeFtBurnOperation(
  ftEvent: DbFtEvent,
  ftMetadata: FungibleTokenMetadata,
  baseTx: BaseTx,
  index: number
): RosettaOperation {
  const burn: RosettaOperation = {
    operation_identifier: { index: index },
    type: getAssetEventTypeString(ftEvent.asset_event_type_id),
    status: getTxStatus(baseTx.status),
    account: {
      address: unwrapOptional(ftEvent.sender, () => 'Unexpected nullish sender_address'),
    },
    amount: {
      value: (0n - unwrapOptional(ftEvent.amount, () => 'Unexpected nullish amount')).toString(10),
      currency: {
        decimals: ftMetadata.decimals,
        symbol: ftMetadata.symbol,
      },
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

function makeFtMintOperation(
  ftEvent: DbFtEvent,
  ftMetadata: FungibleTokenMetadata,
  baseTx: BaseTx,
  index: number
): RosettaOperation {
  const mint: RosettaOperation = {
    operation_identifier: { index: index },
    type: getAssetEventTypeString(ftEvent.asset_event_type_id),
    status: getTxStatus(baseTx.status),
    account: {
      address: unwrapOptional(ftEvent.recipient, () => 'Unexpected nullish sender_address'),
    },
    amount: {
      value: unwrapOptional(
        ftEvent.amount,
        () => 'Unexpected nullish token_transfer_amount'
      ).toString(10),
      currency: {
        decimals: ftMetadata.decimals,
        symbol: ftMetadata.symbol,
      },
    },
  };

  return mint;
}

function makeSenderOperation(tx: BaseTx, index: number): RosettaOperation {
  const sender: RosettaOperation = {
    operation_identifier: { index: index },
    type: 'token_transfer', //Sender operation should always be token_transfer,
    status: getTxStatus(tx.status),
    account: {
      address: unwrapOptional(tx.sender_address, () => 'Unexpected nullish sender_address'),
    },
    amount: {
      value: (
        0n -
        unwrapOptional(tx.token_transfer_amount, () => 'Unexpected nullish token_transfer_amount')
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

function makeFtSenderOperation(
  ftEvent: DbFtEvent,
  ftMetadata: FungibleTokenMetadata,
  tx: BaseTx,
  index: number
): RosettaOperation {
  const sender: RosettaOperation = {
    operation_identifier: { index: index },
    type: 'token_transfer',
    status: getTxStatus(tx.status),
    account: {
      address: unwrapOptional(ftEvent.sender, () => 'Unexpected nullish sender_address'),
    },
    amount: {
      value: (
        0n - unwrapOptional(ftEvent.amount, () => 'Unexpected nullish token_transfer_amount')
      ).toString(10),
      currency: {
        decimals: ftMetadata.decimals,
        symbol: ftMetadata.symbol,
      },
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
    type: 'token_transfer', //Receiver operation should always be token_transfer
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

function makeFtReceiverOperation(
  ftEvent: DbFtEvent,
  ftMetadata: FungibleTokenMetadata,
  tx: BaseTx,
  index: number
): RosettaOperation {
  const receiver: RosettaOperation = {
    operation_identifier: { index: index },
    related_operations: [{ index: index - 1 }],
    type: 'token_transfer',
    status: getTxStatus(tx.status),
    account: {
      address: unwrapOptional(
        ftEvent.recipient,
        () => 'Unexpected nullish token_transfer_recipient_address'
      ),
    },
    amount: {
      value: unwrapOptional(
        ftEvent.amount,
        () => 'Unexpected nullish token_transfer_amount'
      ).toString(10),
      currency: {
        decimals: ftMetadata.decimals,
        symbol: ftMetadata.symbol,
      },
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

async function makeCallContractOperation(
  tx: BaseTx,
  db: PgStore,
  index: number
): Promise<RosettaOperation> {
  const contractCallOp: RosettaOperation = {
    operation_identifier: { index: index },
    type: getTxTypeString(tx.type_id),
    status: getTxStatus(tx.status),
    account: {
      address: unwrapOptional(tx.sender_address, () => 'Unexpected nullish sender_address'),
    },
  };

  const parsed_tx = await getTxFromDataStore(db, { txId: tx.tx_id, includeUnanchored: false });
  if (!parsed_tx.found) {
    throw new Error('unexpected tx not found -- could not get contract from data store');
  }
  const stackContractCall = parsed_tx.result as ContractCallTransaction;
  contractCallOp.status = stackContractCall.tx_status;
  switch (tx.contract_call_function_name) {
    case 'stack-stx':
    case 'delegate-stx':
    case 'revoke-delegate-stx':
      if (
        stackContractCall.contract_call.contract_id == PoxContractIdentifier.testnet ||
        stackContractCall.contract_call.contract_id == PoxContractIdentifier.mainnet
      ) {
        parseStackingContractCall(contractCallOp, stackContractCall);
      } else {
        parseGenericContractCall(contractCallOp, tx);
      }
      break;
    default:
      parseGenericContractCall(contractCallOp, tx);
  }

  return contractCallOp;
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
  if (network === RosettaNetworks.mainnet) {
    btcNetwork = btc.networks.bitcoin;
  } else if (network === RosettaNetworks.testnet) {
    btcNetwork = btc.networks.testnet;
  } else {
    throw new Error(`[publicKeyToBitcoinAddress] Unexpected network '${network}'`);
  }

  const address = btc.payments.p2pkh({
    pubkey: publicKeyBuffer,
    network: btcNetwork,
  });
  return address.address;
}

export function getOptionsFromOperations(operations: RosettaOperation[]): RosettaOptions | null {
  const options: RosettaOptions = {};

  for (const operation of operations) {
    switch (operation.type) {
      case RosettaOperationType.Fee:
        options.fee = operation.amount?.value;
        break;
      case RosettaOperationType.TokenTransfer:
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
      case RosettaOperationType.StackStx:
        if (operation.amount && BigInt(operation.amount.value) > 0) {
          return null;
        }
        if (!operation.metadata || typeof operation.metadata.number_of_cycles !== 'number') {
          return null;
        }

        options.sender_address = operation.account?.address;
        options.type = operation.type;
        options.number_of_cycles = operation.metadata.number_of_cycles;
        options.amount = operation.amount?.value.replace('-', '');
        options.symbol = operation.amount?.currency.symbol;
        options.decimals = operation.amount?.currency.decimals;
        options.pox_addr = operation.metadata?.pox_addr as string;
        break;
      case RosettaOperationType.DelegateStx:
        if (operation.amount && BigInt(operation.amount.value) > 0) {
          return null;
        }
        if (!operation.metadata || typeof operation.metadata.delegate_to !== 'string') {
          return null;
        }
        options.sender_address = operation.account?.address;
        options.type = operation.type;
        options.delegate_to = operation.metadata?.delegate_to;
        options.amount = operation.amount?.value.replace('-', '');
        options.symbol = operation.amount?.currency.symbol;
        options.decimals = operation.amount?.currency.decimals;
        options.pox_addr = operation.metadata?.pox_addr as string;
        break;
      default:
        return null;
    }
  }

  return options;
}

function parseStackingContractCall(
  contractCallOp: RosettaOperation,
  stackContractCall: ContractCallTransaction
) {
  switch (stackContractCall.contract_call.function_name) {
    case 'stack-stx':
      {
        contractCallOp.type = RosettaOperationType.StackStx;
        contractCallOp.metadata = {
          ...parseStackStxArgs(stackContractCall),
        };
      }
      break;
    case 'delegate-stx':
      {
        contractCallOp.type = RosettaOperationType.DelegateStx;
        contractCallOp.metadata = {
          ...parseDelegateStxArgs(stackContractCall),
        };
      }
      break;
    case 'revoke-delegate-stx':
      {
        contractCallOp.type = RosettaOperationType.RevokeDelegateStx;
        contractCallOp.metadata = {
          ...parseRevokeDelegateStxArgs(stackContractCall),
        };
      }
      break;
  }
}

function parseGenericContractCall(operation: RosettaOperation, tx: BaseTx) {
  const metadata = parseContractCallMetadata(tx);
  operation.metadata = metadata.contract_call;
}

function parseRevokeDelegateStxArgs(
  contract: ContractCallTransaction
): RosettaRevokeDelegateContractArgs {
  const args = {} as RosettaRevokeDelegateContractArgs;

  if (contract.tx_result == undefined) {
    throw new Error(`Could not find field tx_result in contract call`);
  }

  // Call result
  const result = decodeClarityValue<ClarityValueOptionalBool>(contract.tx_result.hex);
  args.result =
    result.type_id === ClarityTypeID.OptionalSome && result.value.type_id === ClarityTypeID.BoolTrue
      ? 'true'
      : 'false';

  return args;
}

function parseDelegateStxArgs(contract: ContractCallTransaction): RosettaDelegateContractArgs {
  const args = {} as RosettaDelegateContractArgs;

  if (contract.tx_result == undefined) {
    throw new Error(`Could not find field tx_result in contract call`);
  }

  if (contract.contract_call.function_args == undefined) {
    throw new Error(`Could not find field function_args in contract call`);
  }

  // Locked amount
  let argName = 'amount-ustx';
  const amount_ustx = contract.contract_call.function_args?.find(a => a.name === argName);
  if (!amount_ustx) {
    throw new Error(`Could not find field name ${argName} in contract call`);
  }
  args.amount_ustx = amount_ustx.repr.replace(/[^\d.-]/g, '');

  // Delegatee address
  argName = 'delegate-to';
  const delegate_to = contract.contract_call.function_args?.find(a => a.name === argName);
  if (!delegate_to) {
    throw new Error(`Could not find field name ${argName} in contract call`);
  }
  args.delegate_to = delegate_to.repr.replace(/^'/, '');

  // Height on which the relation between delegator-delagatee will end  - OPTIONAL
  argName = 'until-burn-ht';
  const until_burn = contract.contract_call.function_args.find(a => a.name === argName);
  if (!until_burn) {
    throw new Error(`Could not find field name ${argName} in contract call`);
  }
  args.until_burn_height =
    until_burn.repr !== 'none' ? until_burn.repr.replace(/[^\d.-]/g, '') : 'none';

  // BTC reward address - OPTIONAL
  argName = 'pox-addr';
  const pox_address_raw = contract.contract_call.function_args?.find(a => a.name === argName);
  if (pox_address_raw == undefined || pox_address_raw.repr == 'none') {
    args.pox_addr = 'none';
  } else {
    const pox_address_cv = decodeClarityValue<ClarityValueOptional>(pox_address_raw.hex);
    if (pox_address_cv.type_id === ClarityTypeID.OptionalSome) {
      args.pox_addr = pox_address_cv.value.hex;
    }
  }

  // Call result
  const result = decodeClarityValue<ClarityValueOptionalBool>(contract.tx_result.hex);
  args.result =
    result.type_id === ClarityTypeID.OptionalSome && result.value.type_id === ClarityTypeID.BoolTrue
      ? 'true'
      : 'false';

  return args;
}

function parseStackStxArgs(contract: ContractCallTransaction): RosettaStakeContractArgs {
  const args = {} as RosettaStakeContractArgs;

  if (contract.tx_result == undefined) {
    throw new Error(`Could not find field tx_result in contract call`);
  }

  if (contract.contract_call.function_args == undefined) {
    throw new Error(`Could not find field function_args in contract call`);
  }

  // Locking period
  let argName = 'lock-period';
  const lock_period = contract.contract_call.function_args.find(a => a.name === argName);
  if (!lock_period) {
    throw new Error(`Could not find field name ${argName} in contract call`);
  }
  args.lock_period = lock_period.repr.replace(/[^\d.-]/g, '');

  // Locked amount
  argName = 'amount-ustx';
  const amount_ustx = contract.contract_call.function_args?.find(a => a.name === argName);
  if (!amount_ustx) {
    throw new Error(`Could not find field name ${argName} in contract call`);
  }
  args.amount_ustx = amount_ustx.repr.replace(/[^\d.-]/g, '');

  // Start burn height
  argName = 'start-burn-ht';
  const start_burn_height = contract.contract_call.function_args?.find(a => a.name === argName);
  if (!start_burn_height) {
    throw new Error(`Could not find field name ${argName} in contract call`);
  }
  args.start_burn_height = start_burn_height.repr.replace(/[^\d.-]/g, '');

  // Unlock burn height
  const temp = decodeClarityValue<
    ClarityValueResponse<
      ClarityValueTuple<{
        'unlock-burn-height': ClarityValueUInt;
        stacker: ClarityValuePrincipalStandard;
      }>
    >
  >(contract.tx_result.hex);
  if (temp.type_id === ClarityTypeID.ResponseOk) {
    const resultTuple = temp.value;
    if (resultTuple.data !== undefined) {
      args.unlock_burn_height = resultTuple.data['unlock-burn-height'].value;

      // Stacker address
      args.stacker_address = resultTuple.data.stacker.address;
    }
  }

  // BTC reward address
  argName = 'pox-addr';
  const pox_address_raw = contract.contract_call.function_args?.find(a => a.name === argName);
  if (!pox_address_raw) {
    throw new Error(`Could not find field name ${argName} in contract call`);
  }
  const pox_address_cv = decodeClarityValue(pox_address_raw.hex);
  if (pox_address_cv.type_id === ClarityTypeID.Tuple) {
    const chainID = parseInt(process.env['STACKS_CHAIN_ID'] as string);
    try {
      const addressCV = pox_address_cv as ClarityValueTuple<{
        version: ClarityValueBuffer;
        hashbytes: ClarityValueBuffer;
      }>;
      // TODO(perf): this should be able to use stacks-native-encoding stx-to-btc address fn
      args.pox_addr = poxAddressToBtcAddress(
        hexToBuffer(addressCV.data.version.buffer),
        hexToBuffer(addressCV.data.hashbytes.buffer),
        chainID == ChainID.Mainnet ? 'mainnet' : 'testnet'
      );
    } catch (error) {
      console.log(error);
      args.pox_addr = 'Invalid';
    }
  }

  return args;
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

function getStxCurrencyMetadata(): RosettaCurrency {
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
  const transaction = decodeTransaction(raw_tx);
  const txId = transaction.tx_id;

  const txSender = getTxSenderAddress(transaction);
  const sponsorAddress = getTxSponsorAddress(transaction);
  const fee = BigInt(transaction.auth.origin_condition.tx_fee);
  let amount: bigint | undefined = undefined;
  let recipientAddr = '';
  const sponsored = sponsorAddress ? true : false;

  let transactionType = DbTxTypeId.TokenTransfer;
  switch (transaction.payload.type_id) {
    case TxPayloadTypeID.TokenTransfer:
      amount = BigInt(transaction.payload.amount);
      recipientAddr = transaction.payload.recipient.address;
      if (transaction.payload.recipient.type_id === PrincipalTypeID.Contract) {
        recipientAddr += '.' + transaction.payload.recipient.contract_name;
      }
      transactionType = DbTxTypeId.TokenTransfer;
      break;
    case TxPayloadTypeID.SmartContract:
      transactionType = DbTxTypeId.SmartContract;
      break;
    case TxPayloadTypeID.ContractCall:
      transactionType = DbTxTypeId.ContractCall;
      break;
    case TxPayloadTypeID.Coinbase:
      transactionType = DbTxTypeId.Coinbase;
      break;
    case TxPayloadTypeID.PoisonMicroblock:
      transactionType = DbTxTypeId.PoisonMicroblock;
      break;
  }
  const dbtx: BaseTx = {
    token_transfer_recipient_address: recipientAddr,
    tx_id: txId,
    anchor_mode: 3,
    type_id: transactionType,
    status: '' as any,
    nonce: Number(transaction.auth.origin_condition.nonce),
    fee_rate: fee,
    sender_address: txSender,
    token_transfer_amount: amount,
    sponsored: sponsored,
    sponsor_address: sponsorAddress,
  };

  const txPayload = transaction.payload;
  if (txPayload.type_id === TxPayloadTypeID.TokenTransfer) {
    dbtx.token_transfer_memo = txPayload.memo_hex;
  }

  return dbtx;
}

export async function getValidatedFtMetadata(
  db: PgStore,
  assetIdentifier: string
): Promise<DbFungibleTokenMetadata | undefined> {
  if (!isFtMetadataEnabled()) {
    return;
  }
  const tokenContractId = assetIdentifier.split('::')[0];
  const ftMetadata = await db.getFtMetadata(tokenContractId);
  if (!ftMetadata.found) {
    if (tokenMetadataErrorMode() === TokenMetadataErrorMode.warning) {
      logger.warn(`FT metadata not found for token: ${assetIdentifier}`);
    } else {
      // TODO: Check if the metadata wasn't found because the contract ABI is not SIP-010
      // compliant or because there was a recoverable error that prevented the metadata
      // from being processed.
      throw new Error(`FT metadata not found for token: ${assetIdentifier}`);
    }
  }
  return ftMetadata.result;
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

function getStacksMainnetNetwork() {
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
  if (!transaction.auth.authType || !transaction.auth.spendingCondition?.nonce === undefined) {
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
