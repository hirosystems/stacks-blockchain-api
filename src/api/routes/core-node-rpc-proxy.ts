import * as express from 'express';
import * as cors from 'cors';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import { logger, parsePort } from '../../helpers';
import { Agent, IncomingMessage } from 'http';
import { addAsync } from '@awaitjs/express';

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

  router.getAsync('/pox', async (req, res, next) => {
    const overrideVal = getPoxOverride();
    if (!overrideVal) {
      next();
      return;
    }
    logger.info(`Overriding /v2/pox 'min_amount_ustx' with ${overrideVal}`);
    const poxRes = await fetch(`http://${stacksNodeRpcEndpoint}${req.originalUrl}`);
    res.setHeader('content-type', poxRes.headers.get('content-type') as string);
    res.status(poxRes.status);
    const poxResString = await poxRes.text();
    try {
      const resJson: { min_amount_ustx: number } = JSON.parse(poxResString);
      resJson.min_amount_ustx = overrideVal;
      res.json(resJson);
    } catch (error) {
      res.send(poxResString);
    }
  });

  const proxyOptions: Options = {
    agent: httpAgent,
    target: `http://${stacksNodeRpcEndpoint}`,
    changeOrigin: true,
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
