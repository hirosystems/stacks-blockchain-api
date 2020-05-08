import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import * as Bluebird from 'bluebird';
import { DataStore, DbTx } from '../../datastore/common';
import { getTxFromDataStore } from '../controllers/db-controller';
import { waiter, has0xPrefix } from '../../helpers';

import * as txSchema from '../../../.tmp/entities/transactions/transaction.schema.json';
import * as txResultsSchema from '../../../.tmp/api/transaction/get-transactions.schema.json';
import { parseLimitQuery, parsePagingQueryInput } from '../pagination';
import { validate } from '../validate';

const MAX_TXS_PER_REQUEST = 200;

const parseTxQueryLimit = parseLimitQuery({
  maxItems: MAX_TXS_PER_REQUEST,
  errorMsg: '`limit` must be equal to or less than ' + MAX_TXS_PER_REQUEST,
});

export function createTxRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());

  router.getAsync('/', async (req, res) => {
    const limit = parseTxQueryLimit(req.query.limit ?? 96);
    const offset = parsePagingQueryInput(req.query.offset ?? 0);

    const { results: txResults, total } = await db.getTxList({ offset, limit });

    // TODO: fix these duplicate db queries
    const results = await Bluebird.mapSeries(txResults, async tx => {
      const txQuery = await getTxFromDataStore(tx.tx_id, db);
      if (!txQuery.found) {
        throw new Error('unexpected tx not found -- fix tx enumeration query');
      }
      return txQuery.result;
    });
    const response = { limit, offset, total, results };
    await validate(txResultsSchema, response);
    res.json(response);
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
        const txQuery = await getTxFromDataStore(tx.tx_id, db);
        if (!txQuery.found) {
          throw new Error('error in tx stream, tx not found');
        }
        if (useEventSource) {
          res.write(`event: tx\ndata: ${JSON.stringify(txQuery.result)}\n\n`);
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

    if (!has0xPrefix(tx_id)) {
      return res.redirect('/sidecar/v1/tx/0x' + tx_id);
    }

    const txQuery = await getTxFromDataStore(tx_id, db);
    if (!txQuery.found) {
      res.status(404).json({ error: `could not find transaction by ID ${tx_id}` });
      return;
    }
    await validate(txSchema, txQuery.result);
    res.json(txQuery.result);
  });

  return router;
}
