import Ajv from 'ajv';
import { isValidPrincipal } from '../helpers';
import {
  RosettaConstants,
  RosettaErrors,
  RosettaSchemas,
  SchemaFiles,
  RosettaRequestType,
  getRosettaNetworkName,
  RosettaErrorsTypes,
} from './rosetta-constants';
import { dereferenceSchema, getDocSchemaFile } from './validate';
import { ChainID } from '@stacks/transactions';
import { logger } from '../logger';
import { has0xPrefix, hexToBuffer } from '@hirosystems/api-toolkit';
import {
  RosettaBlockIdentifier,
  RosettaError,
  RosettaPartialBlockIdentifier,
  TransactionIdentifier,
} from '../rosetta/types';

export interface ValidSchema {
  valid: boolean;
  error?: string; // discovered during schema validation
  errorType?: RosettaErrorsTypes; // discovered using our validation
}

async function validate(schemaFilePath: string, data: any): Promise<ValidSchema> {
  const resolvedFilePath = getDocSchemaFile(schemaFilePath);
  const schemaDef = await dereferenceSchema(resolvedFilePath);
  const ajv = new Ajv();
  const valid = ajv.validate(schemaDef, data);
  if (!valid) {
    logger.error(`Schema validation:\n\n ${JSON.stringify(ajv.errors, null, 2)}`);
    const errors = ajv.errors || [{ message: 'error' }];
    return { valid: false, error: errors[0].message };
  }

  return { valid: true };
}

export async function rosettaValidateRequest(
  url: string,
  body: RosettaRequestType,
  chainId: ChainID
): Promise<ValidSchema> {
  // remove trailing slashes, if any
  if (url.endsWith('/')) {
    url = url.slice(0, url.length - 1);
  }
  // Check schemas
  const schemas: SchemaFiles = RosettaSchemas[url];
  // Return early if we don't know about this endpoint.
  if (!schemas) {
    logger.warn(`Schema validation:\n\n unknown endpoint: ${url}`);
    return { valid: true };
  }

  const valid = await validate(schemas.request, body);

  if (!valid.valid) {
    return valid;
  }

  // Other request checks
  if ('network_identifier' in body) {
    if (RosettaConstants.blockchain != body.network_identifier.blockchain) {
      return { valid: false, errorType: RosettaErrorsTypes.invalidBlockchain };
    }

    if (getRosettaNetworkName(chainId) != body.network_identifier.network) {
      return { valid: false, errorType: RosettaErrorsTypes.invalidNetwork };
    }
  }

  if ('block_identifier' in body && !validHexId(body.block_identifier)) {
    return { valid: false, errorType: RosettaErrorsTypes.invalidBlockHash };
  }

  if ('transaction_identifier' in body && !validHexId(body.transaction_identifier)) {
    return { valid: false, errorType: RosettaErrorsTypes.invalidTransactionHash };
  }

  if ('account_identifier' in body && isValidPrincipal(body.account_identifier.address) == false) {
    return { valid: false, errorType: RosettaErrorsTypes.invalidAccount };
  }

  return { valid: true };
}

function validHexId(
  identifier:
    | RosettaBlockIdentifier
    | RosettaPartialBlockIdentifier
    | TransactionIdentifier
    | undefined
): boolean {
  if (identifier === undefined) {
    return true;
  }

  if ('hash' in identifier) {
    let hash = identifier.hash as string;

    if (hash === undefined) {
      return true;
    }

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
export function makeRosettaError(notValid: ValidSchema): Readonly<RosettaError> {
  const error = notValid.error || '';
  if (error.search(/network_identifier/) != -1) {
    return {
      ...RosettaErrors[RosettaErrorsTypes.emptyNetworkIdentifier],
      details: { message: error },
    };
  } else if (error.search(/blockchain/) != -1) {
    return {
      ...RosettaErrors[RosettaErrorsTypes.emptyBlockchain],
      details: { message: error },
    };
  } else if (error.search(/network/) != -1) {
    return {
      ...RosettaErrors[RosettaErrorsTypes.emptyNetwork],
      details: { message: error },
    };
  } else if (error.search(/block_identifier/) != -1) {
    return {
      ...RosettaErrors[RosettaErrorsTypes.invalidBlockIdentifier],
      details: { message: error },
    };
  } else if (error.search(/transaction_identifier/) != -1) {
    return {
      ...RosettaErrors[RosettaErrorsTypes.invalidTransactionIdentifier],
      details: { message: error },
    };
  } else if (error.search(/operations/) != -1) {
    return {
      ...RosettaErrors[RosettaErrorsTypes.invalidOperation],
      details: { message: error },
    };
  } else if (error.search(/must have required property/) != -1) {
    return {
      ...RosettaErrors[RosettaErrorsTypes.invalidParams],
      details: { message: error },
    };
  }

  // we've already identified the problem
  if (notValid.errorType !== undefined) {
    return RosettaErrors[notValid.errorType];
  }

  return RosettaErrors[RosettaErrorsTypes.unknownError];
}
