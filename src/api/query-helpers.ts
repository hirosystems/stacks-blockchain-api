import { NextFunction, Request, Response } from 'express';

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
