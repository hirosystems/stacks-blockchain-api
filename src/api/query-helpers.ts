import { ClarityAbi } from '@stacks/transactions';
import { NextFunction, Request, Response } from 'express';
import { has0xPrefix, hexToBuffer, parseEventTypeStrings, isValidPrincipal } from './../helpers';
import { InvalidRequestError, InvalidRequestErrorType } from '../errors';
import { DbEventTypeId } from './../datastore/common';

function handleBadRequest(res: Response, next: NextFunction, errorMessage: string): never {
  const error = new InvalidRequestError(errorMessage, InvalidRequestErrorType.bad_request);
  res.status(400).json({ error: errorMessage });
  next(error);
  throw error;
}

export function booleanValueForParam(
  req: Request,
  res: Response,
  next: NextFunction,
  paramName: string
): boolean | never {
  if (!(paramName in req.query)) {
    return false;
  }
  const paramVal = req.query[paramName];
  if (typeof paramVal === 'string') {
    const normalizedParam = paramVal.toLowerCase();
    switch (normalizedParam) {
      case 'true':
      case '1':
      case 'yes':
      case 'on':
      // If specified without a value, e.g. `?paramName` then treat it as true
      case '':
        return true;
      case 'false':
      case '0':
      case 'no':
      case 'off':
        return false;
    }
  }
  handleBadRequest(
    res,
    next,
    `Unexpected value for '${paramName}' parameter: ${JSON.stringify(paramVal)}`
  );
}

/**
 * Determines if the query parameters of a request are intended to include unanchored tx data.
 * If an error is encountered while parsing the query param then a 400 response with an error message
 * is sent and the function returns `void`.
 */
export function isUnanchoredRequest(
  req: Request,
  res: Response,
  next: NextFunction
): boolean | never {
  const paramName = 'unanchored';
  return booleanValueForParam(req, res, next, paramName);
}

/**
 * Determines if the query parameters of a request are intended to include data for a specific block height,
 * or if the request intended to include unanchored tx data. If neither a block height parameter or an unanchored
 * parameter are given, then we assume the request is not intended for a specific block, and that it's not intended
 * to include unanchored tx data.
 * If an error is encountered while parsing the params then a 400 response with an error message is sent and the function throws.
 */
export function getBlockParams(
  req: Request,
  res: Response,
  next: NextFunction
):
  | {
      blockHeight: number;
      includeUnanchored?: boolean;
    }
  | {
      includeUnanchored: boolean;
      blockHeight?: number;
    }
  | never {
  if ('height' in req.query || 'block_height' in req.query) {
    const heightQueryValue = req.query['height'] ?? req.query['block_height'];
    if (typeof heightQueryValue !== 'string') {
      handleBadRequest(
        res,
        next,
        `Unexpected type for 'height' parameter: ${JSON.stringify(heightQueryValue)}`
      );
    }
    const heightFilter = parseInt(heightQueryValue, 10);
    if (!Number.isInteger(heightFilter)) {
      handleBadRequest(
        res,
        next,
        `Query parameter 'height' is not a valid integer: ${req.query['height']}`
      );
    }
    if (heightFilter < 1) {
      handleBadRequest(
        res,
        next,
        `Query parameter 'height' is not a positive integer: ${heightFilter}`
      );
    }
    return { blockHeight: heightFilter };
  } else {
    return { includeUnanchored: isUnanchoredRequest(req, res, next) };
  }
}

/**
 * Parses a block height value from a given request query param.
 * If an error is encountered while parsing the param then a 400 response with an error message is sent and the function throws.
 * @param queryParamName - name of the query param
 * @param paramRequired - if true then the function will throw and return a 400 if the param is missing, if false then the function will return null if the param is missing
 */
export function getBlockHeightQueryParam<TRequired extends boolean>(
  queryParamName: string,
  paramRequired: TRequired,
  req: Request,
  res: Response,
  next: NextFunction
): TRequired extends true ? number | never : number | null {
  if (!(queryParamName in req.query)) {
    if (paramRequired) {
      handleBadRequest(
        res,
        next,
        `Request is missing required "${queryParamName}" query parameter`
      );
    } else {
      return null as TRequired extends true ? number : number | null;
    }
  }
  const heightParamVal = req.query[queryParamName];
  if (typeof heightParamVal !== 'string') {
    handleBadRequest(
      res,
      next,
      `Unexpected type for block height query parameter: ${JSON.stringify(heightParamVal)}`
    );
  }
  const height = parseInt(heightParamVal, 10);
  if (!Number.isInteger(height)) {
    handleBadRequest(
      res,
      next,
      `Unexpected non-integer value for block height query parameter': ${heightParamVal}}`
    );
  }
  if (height < 1) {
    handleBadRequest(
      res,
      next,
      `Unexpected integer value for block height query parameter: ${heightParamVal}`
    );
  }
  return height;
}

/**
 * Determines the block height path parameters of a request.
 * If an error is encountered while parsing the params then a 400 response with an error message is sent and the function throws.
 */
export function getBlockHeightPathParam(
  req: Request,
  res: Response,
  next: NextFunction
): number | never {
  if (!('height' in req.params) && !('block_height' in req.params)) {
    handleBadRequest(res, next, `Request is missing required block height path parameter`);
  }
  const heightParamVal = req.params['height'] ?? req.params['block_height'];
  if (typeof heightParamVal !== 'string') {
    handleBadRequest(
      res,
      next,
      `Unexpected type for block height path parameter: ${JSON.stringify(heightParamVal)}`
    );
  }
  const height = parseInt(heightParamVal, 10);
  if (!Number.isInteger(height)) {
    handleBadRequest(
      res,
      next,
      `Unexpected non-integer value for block height path parameter': ${heightParamVal}}`
    );
  }
  if (height < 1) {
    handleBadRequest(
      res,
      next,
      `Unexpected integer value for block height path parameter: ${heightParamVal}`
    );
  }
  return height;
}

/**
 * Determine if until_block query parameter exists or is an integer or string or if it is a valid height
 * if it is a string with "0x" prefix consider it a block_hash if it is integer consider it block_height
 * If type is not string or block_height is not valid or it also has mutually exclusive "unanchored" property a 400 bad requst is send and function throws.
 * @returns `undefined` if param does not exist || block_height if number || block_hash if string || never if error
 */
export function parseUntilBlockQuery(
  req: Request,
  res: Response,
  next: NextFunction
): undefined | number | string | never {
  const untilBlock = req.query.until_block;
  if (!untilBlock) return;
  if (typeof untilBlock === 'string') {
    //if mutually exclusive unachored is also specified, throw bad request error
    if (isUnanchoredRequest(req, res, next)) {
      handleBadRequest(
        res,
        next,
        `can't handle both 'unanchored' and 'until_block' in the same request `
      );
    }
    if (has0xPrefix(untilBlock)) {
      //case for block_hash
      return untilBlock;
    } else {
      //parse int to check if it is a block_height
      const block_height = Number.parseInt(untilBlock, 10);
      if (isNaN(block_height) || block_height < 1) {
        handleBadRequest(
          res,
          next,
          `Unexpected integer value for block height path parameter: ${block_height}`
        );
      }
      return block_height;
    }
  }
  handleBadRequest(res, next, 'until_block must be either `string` or `number`');
}

export function parseTraitAbi(req: Request, res: Response, next: NextFunction): ClarityAbi | never {
  if (!('trait_abi' in req.query)) {
    handleBadRequest(res, next, `Can't find query param 'trait_abi'`);
  }
  const trait = req.query.trait_abi;
  if (typeof trait === 'string') {
    const trait_abi: ClarityAbi = JSON.parse(trait);
    if (!('functions' in trait_abi)) {
      handleBadRequest(res, next, `Invalid 'trait_abi'`);
    }
    return trait_abi;
  }
  handleBadRequest(res, next, `Invalid 'trait_abi'`);
}

export function validateRequestHexInput(hash: string) {
  try {
    const buffer = hexToBuffer(hash);
    if (buffer.toString('hex') !== hash.substring(2).toLowerCase()) {
      throw new Error('Invalid hash characters');
    }
  } catch (error: any) {
    throw new InvalidRequestError(error.message, InvalidRequestErrorType.invalid_hash);
  }
}

export function validatePrincipal(stxAddress: string) {
  if (!isValidPrincipal(stxAddress)) {
    throw new InvalidRequestError(
      `invalid STX address "${stxAddress}"`,
      InvalidRequestErrorType.invalid_address
    );
  }
}

export function parseAddressOrTxId(
  req: Request,
  res: Response,
  next: NextFunction
): { address: string; txId: undefined } | { address: undefined; txId: string } | never {
  const address = req.query.address;
  const txId = req.query.tx_id;
  if (!address && !txId) {
    handleBadRequest(res, next, `can not find 'address' or 'tx_id' in the request`);
  }
  if (address && txId) {
    //if mutually exclusive address and txId specified throw
    handleBadRequest(res, next, `can't handle both 'address' and 'tx_id' in the same request`);
  }
  if (address) {
    if (typeof address === 'string') {
      validatePrincipal(address);
      return { address, txId: undefined };
    }
    handleBadRequest(res, next, `invalid 'address'`);
  }
  if (typeof txId === 'string') {
    const txIdHex = has0xPrefix(txId) ? txId : '0x' + txId;
    validateRequestHexInput(txIdHex);
    return { address: undefined, txId: txIdHex };
  }
  handleBadRequest(res, next, `invalid 'tx_id'`);
}

export function parseEventTypeFilter(
  req: Request,
  res: Response,
  next: NextFunction
): DbEventTypeId[] {
  const typeQuery = req.query.type;
  let eventTypeFilter: DbEventTypeId[];
  if (Array.isArray(typeQuery)) {
    try {
      eventTypeFilter = parseEventTypeStrings(typeQuery as string[]);
    } catch (error) {
      handleBadRequest(res, next, `invalid 'event type'`);
    }
  } else if (typeof typeQuery === 'string') {
    try {
      eventTypeFilter = parseEventTypeStrings([typeQuery]);
    } catch (error) {
      handleBadRequest(res, next, `invalid 'event type'`);
    }
  } else if (typeQuery) {
    handleBadRequest(res, next, `invalid 'event type format'`);
  } else {
    eventTypeFilter = [
      DbEventTypeId.SmartContractLog,
      DbEventTypeId.StxAsset,
      DbEventTypeId.FungibleTokenAsset,
      DbEventTypeId.NonFungibleTokenAsset,
      DbEventTypeId.StxLock,
    ]; //no filter provided , return all types of events
  }

  return eventTypeFilter;
}
export function isValidTxId(tx_id: string) {
  try {
    validateRequestHexInput(tx_id);
    return true;
  } catch {
    return false;
  }
}
