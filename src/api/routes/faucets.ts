import * as btc from 'bitcoinjs-lib';
import PQueue from 'p-queue';
import { BigNumber } from 'bignumber.js';
import {
  AnchorMode,
  getAddressFromPrivateKey,
  makeSTXTokenTransfer,
  pubKeyfromPrivKey,
  publicKeyToString,
  SignedTokenTransferOptions,
  StacksTransaction,
  TransactionVersion,
} from '@stacks/transactions';
import { StacksNetwork } from '@stacks/network';
import {
  makeBtcFaucetPayment,
  getBtcBalance,
  getRpcClient,
  isValidBtcAddress,
} from '../../btc-faucet.js';
import { DbFaucetRequestCurrency } from '../../datastore/common.js';
import { getChainIDNetwork, getStxFaucetNetwork, stxToMicroStx } from '../../helpers.js';
import { StacksCoreRpcClient } from '../../core-rpc/client.js';
import { isProdEnv, logger } from '@stacks/api-toolkit';
import { ENV } from '../../env.js';
import { FastifyPluginAsync, preHandlerHookHandler } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { fastifyFormbody } from '@fastify/formbody';
import { Server } from 'node:http';
import { OptionalNullable } from '../schemas/util.js';
import { RunFaucetResponseSchema } from '../schemas/responses/responses.js';

const testnetAccounts = [
  {
    secretKey: 'cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df01',
    stacksAddress: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
  },
  {
    secretKey: '21d43d2ae0da1d9d04cfcaac7d397a33733881081f0b2cd038062cf0ccbb752601',
    stacksAddress: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
  },
  {
    secretKey: 'c71700b07d520a8c9731e4d0f095aa6efb91e16e25fb27ce2b72e7b698f8127a01',
    stacksAddress: 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
  },
  {
    secretKey: 'e75dcb66f84287eaf347955e94fa04337298dbd95aa0dbb985771104ef1913db01',
    stacksAddress: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
  },
  {
    secretKey: 'ce109fee08860bb16337c76647dcbc02df0c06b455dd69bcf30af74d4eedd19301',
    stacksAddress: 'STF9B75ADQAVXQHNEQ6KGHXTG7JP305J2GRWF3A2',
  },
  {
    secretKey: '08c14a1eada0dd42b667b40f59f7c8dedb12113613448dc04980aea20b268ddb01',
    stacksAddress: 'ST18MDW2PDTBSCR1ACXYRJP2JX70FWNM6YY2VX4SS',
  },
];

interface SeededAccount {
  secretKey: string;
  stacksAddress: string;
  pubKey: string;
}

export const FAUCET_TESTNET_KEYS: SeededAccount[] = testnetAccounts.map(t => ({
  secretKey: t.secretKey,
  stacksAddress: t.stacksAddress,
  pubKey: publicKeyToString(pubKeyfromPrivKey(t.secretKey)),
}));

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
        summary: 'Add regtest BTC tokens to address',
        description: `Add 0.01 BTC token to the specified regtest BTC address.

        The endpoint returns the transaction ID, which you can use to view the transaction in a regtest Bitcoin block
        explorer. The tokens are delivered once the transaction has been included in a block.

        **Note:** This is a Bitcoin regtest-only endpoint. This endpoint will not work on the Bitcoin mainnet.`,
        tags: ['Faucets'],
        querystring: Type.Object({
          address: Type.Optional(
            Type.String({
              description: 'A valid regtest BTC address',
              examples: ['2N4M94S1ZPt8HfxydXzL2P7qyzgVq7MHWts'],
            })
          ),
          large: Type.Optional(
            Type.Boolean({
              description: 'Request a large amount of regtest BTC than the default',
              default: false,
            })
          ),
          xlarge: Type.Optional(
            Type.Boolean({
              description: 'Request an extra large amount of regtest BTC than the default',
              default: false,
            })
          ),
        }),
        body: OptionalNullable(
          Type.Object({
            address: Type.Optional(
              Type.String({
                description: 'A valid regtest BTC address',
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
                'POST request that initiates a transfer of tokens to a specified Bitcoin regtest address',
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
        let btcAmount = 0.0001;

        if (req.query.large && req.query.xlarge) {
          return await reply.status(400).send({
            error: 'cannot simultaneously request a large and xlarge amount',
            success: false,
          });
        }

        if (req.query.large) {
          btcAmount = 0.01;
        } else if (req.query.xlarge) {
          btcAmount = 0.5;
        }

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
        const forwardedFor = req.headers['x-forwarded-for'];
        const ip =
          (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(',')[0])?.trim() ??
          req.ip;

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

        const tx = await makeBtcFaucetPayment(btc.networks.regtest, address, btcAmount);
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
            description: 'A valid regtest BTC address',
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

  const STX_FAUCET_NETWORK = () => getStxFaucetNetwork();
  const STX_FAUCET_KEYS = (ENV.FAUCET_PRIVATE_KEY ?? FAUCET_TESTNET_KEYS[0].secretKey).split(',');

  async function calculateSTXFaucetAmount(
    network: StacksNetwork,
    stacking: boolean
  ): Promise<bigint> {
    if (stacking) {
      try {
        const poxInfo = await clientFromNetwork(network).getPox();
        let stxAmount = BigInt(poxInfo.min_amount_ustx);
        const padPercent = new BigNumber(0.2);
        const padAmount = new BigNumber(stxAmount.toString())
          .times(padPercent)
          .integerValue()
          .toString();
        stxAmount = stxAmount + BigInt(padAmount);
        return stxAmount;
      } catch (_error) {
        // ignore
      }
    }
    return FAUCET_DEFAULT_STX_AMOUNT;
  }

  async function fetchNetworkChainID(network: StacksNetwork): Promise<number> {
    const rpcClient = clientFromNetwork(network);
    const info = await rpcClient.getInfo();
    return info.network_id;
  }

  async function buildSTXFaucetTx(
    recipient: string,
    amount: bigint,
    network: StacksNetwork,
    senderKey: string,
    nonce: bigint,
    fee?: bigint
  ): Promise<StacksTransaction> {
    try {
      const options: SignedTokenTransferOptions = {
        recipient,
        amount,
        senderKey,
        network,
        memo: 'faucet',
        anchorMode: AnchorMode.Any,
        nonce,
      };
      if (fee) options.fee = fee;

      // Detect possible custom network chain ID
      network.chainId = await fetchNetworkChainID(network);

      return await makeSTXTokenTransfer(options);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      if (
        fee === undefined &&
        (error as Error).message &&
        /estimating transaction fee|NoEstimateAvailable/.test(error.message)
      ) {
        return await buildSTXFaucetTx(recipient, amount, network, senderKey, nonce, 200n);
      }
      throw error;
    }
  }

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
        const forwardedFor = req.headers['x-forwarded-for'];
        const ip =
          (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(',')[0])?.trim() ??
          req.ip;
        const isStackingReq = req.query.stacking ?? false;
        const now = Date.now();

        if (isProdEnv) {
          const lastRequests = await fastify.db.getSTXFaucetRequests(recipientAddress);
          const [window, triggerCount] = isStackingReq
            ? [FAUCET_STACKING_WINDOW, FAUCET_STACKING_TRIGGER_COUNT]
            : [FAUCET_DEFAULT_WINDOW, FAUCET_DEFAULT_TRIGGER_COUNT];
          const requestsInWindow = lastRequests.results
            .map(r => now - r.occurred_at)
            .filter(r => r <= window);
          if (requestsInWindow.length >= triggerCount) {
            logger.warn(`StxFaucet rate limit hit for address ${recipientAddress}`);
            return await reply.status(429).send({
              error: 'Too many requests',
              success: false,
            });
          }
        }

        // Start with a random key index. We will try others in order if this one fails.
        let keyIndex = Math.round(Math.random() * (STX_FAUCET_KEYS.length - 1));
        let keysAttempted = 0;
        let sendSuccess: { txId: string; txRaw: string } | undefined;
        const stxAmount = await calculateSTXFaucetAmount(STX_FAUCET_NETWORK(), isStackingReq);
        const rpcClient = clientFromNetwork(STX_FAUCET_NETWORK());
        do {
          keysAttempted++;
          const senderKey = STX_FAUCET_KEYS[keyIndex];
          const senderAddress = getAddressFromPrivateKey(senderKey, TransactionVersion.Testnet);
          logger.debug(`StxFaucet attempting faucet transaction from sender: ${senderAddress}`);
          const nonces = await fastify.db.getAddressNonces({ stxAddress: senderAddress });
          const tx = await buildSTXFaucetTx(
            recipientAddress,
            stxAmount,
            STX_FAUCET_NETWORK(),
            senderKey,
            BigInt(nonces.possibleNextNonce)
          );
          const rawTx = Buffer.from(tx.serialize());
          try {
            const res = await rpcClient.sendTransaction(rawTx);
            sendSuccess = { txId: res.txId, txRaw: rawTx.toString('hex') };
            logger.info(
              `StxFaucet success. Sent ${stxAmount} uSTX from ${senderAddress} to ${recipientAddress} (txId: ${sendSuccess.txId}).`
            );
          } catch (error) {
            if (
              (error as Error).message?.includes('ConflictingNonceInMempool') ||
              (error as Error).message?.includes('TooMuchChaining')
            ) {
              if (keysAttempted == STX_FAUCET_KEYS.length) {
                logger.warn(
                  `StxFaucet attempts exhausted for all faucet keys. Last error: ${error}`
                );
                throw error;
              }
              // Try with the next key. Wrap around the keys array if necessary.
              keyIndex++;
              if (keyIndex >= STX_FAUCET_KEYS.length) keyIndex = 0;
              logger.warn(
                `StxFaucet transaction failed for sender ${senderAddress}, trying with next key: ${error}`
              );
            } else {
              logger.warn(`StxFaucet unexpected error when sending transaction: ${error}`);
              throw error;
            }
          }
        } while (!sendSuccess);

        await fastify.writeDb?.insertFaucetRequest({
          ip: `${ip}`,
          address: recipientAddress,
          currency: DbFaucetRequestCurrency.STX,
          occurred_at: now,
        });
        await reply.send({
          success: true,
          txId: sendSuccess.txId,
          txRaw: sendSuccess.txRaw,
        });
      });
    }
  );
};
