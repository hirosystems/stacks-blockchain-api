import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import { DataStore } from '../../../datastore/common';
import { logger } from '../../../helpers';
import { getRosettaBlockFromDataStore } from '../../controllers/db-controller';
import { StacksCoreRpcClient, Neighbor } from '../../../core-rpc/client';
import {
  RosettaConstants,
  RosettaOperationTypes,
  RosettaOperationStatuses,
  RosettaErrors,
} from '../../rosetta-constants';
const middleware_version = require('../../../../package.json').version;
import {
  RosettaNetworkListResponse,
  RosettaNetworkOptionsResponse,
  RosettaNetworkStatusResponse,
  RosettaPeers,
} from '@blockstack/stacks-blockchain-api-types';
import { rosettaValidateRequest, ValidSchema, makeRosettaError } from '../../rosetta-validate';

export function createRosettaNetworkRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());
  router.use(express.json());

  router.post('/list', (_req, res) => {
    const response: RosettaNetworkListResponse = {
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
    const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body);
    if (!valid.valid) {
      res.status(400).json(makeRosettaError(valid));
      return;
    }

    const block = await getRosettaBlockFromDataStore(db);
    if (!block.found) {
      res.status(404).json(RosettaErrors.blockNotFound);
      return;
    }

    const genesis = await getRosettaBlockFromDataStore(db, undefined, 1);
    if (!genesis.found) {
      res.status(400).json(RosettaErrors.blockNotFound);
      return;
    }

    const stacksCoreRpcClient = new StacksCoreRpcClient();
    const neighborsResp = await stacksCoreRpcClient.getNeighbors();

    const neighbors: Neighbor[] = [...neighborsResp.inbound, ...neighborsResp.outbound];

    const set_of_peer_ids = new Set(
      neighbors.map(neighbor => {
        return neighbor.public_key_hash;
      })
    );

    const peers = [...set_of_peer_ids].map(peerId => {
      return { peer_id: peerId };
    });

    const response: RosettaNetworkStatusResponse = {
      current_block_identifier: {
        index: block.result.block_identifier.index,
        hash: block.result.block_identifier.hash,
      },
      current_block_timestamp: block.result.timestamp,
      genesis_block_identifier: {
        index: genesis.result.block_identifier.index,
        hash: genesis.result.block_identifier.hash,
      },
      peers,
    };
    res.json(response);
  });

  router.postAsync('/options', async (req, res) => {
    const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body);
    if (!valid.valid) {
      res.status(400).json(makeRosettaError(valid));
      return;
    }

    const response: RosettaNetworkOptionsResponse = {
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
