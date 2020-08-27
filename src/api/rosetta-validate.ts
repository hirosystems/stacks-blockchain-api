import * as Ajv from 'ajv';
import * as RefParser from '@apidevtools/json-schema-ref-parser';
import { logger } from '../helpers';
import {
  RosettaConstants,
  RosettaError,
  RosettaErrors,
  RosettaSchemas,
  SchemaFiles,
  RosettaRequestType,
} from './rosetta-constants';
import { NetworkIdentifier } from '@blockstack/stacks-blockchain-api-types';

export interface ValidSchema {
  valid: boolean;
  error?: string; // discovered during schema validation
  errorType?: string; // discovered using our validation
}

async function validate(schemaFilePath: string, data: any): Promise<ValidSchema> {
  const schemaDef = await RefParser.dereference(schemaFilePath);
  const ajv = new Ajv({ schemaId: 'auto' });
  const valid = await ajv.validate(schemaDef, data);
  if (!valid) {
    logger.error(`Schema validation:\n\n ${JSON.stringify(ajv.errors, null, 2)}`);
    const errors = ajv.errors || [{ message: 'error' }];
    return { valid: false, error: errors[0].message };
  }

  return { valid: true };
}

export async function rosettaValidateRequest(
  url: string,
  body: RosettaRequestType
): Promise<ValidSchema> {
  // Check schemas
  const schemas: SchemaFiles = RosettaSchemas[url];
  if (!schemas) return { valid: true };

  const path = require.resolve(schemas.request);
  const valid = await validate(path, body);

  if (!valid.valid) {
    return valid;
  }

  // Other request checks
  if (RosettaConstants.blockchain != body.network_identifier.blockchain) {
    return { valid: false, errorType: 'invalidBlockchain' };
  }

  if (RosettaConstants.network != body.network_identifier.network) {
    return { valid: false, errorType: 'invalidNetwork' };
  }

  return { valid: true };
}

// TODO: there has to be a better way to go from ajv errors to rosetta errors.
export function makeRosettaError(notValid: ValidSchema): RosettaError {
  let resp: RosettaError = RosettaErrors.unknownError;

  // we've already identified the problem
  if (notValid.errorType !== undefined) {
    return RosettaErrors[notValid.errorType];
  }

  const error = notValid.error || '';
  if (error.search(/network_identifier/) != -1) {
    resp = RosettaErrors.emptyNetworkIdentifier;
    resp.details = { message: error };
  } else if (error.search(/blockchain/) != -1) {
    resp = RosettaErrors.emptyBlockchain;
    resp.details = { message: error };
  } else if (error.search(/network/) != -1) {
    resp = RosettaErrors.emptyNetwork;
    resp.details = { message: error };
  }
  return resp;
}
