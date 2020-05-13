import * as Ajv from 'ajv';
import { logger } from '../helpers';

export async function validate(schema: any, data: any) {
  if (process.env.NODE_ENV !== 'development') return;
  const ajv = new Ajv({ schemaId: 'auto' });
  const valid = await ajv.validate(schema, data);
  if (!valid) logger.warn(`Schema validation:\n\n ${JSON.stringify(ajv.errors, null, 2)}`);
}
