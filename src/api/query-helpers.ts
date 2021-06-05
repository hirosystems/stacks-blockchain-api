import { NextFunction, Request, Response } from 'express';

/**
 * Determines if the query parameters of a request are intended to include unanchored tx data.
 * If an error is encountered while parsing the query param then a 400 response with an error message
 * is sent and the function returns `void`.
 */
export function isUnanchoredRequest(
  req: Request,
  res: Response,
  next: NextFunction
): boolean | void {
  const paramName = 'unanchored';
  if (!(paramName in req.query)) {
    return false;
  }
  const paramVal = req.query[paramName];
  // If param is specified without a value, e.g. `?unanchored&thing=1` then treat it as true
  if (paramVal === undefined) {
    return true;
  }
  if (typeof paramVal === 'string') {
    const normalizedParam = paramVal.toLowerCase();
    switch (normalizedParam) {
      case 'true':
      case '1':
      case 'yes':
      case 'on':
      case '':
        return true;
      case 'false':
      case '0':
      case 'no':
      case 'off':
        return false;
    }
  }
  const errMsg = `Unexpected value for 'unanchored' parameter: ${JSON.stringify(paramVal)}`;
  res.status(400).json({ error: errMsg });
  next(new Error(errMsg));
  return void 0;
}
