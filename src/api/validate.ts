import * as Ajv from 'ajv';
import * as RefParser from '@apidevtools/json-schema-ref-parser';
import { logger } from '../helpers';

export async function validate(schemaFilePath: string, data: any) {
  if (process.env.NODE_ENV !== 'development') return;

  const schemaDef = await RefParser.dereference(schemaFilePath);
  const ajv = new Ajv({ schemaId: 'auto' });
  const valid = await ajv.validate(schemaDef, data);
  if (!valid) {
    logger.warn(`Schema validation:\n\n ${JSON.stringify(ajv.errors, null, 2)}`);
  }
}
