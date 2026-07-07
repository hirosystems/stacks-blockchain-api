import Fastify from 'fastify';
import { TSchema, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import FastifySwagger from '@fastify/swagger';
import { writeFileSync } from 'fs';
import { OpenApiSchemaOptions } from './api/schemas/openapi.js';
import { StacksApiRoutes } from './api/init.js';
import { ErrorResponseSchema } from './api/schemas/v1/responses/responses.js';

/**
 * Generates an OpenAPI spec based on current Swagger definitions.
 *
 * Controlled by two env vars:
 * - `OPENAPI_OUTPUT`: output file path (defaults to `./openapi.yaml`, the committed public spec).
 * - `OPENAPI_INCLUDE_DEPRECATED`: when `'true'`, deprecated endpoints are kept in the spec. This is
 *   used to generate the input for the client codegen so the client library retains typed bindings
 *   for deprecated endpoints. The committed `openapi.yaml` omits them (default behavior).
 */
async function generateOpenApiFiles() {
  const outputPath = process.env.OPENAPI_OUTPUT ?? './openapi.yaml';
  const includeDeprecated = process.env.OPENAPI_INCLUDE_DEPRECATED === 'true';

  const fastify = Fastify({
    trustProxy: true,
    logger: true,
  }).withTypeProvider<TypeBoxTypeProvider>();

  fastify.addHook(
    'onRoute',
    (route: {
      schema?: {
        response?: Record<string | number, TSchema>;
        deprecated?: boolean;
        hide?: boolean;
      };
    }) => {
      // Exclude deprecated endpoints from the generated spec entirely
      // (`@fastify/swagger` omits any route whose schema is marked `hide`), unless we're
      // generating the client spec, which must retain bindings for deprecated endpoints.
      if (!includeDeprecated && route.schema?.deprecated) {
        route.schema.hide = true;
        return;
      }
      // If a response schema is defined but lacks a '4xx' response, add it
      if (route.schema?.response && !route.schema?.response['4xx']) {
        route.schema.response['4xx'] = ErrorResponseSchema;
      }
    }
  );

  await fastify.register(FastifySwagger, OpenApiSchemaOptions);
  await fastify.register(StacksApiRoutes);
  await fastify.ready();
  writeFileSync(outputPath, fastify.swagger({ yaml: true }));
  await fastify.close();
}

void generateOpenApiFiles();
