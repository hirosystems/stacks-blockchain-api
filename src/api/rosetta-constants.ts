export const RosettaConstants = {
  blockchain: 'stacks',
  network: 'testnet',
  rosettaVersion: '1.4.2',
  symbol: 'STX',
  decimals: 6,
};

export const RosettaOperationTypes = [
  'token_transfer',
  'contract_call',
  'smart_contract',
  'coinbase',
  'poison_microblock',
  'fee',
];

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

// All possible errors
export interface RosettaError {
  code: number;
  message: string;
  retriable: boolean;
  details?: Record<string, string>;
}

export const RosettaErrors: Record<string, RosettaError> = {
  invalidAccount: {
    code: 601,
    message: 'Invalid Account',
    retriable: true,
  },
  insufficientFunds: {
    code: 602,
    message: 'Insufficient Funds',
    retriable: true,
  },
  accountEmpty: {
    code: 603,
    message: 'Account is empty',
    retriable: true,
  },
  invalidBlockIndex: {
    code: 604,
    message: 'Invalid block index',
    retriable: true,
  },
  blockNotFound: {
    code: 605,
    message: 'Block not found',
    retriable: true,
  },
  invalidBlockHash: {
    code: 606,
    message: 'Invalid block hash',
    retriable: true,
  },
  transactionNotFound: {
    code: 607,
    message: 'Transaction not found',
    retriable: true,
  },
  invalidTransactionHash: {
    code: 608,
    message: 'Invalid transaction hash',
    retriable: true,
  },
  invalidParams: {
    code: 609,
    message: 'invalid params',
    retriable: true,
  },
  invalidNetwork: {
    code: 610,
    message: 'Invalid network.',
    retriable: true,
  },
  invalidBlockchain: {
    code: 611,
    message: 'Invalid blockchain.',
    retriable: true,
  },
  unknownError: {
    code: 612,
    message: 'Unknown error.',
    retriable: false,
  },
  emptyNetworkIdentifier: {
    code: 613,
    message: 'Network identifier object is null',
    retriable: true,
  },
  emptyAccountIdentifier: {
    code: 614,
    message: 'Account identifier object is null',
    retriable: true,
  },
  invalidBlockIdentifier: {
    code: 615,
    message: 'Block identifier is null',
    retriable: true,
  },
  emptyBlockchain: {
    code: 616,
    message: 'Blockchain name is null',
    retriable: true,
  },
  emptyNetwork: {
    code: 617,
    message: 'Network name is null',
    retriable: true,
  },
};
