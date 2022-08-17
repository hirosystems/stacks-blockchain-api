export const BnsErrors = {
  NoSuchNamespace: {
    error: 'No such namespace',
  },
  InvalidPageNumber: {
    error: 'Invalid page',
  },
  NoSuchName: {
    error: 'No such name',
  },
  InvalidNameOrSubdomain: {
    error: 'Invalid name or subdomain',
  },
};

export const printTopic = 'print';
export const enum BnsContractIdentifier {
  mainnet = 'SP000000000000000000002Q6VF78.bns',
  testnet = 'ST000000000000000000002AMW42H.bns',
}
export const namespaceReadyFunction = 'namespace-ready';
export const nameFunctions = [
  'name-import',
  'name-revoke',
  'name-update',
  'name-transfer',
  'name-renewal',
  'name-register',
];

export const bnsBlockchain = 'stacks';
