import Fastify from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import FastifySwagger from '@fastify/swagger';
import { mkdirSync, writeFileSync } from 'fs';
import { OpenApiSchemaOptions } from './api/schemas/openapi';
import { StacksApiRoutes } from './api/init';

/**
 * Generates `openapi.yaml` based on current Swagger definitions.
 */
async function generateOpenApiFiles() {
  const fastify = Fastify({
    trustProxy: true,
    logger: true,
  }).withTypeProvider<TypeBoxTypeProvider>();

  await fastify.register(FastifySwagger, OpenApiSchemaOptions);
  await fastify.register(StacksApiRoutes);
  await fastify.ready();
  mkdirSync('./docs/.tmp', { recursive: true });
  writeFileSync('./docs/.tmp/openapi.yaml', fastify.swagger({ yaml: true }));
  writeFileSync('./docs/.tmp/openapi.json', JSON.stringify(fastify.swagger(), null, 2));
  await fastify.close();
}

void generateOpenApiFiles();
