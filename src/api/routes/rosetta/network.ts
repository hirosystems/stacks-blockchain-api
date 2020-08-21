import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import { DataStore } from '../../../datastore/common';
import {
  RosettaConstants,
  RosettaOperationTypes,
  RosettaOperationStatuses,
  RosettaErrors,
} from '../../rosetta-constants';

export function createRNetworkRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());

  router.postAsync('/list', async (_req, res) => {
    const response = {
      network_identifiers: [
        {
          blockchain: RosettaConstants.blockchain,
          network: RosettaConstants.network,
        },
      ],
    };

    res.json(response);
  });

  router.postAsync('/status', async (req, res) => {
    res.json({status: 'ready'});
  });

  router.postAsync('/options', async (_req, res) => {
    const response = {
      version: {
        rosetta_version: RosettaConstants.rosettaVersion,
        node_version: process.version,
        middleware_version: process.env.npm_package_version,
      },
      allow: {
        operation_statuses: RosettaOperationStatuses,
        operation_types: RosettaOperationTypes,
        errors: Object.values(RosettaErrors),
        historical_balance_lookup: true,
      },
    };

    res.json(response);
  });

  return router;
}
