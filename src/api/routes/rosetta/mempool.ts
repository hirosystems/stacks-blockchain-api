import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import { DataStore } from '../../../datastore/common';
import { has0xPrefix } from '../../../helpers';
import { parseLimitQuery, parsePagingQueryInput } from '../../pagination';
import { rosettaValidateRequest, ValidSchema, makeRosettaError } from '../../rosetta-validate';
import {
  RosettaMempoolResponse,
  RosettaMempoolTransactionResponse,
  RosettaTransaction,
} from '@blockstack/stacks-blockchain-api-types';
import { getOperations } from '../../../rosetta-helpers';
import { RosettaErrors, RosettaErrorsTypes } from '../../rosetta-constants';
import { ChainID } from '@stacks/transactions';

const MAX_MEMPOOL_TXS_PER_REQUEST = 200;
const parseMempoolTxQueryLimit = parseLimitQuery({
  maxItems: MAX_MEMPOOL_TXS_PER_REQUEST,
  errorMsg: `'limit' must be equal to or less than ${MAX_MEMPOOL_TXS_PER_REQUEST}`,
});

export function createRosettaMempoolRouter(db: DataStore, chainId: ChainID): RouterWithAsync {
  const router = addAsync(express.Router());
  router.use(express.json());

  router.postAsync('/', async (req, res) => {
    const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
    if (!valid.valid) {
      res.status(400).json(makeRosettaError(valid));
      return;
    }

    const { results: txResults } = await db.getMempoolTxIdList();

    const transaction_identifiers = txResults.map(tx => {
      return { hash: tx.tx_id };
    });
    const response: RosettaMempoolResponse = {
      transaction_identifiers,
    };
    res.json(response);
  });

  router.postAsync('/transaction', async (req, res) => {
    const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
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
      return res.status(404).json(RosettaErrors[RosettaErrorsTypes.transactionNotFound]);
    }

    const operations = getOperations(mempoolTxQuery.result);
    const transaction: RosettaTransaction = {
      transaction_identifier: { hash: tx_id },
      operations: operations,
    };
    const result: RosettaMempoolTransactionResponse = {
      transaction: transaction,
    };
    res.json(result);
  });

  return router;
}
