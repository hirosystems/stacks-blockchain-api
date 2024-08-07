import * as process from 'process';
import * as btc from 'bitcoinjs-lib';
import PQueue from 'p-queue';
import { BigNumber } from 'bignumber.js';
import {
  AnchorMode,
  makeSTXTokenTransfer,
  SignedTokenTransferOptions,
  StacksTransaction,
} from '@stacks/transactions';
import { StacksNetwork, StacksTestnet } from '@stacks/network';
import {
  makeBtcFaucetPayment,
  getBtcBalance,
  getRpcClient,
  isValidBtcAddress,
} from '../../btc-faucet';
import { DbFaucetRequestCurrency } from '../../datastore/common';
import { getChainIDNetwork, intMax, stxToMicroStx } from '../../helpers';
import { testnetKeys, getStacksTestnetNetwork } from './debug';
import { StacksCoreRpcClient } from '../../core-rpc/client';
import { logger } from '../../logger';
import { FastifyPluginAsync, preHandlerHookHandler } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { fastifyFormbody } from '@fastify/formbody';
import { Server } from 'node:http';
import { OptionalNullable } from '../schemas/util';
import { RunFaucetResponseSchema } from '../schemas/responses/responses';

export function getStxFaucetNetworks(): StacksNetwork[] {
  const networks: StacksNetwork[] = [getStacksTestnetNetwork()];
  const faucetNodeHostOverride: string | undefined = process.env.STACKS_FAUCET_NODE_HOST;
  if (faucetNodeHostOverride) {
    const faucetNodePortOverride: string | undefined = process.env.STACKS_FAUCET_NODE_PORT;
    if (!faucetNodePortOverride) {
      const error = 'STACKS_FAUCET_NODE_HOST is specified but STACKS_FAUCET_NODE_PORT is missing';
      logger.error(error);
      throw new Error(error);
    }
    const network = new StacksTestnet({
      url: `http://${faucetNodeHostOverride}:${faucetNodePortOverride}`,
    });
    networks.push(network);
  }
  return networks;
}

enum TxSendResultStatus {
  Success,
  ConflictingNonce,
  TooMuchChaining,
  Error,
}

interface TxSendResultSuccess {
  status: TxSendResultStatus.Success;
  txId: string;
}

interface TxSendResultError {
  status: TxSendResultStatus;
  error: Error;
}

type TxSendResult = TxSendResultSuccess | TxSendResultError;

function clientFromNetwork(network: StacksNetwork): StacksCoreRpcClient {
  const coreUrl = new URL(network.coreApiUrl);
  return new StacksCoreRpcClient({ host: coreUrl.hostname, port: coreUrl.port });
}

export const FaucetRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  await fastify.register(fastifyFormbody);

  // Middleware to ensure faucet is enabled
  fastify.addHook('preHandler', (_req, reply, done) => {
    if (getChainIDNetwork(fastify.chainId) === 'testnet' && fastify.writeDb) {
      done();
    } else {
      return reply.status(403).send({
        error: 'Faucet is not enabled',
        success: false,
      });
    }
  });

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

  const btcFaucetRequestQueue = new PQueue({ concurrency: 1 });

  fastify.post(
    '/btc',
    {
      preHandler: missingBtcConfigMiddleware,
      schema: {
        operationId: 'run_faucet_btc',
        summary: 'Add testnet BTC tokens to address',
        description: `Add 1 BTC token to the specified testnet BTC address.

        The endpoint returns the transaction ID, which you can use to view the transaction in a testnet Bitcoin block
        explorer. The tokens are delivered once the transaction has been included in a block.

        **Note:** This is a testnet only endpoint. This endpoint will not work on the mainnet.`,
        tags: ['Faucets'],
        querystring: Type.Object({
          address: Type.Optional(
            Type.String({
              description: 'A valid testnet BTC address',
              examples: ['2N4M94S1ZPt8HfxydXzL2P7qyzgVq7MHWts'],
            })
          ),
        }),
        body: OptionalNullable(
          Type.Object({
            address: Type.Optional(
              Type.String({
                description: 'A valid testnet BTC address',
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
                'POST request that initiates a transfer of tokens to a specified testnet address',
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
        if (!address) {
          return await reply.status(400).send({
            error: 'address required',
            success: false,
          });
        }
        if (!isValidBtcAddress(btc.networks.regtest, address)) {
          return await reply.status(400).send({
            error: 'Invalid BTC regtest address',
            success: false,
          });
        }
        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

        // Guard condition: requests are limited to 5 times per 5 minutes.
        // Only based on address for now, but we're keeping the IP in case
        // we want to escalate and implement a per IP policy
        const lastRequests = await fastify.db.getBTCFaucetRequests(address);
        const now = Date.now();
        const window = 5 * 60 * 1000; // 5 minutes
        const requestsInWindow = lastRequests.results
          .map(r => now - r.occurred_at)
          .filter(r => r <= window);
        if (requestsInWindow.length >= 5) {
          logger.warn(`BTC faucet rate limit hit for address ${address}`);
          return await reply.status(429).send({
            error: 'Too many requests',
            success: false,
          });
        }

        const tx = await makeBtcFaucetPayment(btc.networks.regtest, address, 0.5);
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
      preHandler: missingBtcConfigMiddleware,
      schema: {
        operationId: 'get_btc_balance',
        summary: 'Get BTC balance for address',
        tags: ['Faucets'],
        params: Type.Object({
          address: Type.String({
            description: 'A valid testnet BTC address',
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
      const balance = await getBtcBalance(btc.networks.regtest, address);
      await reply.send({ balance });
    }
  );

  const stxFaucetRequestQueue = new PQueue({ concurrency: 1 });

  const FAUCET_DEFAULT_STX_AMOUNT = stxToMicroStx(500);
  const FAUCET_DEFAULT_WINDOW = 5 * 60 * 1000; // 5 minutes
  const FAUCET_DEFAULT_TRIGGER_COUNT = 5;

  const FAUCET_STACKING_WINDOW = 2 * 24 * 60 * 60 * 1000; // 2 days
  const FAUCET_STACKING_TRIGGER_COUNT = 1;

  const STX_FAUCET_NETWORKS = () => getStxFaucetNetworks();
  const STX_FAUCET_KEYS = (process.env.FAUCET_PRIVATE_KEY ?? testnetKeys[0].secretKey).split(',');

  fastify.post(
    '/stx',
    {
      schema: {
        operationId: 'run_faucet_stx',
        summary: 'Get STX testnet tokens',
        description: `Add 500 STX tokens to the specified testnet address. Testnet STX addresses begin with \`ST\`. If the \`stacking\`
        parameter is set to \`true\`, the faucet will add the required number of tokens for individual stacking to the
        specified testnet address.

        The endpoint returns the transaction ID, which you can use to view the transaction in the
        [Stacks Explorer](https://explorer.hiro.so/?chain=testnet). The tokens are delivered once the transaction has
        been included in an anchor block.

        A common reason for failed faucet transactions is that the faucet has run out of tokens. If you are experiencing
        failed faucet transactions to a testnet address, you can get help in [Discord](https://stacks.chat).

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

      const address = req.query.address;
      if (!address) {
        return await reply.status(400).send({
          error: 'address required',
          success: false,
        });
      }

      await stxFaucetRequestQueue.add(async () => {
        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        const lastRequests = await fastify.db.getSTXFaucetRequests(address);

        const isStackingReq = req.query.stacking ?? false;

        // Guard condition: requests are limited to x times per y minutes.
        // Only based on address for now, but we're keeping the IP in case
        // we want to escalate and implement a per IP policy
        const now = Date.now();
        const [window, triggerCount] = isStackingReq
          ? [FAUCET_STACKING_WINDOW, FAUCET_STACKING_TRIGGER_COUNT]
          : [FAUCET_DEFAULT_WINDOW, FAUCET_DEFAULT_TRIGGER_COUNT];

        const requestsInWindow = lastRequests.results
          .map(r => now - r.occurred_at)
          .filter(r => r <= window);
        if (requestsInWindow.length >= triggerCount) {
          logger.warn(`STX faucet rate limit hit for address ${address}`);
          return await reply.status(429).send({
            error: 'Too many requests',
            success: false,
          });
        }

        const stxAmounts: bigint[] = [];
        for (const network of STX_FAUCET_NETWORKS()) {
          try {
            let stxAmount = FAUCET_DEFAULT_STX_AMOUNT;
            if (isStackingReq) {
              const poxInfo = await clientFromNetwork(network).getPox();
              stxAmount = BigInt(poxInfo.min_amount_ustx);
              const padPercent = new BigNumber(0.2);
              const padAmount = new BigNumber(stxAmount.toString())
                .times(padPercent)
                .integerValue()
                .toString();
              stxAmount = stxAmount + BigInt(padAmount);
            }
            stxAmounts.push(stxAmount);
          } catch (error) {
            // ignore
          }
        }
        const stxAmount = intMax(stxAmounts);

        const generateTx = async (
          network: StacksNetwork,
          keyIndex: number,
          nonce?: bigint,
          fee?: bigint
        ): Promise<StacksTransaction> => {
          const txOpts: SignedTokenTransferOptions = {
            recipient: address,
            amount: stxAmount,
            senderKey: STX_FAUCET_KEYS[keyIndex],
            network: network,
            memo: 'Faucet',
            anchorMode: AnchorMode.Any,
          };
          if (fee !== undefined) {
            txOpts.fee = fee;
          }
          if (nonce !== undefined) {
            txOpts.nonce = nonce;
          }
          try {
            return await makeSTXTokenTransfer(txOpts);
          } catch (error: any) {
            if (
              fee === undefined &&
              (error as Error).message &&
              /estimating transaction fee|NoEstimateAvailable/.test(error.message)
            ) {
              const defaultFee = 200n;
              return await generateTx(network, keyIndex, nonce, defaultFee);
            }
            throw error;
          }
        };

        const nonces: bigint[] = [];
        const fees: bigint[] = [];
        let txGenFetchError: Error | undefined;
        for (const network of STX_FAUCET_NETWORKS()) {
          try {
            const tx = await generateTx(network, 0);
            nonces.push(tx.auth.spendingCondition?.nonce ?? BigInt(0));
            fees.push(tx.auth.spendingCondition.fee);
          } catch (error: any) {
            txGenFetchError = error;
          }
        }
        if (nonces.length === 0) {
          throw txGenFetchError;
        }
        let nextNonce = intMax(nonces);
        const fee = intMax(fees);

        const sendTxResults: TxSendResult[] = [];
        let retrySend = false;
        let sendSuccess: { txId: string; txRaw: string } | undefined;
        let lastSendError: Error | undefined;
        let stxKeyIndex = 0;
        do {
          const tx = await generateTx(STX_FAUCET_NETWORKS()[0], stxKeyIndex, nextNonce, fee);
          const rawTx = Buffer.from(tx.serialize());
          for (const network of STX_FAUCET_NETWORKS()) {
            const rpcClient = clientFromNetwork(network);
            try {
              const res = await rpcClient.sendTransaction(rawTx);
              sendSuccess = { txId: res.txId, txRaw: rawTx.toString('hex') };
              sendTxResults.push({
                status: TxSendResultStatus.Success,
                txId: res.txId,
              });
            } catch (error: any) {
              lastSendError = error;
              if (error.message?.includes('ConflictingNonceInMempool')) {
                sendTxResults.push({
                  status: TxSendResultStatus.ConflictingNonce,
                  error,
                });
              } else if (error.message?.includes('TooMuchChaining')) {
                sendTxResults.push({
                  status: TxSendResultStatus.TooMuchChaining,
                  error,
                });
              } else {
                sendTxResults.push({
                  status: TxSendResultStatus.Error,
                  error,
                });
              }
            }
          }
          if (sendTxResults.every(res => res.status === TxSendResultStatus.Success)) {
            retrySend = false;
          } else if (
            sendTxResults.every(res => res.status === TxSendResultStatus.ConflictingNonce)
          ) {
            retrySend = true;
            sendTxResults.length = 0;
            nextNonce = nextNonce + 1n;
          } else if (
            sendTxResults.every(res => res.status === TxSendResultStatus.TooMuchChaining)
          ) {
            // Try with the next key in case we have one.
            if (stxKeyIndex + 1 === STX_FAUCET_KEYS.length) {
              retrySend = false;
            } else {
              retrySend = true;
              stxKeyIndex++;
            }
          } else {
            retrySend = false;
          }
        } while (retrySend);

        if (!sendSuccess) {
          if (lastSendError) {
            throw lastSendError;
          } else {
            throw new Error(`Unexpected failure to send or capture error`);
          }
        } else {
          await reply.send({
            success: true,
            txId: sendSuccess.txId,
            txRaw: sendSuccess.txRaw,
          });
        }

        await fastify.writeDb?.insertFaucetRequest({
          ip: `${ip}`,
          address: address,
          currency: DbFaucetRequestCurrency.STX,
          occurred_at: now,
        });
      });
    }
  );
};
