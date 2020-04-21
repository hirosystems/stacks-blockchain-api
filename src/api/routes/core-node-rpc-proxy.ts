import * as express from 'express';
import * as cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { StacksCoreRpcClient } from '../../core-rpc/client';

export function createCoreNodeRpcProxyRouter(): express.Router {
  const router = express.Router();
  router.use(cors());

  const stacksNodeRpcEndpoint = new StacksCoreRpcClient().endpoint;

  const stacksNodeRpcProxy = createProxyMiddleware({
    target: `http://${stacksNodeRpcEndpoint}`,
    changeOrigin: true,
  });

  router.use(stacksNodeRpcProxy);

  return router;
}
