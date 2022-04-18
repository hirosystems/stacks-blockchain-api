import * as express from 'express';
import { FeeRate } from '@stacks/stacks-blockchain-api-types';
import { PgStore } from '../../datastore/pg-store';

export const FEE_RATE = 400;

export function createFeeRateRouter(_: PgStore): express.Router {
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
