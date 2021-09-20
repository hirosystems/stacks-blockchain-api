import * as express from 'express';
import * as cors from 'cors';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import { logError, logger, parsePort, pipelineAsync } from '../../helpers';
import { Agent } from 'http';
import * as fs from 'fs';
import { addAsync } from '@awaitjs/express';
import * as chokidar from 'chokidar';
import * as jsoncParser from 'jsonc-parser';
import fetch, { RequestInit } from 'node-fetch';

export function GetStacksNodeProxyEndpoint() {
  // Use STACKS_CORE_PROXY env vars if available, otherwise fallback to `STACKS_CORE_RPC
  const proxyHost =
    process.env['STACKS_CORE_PROXY_HOST'] ?? process.env['STACKS_CORE_RPC_HOST'] ?? '';
  const proxyPort =
    parsePort(process.env['STACKS_CORE_PROXY_PORT'] ?? process.env['STACKS_CORE_RPC_PORT']) ?? 0;
  return `${proxyHost}:${proxyPort}`;
}

export function createCoreNodeRpcProxyRouter(): express.Router {
  const router = addAsync(express.Router());
  router.use(cors());

  const stacksNodeRpcEndpoint = GetStacksNodeProxyEndpoint();

  logger.info(`/v2/* proxying to: ${stacksNodeRpcEndpoint}`);

  // Note: while keep-alive may result in some performance improvements with the stacks-node http server,
  // it can also cause request distribution issues when proxying to a pool of stacks-nodes. See:
  // https://github.com/blockstack/stacks-blockchain-api/issues/756
  const httpAgent = new Agent({
    // keepAlive: true,
    keepAlive: false, // `false` is the default -- set it explicitly for readability anyway.
    // keepAliveMsecs: 60000,
    maxSockets: 200,
    maxTotalSockets: 400,
  });

  const PROXY_CACHE_CONTROL_FILE_ENV_VAR = 'STACKS_API_PROXY_CACHE_CONTROL_FILE';
  let proxyCacheControlFile = '.proxy-cache-control.json';
  if (process.env[PROXY_CACHE_CONTROL_FILE_ENV_VAR]) {
    proxyCacheControlFile = process.env[PROXY_CACHE_CONTROL_FILE_ENV_VAR] as string;
    logger.info(`Using ${proxyCacheControlFile}`);
  }
  const cacheControlFileWatcher = chokidar.watch(proxyCacheControlFile, {
    persistent: false,
    useFsEvents: false,
    ignoreInitial: true,
  });
  let pathCacheOptions = new Map<RegExp, string | null>();

  const updatePathCacheOptions = () => {
    try {
      const configContent: { paths: Record<string, string> } = jsoncParser.parse(
        fs.readFileSync(proxyCacheControlFile, 'utf8')
      );
      pathCacheOptions = new Map(
        Object.entries(configContent.paths).map(([k, v]) => [RegExp(k), v])
      );
    } catch (error) {
      pathCacheOptions.clear();
      logger.error(`Error reading changes from ${proxyCacheControlFile}`, error);
    }
  };
  updatePathCacheOptions();
  cacheControlFileWatcher.on('all', (eventName, path, stats) => {
    updatePathCacheOptions();
  });

  const getCacheControlHeader = (statusCode: number, url: string): string | null => {
    if (statusCode < 200 || statusCode > 299) {
      return null;
    }
    for (const [regexp, cacheControl] of pathCacheOptions.entries()) {
      if (cacheControl && regexp.test(url)) {
        return cacheControl;
      }
    }
    return null;
  };

  /**
   * Check for any extra endpoints that have been configured for performing a "multicast" for a tx submission.
   */
  function getExtraTxPostEndpoints(): string[] | false {
    const STACKS_EXTRA_TX_POST_ENDPOINTS_ENV_VAR = 'STACKS_EXTRA_TX_POST_ENDPOINTS';
    const extraEndpoints = process.env[STACKS_EXTRA_TX_POST_ENDPOINTS_ENV_VAR];
    if (!extraEndpoints) {
      return false;
    }
    const endpointsArray = extraEndpoints.split(',').map(r => r.trim());
    return endpointsArray;
  }

  /**
   * Reads an http request stream into a Buffer.
   */
  async function readRequestBody(req: express.Request, maxSizeBytes = Infinity): Promise<Buffer> {
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
        if (!req.complete) {
          return reject(
            new Error('The connection was terminated while the message was still being sent')
          );
        }
        resolve(resultBuffer);
      });
      req.on('error', error => reject(error));
    });
  }

  router.postAsync('/transactions', async (req, res, next) => {
    const extraEndpoints = getExtraTxPostEndpoints();
    if (!extraEndpoints) {
      next();
      return;
    }
    const endpoints = [
      // The primary proxy endpoint (the http response from this one will be returned to the client)
      `http://${stacksNodeRpcEndpoint}/v2/transactions`,
    ];
    endpoints.push(...extraEndpoints);
    logger.info(`Overriding POST /v2/transactions to multicast to ${endpoints.join(',')}}`);
    const maxBodySize = 10_000_000; // 10 MB max POST body size
    const reqBody = await readRequestBody(req, maxBodySize);
    const reqHeaders: string[][] = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      reqHeaders.push([req.rawHeaders[i], req.rawHeaders[i + 1]]);
    }
    const postFn = async (endpoint: string) => {
      const reqOpts: RequestInit = {
        method: 'POST',
        agent: httpAgent,
        body: reqBody,
        headers: reqHeaders,
      };
      const proxyResult = await fetch(endpoint, reqOpts);
      return proxyResult;
    };

    // Here's were we "multicast" the `/v2/transaction` POST, by concurrently sending the http request to all configured endpoints.
    const results = await Promise.allSettled(endpoints.map(endpoint => postFn(endpoint)));

    // Log any errors from requests to the extra endpoints, because only the first (non-extra) endpoint http response
    // is proxied back through to the client.
    results.slice(1).forEach(p => {
      if (p.status === 'rejected') {
        logError(`Error during POST /v2/transaction to extra endpoint: ${p.reason}`, p.reason);
      } else {
        if (!p.value.ok) {
          logError(
            `Response ${p.value.status} during POST /v2/transaction to extra endpoint ${p.value.url}`
          );
        }
      }
    });

    // Proxy the result of the (non-extra) http response back to the client.
    const mainResult = results[0];
    if (mainResult.status === 'rejected') {
      logError(
        `Error in primary POST /v2/transaction proxy: ${mainResult.reason}`,
        mainResult.reason
      );
      res.status(500).json({ error: mainResult.reason });
    } else {
      const proxyResp = mainResult.value;
      res.status(proxyResp.status);
      proxyResp.headers.forEach((value, name) => {
        res.setHeader(name, value);
      });
      await pipelineAsync(proxyResp.body, res);
    }
  });

  const proxyOptions: Options = {
    agent: httpAgent,
    target: `http://${stacksNodeRpcEndpoint}`,
    changeOrigin: true,
    onProxyRes: (proxyRes, req, res) => {
      const header = getCacheControlHeader(res.statusCode, req.url);
      if (header) {
        proxyRes.headers['Cache-Control'] = header;
      }
    },
    onError: (error, req, res) => {
      const msg =
        (error as any).code === 'ECONNREFUSED'
          ? 'core node unresponsive'
          : 'cannot connect to core node';
      res.status(502).json({ message: msg, error: error });
    },
  };

  const stacksNodeRpcProxy = createProxyMiddleware(proxyOptions);

  router.use(stacksNodeRpcProxy);

  return router;
}
