import * as express from 'express';
import * as cors from 'cors';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import { logger, parsePort } from '../../helpers';
import { Agent } from 'http';
import * as fs from 'fs';
import { addAsync } from '@awaitjs/express';
import * as chokidar from 'chokidar';
import * as jsoncParser from 'jsonc-parser';

export const V2_POX_MIN_AMOUNT_USTX_ENV_VAR = 'V2_POX_MIN_AMOUNT_USTX';

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

  const getPoxOverride = () => {
    const overrideEnvVar = process.env[V2_POX_MIN_AMOUNT_USTX_ENV_VAR];
    if (overrideEnvVar) {
      return parseInt(overrideEnvVar);
    } else {
      return undefined;
    }
  };

  logger.info(`/v2/* proxying to: ${stacksNodeRpcEndpoint}`);

  const httpAgent = new Agent({
    keepAlive: true,
    keepAliveMsecs: 60000,
    maxSockets: 200,
    maxTotalSockets: 400,
  });

  const PROXY_CACHE_CONTROL_FILE = '.proxy-cache-control.json';
  const cacheControlFileWatcher = chokidar.watch(PROXY_CACHE_CONTROL_FILE);
  let pathCacheOptions = new Map<RegExp, string | null>();

  const updatePathCacheOptions = () => {
    try {
      const configContent: { paths: Record<string, string> } = jsoncParser.parse(
        fs.readFileSync(PROXY_CACHE_CONTROL_FILE, 'utf8')
      );
      pathCacheOptions = new Map(
        Object.entries(configContent.paths).map(([k, v]) => [RegExp(k), v])
      );
    } catch (error) {
      pathCacheOptions.clear();
      logger.error(`Error reading changes from ${PROXY_CACHE_CONTROL_FILE}`, error);
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

  router.getAsync('/pox', async (req, res, next) => {
    const overrideVal = getPoxOverride();
    if (!overrideVal) {
      next();
      return;
    }
    logger.info(`Overriding /v2/pox 'min_amount_ustx' with ${overrideVal}`);
    const poxRes = await fetch(`http://${stacksNodeRpcEndpoint}${req.originalUrl}`);
    res.header('content-type', poxRes.headers.get('content-type') as string);
    res.status(poxRes.status);
    const poxResString = await poxRes.text();
    try {
      const resJson: { min_amount_ustx: number } = JSON.parse(poxResString);
      resJson.min_amount_ustx = overrideVal;
      const header = getCacheControlHeader(res.statusCode, req.originalUrl);
      if (header) {
        res.header('Cache-Control', header);
      }
      res.json(resJson);
    } catch (error) {
      res.send(poxResString);
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
