import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import * as Bluebird from 'bluebird';
import { BlockListResponse } from '@stacks/stacks-blockchain-api-types';

import { DataStore } from '../../datastore/common';
import { getBlockFromDataStore } from '../controllers/db-controller';
import { timeout, waiter, has0xPrefix } from '../../helpers';
import { parseLimitQuery, parsePagingQueryInput } from '../pagination';

const MAX_BLOCKS_PER_REQUEST = 30;

const parseBlockQueryLimit = parseLimitQuery({
  maxItems: MAX_BLOCKS_PER_REQUEST,
  errorMsg: '`limit` must be equal to or less than ' + MAX_BLOCKS_PER_REQUEST,
});

export function createBlockRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());

  router.getAsync('/', async (req, res) => {
    const limit = parseBlockQueryLimit(req.query.limit ?? 20);
    const offset = parsePagingQueryInput(req.query.offset ?? 0);

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
    const response: BlockListResponse = { limit, offset, total, results };
    // TODO: block schema validation
    res.json(response);
  });

  router.getAsync('/by_height/:height', async (req, res) => {
    const height = parseInt(req.params['height'], 10);
    if (!Number.isInteger(height)) {
      return res
        .status(400)
        .json({ error: `height is not a valid integer: ${req.query['height']}` });
    }
    if (height < 1) {
      return res.status(400).json({ error: `height is not a positive integer: ${height}` });
    }
    const block = await getBlockFromDataStore({ blockIdentifer: { height }, db });
    if (!block.found) {
      res.status(404).json({ error: `cannot find block by height ${height}` });
      return;
    }
    // TODO: block schema validation
    res.json(block.result);
  });

  router.getAsync('/:hash', async (req, res) => {
    const { hash } = req.params;

    if (!has0xPrefix(hash)) {
      return res.redirect('/extended/v1/block/0x' + hash);
    }

    const block = await getBlockFromDataStore({ blockIdentifer: { hash }, db });
    if (!block.found) {
      res.status(404).json({ error: `cannot find block by hash ${hash}` });
      return;
    }
    // TODO: block schema validation
    res.json(block.result);
  });

  return router;
}
