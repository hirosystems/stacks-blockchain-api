import * as T from '@stacks/stacks-blockchain-api-types';
import { RosettaErrorNoDetails } from '@stacks/stacks-blockchain-api-types';
import { ChainID, getChainIDNetwork } from '../helpers';

export const RosettaNetworks = {
  testnet: 'testnet',
  mainnet: 'mainnet',
};

export const RosettaConstants = {
  blockchain: 'stacks',
  rosettaVersion: '1.4.6',
  symbol: 'STX',
  decimals: 6,
  StackedBalance: 'StackedBalance',
  SpendableBalance: 'SpendableBalance',
  VestingLockedBalance: 'VestingLockedBalance',
  VestingUnlockedBalance: 'VestingUnlockedBalance',
  VestingSchedule: 'VestingSchedule',
};

export function getRosettaNetworkName(chainId: ChainID): string {
  if (getChainIDNetwork(chainId) === 'mainnet') {
    return RosettaNetworks.mainnet;
  } else if (getChainIDNetwork(chainId) === 'testnet') {
    return RosettaNetworks.testnet;
  } else {
    throw new Error(`Cannot get rosetta network for unexpected chainID "${chainId}"`);
  }
}

export enum RosettaOperationType {
  TokenTransfer = 'token_transfer',
  ContractCall = 'contract_call',
  SmartContract = 'smart_contract',
  Coinbase = 'coinbase',
  PoisonMicroblock = 'poison_microblock',
  Fee = 'fee',
  Mint = 'mint',
  Burn = 'burn',
  MinerReward = 'miner_reward',
  StxLock = 'stx_lock',
  StxUnlock = 'stx_unlock',
  StackStx = 'stack_stx',
  DelegateStx = 'delegate_stx',
  RevokeDelegateStx = 'revoke_delegate_stx',
  // todo: add new pox-2 methods
}

type RosettaOperationTypeUnion = `${RosettaOperationType}`;

// Function that leverages typescript to ensure a given array contains all values from a type union
const arrayOfAllOpTypes = <T extends RosettaOperationTypeUnion[]>(
  array: T & ([RosettaOperationTypeUnion] extends [T[number]] ? unknown : 'Invalid')
) => array;

export const RosettaOperationTypes = arrayOfAllOpTypes([
  'token_transfer',
  'contract_call',
  'smart_contract',
  'coinbase',
  'poison_microblock',
  'fee',
  'mint',
  'burn',
  'miner_reward',
  'stx_lock',
  'stx_unlock',
  'stack_stx',
  'delegate_stx',
  'revoke_delegate_stx',
]) as RosettaOperationType[];

export const RosettaOperationStatuses = [
  {
    status: 'success',
    successful: true,
  },
  {
    status: 'pending',
    successful: true,
  },
  {
    status: 'abort_by_response',
    successful: false,
  },
  {
    status: 'abort_by_post_condition',
    successful: false,
  },
];

export enum RosettaErrorsTypes {
  invalidAccount,
  insufficientFunds,
  accountEmpty,
  invalidBlockIndex,
  blockNotFound,
  invalidBlockHash,
  transactionNotFound,
  invalidTransactionHash,
  invalidParams,
  invalidNetwork,
  invalidBlockchain,
  unknownError,
  emptyNetworkIdentifier,
  emptyAccountIdentifier,
  invalidBlockIdentifier,
  invalidTransactionIdentifier,
  emptyBlockchain,
  emptyNetwork,
  invalidCurveType,
  invalidPublicKey,
  invalidOperation,
  invalidFee,
  invalidCurrencySymbol,
  invalidCurrencyDecimals,
  invalidTransactionType,
  invalidSender,
  invalidRecipient,
  invalidTransactionString,
  transactionNotSigned,
  invalidAmount,
  invalidFees,
  emptyPublicKey,
  noSignatures,
  invalidSignature,
  signatureNotVerified,
  needOnePublicKey,
  needOnlyOneSignature,
  signatureTypeNotSupported,
  missingTransactionSize,
  stackingEligibityError,
  invalidSubAccount,
  missingSenderAddress,
  missingNonce,
  missingContractAddress,
  missingContractName,
}

export const RosettaErrors: Record<RosettaErrorsTypes, Readonly<RosettaErrorNoDetails>> = {
  [RosettaErrorsTypes.invalidAccount]: {
    code: 601,
    message: 'Invalid Account.',
    retriable: true,
  },
  [RosettaErrorsTypes.insufficientFunds]: {
    code: 602,
    message: 'Insufficient Funds.',
    retriable: false,
  },
  [RosettaErrorsTypes.accountEmpty]: {
    code: 603,
    message: 'Account is empty.',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidBlockIndex]: {
    code: 604,
    message: 'Invalid block index.',
    retriable: false,
  },
  [RosettaErrorsTypes.blockNotFound]: {
    code: 605,
    message: 'Block not found.',
    retriable: true,
  },
  [RosettaErrorsTypes.invalidBlockHash]: {
    code: 606,
    message: 'Invalid block hash.',
    retriable: true,
  },
  [RosettaErrorsTypes.transactionNotFound]: {
    code: 607,
    message: 'Transaction not found.',
    retriable: true,
  },
  [RosettaErrorsTypes.invalidTransactionHash]: {
    code: 608,
    message: 'Invalid transaction hash.',
    retriable: true,
  },
  [RosettaErrorsTypes.invalidParams]: {
    code: 609,
    message: 'Invalid params.',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidNetwork]: {
    code: 610,
    message: 'Invalid network.',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidBlockchain]: {
    code: 611,
    message: 'Invalid blockchain.',
    retriable: false,
  },
  [RosettaErrorsTypes.unknownError]: {
    code: 612,
    message: 'Unknown error.',
    retriable: false,
  },
  [RosettaErrorsTypes.emptyNetworkIdentifier]: {
    code: 613,
    message: 'Network identifier object is null.',
    retriable: false,
  },
  [RosettaErrorsTypes.emptyAccountIdentifier]: {
    code: 614,
    message: 'Account identifier object is null.',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidBlockIdentifier]: {
    code: 615,
    message: 'Block identifier is null.',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidTransactionIdentifier]: {
    code: 616,
    message: 'Transaction identifier is null.',
    retriable: true,
  },
  [RosettaErrorsTypes.emptyBlockchain]: {
    code: 617,
    message: 'Blockchain name is null.',
    retriable: false,
  },
  [RosettaErrorsTypes.emptyNetwork]: {
    code: 618,
    message: 'Network name is null.',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidCurveType]: {
    code: 619,
    message: 'Invalid curve type.',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidPublicKey]: {
    code: 620,
    message: 'invalid public key.',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidOperation]: {
    code: 621,
    message: 'Invalid operation',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidFee]: {
    code: 622,
    message: 'Invalid fee',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidCurrencySymbol]: {
    code: 623,
    message: 'Invalid symbol',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidCurrencyDecimals]: {
    code: 624,
    message: 'Invalid currency decimals',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidTransactionType]: {
    code: 625,
    message: 'Invalid transaction type',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidSender]: {
    code: 626,
    message: 'Invalid sender address',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidRecipient]: {
    code: 627,
    message: 'Invalid recipient address',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidTransactionString]: {
    code: 628,
    message: 'Invalid transaction string',
    retriable: false,
  },
  [RosettaErrorsTypes.transactionNotSigned]: {
    code: 629,
    message: 'Transaction not signed',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidAmount]: {
    code: 630,
    message: 'Amount not available',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidFees]: {
    code: 631,
    message: 'Fees not available',
    retriable: false,
  },
  [RosettaErrorsTypes.emptyPublicKey]: {
    code: 632,
    message: 'Public key not available',
    retriable: false,
  },
  [RosettaErrorsTypes.noSignatures]: {
    code: 633,
    message: 'no signature found',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidSignature]: {
    code: 634,
    message: 'Invalid Signature',
    retriable: false,
  },
  [RosettaErrorsTypes.signatureNotVerified]: {
    code: 635,
    message: 'Signature(s) not verified with this public key(s)',
    retriable: false,
  },
  [RosettaErrorsTypes.needOnePublicKey]: {
    code: 636,
    message: 'Need one public key for single signature',
    retriable: false,
  },
  [RosettaErrorsTypes.needOnlyOneSignature]: {
    code: 637,
    message: 'Need only one signature',
    retriable: false,
  },
  [RosettaErrorsTypes.signatureTypeNotSupported]: {
    code: 638,
    message: 'Signature type not supported.',
    retriable: false,
  },
  [RosettaErrorsTypes.missingTransactionSize]: {
    code: 639,
    message: 'Transaction size required to calculate total fee.',
    retriable: false,
  },
  [RosettaErrorsTypes.stackingEligibityError]: {
    code: 640,
    message: 'Account not eligible for stacking.',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidSubAccount]: {
    code: 641,
    message: 'Invalid sub-account',
    retriable: false,
  },
  [RosettaErrorsTypes.missingSenderAddress]: {
    code: 642,
    message: 'Missing sender address',
    retriable: false,
  },
  [RosettaErrorsTypes.missingNonce]: {
    code: 643,
    message: 'Missing transaction nonce',
    retriable: false,
  },
  [RosettaErrorsTypes.missingContractAddress]: {
    code: 644,
    message: 'Missing contract address',
    retriable: false,
  },
  [RosettaErrorsTypes.missingContractName]: {
    code: 645,
    message: 'Missing contract name',
    retriable: false,
  },
};

// All request types, used to validate input.
export type RosettaRequestType =
  | T.RosettaAccountBalanceRequest
  | T.RosettaBlockRequest
  | T.RosettaBlockTransactionRequest
  | T.RosettaMempoolTransactionRequest
  | T.RosettaNetworkListRequest
  | T.RosettaOptionsRequest
  | T.RosettaStatusRequest;

export interface SchemaFiles {
  request: string;
  response: string;
}

export const RosettaSchemas: Record<string, SchemaFiles> = {
  '/rosetta/v1/network/list': {
    request:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-network-list-request.schema.json',
    response:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-network-list-response.schema.json',
  },
  '/rosetta/v1/network/options': {
    request:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-network-options-request.schema.json',
    response:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-network-options-response.schema.json',
  },
  '/rosetta/v1/network/status': {
    request:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-network-status-request.schema.json',
    response:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-network-status-response.schema.json',
  },
  '/rosetta/v1/block': {
    request: '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-block-request.schema.json',
    response: '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-block-response.schema.json',
  },
  '/rosetta/v1/block/transaction': {
    request:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-block-transaction-request.schema.json',
    response:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-block-transaction-response.schema.json',
  },
  '/rosetta/v1/mempool': {
    request: '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-mempool-request.schema.json',
    response:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-mempool-response.schema.json',
  },
  '/rosetta/v1/mempool/transaction': {
    request:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-mempool-transaction-request.schema.json',
    response:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-mempool-transaction-response.schema.json',
  },
  '/rosetta/v1/account/balance': {
    request:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-account-balance-request.schema.json',
    response:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-account-response.schema.json',
  },
  '/rosetta/v1/construction/derive': {
    request:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-construction-derive-request.schema.json',
    response:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-construction-derive-response.schema.json',
  },
  '/rosetta/v1/construction/preprocess': {
    request:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-construction-preprocess-request.schema.json',
    response:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-construction-preprocess-response.schema.json',
  },
  '/rosetta/v1/construction/metadata': {
    request:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-construction-metadata-request.schema.json',
    response:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-construction-metadata-response.schema.json',
  },
  '/rosetta/v1/construction/hash': {
    request:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-construction-hash-request.schema.json',
    response:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-construction-hash-response.schema.json',
  },
  '/rosetta/v1/construction/parse': {
    request:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-construction-parse-request.schema.json',
    response:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-construction-parse-response.schema.json',
  },
  '/rosetta/v1/construction/submit': {
    request:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-construction-submit-request.schema.json',
    response:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-construction-submit-response.schema.json',
  },
  '/rosetta/v1/construction/payloads': {
    request:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-construction-payloads-request.schema.json',
    response:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-construction-payloads-response.schema.json',
  },
  '/rosetta/v1/construction/combine': {
    request:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-construction-combine-request.schema.json',
    response:
      '@stacks/stacks-blockchain-api-types/api/rosetta/rosetta-construction-combine-response.schema.json',
  },
};

export const PoxContractIdentifier = {
  pox1: {
    mainnet: 'SP000000000000000000002Q6VF78.pox',
    testnet: 'ST000000000000000000002AMW42H.pox',
  },
  pox2: {
    mainnet: 'SP000000000000000000002Q6VF78.pox-2',
    testnet: 'ST000000000000000000002AMW42H.pox-2',
  },
  pox3: {
    mainnet: 'SP000000000000000000002Q6VF78.pox-3',
    testnet: 'ST000000000000000000002AMW42H.pox-3',
  },
} as const;
