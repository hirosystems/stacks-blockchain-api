import * as Ajv from 'ajv';
import * as RefParser from '@apidevtools/json-schema-ref-parser';
import { logger, getOrAdd, getOrAddAsync } from '../helpers';

const derefSchemaCache: Map<string, RefParser.JSONSchema> = new Map();
export async function dereferenceSchema(schemaFilePath: string): Promise<RefParser.JSONSchema> {
  return getOrAddAsync(derefSchemaCache, schemaFilePath, () =>
    RefParser.dereference(schemaFilePath)
  );
}

export async function validate(schemaFilePath: string, data: any) {
  if (process.env.NODE_ENV !== 'development') return;

  const schemaDef = await dereferenceSchema(schemaFilePath);
  const ajv = new Ajv({ schemaId: 'auto' });
  const valid = await ajv.validate(schemaDef, data);
  if (!valid) {
    logger.warn(`Schema validation:\n\n ${JSON.stringify(ajv.errors, null, 2)}`);
  }
}
