import * as Ajv from 'ajv';
import * as RefParser from '@apidevtools/json-schema-ref-parser';
import { hexToBuffer, logger, has0xPrefix } from '../helpers';
import {
  RosettaConstants,
  RosettaError,
  RosettaErrors,
  RosettaSchemas,
  SchemaFiles,
  RosettaRequestType,
} from './rosetta-constants';
import * as T from '@blockstack/stacks-blockchain-api-types';
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
  // remove trailing slashes, if any
  if (url.endsWith('/')) {
    url = url.slice(0, url.length - 1);
  }
  // Check schemas
  const schemas: SchemaFiles = RosettaSchemas[url];
  // Return early if we don't know about this endpoint.
  if (!schemas) return { valid: true };

  const path = require.resolve(schemas.request);
  const valid = await validate(path, body);

  if (!valid.valid) {
    return valid;
  }

  // Other request checks
  if ('network_identifier' in body) {
    if (RosettaConstants.blockchain != body.network_identifier.blockchain) {
      return { valid: false, errorType: 'invalidBlockchain' };
    }

    if (RosettaConstants.network != body.network_identifier.network) {
      return { valid: false, errorType: 'invalidNetwork' };
    }
  }

  if ('block_identifier' in body && !validHexId(body.block_identifier)) {
    return { valid: false, errorType: 'invalidBlockHash' };
  }

  if ('transaction_identifier' in body && !validHexId(body.transaction_identifier)) {
    return { valid: false, errorType: 'invalidTransactionHash' };
  }

  return { valid: true };
}

function validHexId(
  identifier: T.RosettaBlockIdentifier | T.TransactionIdentifier | undefined
): boolean {
  if (identifier === undefined) {
    return true;
  }

  if ('hash' in identifier) {
    let hash = identifier.hash;

    try {
      if (!has0xPrefix(hash)) {
        hash = '0x' + hash;
        hexToBuffer(hash);
      }
    } catch (_e) {
      return false;
    }
  }
  return true;
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
  } else if (error.search(/block_identifier/) != -1) {
    resp = RosettaErrors.invalidBlockIdentifier;
    resp.details = { message: error };
  } else if (error.search(/transaction_identifier/) != -1) {
    resp = RosettaErrors.invalidTransactionIdentifier;
    resp.details = { message: error };
  }
  return resp;
}
