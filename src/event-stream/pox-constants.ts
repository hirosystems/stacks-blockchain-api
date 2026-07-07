const BOOT_ADDR_MAINNET = 'SP000000000000000000002Q6VF78';
const BOOT_ADDR_TESTNET = 'ST000000000000000000002AMW42H';

const POX_1_CONTRACT_NAME = 'pox';
export const POX_2_CONTRACT_NAME = 'pox-2';
export const POX_3_CONTRACT_NAME = 'pox-3';
export const POX_4_CONTRACT_NAME = 'pox-4';
export const POX_5_CONTRACT_NAME = 'pox-5';

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
  pox5: {
    mainnet: `${BOOT_ADDR_MAINNET}.${POX_5_CONTRACT_NAME}`,
    testnet: `${BOOT_ADDR_TESTNET}.${POX_5_CONTRACT_NAME}`,
  },
} as const;

export const PoxContractIdentifiers = Object.values(PoxContractIdentifier).flatMap(
  Object.values
) as string[];
