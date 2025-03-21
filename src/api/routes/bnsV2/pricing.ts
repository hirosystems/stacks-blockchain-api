import {
  makeRandomPrivKey,
  getAddressFromPrivateKey,
  TransactionVersion,
  ReadOnlyFunctionOptions,
  bufferCVFromString,
  callReadOnlyFunction,
  ClarityType,
} from '@stacks/transactions';
import { getChainIDNetwork, isValidPrincipal } from './../../../helpers';
import { GetStacksNetwork } from '../../../event-stream/bns/bns-helpers';
import { logger } from '../../../logger';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { handleChainTipCache } from '../../controllers/cache-controller';
import { getBnsV2ContractID } from 'src/event-stream/bnsV2/bnsV2-helpers';

export const BnsV2PriceRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/namespaces/:tld',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_namespace_price',
        summary: 'Get Namespace Price',
        description: `Retrieves the price of a namespace. The \`amount\` given will be in the smallest possible units of the currency.`,
        tags: ['Names'],
        params: Type.Object({
          tld: Type.String({ description: 'the namespace to fetch price for', examples: ['id'] }),
        }),
        response: {
          200: Type.Object(
            { units: Type.String(), amount: Type.String() },
            { title: 'BnsGetNamespacePriceResponse', description: 'Fetch price for namespace.' }
          ),
          400: Type.Object({ error: Type.String() }, { title: 'BnsError', description: 'Error' }),
        },
      },
    },
    async (req, reply) => {
      const namespace = req.params.tld;
      if (namespace.length > 20) {
        await reply.status(400).send({ error: 'Invalid namespace' });
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
        functionName: 'get-namespace-price',
        functionArgs: [bufferCVFromString(namespace)],
        network: GetStacksNetwork(fastify.chainId),
      };
      const contractCallTx = await callReadOnlyFunction(txOptions);
      if (
        contractCallTx.type == ClarityType.ResponseOk &&
        contractCallTx.value.type == ClarityType.UInt
      ) {
        const response = {
          units: 'STX',
          amount: contractCallTx.value.value.toString(10),
        };
        await reply.send(response);
      } else {
        await reply.status(400).send({ error: 'Invalid namespace' });
      }
    }
  );

  fastify.get(
    '/names/:name',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_name_price',
        summary: 'Get Name Price',
        description: `Retrieves the price of a name. The \`amount\` given will be in the smallest possible units of the currency.`,
        tags: ['Names'],
        params: Type.Object({
          name: Type.String({
            description: 'the name to query price information for',
            examples: ['muneeb.id'],
          }),
        }),
        response: {
          200: Type.Object(
            { units: Type.String(), amount: Type.String() },
            { title: 'BnsGetNamePriceResponse', description: 'Fetch price for name.' }
          ),
          400: Type.Object({ error: Type.String() }, { title: 'BnsError', description: 'Error' }),
        },
      },
    },
    async (req, reply) => {
      const input = req.params.name;
      if (!input.includes('.')) {
        await reply.status(400).send({ error: 'Invalid name' });
        return;
      }
      const split = input.split('.');
      if (split.length != 2) {
        await reply.status(400).send({ error: 'Invalid name' });
        return;
      }
      const name = split[0];
      const namespace = split[1];
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
        functionName: 'get-name-price',
        functionArgs: [bufferCVFromString(namespace), bufferCVFromString(name)],
        network: GetStacksNetwork(fastify.chainId),
      };

      const contractCall = await callReadOnlyFunction(txOptions);
      if (
        contractCall.type == ClarityType.ResponseOk &&
        contractCall.value.type == ClarityType.UInt
      ) {
        const response = {
          units: 'STX',
          amount: contractCall.value.value.toString(10),
        };
        await reply.send(response);
      } else {
        await reply.status(400).send({ error: 'Invalid name' });
      }
    }
  );

  await Promise.resolve();
};
