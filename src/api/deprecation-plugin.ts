import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';

declare module 'fastify' {
  interface FastifySchema {
    deprecatedMessage?: string;
  }
}

const pluginCb: FastifyPluginAsync<{ defaultDeprecatedMessage: string }> = async (
  fastify,
  options
) => {
  fastify.addHook('onSend', async (request, reply) => {
    if (request.routeOptions.schema?.deprecated) {
      const warningMessage =
        request.routeOptions.schema.deprecatedMessage ??
        options.defaultDeprecatedMessage ??
        'Endpoint is deprecated';
      const warning = `299 - "Deprecated: ${warningMessage}"`;
      if (!reply.getHeader('Warning')) {
        void reply.header('Warning', warning);
      }
    }
  });
  await Promise.resolve();
};

/**
 * Fastify plugin that adds deprecation warnings to HTTP responses.
 *
 * If a route's schema has `deprecated: true`, a `Warning` header will be added to the response.
 * - If the schema includes a `deprecatedMessage`, it will be used in the warning.
 * - If not, the plugin uses the `defaultDeprecatedMessage` provided in the plugin options.
 * - If neither is available, a generic warning message `299 - "Deprecated"` is used.
 */
const DeprecationPlugin = fp(pluginCb);

export default DeprecationPlugin;
