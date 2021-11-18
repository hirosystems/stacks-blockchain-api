import * as express from 'express';
import * as core from 'express-serve-static-core';

// TODO: these type generics allow handlers to fully match the types specified in the original (synchronous) express handler.
// But it's horribly verbose and can break if the types package changes. Seems like it should be possible to use some clever
// typescript to transform/extend the `RequestHandler` function type.

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
