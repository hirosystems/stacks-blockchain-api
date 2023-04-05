import * as express from 'express';
import { BlockListResponse } from '@stacks/stacks-blockchain-api-types';
import { getBlockFromDataStore, getBlocksWithMetadata } from '../controllers/db-controller';
import { has0xPrefix } from '../../helpers';
import { InvalidRequestError, InvalidRequestErrorType } from '../../errors';
import { getPagingQueryLimit, parsePagingQueryInput, ResourceType } from '../pagination';
import { getBlockHeightPathParam, validateRequestHexInput } from '../query-helpers';
import { getETagCacheHandler, setETagCacheHeaders } from '../controllers/cache-controller';
import { asyncHandler } from '../async-handler';
import { PgStore } from '../../datastore/pg-store';

export function createBlockRouter(db: PgStore): express.Router {
  const router = express.Router();
  const cacheHandler = getETagCacheHandler(db);
  router.get(
    '/',
    cacheHandler,
    asyncHandler(async (req, res) => {
      const limit = getPagingQueryLimit(ResourceType.Block, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);

      const { results, total } = await getBlocksWithMetadata({ offset, limit, db });
      setETagCacheHeaders(res);
      // TODO: block schema validation
      const response: BlockListResponse = { limit, offset, total, results };
      res.json(response);
    })
  );

  router.get(
    '/by_height/:height',
    cacheHandler,
    asyncHandler(async (req, res, next) => {
      const height = getBlockHeightPathParam(req, res, next);
      const block = await getBlockFromDataStore({ blockIdentifer: { height }, db });
      if (!block.found) {
        res.status(404).json({ error: `cannot find block by height ${height}` });
        return;
      }
      setETagCacheHeaders(res);
      // TODO: block schema validation
      res.json(block.result);
    })
  );

  router.get(
    '/by_burn_block_height/:burnBlockHeight',
    cacheHandler,
    asyncHandler(async (req, res) => {
      const burnBlockHeight = parseInt(req.params['burnBlockHeight'], 10);
      if (!Number.isInteger(burnBlockHeight)) {
        throw new InvalidRequestError(
          `burnchain height is not a valid integer: ${req.params['burnBlockHeight']}`,
          InvalidRequestErrorType.invalid_param
        );
      }
      if (burnBlockHeight < 1) {
        throw new InvalidRequestError(
          `burnchain height is not a positive integer: ${burnBlockHeight}`,
          InvalidRequestErrorType.invalid_param
        );
      }
      const block = await getBlockFromDataStore({ blockIdentifer: { burnBlockHeight }, db });
      if (!block.found) {
        res.status(404).json({ error: `cannot find block by height ${burnBlockHeight}` });
        return;
      }
      setETagCacheHeaders(res);
      // TODO: block schema validation
      res.json(block.result);
    })
  );

  router.get(
    '/:hash',
    cacheHandler,
    asyncHandler(async (req, res) => {
      const { hash } = req.params;

      if (!has0xPrefix(hash)) {
        return res.redirect('/extended/v1/block/0x' + hash);
      }
      validateRequestHexInput(hash);

      const block = await getBlockFromDataStore({ blockIdentifer: { hash }, db });
      if (!block.found) {
        res.status(404).json({ error: `cannot find block by hash ${hash}` });
        return;
      }
      setETagCacheHeaders(res);
      // TODO: block schema validation
      res.json(block.result);
    })
  );

  router.get(
    '/by_burn_block_hash/:burnBlockHash',
    cacheHandler,
    asyncHandler(async (req, res) => {
      const { burnBlockHash } = req.params;

      if (!has0xPrefix(burnBlockHash)) {
        return res.redirect('/extended/v1/block/by_burn_block_hash/0x' + burnBlockHash);
      }

      const block = await getBlockFromDataStore({ blockIdentifer: { burnBlockHash }, db });
      if (!block.found) {
        res.status(404).json({ error: `cannot find block by burn block hash ${burnBlockHash}` });
        return;
      }
      setETagCacheHeaders(res);
      // TODO: block schema validation
      res.json(block.result);
    })
  );

  return router;
}
