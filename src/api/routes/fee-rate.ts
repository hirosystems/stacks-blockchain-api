import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import { DataStore } from '../../datastore/common';
import { FeeRate } from '@stacks/stacks-blockchain-api-types';

export const FEE_RATE = 346;

export function createFeeRateRouter(_: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());

  router.get('/', (_, res) => {
    const response: FeeRate = {
      fee_rate: FEE_RATE,
    };
    res.json(response);
  });

  return router;
}
