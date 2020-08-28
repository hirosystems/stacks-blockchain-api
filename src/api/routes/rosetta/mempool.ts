import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import { DataStore } from '../../../datastore/common';
import { has0xPrefix } from '../../../helpers';
import { parseLimitQuery, parsePagingQueryInput } from '../../pagination';
import { rosettaValidateRequest, ValidSchema, makeRosettaError } from '../../rosetta-validate';
import {
  RosettaMempoolResponse,
  RosettaTransaction,
} from '@blockstack/stacks-blockchain-api-types';
import { getOperations } from '../../../rosetta-helpers';
import { RosettaErrors } from './../../rosetta-constants';

const MAX_MEMPOOL_TXS_PER_REQUEST = 200;
const parseMempoolTxQueryLimit = parseLimitQuery({
  maxItems: MAX_MEMPOOL_TXS_PER_REQUEST,
  errorMsg: `'limit' must be equal to or less than ${MAX_MEMPOOL_TXS_PER_REQUEST}`,
});

export function createRosettaMempoolRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());
  router.use(express.json());

  router.postAsync('/', async (req, res) => {
    const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body);
    if (!valid.valid) {
      res.status(400).json(makeRosettaError(valid));
      return;
    }

    const limit = req.body.metadata
      ? parseMempoolTxQueryLimit(req.body.metadata.limit ?? 100)
      : 100;
    const offset = req.body.metadata ? parsePagingQueryInput(req.body.metadata.offset ?? 0) : 0;
    const { results: txResults, total } = await db.getMempoolTxIdList({ offset, limit });

    const transaction_identifiers = txResults.map(tx => {
      return { hash: tx.tx_id };
    });
    const metadata = {
      limit: limit,
      total: total,
      offset: offset,
    };
    const response: RosettaMempoolResponse = {
      transaction_identifiers,
      metadata,
    };
    res.json(response);
  });

  router.postAsync('/transaction', async (req, res) => {
    const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body);
    if (!valid.valid) {
      res.status(400).json(makeRosettaError(valid));
      return;
    }

    let tx_id = req.body.transaction_identifier.hash;

    if (!has0xPrefix(tx_id)) {
      tx_id = '0x' + tx_id;
    }
    const mempoolTxQuery = await db.getMempoolTx(tx_id);

    if (!mempoolTxQuery.found) {
      return res.status(400).json(RosettaErrors.transactionNotFound);
    }

    const operations = getOperations(mempoolTxQuery.result);
    const result: RosettaTransaction = {
      transaction_identifier: { hash: tx_id },
      operations: operations,
    };
    res.json(result);
  });

  return router;
}
