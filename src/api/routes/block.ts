import * as express from 'express';
import * as Bluebird from 'bluebird';
import { BlockListResponse } from '@stacks/stacks-blockchain-api-types';

import { DataStore } from '../../datastore/common';
import { getBlockFromDataStore } from '../controllers/db-controller';
import { timeout, waiter, has0xPrefix } from '../../helpers';
import { InvalidRequestError, InvalidRequestErrorType } from '../../errors';
import { parseLimitQuery, parsePagingQueryInput } from '../pagination';
import { getBlockHeightPathParam, validateRequestHexInput } from '../query-helpers';
import { getChainTipCacheHandler, setChainTipCacheHeaders } from '../controllers/cache-controller';
import { asyncHandler } from '../async-handler';

const MAX_BLOCKS_PER_REQUEST = 30;

const parseBlockQueryLimit = parseLimitQuery({
  maxItems: MAX_BLOCKS_PER_REQUEST,
  errorMsg: '`limit` must be equal to or less than ' + MAX_BLOCKS_PER_REQUEST,
});

export function createBlockRouter(db: DataStore): express.Router {
  const router = express.Router();
  const cacheHandler = getChainTipCacheHandler(db);
  router.get(
    '/',
    cacheHandler,
    asyncHandler(async (req, res) => {
      const limit = parseBlockQueryLimit(req.query.limit ?? 20);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);

      // TODO: use getBlockWithMetadata or similar to avoid transaction integrity issues from lazy resolving block tx data (primarily the contract-call ABI data)
      const { results: blocks, total } = await db.getBlocks({ offset, limit });
      // TODO: fix duplicate pg queries
      const results = await Bluebird.mapSeries(blocks, async block => {
        const blockQuery = await getBlockFromDataStore({
          blockIdentifer: { hash: block.block_hash },
          db,
        });
        if (!blockQuery.found) {
          throw new Error('unexpected block not found -- fix block enumeration query');
        }
        return blockQuery.result;
      });
      setChainTipCacheHeaders(res);
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
      setChainTipCacheHeaders(res);
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
      setChainTipCacheHeaders(res);
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
      setChainTipCacheHeaders(res);
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
      setChainTipCacheHeaders(res);
      // TODO: block schema validation
      res.json(block.result);
    })
  );

  return router;
}
