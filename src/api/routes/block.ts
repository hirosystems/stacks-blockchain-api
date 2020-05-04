import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import * as Bluebird from 'bluebird';
import { DataStore } from '../../datastore/common';
import { getBlockFromDataStore } from '../controllers/db-controller';
import { timeout, waiter } from '../../helpers';
import { validate } from '../validate';

export function createBlockRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());

  router.getAsync('/', async (req, res) => {
    const blocks = await db.getBlocks();
    // TODO: fix duplicate pg queries
    const result = await Bluebird.mapSeries(blocks.results, async block => {
      const blockQuery = await getBlockFromDataStore(block.block_hash, db);
      if (!blockQuery.found) {
        throw new Error('unexpected block not found -- fix block enumeration query');
      }
      return blockQuery.result;
    });

    // TODO: block schema validation
    res.json(result);
  });

  router.getAsync('/:block_hash', async (req, res) => {
    const { block_hash } = req.params;
    const block = await getBlockFromDataStore(block_hash, db);
    if (!block.found) {
      res.status(404).json({ error: `cannot find block by hash ${block_hash}` });
      return;
    }
    // TODO: block schema validation
    res.json(block.result);
  });

  return router;
}
