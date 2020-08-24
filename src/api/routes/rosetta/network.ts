import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import { DataStore } from '../../../datastore/common';
import {
  RosettaConstants,
  RosettaOperationTypes,
  RosettaOperationStatuses,
  RosettaErrors,
} from '../../rosetta-constants';
const middleware_version = require('../../../../package.json').version;

export function createRosettaNetworkRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());

  router.post('/list', (_req, res) => {
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

  router.post('/status', (req, res) => {
    res.json({ status: 'ready' });
  });

  router.post('/options', (_req, res) => {
    const response = {
      version: {
        rosetta_version: RosettaConstants.rosettaVersion,
        node_version: process.version,
        middleware_version: middleware_version,
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
