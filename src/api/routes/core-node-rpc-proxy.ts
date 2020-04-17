import * as express from 'express';
import * as cors from 'cors';
import * as expressProxy from 'express-http-proxy';
import { StacksCoreRpcClient } from '../../core-rpc/client';

export function createCoreNodeRpcProxyRouter(): express.Router {
  const router = express.Router();
  router.use(cors());

  const stacksNodeRpcEndpoint = new StacksCoreRpcClient().endpoint;

  const proxyPathResolver = (req: express.Request): string | Promise<string> => {
    console.info(`Proxy core-node RPC: ${req.originalUrl}`);
    return req.originalUrl;
  };

  const stacksNodeRpcProxy = expressProxy(stacksNodeRpcEndpoint, {
    https: false,
    proxyReqPathResolver: proxyPathResolver,
  });

  router.use(stacksNodeRpcProxy);

  return router;
}
