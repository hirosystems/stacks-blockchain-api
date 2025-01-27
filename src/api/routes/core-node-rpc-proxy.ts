import { parsePort, REPO_DIR } from '../../helpers';
import * as fs from 'fs';
import * as path from 'path';
import fetch, { RequestInit } from 'node-fetch';
import { logger } from '../../logger';
import { FastifyPluginAsync } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server, ServerResponse } from 'node:http';
import { fastifyHttpProxy } from '@fastify/http-proxy';
import { StacksCoreRpcClient } from '../../core-rpc/client';
import { parseBoolean } from '@hirosystems/api-toolkit';

function GetStacksNodeProxyEndpoint() {
  // Use STACKS_CORE_PROXY env vars if available, otherwise fallback to `STACKS_CORE_RPC
  const proxyHost =
    process.env['STACKS_CORE_PROXY_HOST'] ?? process.env['STACKS_CORE_RPC_HOST'] ?? '';
  const proxyPort =
    parsePort(process.env['STACKS_CORE_PROXY_PORT'] ?? process.env['STACKS_CORE_RPC_PORT']) ?? 0;
  return `${proxyHost}:${proxyPort}`;
}

function getReqUrl(req: { url: string; hostname: string }): URL {
  return new URL(req.url, `http://${req.hostname}`);
}

function parseFloatEnv(env: string) {
  const envValue = process.env[env];
  if (envValue) {
    const parsed = parseFloat(envValue);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
}

// https://github.com/stacks-network/stacks-core/blob/20d5137438c7d169ea97dd2b6a4d51b8374a4751/stackslib/src/chainstate/stacks/db/blocks.rs#L338
const MINIMUM_TX_FEE_RATE_PER_BYTE = 1;
// https://github.com/stacks-network/stacks-core/blob/eb865279406d0700474748dc77df100cba6fa98e/stackslib/src/core/mod.rs#L212-L218
const DEFAULT_BLOCK_LIMIT_WRITE_LENGTH = 15_000_000;
const DEFAULT_BLOCK_LIMIT_WRITE_COUNT = 15_000;
const DEFAULT_BLOCK_LIMIT_READ_LENGTH = 100_000_000;
const DEFAULT_BLOCK_LIMIT_READ_COUNT = 15_000;
const DEFAULT_BLOCK_LIMIT_RUNTIME = 5_000_000_000;
// https://github.com/stacks-network/stacks-core/blob/9c8ed7b9df51a0b5d96135cb594843091311b20e/stackslib/src/chainstate/stacks/mod.rs#L1096
const BLOCK_LIMIT_SIZE = 2 * 1024 * 1024;

const DEFAULT_FEE_ESTIMATION_MODIFIER = 1.0;
const DEFAULT_FEE_PAST_TENURE_FULLNESS_WINDOW = 5;
const DEFAULT_FEE_PAST_DIMENSION_FULLNESS_THRESHOLD = 0.9;
const DEFAULT_FEE_CURRENT_DIMENSION_FULLNESS_THRESHOLD = 0.5;
const DEFAULT_FEE_CURRENT_BLOCK_COUNT_MINIMUM = 5;

interface FeeEstimation {
  fee: number;
  fee_rate: number;
}
interface FeeEstimateResponse {
  cost_scalar_change_by_byte: number;
  estimated_cost: {
    read_count: number;
    read_length: number;
    runtime: number;
    write_count: number;
    write_length: number;
  };
  estimated_cost_scalar: number;
  estimations: [FeeEstimation, FeeEstimation, FeeEstimation];
}

interface FeeEstimateProxyOptions {
  estimationModifier: number;
  pastTenureFullnessWindow: number;
  pastDimensionFullnessThreshold: number;
  currentDimensionFullnessThreshold: number;
  currentBlockCountMinimum: number;
  readCountLimit: number;
  readLengthLimit: number;
  writeCountLimit: number;
  writeLengthLimit: number;
  runtimeLimit: number;
  sizeLimit: number;
  minTxFeeRatePerByte: number;
}

export const CoreNodeRpcProxyRouter: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  const stacksNodeRpcEndpoint = GetStacksNodeProxyEndpoint();

  logger.info(`/v2/* proxying to: ${stacksNodeRpcEndpoint}`);

  // Default fee estimator options
  let feeEstimatorEnabled = false;
  let didReadTenureCostsFromCore = false;
  const feeOpts: FeeEstimateProxyOptions = {
    estimationModifier: DEFAULT_FEE_ESTIMATION_MODIFIER,
    pastTenureFullnessWindow: DEFAULT_FEE_PAST_TENURE_FULLNESS_WINDOW,
    pastDimensionFullnessThreshold: DEFAULT_FEE_PAST_DIMENSION_FULLNESS_THRESHOLD,
    currentDimensionFullnessThreshold: DEFAULT_FEE_CURRENT_DIMENSION_FULLNESS_THRESHOLD,
    currentBlockCountMinimum: DEFAULT_FEE_CURRENT_BLOCK_COUNT_MINIMUM,
    readCountLimit: DEFAULT_BLOCK_LIMIT_READ_COUNT,
    readLengthLimit: DEFAULT_BLOCK_LIMIT_READ_LENGTH,
    writeCountLimit: DEFAULT_BLOCK_LIMIT_WRITE_COUNT,
    writeLengthLimit: DEFAULT_BLOCK_LIMIT_WRITE_LENGTH,
    runtimeLimit: DEFAULT_BLOCK_LIMIT_RUNTIME,
    sizeLimit: BLOCK_LIMIT_SIZE,
    minTxFeeRatePerByte: MINIMUM_TX_FEE_RATE_PER_BYTE,
  };

  /**
   * Check for any extra endpoints that have been configured for performing a "multicast" for a tx submission.
   */
  async function getExtraTxPostEndpoints(): Promise<string[] | false> {
    const STACKS_API_EXTRA_TX_ENDPOINTS_FILE_ENV_VAR = 'STACKS_API_EXTRA_TX_ENDPOINTS_FILE';
    const extraEndpointsEnvVar = process.env[STACKS_API_EXTRA_TX_ENDPOINTS_FILE_ENV_VAR];
    if (!extraEndpointsEnvVar) {
      return false;
    }
    const filePath = path.resolve(REPO_DIR, extraEndpointsEnvVar);
    let fileContents: string;
    try {
      fileContents = await fs.promises.readFile(filePath, { encoding: 'utf8' });
    } catch (error) {
      logger.error(error, `Error reading ${STACKS_API_EXTRA_TX_ENDPOINTS_FILE_ENV_VAR}`);
      return false;
    }
    const endpoints = fileContents
      .split(/\r?\n/)
      .map(r => r.trim())
      .filter(r => !r.startsWith('#') && r.length !== 0);
    if (endpoints.length === 0) {
      return false;
    }
    return endpoints;
  }

  /**
   * Reads an http request stream into a Buffer.
   */
  async function readRequestBody(req: ServerResponse, maxSizeBytes = Infinity): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      let resultBuffer: Buffer = Buffer.alloc(0);
      req.on('data', chunk => {
        if (!Buffer.isBuffer(chunk)) {
          reject(
            new Error(
              `Expected request body chunks to be Buffer, received ${chunk.constructor.name}`
            )
          );
          req.destroy();
          return;
        }
        resultBuffer = resultBuffer.length === 0 ? chunk : Buffer.concat([resultBuffer, chunk]);
        if (resultBuffer.byteLength >= maxSizeBytes) {
          reject(new Error(`Request body exceeded max byte size`));
          req.destroy();
          return;
        }
      });
      req.on('end', () => {
        resolve(resultBuffer);
      });
      req.on('error', error => reject(error));
    });
  }

  /**
   * Logs a transaction broadcast event alongside the current block height.
   */
  async function logTxBroadcast(response: string): Promise<void> {
    try {
      const blockHeightQuery = await fastify.db.getCurrentBlockHeight();
      if (!blockHeightQuery.found) {
        return;
      }
      const blockHeight = blockHeightQuery.result;
      // Strip wrapping double quotes (if any)
      const txId = response.replace(/^"(.*)"$/, '$1');
      logger.info('Transaction broadcasted', {
        txid: `0x${txId}`,
        first_broadcast_at_stacks_height: blockHeight,
      });
    } catch (error) {
      logger.error(error, 'Error logging tx broadcast');
    }
  }

  /// Retrieves the current Stacks tenure cost limits from the active PoX epoch.
  async function readEpochTenureCostLimits(): Promise<void> {
    const clientInfo = stacksNodeRpcEndpoint.split(':');
    const client = new StacksCoreRpcClient({ host: clientInfo[0], port: clientInfo[1] });
    let attempts = 0;
    while (attempts < 5) {
      try {
        const poxData = await client.getPox();
        const epochLimits = poxData.epochs.pop()?.block_limit;
        if (epochLimits) {
          feeOpts.readCountLimit = epochLimits.read_count;
          feeOpts.readLengthLimit = epochLimits.read_length;
          feeOpts.writeCountLimit = epochLimits.write_count;
          feeOpts.writeLengthLimit = epochLimits.write_length;
          feeOpts.runtimeLimit = epochLimits.runtime;
        }
        logger.info(`CoreNodeRpcProxy successfully retrieved tenure cost limits from core`);
        return;
      } catch (error) {
        logger.warn(error, `CoreNodeRpcProxy unable to get current tenure cost limits`);
        attempts++;
      }
    }
    logger.warn(
      `CoreNodeRpcProxy failed to get tenure cost limits after ${attempts} attempts. Using defaults.`
    );
  }

  /// Checks if we should modify all transaction fee estimations to always use the minimum fee. This
  /// only happens if there is no fee market i.e. if the last N block tenures have not been full. We
  /// use a threshold to determine if a block size dimension is full.
  async function shouldUseTransactionMinimumFee(): Promise<boolean> {
    return await fastify.db.sqlTransaction(async sql => {
      // Check current tenure first. If it's empty after a few blocks, go back to minimum fee.
      const currThreshold = feeOpts.currentDimensionFullnessThreshold;
      const currentCosts = await fastify.db.getCurrentTenureExecutionCosts(sql);
      if (
        currentCosts.block_count >= feeOpts.currentBlockCountMinimum &&
        currentCosts.read_count < feeOpts.readCountLimit * currThreshold &&
        currentCosts.read_length < feeOpts.readLengthLimit * currThreshold &&
        currentCosts.write_count < feeOpts.writeCountLimit * currThreshold &&
        currentCosts.write_length < feeOpts.writeLengthLimit * currThreshold &&
        currentCosts.runtime < feeOpts.runtimeLimit * currThreshold &&
        currentCosts.tx_total_size < feeOpts.sizeLimit * currThreshold
      ) {
        return true;
      }

      // Current tenure is either full-ish or it has just begun. Take a look at past averages. If
      // they are below our past threshold, go to min fee.
      const pastThreshold = feeOpts.pastDimensionFullnessThreshold;
      const pastCosts = await fastify.db.getLastTenureWeightedAverageExecutionCosts(
        sql,
        feeOpts.pastTenureFullnessWindow
      );
      if (!pastCosts) return true;
      return (
        pastCosts.read_count < feeOpts.readCountLimit * pastThreshold &&
        pastCosts.read_length < feeOpts.readLengthLimit * pastThreshold &&
        pastCosts.write_count < feeOpts.writeCountLimit * pastThreshold &&
        pastCosts.write_length < feeOpts.writeLengthLimit * pastThreshold &&
        pastCosts.runtime < feeOpts.runtimeLimit * pastThreshold &&
        pastCosts.tx_total_size < feeOpts.sizeLimit * pastThreshold
      );
    });
  }

  const maxBodySize = 10_000_000; // 10 MB max POST body size
  fastify.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: maxBodySize },
    (_req, body, done) => {
      done(null, body);
    }
  );

  fastify.addHook('onReady', () => {
    feeEstimatorEnabled = parseBoolean(process.env['STACKS_CORE_FEE_ESTIMATOR_ENABLED']);
    if (!feeEstimatorEnabled) return;

    feeOpts.estimationModifier =
      parseFloatEnv('STACKS_CORE_FEE_ESTIMATION_MODIFIER') ?? feeOpts.estimationModifier;
    feeOpts.pastTenureFullnessWindow =
      parseFloatEnv('STACKS_CORE_FEE_PAST_TENURE_FULLNESS_WINDOW') ??
      feeOpts.pastTenureFullnessWindow;
    feeOpts.pastDimensionFullnessThreshold =
      parseFloatEnv('STACKS_CORE_FEE_PAST_DIMENSION_FULLNESS_THRESHOLD') ??
      feeOpts.pastDimensionFullnessThreshold;
    feeOpts.currentDimensionFullnessThreshold =
      parseFloatEnv('STACKS_CORE_FEE_CURRENT_DIMENSION_FULLNESS_THRESHOLD') ??
      feeOpts.currentDimensionFullnessThreshold;
    feeOpts.currentBlockCountMinimum =
      parseFloatEnv('STACKS_CORE_FEE_CURRENT_BLOCK_COUNT_MINIMUM') ??
      feeOpts.currentBlockCountMinimum;
  });

  await fastify.register(fastifyHttpProxy, {
    upstream: `http://${stacksNodeRpcEndpoint}`,
    rewritePrefix: '/v2',
    http2: false,
    globalAgent: true,
    preValidation: async (req, reply) => {
      if (getReqUrl(req).pathname !== '/v2/transactions') {
        return;
      }
      const extraEndpoints = await getExtraTxPostEndpoints();
      if (!extraEndpoints) {
        return;
      }
      const endpoints = [
        // The primary proxy endpoint (the http response from this one will be returned to the client)
        `http://${stacksNodeRpcEndpoint}/v2/transactions`,
      ];
      endpoints.push(...extraEndpoints);
      logger.info(`Overriding POST /v2/transactions to multicast to ${endpoints.join(',')}}`);
      const reqBody = req.body as Buffer;
      const reqHeaders: string[][] = [];
      for (let i = 0; i < req.raw.rawHeaders.length; i += 2) {
        reqHeaders.push([req.raw.rawHeaders[i], req.raw.rawHeaders[i + 1]]);
      }
      const postFn = async (endpoint: string) => {
        const reqOpts: RequestInit = {
          method: 'POST',
          body: reqBody,
          headers: reqHeaders,
        };
        const proxyResult = await fetch(endpoint, reqOpts);
        return proxyResult;
      };

      // Here's were we "multicast" the `/v2/transaction` POST, by concurrently sending the http request to all configured endpoints.
      const results = await Promise.allSettled(endpoints.map(endpoint => postFn(endpoint)));

      // Only the first (non-extra) endpoint http response is proxied back through to the client, so ensure any errors from requests
      // to the extra endpoints are logged.
      results.slice(1).forEach(p => {
        if (p.status === 'rejected') {
          logger.error(
            p.reason,
            `Error during POST /v2/transaction to extra endpoint: ${p.reason}`
          );
        } else {
          if (!p.value.ok) {
            logger.warn(
              `Response ${p.value.status} during POST /v2/transaction to extra endpoint ${p.value.url}`
            );
          }
        }
      });

      // Proxy the result of the (non-extra) http response back to the client.
      const mainResult = results[0];
      if (mainResult.status === 'rejected') {
        logger.error(
          mainResult.reason,
          `Error in primary POST /v2/transaction proxy: ${mainResult.reason}`
        );
        await reply.status(500).send({ error: mainResult.reason });
      } else {
        const proxyResp = mainResult.value;
        if (proxyResp.status === 200) {
          // Log the transaction id broadcast, but clone the `Response` first before parsing its body
          // so we don't mess up the original response's `ReadableStream` pointers.
          const parsedTxId: string = await proxyResp.clone().text();
          await logTxBroadcast(parsedTxId);
        }
        await reply
          .status(proxyResp.status)
          .headers(Object.fromEntries(proxyResp.headers.entries()))
          .send(proxyResp.body);
        console.log('sent');
      }
    },
    replyOptions: {
      onResponse: async (req, reply, response) => {
        // Log the transaction id broadcast
        if (getReqUrl(req).pathname === '/v2/transactions' && reply.statusCode === 200) {
          const responseBuffer = await readRequestBody(response as ServerResponse);
          const txId = responseBuffer.toString();
          await logTxBroadcast(txId);
          await reply.send(responseBuffer);
        } else if (
          getReqUrl(req).pathname === '/v2/fees/transaction' &&
          reply.statusCode === 200 &&
          feeEstimatorEnabled
        ) {
          if (!didReadTenureCostsFromCore) {
            await readEpochTenureCostLimits();
            didReadTenureCostsFromCore = true;
          }
          const reqBody = req.body as {
            estimated_len?: number;
            transaction_payload: string;
          };
          // https://github.com/stacks-network/stacks-core/blob/20d5137438c7d169ea97dd2b6a4d51b8374a4751/stackslib/src/net/api/postfeerate.rs#L200-L201
          const txSize = Math.max(
            reqBody.estimated_len ?? 0,
            reqBody.transaction_payload.length / 2
          );
          const minFee = txSize * feeOpts.minTxFeeRatePerByte;
          const responseBuffer = await readRequestBody(response as ServerResponse);
          const responseJson = JSON.parse(responseBuffer.toString()) as FeeEstimateResponse;

          if (await shouldUseTransactionMinimumFee()) {
            responseJson.estimations.forEach(estimation => {
              estimation.fee = minFee;
            });
          } else {
            // Fall back to Stacks core's estimate, but modify it according to the ENV configured
            // multiplier.
            responseJson.estimations.forEach(estimation => {
              // max(min fee, estimate returned by node * configurable modifier)
              estimation.fee = Math.max(
                minFee,
                Math.round(estimation.fee * feeOpts.estimationModifier)
              );
            });
          }
          await reply.removeHeader('content-length').send(JSON.stringify(responseJson));
        } else {
          await reply.send(response);
        }
      },
    },
  });

  await Promise.resolve();
};
