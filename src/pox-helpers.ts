/** Names for synthetic events generated for the pox-2, pox-3, and pox-4 contracts */
export enum SyntheticPoxEventName {
  HandleUnlock = 'handle-unlock',
  StackStx = 'stack-stx',
  StackIncrease = 'stack-increase',
  StackExtend = 'stack-extend',
  DelegateStx = 'delegate-stx',
  DelegateStackStx = 'delegate-stack-stx',
  DelegateStackIncrease = 'delegate-stack-increase',
  DelegateStackExtend = 'delegate-stack-extend',
  StackAggregationCommit = 'stack-aggregation-commit',
  StackAggregationCommitIndexed = 'stack-aggregation-commit-indexed',
  StackAggregationIncrease = 'stack-aggregation-increase',
  RevokeDelegateStx = 'revoke-delegate-stx', // Only guaranteed to be present in pox-4
}

const BOOT_ADDR_MAINNET = 'SP000000000000000000002Q6VF78';
const BOOT_ADDR_TESTNET = 'ST000000000000000000002AMW42H';

export const POX_1_CONTRACT_NAME = 'pox';
export const POX_2_CONTRACT_NAME = 'pox-2';
export const POX_3_CONTRACT_NAME = 'pox-3';
export const POX_4_CONTRACT_NAME = 'pox-4';

export const PoxContractNames = [
  POX_1_CONTRACT_NAME,
  POX_2_CONTRACT_NAME,
  POX_3_CONTRACT_NAME,
  POX_4_CONTRACT_NAME,
] as const;

export const PoxContractIdentifier = {
  pox1: {
    mainnet: `${BOOT_ADDR_MAINNET}.${POX_1_CONTRACT_NAME}`,
    testnet: `${BOOT_ADDR_TESTNET}.${POX_1_CONTRACT_NAME}`,
  },
  pox2: {
    mainnet: `${BOOT_ADDR_MAINNET}.${POX_2_CONTRACT_NAME}`,
    testnet: `${BOOT_ADDR_TESTNET}.${POX_2_CONTRACT_NAME}`,
  },
  pox3: {
    mainnet: `${BOOT_ADDR_MAINNET}.${POX_3_CONTRACT_NAME}`,
    testnet: `${BOOT_ADDR_TESTNET}.${POX_3_CONTRACT_NAME}`,
  },
  pox4: {
    mainnet: `${BOOT_ADDR_MAINNET}.${POX_4_CONTRACT_NAME}`,
    testnet: `${BOOT_ADDR_TESTNET}.${POX_4_CONTRACT_NAME}`,
  },
} as const;

export const PoxContractIdentifiers = Object.values(PoxContractIdentifier).flatMap(
  Object.values
) as string[];
