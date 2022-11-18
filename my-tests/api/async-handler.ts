/**
 * Inspired by https://github.com/Abazhenov/express-async-handler
 * Modified to improve type definitions so that they fully match the
 * types specified in the original (synchronous) Express handler.
 *
 * This is used as an alternative to the async Express extensions
 * provided by the `@awaitjs/express` lib, e.g. `router.getAsync`,
 * because it has incorrect/bugged behavior when given multiple router
 * handler functions. It executes both synchronously at the same time,
 * breaking the ability for the handlers to control the route flow
 * based on the order in which they are specified.
 */
import * as express from 'express';
import * as core from 'express-serve-static-core';

export function asyncHandler<
  P = core.ParamsDictionary,
  ResBody = any,
  ReqBody = any,
  ReqQuery = core.Query,
  Locals extends Record<string, any> = Record<string, any>
>(
  handler: (
    ...args: Parameters<express.RequestHandler<P, ResBody, ReqBody, ReqQuery, Locals>>
  ) => void | Promise<void>
): express.RequestHandler<P, ResBody, ReqBody, ReqQuery, Locals> {
  return function asyncUtilWrap(
    ...args: Parameters<express.RequestHandler<P, ResBody, ReqBody, ReqQuery, Locals>>
  ) {
    const next = args[args.length - 1] as core.NextFunction;
    try {
      const fnReturn = handler(...args);
      return Promise.resolve(fnReturn).catch(next);
    } catch (error) {
      next(error);
    }
  };
}
