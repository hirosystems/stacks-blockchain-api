import * as express from 'express';
import * as cors from 'cors';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import { logger, parsePort } from '../../helpers';
import { Agent } from 'http';
import * as fs from 'fs';
import { addAsync } from '@awaitjs/express';
import * as chokidar from 'chokidar';
import * as jsoncParser from 'jsonc-parser';

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
