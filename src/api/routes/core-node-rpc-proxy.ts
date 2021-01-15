import * as express from 'express';
import * as cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { parsePort } from '../../helpers';

export function createCoreNodeRpcProxyRouter(): express.Router {
  const router = express.Router();
  router.use(cors());

  // Use STACKS_CORE_PROXY env vars if available, otherwise fallback to `STACKS_CORE_RPC
  const proxyHost =
    process.env['STACKS_CORE_PROXY_HOST'] ?? process.env['STACKS_CORE_RPC_HOST'] ?? '';
  const proxyPort =
    parsePort(process.env['STACKS_CORE_PROXY_PORT'] ?? process.env['STACKS_CORE_RPC_PORT']) ?? 0;

  const stacksNodeRpcEndpoint = `${proxyHost}:${proxyPort}`;

  const stacksNodeRpcProxy = createProxyMiddleware({
    target: `http://${stacksNodeRpcEndpoint}`,
    changeOrigin: true,
    onError: (error, req, res) => {
      const msg =
        (error as any).code === 'ECONNREFUSED'
          ? 'core node unresponsive'
          : 'cannot connect to core node';
      res.status(502).json({ message: msg, error: error });
    },
  });

  router.use(stacksNodeRpcProxy);

  return router;
}
