import { FastifyPluginAsync, preHandlerHookHandler } from 'fastify';
import { Server } from 'node:http';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { logger } from '@stacks/api-toolkit';
import { getRpcClient, getBtcFaucetAddressNetwork } from '../../../btc-faucet.js';
import { getChainIDNetwork } from '../../../helpers.js';
import { ENV } from '../../../env.js';
import { classifyFaucetError } from '../../faucets/errors.js';
import {
  isValidTestnetPrincipal,
  sendBtcFaucetPayment,
  sendSbtcFaucetTx,
  sendStxFaucetTx,
} from '../../faucets/common.js';
import {
  FaucetBtcRequestSchema,
  FaucetBtcRunSchema,
  FaucetErrorSchema,
  FaucetSbtcRunSchema,
  FaucetStacksRequestSchema,
  FaucetStxRunSchema,
} from '../../schemas/v3/entities/faucets.js';

/** Appended to every faucet description: amounts are fixed per deployment. */
const CUSTOM_AMOUNT_NOTE =
  'Each request sends a fixed amount configured by the API operator, which the response ' +
  'reports. If you need more for testing (for example, to enroll in a staking bond), reach out ' +
  'to request a custom faucet transaction.';

export const FaucetsRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  // Encapsulated error handler for all faucet routes. Faucet handlers talk to backing nodes
  // (bitcoind RPC, the Stacks core node RPC) whose failures would otherwise bubble up to the global
  // handler as a generic `500` that leaks internal details (e.g. the node's host/port). Here we
  // translate those into sanitized responses with appropriate status codes.
  fastify.setErrorHandler(async (error, req, reply) => {
    // If the response was already flushed, we can't change its status or body. Attempting to do so
    // would leave the client with a mismatched status line and error body. Just log and bail.
    if (reply.sent) {
      logger.error(error, `Faucet request to ${req.method} ${req.url} failed after response sent`);
      return;
    }
    // Client errors (body validation, malformed or missing JSON, wrong content type) keep their
    // status and message, rendered in the same `{ error }` shape as every other faucet error.
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({ error: (error as Error).message });
    }
    const classified = classifyFaucetError(error);
    const suffix = classified.logReason ? `: ${classified.logReason}` : '';
    logger.error(error, `Faucet request to ${req.method} ${req.url} failed${suffix}`);
    return reply.status(classified.statusCode).send({ error: classified.message });
  });

  // Middleware to ensure faucets are only served on testnet
  fastify.addHook('preHandler', (_req, reply, done) => {
    if (getChainIDNetwork(fastify.chainId) === 'testnet') {
      done();
    } else {
      return reply.status(403).send({ error: 'Faucet is not available' });
    }
  });

  const btcFaucetEnabledMiddleware: preHandlerHookHandler = (_req, reply, done) => {
    if (!ENV.TESTNET_BTC_FAUCET_ENABLED) {
      return reply.status(403).send({ error: 'BTC faucet is not available' });
    }
    done();
  };

  const stxFaucetEnabledMiddleware: preHandlerHookHandler = (_req, reply, done) => {
    if (!ENV.TESTNET_STX_FAUCET_ENABLED) {
      return reply.status(403).send({ error: 'STX faucet is not available' });
    }
    done();
  };

  const sbtcFaucetEnabledMiddleware: preHandlerHookHandler = (_req, reply, done) => {
    if (!ENV.TESTNET_SBTC_FAUCET_ENABLED) {
      return reply.status(403).send({ error: 'sBTC faucet is not available' });
    }
    done();
  };

  const missingBtcConfigMiddleware: preHandlerHookHandler = (_req, reply, done) => {
    try {
      getRpcClient();
      done();
    } catch (err) {
      return reply.status(403).send({ error: (err as Error).message });
    }
  };

  // Runs after body validation, so `address` is present and non-empty.
  const stacksAddressMiddleware: preHandlerHookHandler = (req, reply, done) => {
    if (!isValidTestnetPrincipal((req.body as { address: string }).address)) {
      return reply.status(400).send({ error: 'Invalid testnet Stacks address' });
    }
    done();
  };

  fastify.post(
    '/faucets/btc',
    {
      preHandler: [btcFaucetEnabledMiddleware, missingBtcConfigMiddleware],
      schema: {
        operationId: 'get_faucet_btc',
        summary: 'Get BTC regtest or signet tokens',
        description:
          'Sends BTC to the specified regtest or signet BTC address. The response reports the ' +
          'amount sent, in satoshis, and the transaction id, which you can use to view the ' +
          'transaction in a regtest or signet Bitcoin block explorer. The tokens are delivered ' +
          'once the transaction has been included in a block.\n\n' +
          `${CUSTOM_AMOUNT_NOTE}\n\n` +
          '**Note:** This is a Bitcoin regtest/signet-only endpoint. This endpoint will not work ' +
          'on Bitcoin mainnet.',
        tags: ['Faucets'],
        body: FaucetBtcRequestSchema,
        response: {
          200: FaucetBtcRunSchema,
          '4xx': FaucetErrorSchema,
          '5xx': FaucetErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const { address } = req.body;
      const btcNetwork = getBtcFaucetAddressNetwork(address);
      if (!btcNetwork) {
        return await reply.status(400).send({ error: 'Invalid BTC regtest or signet address' });
      }

      const amountSats = ENV.TESTNET_BTC_FAUCET_AMOUNT;
      const tx = await sendBtcFaucetPayment(btcNetwork, address, amountSats / 1e8);
      await reply.send({
        transaction: { tx_id: `0x${tx.txId}`, chain: 'bitcoin' },
        amount: { btc: amountSats.toString() },
      });
    }
  );

  fastify.post(
    '/faucets/stx',
    {
      preHandler: [stxFaucetEnabledMiddleware, stacksAddressMiddleware],
      schema: {
        operationId: 'get_faucet_stx',
        summary: 'Get STX testnet tokens',
        description:
          'Sends STX to the specified testnet address. Testnet STX addresses begin with `ST`. ' +
          'The response reports the amount sent, in µSTX, and the transaction id, which you can ' +
          'use to view the transaction in the ' +
          '[Stacks Explorer](https://explorer.hiro.so/?chain=testnet). The tokens are delivered ' +
          'once the transaction has been included in a block.\n\n' +
          `${CUSTOM_AMOUNT_NOTE}\n\n` +
          '**Note:** This is a testnet only endpoint. This endpoint will not work on mainnet.',
        tags: ['Faucets'],
        body: FaucetStacksRequestSchema,
        response: {
          200: FaucetStxRunSchema,
          '4xx': FaucetErrorSchema,
          '5xx': FaucetErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const sent = await sendStxFaucetTx({
        db: fastify.db,
        recipientAddress: req.body.address,
        amount: BigInt(ENV.TESTNET_STX_FAUCET_AMOUNT),
      });
      await reply.send({
        transaction: { tx_id: sent.txId, chain: 'stacks' },
        amount: { stx: sent.amount.toString() },
      });
    }
  );

  fastify.post(
    '/faucets/sbtc',
    {
      preHandler: [sbtcFaucetEnabledMiddleware, stacksAddressMiddleware],
      schema: {
        operationId: 'get_faucet_sbtc',
        summary: 'Get sBTC testnet tokens',
        description:
          'Sends sBTC to the specified testnet address. The endpoint performs a SIP-010 ' +
          '`transfer` contract call on the configured testnet sBTC token contract. Testnet STX ' +
          'addresses begin with `ST`. The response reports the amount sent, in satoshis, and ' +
          'the transaction id, which you can use to view the transaction in the ' +
          '[Stacks Explorer](https://explorer.hiro.so/?chain=testnet). The tokens are delivered ' +
          'once the transaction has been included in a block.\n\n' +
          `${CUSTOM_AMOUNT_NOTE}\n\n` +
          '**Note:** This is a testnet only endpoint. This endpoint will not work on mainnet.',
        tags: ['Faucets'],
        body: FaucetStacksRequestSchema,
        response: {
          200: FaucetSbtcRunSchema,
          '4xx': FaucetErrorSchema,
          '5xx': FaucetErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const sent = await sendSbtcFaucetTx({ db: fastify.db, recipientAddress: req.body.address });
      await reply.send({
        transaction: { tx_id: sent.txId, chain: 'stacks' },
        amount: { sbtc: sent.amount.toString() },
      });
    }
  );
};
