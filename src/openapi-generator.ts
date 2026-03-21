import Fastify from 'fastify';
import { TSchema, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import FastifySwagger from '@fastify/swagger';
import { mkdirSync, writeFileSync } from 'fs';
import { OpenApiSchemaOptions } from './api/schemas/openapi.js';
import { StacksApiRoutes } from './api/init.js';
import { ErrorResponseSchema } from './api/schemas/responses/responses.js';

/**
 * Generates `openapi.yaml` based on current Swagger definitions.
 */
async function generateOpenApiFiles() {
  const fastify = Fastify({
    trustProxy: true,
    logger: true,
  }).withTypeProvider<TypeBoxTypeProvider>();

  // If a response schema is defined but lacks a '4xx' response, add it
  fastify.addHook(
    'onRoute',
    (route: { schema?: { response: Record<string | number, TSchema> } }) => {
      if (route.schema?.response && !route.schema?.response['4xx']) {
        route.schema.response['4xx'] = ErrorResponseSchema;
      }
    }
  );

  await fastify.register(FastifySwagger, OpenApiSchemaOptions);
  await fastify.register(StacksApiRoutes);
  await fastify.ready();
  mkdirSync('./docs', { recursive: true });
  writeFileSync('./docs/openapi.yaml', fastify.swagger({ yaml: true }));
  writeFileSync('./docs/openapi.json', JSON.stringify(fastify.swagger(), null, 2));
  await fastify.close();
}

void generateOpenApiFiles();
