import { FastifyPluginAsync, preHandlerHookHandler } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { fastifyFormbody } from '@fastify/formbody';
import { Server } from 'node:http';
import { logger } from '@stacks/api-toolkit';
import {
  makeBtcFaucetPayment,
  getBtcBalance,
  getRpcClient,
  getBtcFaucetAddressNetwork,
} from '../../../btc-faucet.js';
import { DbFaucetRequestCurrency } from '../../../datastore/common.js';
import { getChainIDNetwork, getStxFaucetNetwork } from '../../../helpers.js';
import { ENV } from '../../../env.js';
import { OptionalNullable } from '../../schemas/v1/util.js';
import { RunFaucetResponseSchema } from '../../schemas/v1/responses/responses.js';
import { classifyFaucetError } from '../../faucets/errors.js';
import {
  btcFaucetRequestQueue,
  calculateSTXFaucetAmount,
  FAUCET_BTC_AMOUNT,
  FAUCET_BTC_LARGE_AMOUNT,
  FAUCET_BTC_XLARGE_AMOUNT,
  FAUCET_DEFAULT_TRIGGER_COUNT,
  FAUCET_DEFAULT_WINDOW,
  FAUCET_STACKING_TRIGGER_COUNT,
  FAUCET_STACKING_WINDOW,
  getRequestIp,
  isRateLimited,
  sbtcFaucetRequestQueue,
  sendSbtcFaucetTx,
  sendStxFaucetTx,
  stxFaucetRequestQueue,
} from '../../faucets/common.js';

export { FAUCET_TESTNET_KEYS } from '../../faucets/common.js';

/** Appended to each faucet route's `deprecatedMessage`, pointing callers at the v3 equivalent. */
function deprecatedFor(v3Path: string): string {
  return (
    `Use POST ${v3Path} instead. It takes the address in a JSON body ({"address": ...}) ` +
    'rather than the query string, sends a single fixed amount (no size or stacking options), ' +
    'and returns a `transaction` object plus the amount sent instead of the transaction id and ' +
    'raw transaction hex.'
  );
}

export const FaucetRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  await fastify.register(fastifyFormbody);

  // Encapsulated error handler for all faucet routes. Faucet handlers talk to backing nodes
  // (bitcoind RPC, the Stacks core node RPC) whose failures would otherwise bubble up to the
  // global handler as a generic `500` that leaks internal details (e.g. the node's host/port).
  // Here we translate those into sanitized responses with appropriate status codes.
  fastify.setErrorHandler(async (error, req, reply) => {
    // If the response was already flushed, we can't change its status or body -- attempting to do
    // so would leave the client with a mismatched status line and error body. Just log and bail.
    if (reply.sent) {
      logger.error(error, `Faucet request to ${req.method} ${req.url} failed after response sent`);
      return;
    }
    // Preserve validation errors and any explicit client (4xx) errors as-is.
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.send(error);
    }
    const classified = classifyFaucetError(error);
    const suffix = classified.logReason ? `: ${classified.logReason}` : '';
    logger.error(error, `Faucet request to ${req.method} ${req.url} failed${suffix}`);
    return reply.status(classified.statusCode).send({
      error: classified.message,
      success: false,
    });
  });

  // Middleware to ensure faucet is enabled
  fastify.addHook('preHandler', (_req, reply, done) => {
    if (getChainIDNetwork(fastify.chainId) === 'testnet' && fastify.writeDb) {
      done();
    } else {
      return reply.status(403).send({
        error: 'Faucet is not available',
        success: false,
      });
    }
  });

  const btcFaucetEnabledMiddleware: preHandlerHookHandler = (_req, reply, done) => {
    if (!ENV.TESTNET_BTC_FAUCET_ENABLED) {
      return reply.status(403).send({
        error: 'BTC faucet is not available',
        success: false,
      });
    }
    done();
  };

  const stxFaucetEnabledMiddleware: preHandlerHookHandler = (_req, reply, done) => {
    if (!ENV.TESTNET_STX_FAUCET_ENABLED) {
      return reply.status(403).send({
        error: 'STX faucet is not available',
        success: false,
      });
    }
    done();
  };

  const sbtcFaucetEnabledMiddleware: preHandlerHookHandler = (_req, reply, done) => {
    if (!ENV.TESTNET_SBTC_FAUCET_ENABLED) {
      return reply.status(403).send({
        error: 'sBTC faucet is not available',
        success: false,
      });
    }
    done();
  };

  const missingBtcConfigMiddleware: preHandlerHookHandler = (_req, reply, done) => {
    try {
      getRpcClient();
      done();
    } catch (err) {
      return reply.status(403).send({
        error: (err as Error).message,
        success: false,
      });
    }
  };

  fastify.post(
    '/btc',
    {
      preHandler: [btcFaucetEnabledMiddleware, missingBtcConfigMiddleware],
      schema: {
        operationId: 'run_faucet_btc',
        deprecated: true,
        deprecatedMessage: deprecatedFor('/extended/v3/faucets/btc'),
        summary: 'Get BTC regtest or signet tokens',
        description: `Add 0.0001 BTC to the specified regtest or signet BTC address (0.01 BTC with \`large\`, 0.5 BTC with \`xlarge\`).

        The endpoint returns the transaction ID, which you can use to view the transaction in a regtest or signet
        Bitcoin block explorer. The tokens are delivered once the transaction has been included in a block.

        **Deprecated:** use \`POST /extended/v3/faucets/btc\` instead.

        **Note:** This is a Bitcoin regtest/signet-only endpoint. This endpoint will not work on the Bitcoin mainnet.`,
        tags: ['Faucets'],
        querystring: Type.Object({
          address: Type.Optional(
            Type.String({
              description: 'A valid regtest or signet BTC address',
              examples: ['2N4M94S1ZPt8HfxydXzL2P7qyzgVq7MHWts'],
            })
          ),
          large: Type.Optional(
            Type.Boolean({
              description: 'Request a large amount of regtest or signet BTC than the default',
              default: false,
            })
          ),
          xlarge: Type.Optional(
            Type.Boolean({
              description:
                'Request an extra large amount of regtest or signet BTC than the default',
              default: false,
            })
          ),
        }),
        body: OptionalNullable(
          Type.Object({
            address: Type.Optional(
              Type.String({
                description: 'A valid regtest or signet BTC address',
                examples: ['2N4M94S1ZPt8HfxydXzL2P7qyzgVq7MHWts'],
              })
            ),
          })
        ),
        response: {
          200: Type.Object(
            {
              success: Type.Literal(true, {
                description: 'Indicates if the faucet call was successful',
              }),
              txid: Type.String({ description: 'The transaction ID for the faucet call' }),
              raw_tx: Type.String({ description: 'Raw transaction in hex string representation' }),
            },
            {
              title: 'RunFaucetResponse',
              description:
                'POST request that initiates a transfer of tokens to a specified Bitcoin regtest or signet address',
            }
          ),
          '4xx': Type.Object({
            success: Type.Literal(false),
            error: Type.String({ description: 'Error message' }),
          }),
        },
      },
    },
    async (req, reply) => {
      await btcFaucetRequestQueue.add(async () => {
        const address = req.query.address || req.body?.address;
        let btcAmount = FAUCET_BTC_AMOUNT;

        if (req.query.large && req.query.xlarge) {
          return await reply.status(400).send({
            error: 'cannot simultaneously request a large and xlarge amount',
            success: false,
          });
        }

        if (req.query.large) {
          btcAmount = FAUCET_BTC_LARGE_AMOUNT;
        } else if (req.query.xlarge) {
          btcAmount = FAUCET_BTC_XLARGE_AMOUNT;
        }

        if (!address) {
          return await reply.status(400).send({
            error: 'address required',
            success: false,
          });
        }
        const btcNetwork = getBtcFaucetAddressNetwork(address);
        if (!btcNetwork) {
          return await reply.status(400).send({
            error: 'Invalid BTC regtest or signet address',
            success: false,
          });
        }
        const ip = getRequestIp(req.headers['x-forwarded-for'], req.ip);
        const now = Date.now();

        // Guard condition: requests are limited to 5 times per 5 minutes.
        // Only based on address for now, but we're keeping the IP in case
        // we want to escalate and implement a per IP policy
        if (ENV.TESTNET_FAUCETS_RATE_LIMIT_ENABLED) {
          const lastRequests = await fastify.db.getBTCFaucetRequests(address);
          const occurredAt = lastRequests.results.map(r => r.occurred_at);
          if (isRateLimited(occurredAt, now, FAUCET_DEFAULT_WINDOW, FAUCET_DEFAULT_TRIGGER_COUNT)) {
            logger.warn(`BTC faucet rate limit hit for address ${address}`);
            return await reply.status(429).send({
              error: 'Too many requests',
              success: false,
            });
          }
        }

        const tx = await makeBtcFaucetPayment(btcNetwork, address, btcAmount);
        await fastify.writeDb?.insertFaucetRequest({
          ip: `${ip}`,
          address: address,
          currency: DbFaucetRequestCurrency.BTC,
          occurred_at: now,
        });

        await reply.send({
          txid: tx.txId,
          raw_tx: tx.rawTx,
          success: true,
        });
      });
    }
  );

  fastify.get(
    '/btc/:address',
    {
      preHandler: [btcFaucetEnabledMiddleware, missingBtcConfigMiddleware],
      schema: {
        deprecated: true,
        operationId: 'get_btc_balance',
        summary: 'Get BTC balance for address',
        description: 'Get the BTC balance for an address. **This endpoint is deprecated.**',
        tags: ['Faucets'],
        params: Type.Object({
          address: Type.String({
            description: 'A valid regtest or signet BTC address',
            examples: ['2N4M94S1ZPt8HfxydXzL2P7qyzgVq7MHWts'],
          }),
        }),
        response: {
          200: Type.Object({
            balance: Type.Number({ description: 'Address balance in BTC' }),
          }),
          '4xx': Type.Object({
            success: Type.Literal(false),
            error: Type.String({ description: 'Error message' }),
          }),
        },
      },
    },
    async (req, reply) => {
      const { address } = req.params;
      const btcNetwork = getBtcFaucetAddressNetwork(address);
      if (!btcNetwork) {
        return await reply.status(400).send({
          error: 'Invalid BTC regtest or signet address',
          success: false,
        });
      }
      const balance = await getBtcBalance(btcNetwork, address);
      await reply.send({ balance });
    }
  );

  fastify.post(
    '/stx',
    {
      preHandler: stxFaucetEnabledMiddleware,
      schema: {
        operationId: 'run_faucet_stx',
        deprecated: true,
        deprecatedMessage: deprecatedFor('/extended/v3/faucets/stx'),
        summary: 'Get STX testnet tokens',
        description: `Add 500 STX tokens to the specified testnet address. Testnet STX addresses begin with \`ST\`. If the \`stacking\`
        parameter is set to \`true\`, the faucet will add the required number of tokens for individual stacking to the
        specified testnet address.

        The endpoint returns the transaction ID, which you can use to view the transaction in the
        [Stacks Explorer](https://explorer.hiro.so/?chain=testnet). The tokens are delivered once the transaction has
        been included in an anchor block.

        A common reason for failed faucet transactions is that the faucet has run out of tokens. If you are experiencing
        failed faucet transactions to a testnet address, you can get help in [Discord](https://stacks.chat).

        **Deprecated:** use \`POST /extended/v3/faucets/stx\` instead.

        **Note:** This is a testnet only endpoint. This endpoint will not work on the mainnet.`,
        tags: ['Faucets'],
        querystring: Type.Object({
          address: Type.Optional(
            Type.String({
              description: 'A valid testnet STX address',
              examples: ['ST3M7N9Q9HDRM7RVP1Q26P0EE69358PZZAZD7KMXQ'],
            })
          ),
          stacking: Type.Optional(
            Type.Boolean({
              description:
                'Request the amount of STX tokens needed for individual address stacking',
              default: false,
            })
          ),
        }),
        body: OptionalNullable(
          Type.Object({
            address: Type.Optional(
              Type.String({
                description:
                  '[Deprecated -- use query param rather than POST body] A valid testnet STX address',
                examples: ['ST3M7N9Q9HDRM7RVP1Q26P0EE69358PZZAZD7KMXQ'],
              })
            ),
          })
        ),
        response: {
          200: RunFaucetResponseSchema,
          '4xx': Type.Object({
            success: Type.Literal(false, {
              description: 'Indicates if the faucet call was successful',
            }),
            error: Type.String({ description: 'Error message' }),
            help: Type.Optional(Type.String()),
          }),
        },
      },
    },
    async (req, reply) => {
      if (!req.query.address && req.body?.address) {
        // return error for no longer supported post body requests
        const url = new URL(`${req.protocol}://${req.hostname}${req.url}`);
        url.search = new URLSearchParams(req.body).toString();
        return reply.status(400).send({
          error: `POST body is no longer supported, parameters must be passed as query parameters, e.g. ${url}`,
          help: `Example curl request: curl -X POST '${url}'`,
          success: false,
        });
      }

      const recipientAddress = req.query.address;
      if (!recipientAddress) {
        return await reply.status(400).send({
          error: 'address required',
          success: false,
        });
      }

      await stxFaucetRequestQueue.add(async () => {
        // Guard condition: requests are limited to x times per y minutes.
        // Only based on address for now, but we're keeping the IP in case
        // we want to escalate and implement a per IP policy
        const ip = getRequestIp(req.headers['x-forwarded-for'], req.ip);
        const isStackingReq = req.query.stacking ?? false;
        const now = Date.now();

        if (ENV.TESTNET_FAUCETS_RATE_LIMIT_ENABLED) {
          const lastRequests = await fastify.db.getSTXFaucetRequests(recipientAddress);
          const [window, triggerCount] = isStackingReq
            ? [FAUCET_STACKING_WINDOW, FAUCET_STACKING_TRIGGER_COUNT]
            : [FAUCET_DEFAULT_WINDOW, FAUCET_DEFAULT_TRIGGER_COUNT];
          const occurredAt = lastRequests.results.map(r => r.occurred_at);
          if (isRateLimited(occurredAt, now, window, triggerCount)) {
            logger.warn(`StxFaucet rate limit hit for address ${recipientAddress}`);
            return await reply.status(429).send({
              error: 'Too many requests',
              success: false,
            });
          }
        }

        const sent = await sendStxFaucetTx({
          db: fastify.db,
          recipientAddress,
          amount: await calculateSTXFaucetAmount(getStxFaucetNetwork(), isStackingReq),
        });

        await fastify.writeDb?.insertFaucetRequest({
          ip: `${ip}`,
          address: recipientAddress,
          currency: DbFaucetRequestCurrency.STX,
          occurred_at: now,
        });
        await reply.send({
          success: true,
          txId: sent.txId,
          txRaw: sent.rawTx,
        });
      });
    }
  );

  fastify.post(
    '/sbtc',
    {
      preHandler: sbtcFaucetEnabledMiddleware,
      schema: {
        operationId: 'run_faucet_sbtc',
        deprecated: true,
        deprecatedMessage: deprecatedFor('/extended/v3/faucets/sbtc'),
        summary: 'Get sBTC testnet tokens',
        description: `Add sBTC tokens to the specified testnet address. The endpoint performs a SIP-010 \`transfer\`
        contract call on the configured testnet sBTC token contract. Testnet STX addresses begin with \`ST\`.

        The endpoint returns the transaction ID, which you can use to view the transaction in the
        [Stacks Explorer](https://explorer.hiro.so/?chain=testnet). The tokens are delivered once the transaction has
        been included in a block.

        **Deprecated:** use \`POST /extended/v3/faucets/sbtc\` instead.

        **Note:** This is a testnet only endpoint. This endpoint will not work on mainnet.`,
        tags: ['Faucets'],
        querystring: Type.Object({
          address: Type.Optional(
            Type.String({
              description: 'A valid testnet STX address',
              examples: ['ST3M7N9Q9HDRM7RVP1Q26P0EE69358PZZAZD7KMXQ'],
            })
          ),
        }),
        response: {
          200: RunFaucetResponseSchema,
          '4xx': Type.Object({
            success: Type.Literal(false, {
              description: 'Indicates if the faucet call was successful',
            }),
            error: Type.String({ description: 'Error message' }),
          }),
        },
      },
    },
    async (req, reply) => {
      const recipientAddress = req.query.address;
      if (!recipientAddress) {
        return await reply.status(400).send({
          error: 'address required',
          success: false,
        });
      }

      await sbtcFaucetRequestQueue.add(async () => {
        // Guard condition: requests are limited to x times per y minutes.
        // Only based on address for now, but we're keeping the IP in case
        // we want to escalate and implement a per IP policy
        const ip = getRequestIp(req.headers['x-forwarded-for'], req.ip);
        const now = Date.now();

        if (ENV.TESTNET_FAUCETS_RATE_LIMIT_ENABLED) {
          const lastRequests = await fastify.db.getSBTCFaucetRequests(recipientAddress);
          const occurredAt = lastRequests.results.map(r => r.occurred_at);
          if (isRateLimited(occurredAt, now, FAUCET_DEFAULT_WINDOW, FAUCET_DEFAULT_TRIGGER_COUNT)) {
            logger.warn(`SbtcFaucet rate limit hit for address ${recipientAddress}`);
            return await reply.status(429).send({
              error: 'Too many requests',
              success: false,
            });
          }
        }

        const sent = await sendSbtcFaucetTx({ db: fastify.db, recipientAddress });

        await fastify.writeDb?.insertFaucetRequest({
          ip: `${ip}`,
          address: recipientAddress,
          currency: DbFaucetRequestCurrency.SBTC,
          occurred_at: now,
        });
        await reply.send({
          success: true,
          txId: sent.txId,
          txRaw: sent.rawTx,
        });
      });
    }
  );
};
