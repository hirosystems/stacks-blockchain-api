import { NextFunction, Request, Response } from 'express';
import { has0xPrefix } from './../helpers';

function handleBadRequest(res: Response, next: NextFunction, errorMessage: string): never {
  const error = new Error(errorMessage);
  res.status(400).json({ error: errorMessage });
  next(error);
  throw error;
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
      // If specified without a value, e.g. `?unanchored&thing=1` then treat it as true
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
    `Unexpected value for 'unanchored' parameter: ${JSON.stringify(paramVal)}`
  );
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
 * @returns - undefined  if  param does not exist || block_height if number || block_hash if string || never if error
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
