import { SwaggerOptions } from '@fastify/swagger';
import { isProdEnv, logger, SERVER_VERSION } from '@stacks/api-toolkit';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const openApiVersion = (() => {
  if (isProdEnv) return SERVER_VERSION.tag;
  try {
    const packageJsonPath = resolve(__dirname, '../../../package.json');
    return (JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version: string }).version;
  } catch (error) {
    logger.error(error, 'Error reading version from package.json');
    return SERVER_VERSION.tag;
  }
})();

export const OpenApiSchemaOptions: SwaggerOptions = {
  openapi: {
    info: {
      title: 'Stacks Blockchain API',
      description: `Welcome to the API reference overview for the [Stacks Blockchain API](https://docs.hiro.so/stacks-blockchain-api). [Download Postman collection](https://hirosystems.github.io/stacks-blockchain-api/collection.json).`,
      version: openApiVersion,
    },
    externalDocs: {
      url: 'https://github.com/hirosystems/stacks-blockchain-api',
      description: 'Source Repository',
    },
    servers: [
      {
        url: 'https://api.hiro.so/',
        description: 'mainnet',
      },
    ],
    tags: [
      {
        name: 'Accounts',
        description: 'Read-only endpoints to obtain Stacks account details',
        externalDocs: {
          description: 'Stacks Documentation - Accounts',
          url: 'https://docs.stacks.co/network-fundamentals/accounts',
        },
      },
      { name: 'Blocks', description: 'Read-only endpoints to obtain Stacks block details' },
      { name: 'Burn Blocks', description: 'Read-only endpoints to obtain burn block details' },
      {
        name: 'Faucets',
        description: 'Endpoints to request STX or BTC tokens (not possible on Mainnet)',
      },
      { name: 'Fees', description: 'Read-only endpoints to obtain fee details' },
      {
        name: 'Info',
        description:
          'Read-only endpoints to obtain network, Proof-of-Transfer, Stacking, STX token, and node information',
      },
      {
        name: 'Microblocks',
        description: 'Read-only endpoints to obtain microblocks details',
        externalDocs: {
          description: 'Stacks Documentation - Microblocks',
          url: 'https://docs.stacks.co/understand-stacks/microblocks',
        },
      },
      {
        name: 'Names',
        description: 'Read-only endpoints realted to the Blockchain Naming System on Stacks',
        externalDocs: {
          description: 'Stacks Documentation - Blockchain Naming System',
          url: 'https://docs.stacks.co/network-fundamentals/bitcoin-name-system',
        },
      },
      {
        name: 'Non-Fungible Tokens',
        description: 'Read-only endpoints to obtain non-fungible token details',
        externalDocs: {
          description: 'Stacks Documentation - Tokens',
          url: 'https://docs.stacks.co/build/create-tokens',
        },
      },
      {
        name: 'Search',
        description:
          'Read-only endpoints to search for accounts, blocks, smart contracts, and transactions',
      },
      {
        name: 'Smart Contracts',
        description: 'Read-only endpoints to obtain Clarity smart contract details',
        externalDocs: {
          description: 'Stacks Documentation - Clarity Smart Contracts',
          url: 'https://docs.stacks.co/clarity/overview',
        },
      },
      {
        name: 'Stacking Rewards',
        description: 'Read-only endpoints to obtain Stacking reward details',
        externalDocs: {
          description: 'Stacks Documentation - Stacking',
          url: 'https://docs.stacks.co/block-production/stacking',
        },
      },
      {
        name: 'Transactions',
        description:
          'Endpoints to obtain transaction details and to broadcast transactions to the network',
        externalDocs: {
          description: 'Hiro Documentation - Transactions',
          url: 'https://docs.hiro.so/get-started/transactions',
        },
      },
      { name: 'Mempool', description: 'Endpoints to obtain Mempool information' },
      {
        name: 'Proof of Transfer',
        description: 'Endpoints to get information about the Proof of Transfer consensus mechanism',
      },
    ],
  },
};
