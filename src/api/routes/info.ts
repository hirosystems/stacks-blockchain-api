import * as express from 'express';
import { asyncHandler } from '../async-handler';
import { validate } from '../validate';
import { InvalidRequestError, InvalidRequestErrorType } from '../../errors';
import {
  NetworkBlockTimesResponse,
  NetworkBlockTimeResponse,
} from '@stacks/stacks-blockchain-api-types';
import { PgStore } from '../../datastore/pg-store';
import { isProdEnv } from '@hirosystems/api-toolkit';

const enum TargetBlockTime {
  /**
   * This is currently the Stacks 2.0 testnet, which uses a regtest bitcoin node with a
   * controller service that controls the block mining. The configured time can be found at
   * https://github.com/hirosystems/k8s/blob/5a3ae6abe74b736a0f21566a187838b00425e045/blockstack-core/v2/argon/bitcoin/staging/configmap.yaml#L7
   */
  Testnet = 2 * 60, // 2 minutes
  /**
   * Mainnet uses burnchain's block time (i.e. Bitcoin mainnet's 10 minute block time)
   */
  Mainnet = 10 * 60, // 10 minutes
}

export function createInfoRouter(db: PgStore): express.Router {
  const router = express.Router();

  router.get(
    '/network_block_times',
    asyncHandler(async (req, res) => {
      const response: NetworkBlockTimesResponse = {
        testnet: { target_block_time: TargetBlockTime.Testnet },
        mainnet: { target_block_time: TargetBlockTime.Mainnet },
      };
      if (!isProdEnv) {
        const schemaPath =
          '@stacks/stacks-blockchain-api-types/api/info/get-network-block-times.schema.json';
        await validate(schemaPath, response);
      }
      res.json(response);
    })
  );

  router.get(
    '/network_block_time/:network',
    asyncHandler(async (req, res) => {
      const { network } = req.params || req.query;
      if (!network || !['testnet', 'mainnet'].includes(network)) {
        throw new InvalidRequestError(
          '`network` param must be `testnet` or `mainnet`',
          InvalidRequestErrorType.invalid_param
        );
      }
      const response: NetworkBlockTimeResponse = {
        target_block_time:
          network === 'testnet' ? TargetBlockTime.Testnet : TargetBlockTime.Mainnet,
      };
      if (!isProdEnv) {
        const schemaPath =
          '@stacks/stacks-blockchain-api-types/api/info/get-network-block-time-by-network.schema.json';
        await validate(schemaPath, response);
      }
      res.json(response);
    })
  );

  return router;
}
