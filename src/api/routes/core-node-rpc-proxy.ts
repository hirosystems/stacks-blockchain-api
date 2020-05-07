import express from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { StacksCoreRpcClient } from '../../core-rpc/client';

export function createCoreNodeRpcProxyRouter(): express.Router {
  const router = express.Router();
  router.use(cors());

  const stacksNodeRpcEndpoint = new StacksCoreRpcClient().endpoint;

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
