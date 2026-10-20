import { FastifyPluginAsync } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { fastifyHttpProxy } from '@fastify/http-proxy';
import { logger } from '@stacks/api-toolkit';
import { ENV } from '../../../env.js';

function GetStacksNodeProxyEndpoint() {
  // Proxy host/port are optional and fall back to the core node RPC host/port when unset.
  const proxyHost = ENV.STACKS_CORE_PROXY_HOST ?? ENV.STACKS_CORE_RPC_HOST;
  const proxyPort = ENV.STACKS_CORE_PROXY_PORT ?? ENV.STACKS_CORE_RPC_PORT;
  return `${proxyHost}:${proxyPort}`;
}

/**
 * Transparently proxies `/v2` requests to the Stacks node RPC. Request and response bodies are
 * streamed through unmodified. Tx multicasting and fee estimation adjustments live in the separate
 * `stacks-node-rpc-proxy` service.
 */
export const CoreNodeRpcProxyRouter: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  const stacksNodeRpcEndpoint = GetStacksNodeProxyEndpoint();

  logger.info(`Proxying Stacks node RPC calls to ${stacksNodeRpcEndpoint}`);

  await fastify.register(fastifyHttpProxy, {
    upstream: `http://${stacksNodeRpcEndpoint}`,
    rewritePrefix: '/v2',
    http2: false,
    globalAgent: true,
  });
};
