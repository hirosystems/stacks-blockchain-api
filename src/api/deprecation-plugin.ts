import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';

declare module 'fastify' {
  interface FastifySchema {
    deprecatedMessage?: string;
    /**
     * Marks a `deprecated` route that keeps serving when `ENABLE_DEPRECATED_ENDPOINTS` is off. It
     * still gets the `Warning` header and is still hidden from the OpenAPI spec; it is only exempt
     * from the `410 Gone` sunset kill switch.
     */
    deprecatedExemptFromSunset?: boolean;
  }
}

const pluginCb: FastifyPluginAsync<{
  defaultDeprecatedMessage: string;
  /**
   * When `false`, every route whose schema is marked `deprecated` is disabled and responds with
   * `410 Gone`, unless it is also marked `deprecatedExemptFromSunset`. Defaults to enabled when
   * omitted.
   */
  enableDeprecatedEndpoints?: boolean;
}> = async (fastify, options) => {
  // When deprecated endpoints are disabled (e.g. past a sunset date), short-circuit any route
  // whose schema is marked `deprecated` (and not `deprecatedExemptFromSunset`) with a `410 Gone`
  // before its handler (and any DB work) runs. `onRequest` is the earliest hook with
  // `routeOptions` populated.
  if (options.enableDeprecatedEndpoints === false) {
    fastify.addHook('onRequest', async (request, reply) => {
      const schema = request.routeOptions.schema;
      if (schema?.deprecated && !schema.deprecatedExemptFromSunset) {
        const message =
          schema.deprecatedMessage ?? options.defaultDeprecatedMessage ?? 'Endpoint is deprecated';
        return reply.code(410).send({
          error: 'Gone',
          message: `This endpoint has been disabled. ${message}`,
        });
      }
    });
  }

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
 * Fastify plugin that handles deprecated API endpoints.
 *
 * If a route's schema has `deprecated: true`, a `Warning` header will be added to the response.
 * - If the schema includes a `deprecatedMessage`, it will be used in the warning.
 * - If not, the plugin uses the `defaultDeprecatedMessage` provided in the plugin options.
 * - If neither is available, a generic warning message like `299 - "Deprecated: Endpoint is deprecated"` is used.
 *
 * If `enableDeprecatedEndpoints` is `false`, all deprecated routes are disabled and respond with
 * `410 Gone` instead of executing. This is the master kill-switch flipped at a sunset date.
 * Routes that also set `deprecatedExemptFromSunset: true` are exempt and keep serving (still with
 * the `Warning` header): use it for endpoints that are deprecated in favor of a newer version but
 * are not part of the planned sunset.
 */
const DeprecationPlugin = fp(pluginCb);

export default DeprecationPlugin;
