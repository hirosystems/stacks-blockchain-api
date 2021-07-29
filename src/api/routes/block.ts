import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import * as Bluebird from 'bluebird';
import { BlockListResponse } from '@stacks/stacks-blockchain-api-types';

import { DataStore } from '../../datastore/common';
import { getBlockFromDataStore } from '../controllers/db-controller';
import { timeout, waiter, has0xPrefix } from '../../helpers';
import { parseLimitQuery, parsePagingQueryInput } from '../pagination';
import { getBlockHeightPathParam } from '../query-helpers';

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
    const response: BlockListResponse = { limit, offset, total, results };
    // TODO: block schema validation
    res.json(response);
  });

  router.getAsync('/by_height/:height', async (req, res, next) => {
    const height = getBlockHeightPathParam(req, res, next);
    const block = await getBlockFromDataStore({ blockIdentifer: { height }, db });
    if (!block.found) {
      res.status(404).json({ error: `cannot find block by height ${height}` });
      return;
    }
    // TODO: block schema validation
    res.json(block.result);
  });

  router.getAsync('/by_burn_block_height/:burnBlockHeight', async (req, res) => {
    const burnBlockHeight = parseInt(req.params['burnBlockHeight'], 10);
    if (!Number.isInteger(burnBlockHeight)) {
      return res.status(400).json({
        error: `burnchain height is not a valid integer: ${req.params['burnBlockHeight']}`,
      });
    }
    if (burnBlockHeight < 1) {
      return res
        .status(400)
        .json({ error: `burnchain height is not a positive integer: ${burnBlockHeight}` });
    }
    const block = await getBlockFromDataStore({ blockIdentifer: { burnBlockHeight }, db });
    if (!block.found) {
      res.status(404).json({ error: `cannot find block by height ${burnBlockHeight}` });
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

  router.getAsync('/by_burn_block_hash/:burnBlockHash', async (req, res) => {
    const { burnBlockHash } = req.params;

    if (!has0xPrefix(burnBlockHash)) {
      return res.redirect('/extended/v1/block/by_burn_block_hash/0x' + burnBlockHash);
    }

    const block = await getBlockFromDataStore({ blockIdentifer: { burnBlockHash }, db });
    if (!block.found) {
      res.status(404).json({ error: `cannot find block by burn block hash ${burnBlockHash}` });
      return;
    }
    // TODO: block schema validation
    res.json(block.result);
  });

  return router;
}
