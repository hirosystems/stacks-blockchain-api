import {
  makeRandomPrivKey,
  getAddressFromPrivateKey,
  TransactionVersion,
  ReadOnlyFunctionOptions,
  bufferCVFromString,
  callReadOnlyFunction,
  ClarityType,
  standardPrincipalCV,
  uintCV,
} from '@stacks/transactions';
import { getChainIDNetwork, isValidPrincipal } from '../../../helpers';
import { GetStacksNetwork } from '../../../event-stream/bns/bns-helpers';
import { logger } from '../../../logger';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { getBnsV2ContractID } from 'src/event-stream/bnsV2/bnsV2-helpers';

export const BnsV2ReadRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/renewal-height/:id',
    {
      schema: {
        operationId: 'get_renewal_height',
        summary: 'Get Renewal Height',
        description: `Retrieves the renewal height for a given name ID.`,
        tags: ['Names'],
        params: Type.Object({
          id: Type.String({ description: 'The ID of the name', examples: ['123'] }),
        }),
        response: {
          200: Type.Object(
            { renewal_height: Type.Union([Type.Number(), Type.Null()]) },
            {
              title: 'BnsGetRenewalHeightResponse',
              description: 'Fetch renewal height for a name ID.',
            }
          ),
          400: Type.Object({ error: Type.String() }, { title: 'BnsError', description: 'Error' }),
        },
      },
    },
    async (req, reply) => {
      const id = req.params.id;

      const randomPrivKey = makeRandomPrivKey();
      const address = getAddressFromPrivateKey(
        randomPrivKey.data,
        getChainIDNetwork(fastify.chainId) === 'mainnet'
          ? TransactionVersion.Mainnet
          : TransactionVersion.Testnet
      );

      const bnsV2ContractIdentifier = getBnsV2ContractID(fastify.chainId);
      if (!bnsV2ContractIdentifier || !isValidPrincipal(bnsV2ContractIdentifier)) {
        logger.error('BNS contract ID not properly configured');
        throw new Error('BNS contract ID not properly configured');
      }

      const [bnsV2ContractAddress, bnsV2ContractName] = bnsV2ContractIdentifier.split('.');

      const txOptions: ReadOnlyFunctionOptions = {
        senderAddress: address,
        contractAddress: bnsV2ContractAddress,
        contractName: bnsV2ContractName,
        functionName: 'get-renewal-height',
        functionArgs: [uintCV(id)],
        network: GetStacksNetwork(fastify.chainId),
      };

      try {
        const result = await callReadOnlyFunction(txOptions);

        if (result.type === ClarityType.ResponseOk && result.value.type === ClarityType.UInt) {
          await reply.send({ renewal_height: Number(result.value.value) });
        } else if (result.type === ClarityType.ResponseErr) {
          await reply.status(400).send({ error: 'Name not found or other contract error' });
        } else {
          throw new Error('Unexpected response from contract');
        }
      } catch (error) {
        logger.error(error, `Error calling get-renewal-height for ID ${id}`);
        await reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  fastify.get(
    '/can-resolve-name/:namespace/:name',
    {
      schema: {
        operationId: 'can_resolve_name',
        summary: 'Can Resolve Name',
        description: `Checks if a given name can be resolved and returns its renewal height and owner.`,
        tags: ['Names'],
        params: Type.Object({
          namespace: Type.String({ description: 'The namespace of the name', examples: ['id'] }),
          name: Type.String({ description: 'The name to check', examples: ['satoshi'] }),
        }),
        response: {
          200: Type.Object(
            {
              can_resolve: Type.Boolean(),
              renewal: Type.Number(),
              owner: Type.String(),
            },
            {
              title: 'BnsCanResolveNameResponse',
              description: 'Result of checking if a name can be resolved.',
            }
          ),
          400: Type.Object({ error: Type.String() }, { title: 'BnsError', description: 'Error' }),
        },
      },
    },
    async (req, reply) => {
      const { namespace, name } = req.params;

      const randomPrivKey = makeRandomPrivKey();
      const address = getAddressFromPrivateKey(
        randomPrivKey.data,
        getChainIDNetwork(fastify.chainId) === 'mainnet'
          ? TransactionVersion.Mainnet
          : TransactionVersion.Testnet
      );

      const bnsV2ContractIdentifier = getBnsV2ContractID(fastify.chainId);
      if (!bnsV2ContractIdentifier || !isValidPrincipal(bnsV2ContractIdentifier)) {
        logger.error('BNS contract ID not properly configured');
        throw new Error('BNS contract ID not properly configured');
      }

      const [bnsV2ContractAddress, bnsV2ContractName] = bnsV2ContractIdentifier.split('.');

      const txOptions: ReadOnlyFunctionOptions = {
        senderAddress: address,
        contractAddress: bnsV2ContractAddress,
        contractName: bnsV2ContractName,
        functionName: 'can-resolve-name',
        functionArgs: [bufferCVFromString(namespace), bufferCVFromString(name)],
        network: GetStacksNetwork(fastify.chainId),
      };

      try {
        const result = await callReadOnlyFunction(txOptions);

        if (result.type === ClarityType.ResponseOk && result.value.type === ClarityType.Tuple) {
          const { renewal, owner } = result.value.data;
          await reply.send({
            can_resolve: true,
            renewal: renewal.type === ClarityType.UInt ? Number(renewal.value) : 0,
            owner:
              owner.type === ClarityType.PrincipalStandard ||
              owner.type === ClarityType.PrincipalContract
                ? owner.address.toString()
                : owner.type === ClarityType.StringASCII
                ? owner.data
                : 'Unknown',
          });
        } else if (result.type === ClarityType.ResponseErr) {
          await reply.status(400).send({ error: 'Name not found or other contract error' });
        } else {
          throw new Error('Unexpected response from contract');
        }
      } catch (error) {
        logger.error(error, `Error calling can-resolve-name for ${namespace}.${name}`);
        await reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  fastify.get(
    '/owner/:id',
    {
      schema: {
        operationId: 'get_owner',
        summary: 'Get Token Owner',
        description: `Retrieves the owner of a token for a given token ID.`,
        tags: ['Names'],
        params: Type.Object({
          id: Type.String({ description: 'The ID of the token', examples: ['123'] }),
        }),
        response: {
          200: Type.Object(
            { owner: Type.Union([Type.String(), Type.Null()]) },
            {
              title: 'BnsGetOwnerResponse',
              description: 'Fetch owner for a given token ID.',
            }
          ),
          400: Type.Object({ error: Type.String() }, { title: 'BnsError', description: 'Error' }),
        },
      },
    },
    async (req, reply) => {
      const id = req.params.id;

      const randomPrivKey = makeRandomPrivKey();
      const address = getAddressFromPrivateKey(
        randomPrivKey.data,
        getChainIDNetwork(fastify.chainId) === 'mainnet'
          ? TransactionVersion.Mainnet
          : TransactionVersion.Testnet
      );

      const bnsV2ContractIdentifier = getBnsV2ContractID(fastify.chainId);
      if (!bnsV2ContractIdentifier || !isValidPrincipal(bnsV2ContractIdentifier)) {
        logger.error('BNS contract ID not properly configured');
        throw new Error('BNS contract ID not properly configured');
      }

      const [bnsV2ContractAddress, bnsV2ContractName] = bnsV2ContractIdentifier.split('.');

      const txOptions: ReadOnlyFunctionOptions = {
        senderAddress: address,
        contractAddress: bnsV2ContractAddress,
        contractName: bnsV2ContractName,
        functionName: 'get-owner',
        functionArgs: [uintCV(id)],
        network: GetStacksNetwork(fastify.chainId),
      };

      try {
        const result = await callReadOnlyFunction(txOptions);

        if (result.type === ClarityType.ResponseOk) {
          if (result.value.type === ClarityType.OptionalSome) {
            const owner = result.value.value;
            if (
              owner.type === ClarityType.PrincipalStandard ||
              owner.type === ClarityType.PrincipalContract
            ) {
              await reply.send({ owner: owner.address.toString() });
            } else {
              throw new Error('Unexpected owner type');
            }
          } else {
            await reply.send({ owner: null });
          }
        } else if (result.type === ClarityType.ResponseErr) {
          await reply.status(400).send({ error: 'Token not found or other contract error' });
        } else {
          throw new Error('Unexpected response from contract');
        }
      } catch (error) {
        logger.error(error, `Error calling get-owner for ID ${id}`);
        await reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
  fastify.get(
    '/can-namespace-be-registered/:namespace',
    {
      schema: {
        operationId: 'can_namespace_be_registered',
        summary: 'Can Namespace Be Registered',
        description: `Checks if a given namespace can be registered.`,
        tags: ['Names'],
        params: Type.Object({
          namespace: Type.String({ description: 'The namespace to check', examples: ['app'] }),
        }),
        response: {
          200: Type.Object(
            {
              can_be_registered: Type.Boolean(),
            },
            {
              title: 'BnsCanNamespaceBeRegisteredResponse',
              description: 'Result of checking if a namespace can be registered.',
            }
          ),
          400: Type.Object({ error: Type.String() }, { title: 'BnsError', description: 'Error' }),
        },
      },
    },
    async (req, reply) => {
      const { namespace } = req.params;

      const randomPrivKey = makeRandomPrivKey();
      const address = getAddressFromPrivateKey(
        randomPrivKey.data,
        getChainIDNetwork(fastify.chainId) === 'mainnet'
          ? TransactionVersion.Mainnet
          : TransactionVersion.Testnet
      );

      const bnsV2ContractIdentifier = getBnsV2ContractID(fastify.chainId);
      if (!bnsV2ContractIdentifier || !isValidPrincipal(bnsV2ContractIdentifier)) {
        logger.error('BNS contract ID not properly configured');
        throw new Error('BNS contract ID not properly configured');
      }

      const [bnsV2ContractAddress, bnsV2ContractName] = bnsV2ContractIdentifier.split('.');

      const txOptions: ReadOnlyFunctionOptions = {
        senderAddress: address,
        contractAddress: bnsV2ContractAddress,
        contractName: bnsV2ContractName,
        functionName: 'can-namespace-be-registered',
        functionArgs: [bufferCVFromString(namespace)],
        network: GetStacksNetwork(fastify.chainId),
      };

      try {
        const result = await callReadOnlyFunction(txOptions);

        if (result.type === ClarityType.ResponseOk && result.value.type === ClarityType.BoolTrue) {
          await reply.send({ can_be_registered: true });
        } else if (
          result.type === ClarityType.ResponseOk &&
          result.value.type === ClarityType.BoolFalse
        ) {
          await reply.send({ can_be_registered: false });
        } else if (result.type === ClarityType.ResponseErr) {
          await reply.status(400).send({ error: 'Namespace check failed or other contract error' });
        } else {
          throw new Error('Unexpected response from contract');
        }
      } catch (error) {
        logger.error(error, `Error calling can-namespace-be-registered for ${namespace}`);
        await reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
  fastify.get(
    '/get-bns-info/:namespace/:name',
    {
      schema: {
        operationId: 'get_bns_info',
        summary: 'Get BNS Info',
        description: `Retrieves the properties of a BNS name.`,
        tags: ['Names'],
        params: Type.Object({
          namespace: Type.String({ description: 'The namespace of the name', examples: ['id'] }),
          name: Type.String({ description: 'The name to get info for', examples: ['satoshi'] }),
        }),
        response: {
          200: Type.Object(
            {
              registered_at: Type.Union([Type.Number(), Type.Null()]),
              imported_at: Type.Union([Type.Number(), Type.Null()]),
              hashed_salted_fqn_preorder: Type.Union([Type.String(), Type.Null()]),
              preordered_by: Type.Union([Type.String(), Type.Null()]),
              renewal_height: Type.Number(),
              stx_burn: Type.String(),
              owner: Type.String(),
            },
            {
              title: 'BnsGetBnsInfoResponse',
              description: 'Properties of a BNS name.',
            }
          ),
          400: Type.Object({ error: Type.String() }, { title: 'BnsError', description: 'Error' }),
        },
      },
    },
    async (req, reply) => {
      const { namespace, name } = req.params;

      const randomPrivKey = makeRandomPrivKey();
      const address = getAddressFromPrivateKey(
        randomPrivKey.data,
        getChainIDNetwork(fastify.chainId) === 'mainnet'
          ? TransactionVersion.Mainnet
          : TransactionVersion.Testnet
      );

      const bnsV2ContractIdentifier = getBnsV2ContractID(fastify.chainId);
      if (!bnsV2ContractIdentifier || !isValidPrincipal(bnsV2ContractIdentifier)) {
        logger.error('BNS contract ID not properly configured');
        throw new Error('BNS contract ID not properly configured');
      }

      const [bnsV2ContractAddress, bnsV2ContractName] = bnsV2ContractIdentifier.split('.');

      const txOptions: ReadOnlyFunctionOptions = {
        senderAddress: address,
        contractAddress: bnsV2ContractAddress,
        contractName: bnsV2ContractName,
        functionName: 'get-bns-info',
        functionArgs: [bufferCVFromString(name), bufferCVFromString(namespace)],
        network: GetStacksNetwork(fastify.chainId),
      };

      try {
        const result = await callReadOnlyFunction(txOptions);

        if (result.type === ClarityType.OptionalSome && result.value.type === ClarityType.Tuple) {
          const {
            'registered-at': registeredAt,
            'imported-at': importedAt,
            'hashed-salted-fqn-preorder': hashedSaltedFqnPreorder,
            'preordered-by': preorderedBy,
            'renewal-height': renewalHeight,
            'stx-burn': stxBurn,
            owner,
          } = result.value.data;

          await reply.send({
            registered_at:
              registeredAt.type === ClarityType.OptionalSome ? Number(registeredAt.value) : null,
            imported_at:
              importedAt.type === ClarityType.OptionalSome ? Number(importedAt.value) : null,
            hashed_salted_fqn_preorder:
              hashedSaltedFqnPreorder.type === ClarityType.OptionalSome
                ? hashedSaltedFqnPreorder.value.toString()
                : null,
            preordered_by:
              preorderedBy.type === ClarityType.OptionalSome ? preorderedBy.value.toString() : null,
            renewal_height: Number(renewalHeight),
            stx_burn: stxBurn.toString(),
            owner: owner.toString(),
          });
        } else if (result.type === ClarityType.OptionalNone) {
          await reply.status(404).send({ error: 'BNS name not found' });
        } else {
          throw new Error('Unexpected response from contract');
        }
      } catch (error) {
        logger.error(error, `Error calling get-bns-info for ${namespace}.${name}`);
        await reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  fastify.get(
    '/get-id-from-bns/:namespace/:name',
    {
      schema: {
        operationId: 'get_id_from_bns',
        summary: 'Get ID from BNS',
        description: `Retrieves the unique ID of a BNS name.`,
        tags: ['Names'],
        params: Type.Object({
          namespace: Type.String({ description: 'The namespace of the name', examples: ['id'] }),
          name: Type.String({ description: 'The name to get the ID for', examples: ['satoshi'] }),
        }),
        response: {
          200: Type.Object(
            {
              id: Type.Union([Type.Number(), Type.Null()]),
            },
            {
              title: 'BnsGetIdFromBnsResponse',
              description: 'Unique ID of a BNS name.',
            }
          ),
          400: Type.Object({ error: Type.String() }, { title: 'BnsError', description: 'Error' }),
        },
      },
    },
    async (req, reply) => {
      const { namespace, name } = req.params;

      const randomPrivKey = makeRandomPrivKey();
      const address = getAddressFromPrivateKey(
        randomPrivKey.data,
        getChainIDNetwork(fastify.chainId) === 'mainnet'
          ? TransactionVersion.Mainnet
          : TransactionVersion.Testnet
      );

      const bnsV2ContractIdentifier = getBnsV2ContractID(fastify.chainId);
      if (!bnsV2ContractIdentifier || !isValidPrincipal(bnsV2ContractIdentifier)) {
        logger.error('BNS contract ID not properly configured');
        throw new Error('BNS contract ID not properly configured');
      }

      const [bnsV2ContractAddress, bnsV2ContractName] = bnsV2ContractIdentifier.split('.');

      const txOptions: ReadOnlyFunctionOptions = {
        senderAddress: address,
        contractAddress: bnsV2ContractAddress,
        contractName: bnsV2ContractName,
        functionName: 'get-id-from-bns',
        functionArgs: [bufferCVFromString(name), bufferCVFromString(namespace)],
        network: GetStacksNetwork(fastify.chainId),
      };

      try {
        const result = await callReadOnlyFunction(txOptions);

        if (result.type === ClarityType.OptionalSome && result.value.type === ClarityType.UInt) {
          await reply.send({ id: Number(result.value.value) });
        } else if (result.type === ClarityType.OptionalNone) {
          await reply.send({ id: null });
        } else {
          throw new Error('Unexpected response from contract');
        }
      } catch (error) {
        logger.error(error, `Error calling get-id-from-bns for ${namespace}.${name}`);
        await reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  fastify.get(
    '/get-bns-from-id/:id',
    {
      schema: {
        operationId: 'get_bns_from_id',
        summary: 'Get BNS from ID',
        description: `Retrieves the BNS name and namespace given a unique ID.`,
        tags: ['Names'],
        params: Type.Object({
          id: Type.String({ description: 'The unique ID of the BNS name', examples: ['123'] }),
        }),
        response: {
          200: Type.Object(
            {
              name: Type.Union([Type.String(), Type.Null()]),
              namespace: Type.Union([Type.String(), Type.Null()]),
            },
            {
              title: 'BnsGetBnsFromIdResponse',
              description: 'BNS name and namespace for a given ID.',
            }
          ),
          400: Type.Object({ error: Type.String() }, { title: 'BnsError', description: 'Error' }),
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params;

      const randomPrivKey = makeRandomPrivKey();
      const address = getAddressFromPrivateKey(
        randomPrivKey.data,
        getChainIDNetwork(fastify.chainId) === 'mainnet'
          ? TransactionVersion.Mainnet
          : TransactionVersion.Testnet
      );

      const bnsV2ContractIdentifier = getBnsV2ContractID(fastify.chainId);
      if (!bnsV2ContractIdentifier || !isValidPrincipal(bnsV2ContractIdentifier)) {
        logger.error('BNS contract ID not properly configured');
        throw new Error('BNS contract ID not properly configured');
      }

      const [bnsV2ContractAddress, bnsV2ContractName] = bnsV2ContractIdentifier.split('.');

      const txOptions: ReadOnlyFunctionOptions = {
        senderAddress: address,
        contractAddress: bnsV2ContractAddress,
        contractName: bnsV2ContractName,
        functionName: 'get-bns-from-id',
        functionArgs: [uintCV(id)],
        network: GetStacksNetwork(fastify.chainId),
      };

      try {
        const result = await callReadOnlyFunction(txOptions);

        if (result.type === ClarityType.OptionalSome && result.value.type === ClarityType.Tuple) {
          const { name, namespace } = result.value.data;
          await reply.send({
            name: name.toString(),
            namespace: namespace.toString(),
          });
        } else if (result.type === ClarityType.OptionalNone) {
          await reply.send({ name: null, namespace: null });
        } else {
          throw new Error('Unexpected response from contract');
        }
      } catch (error) {
        logger.error(error, `Error calling get-bns-from-id for ID ${id}`);
        await reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
  fastify.get(
    '/primary-name/:owner',
    {
      schema: {
        operationId: 'get_primary_name',
        summary: 'Get Primary Name',
        description: `Retrieves the primary name associated with the given principal (owner address).`,
        tags: ['Names'],
        params: Type.Object({
          owner: Type.String({
            description: 'The principal (owner address) to fetch the primary name for',
            examples: ['SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7'],
          }),
        }),
        response: {
          200: Type.Object(
            { name: Type.Union([Type.String(), Type.Null()]) },
            {
              title: 'BnsGetPrimaryNameResponse',
              description: 'Fetch primary name for a principal.',
            }
          ),
          400: Type.Object({ error: Type.String() }, { title: 'BnsError', description: 'Error' }),
        },
      },
    },
    async (req, reply) => {
      const owner = req.params.owner;

      if (!isValidPrincipal(owner)) {
        await reply.status(400).send({ error: 'Invalid principal address' });
        return;
      }

      const randomPrivKey = makeRandomPrivKey();
      const address = getAddressFromPrivateKey(
        randomPrivKey.data,
        getChainIDNetwork(fastify.chainId) === 'mainnet'
          ? TransactionVersion.Mainnet
          : TransactionVersion.Testnet
      );

      const bnsV2ContractIdentifier = getBnsV2ContractID(fastify.chainId);
      if (!bnsV2ContractIdentifier || !isValidPrincipal(bnsV2ContractIdentifier)) {
        logger.error('BNS contract ID not properly configured');
        throw new Error('BNS contract ID not properly configured');
      }

      const [bnsV2ContractAddress, bnsV2ContractName] = bnsV2ContractIdentifier.split('.');

      const txOptions: ReadOnlyFunctionOptions = {
        senderAddress: address,
        contractAddress: bnsV2ContractAddress,
        contractName: bnsV2ContractName,
        functionName: 'get-primary-name',
        functionArgs: [standardPrincipalCV(owner)],
        network: GetStacksNetwork(fastify.chainId),
      };

      try {
        const result = await callReadOnlyFunction(txOptions);

        if (result.type === ClarityType.OptionalNone) {
          await reply.send({ name: null });
        } else if (
          result.type === ClarityType.OptionalSome &&
          result.value.type === ClarityType.UInt
        ) {
          const nameId = result.value.value.toString();
          await reply.send({ name: nameId });
        } else {
          throw new Error('Unexpected response from contract');
        }
      } catch (error) {
        logger.error(error, `Error calling get-primary-name for ${owner}`);
        await reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
};
