import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import * as cors from 'cors';
import * as Bluebird from 'bluebird';
import { DataStore, DbTx } from '../../datastore/common';
import { getTxFromDataStore } from '../controllers/db-controller';
import { timeout, waiter } from '../../helpers';
import { validate } from '../validate';

import * as txSchema from '../../../.tmp/entities/transactions/transaction.schema.json';
import * as txResultsSchema from '../../../.tmp/api/transaction/get-transactions.schema.json';

export function createTxRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());
  router.use(cors());

  router.getAsync('/', async (req, res) => {
    const txs = await db.getTxList();
    const results = await Bluebird.mapSeries(txs.results, async tx => {
      return await getTxFromDataStore(tx.tx_id, db);
    });
    await validate(txResultsSchema, { results });
    res.json({ results });
  });

  router.getAsync('/stream', async (req, res) => {
    const protocol = req.query['protocol'];
    const useEventSource = protocol === 'eventsource';
    const useWebSocket = protocol === 'websocket';
    if (!useEventSource && !useWebSocket) {
      throw new Error(`Unsupported stream protocol "${protocol}"`);
    }

    if (useEventSource) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
    } else if (useWebSocket) {
      throw new Error('WebSocket stream not yet implemented');
    }

    const dbTxUpdate = async (tx: DbTx): Promise<void> => {
      try {
        // TODO: timeout is temp hack until atomic db updates are implemented
        await timeout(1);
        const fullTx = await getTxFromDataStore(tx.tx_id, db);
        if (useEventSource) {
          res.write(`event: tx\ndata: ${JSON.stringify(fullTx)}\n\n`);
          res.flush();
        }
      } catch (error) {
        // TODO: real error handling
        console.error(error);
      }
    };

    // EventEmitters don't like being passed Promise functions so wrap the async handler
    const onTxUpdate = (tx: DbTx): void => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      dbTxUpdate(tx);
    };

    const endWaiter = waiter();
    db.addListener('txUpdate', onTxUpdate);
    res.on('close', () => {
      endWaiter.finish();
      db.removeListener('txUpdate', onTxUpdate);
    });
    await endWaiter;
  });

  router.getAsync('/:tx_id', async (req, res) => {
    const { tx_id } = req.params;
    const txResponse = await getTxFromDataStore(tx_id, db);
    await validate(txSchema, txResponse);
    res.json(txResponse);
  });

  return router;
}
