import * as express from 'express';
import { DataStore } from '../../datastore/common';
import { FeeRate } from '@stacks/stacks-blockchain-api-types';

export const FEE_RATE = 400;

export function createFeeRateRouter(_: DataStore): express.Router {
  const router = express.Router();

  router.post('/', (req, res) => {
    //validate and use req.body.transaction when we want to use it
    const response: FeeRate = {
      fee_rate: FEE_RATE,
    };
    res.json(response);
  });

  return router;
}
