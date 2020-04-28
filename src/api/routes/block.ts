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
    const results = await Bluebird.mapSeries(blocks.results, async block => {
      return await getBlockFromDataStore(block.block_hash, db);
    });

    // TODO: block schema validation
    // await validate(txResultsSchema, { results });
    res.json({ results });
  });

  router.getAsync('/:block_hash', async (req, res) => {
    const { block_hash } = req.params;
    const txResponse = await getBlockFromDataStore(block_hash, db);
    // TODO: block schema validation
    // await validate(txSchema, txResponse);
    res.json(txResponse);
  });

  return router;
}
