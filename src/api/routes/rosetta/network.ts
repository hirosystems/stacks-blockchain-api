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
  getRosettaNetworkName,
  RosettaErrorsTypes,
} from '../../rosetta-constants';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const middleware_version = require('../../../../package.json').version;
import {
  RosettaNetworkListResponse,
  RosettaNetworkOptionsResponse,
  RosettaNetworkStatusResponse,
  RosettaSyncStatus,
  RosettaPeers,
} from '@stacks/stacks-blockchain-api-types';
import { rosettaValidateRequest, ValidSchema, makeRosettaError } from '../../rosetta-validate';
import { ChainID } from '@stacks/transactions';

export function createRosettaNetworkRouter(db: DataStore, chainId: ChainID): RouterWithAsync {
  const router = addAsync(express.Router());
  router.use(express.json());

  router.post('/list', (_req, res) => {
    const response: RosettaNetworkListResponse = {
      network_identifiers: [
        {
          blockchain: RosettaConstants.blockchain,
          network: getRosettaNetworkName(chainId),
        },
      ],
    };

    res.json(response);
  });

  router.postAsync('/status', async (req, res) => {
    const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
    if (!valid.valid) {
      res.status(500).json(makeRosettaError(valid));
      return;
    }

    const block = await getRosettaBlockFromDataStore(db, false);
    if (!block.found) {
      res.status(500).json(RosettaErrors[RosettaErrorsTypes.blockNotFound]);
      return;
    }

    const genesis = await getRosettaBlockFromDataStore(db, false, undefined, 1);
    if (!genesis.found) {
      res.status(500).json(RosettaErrors[RosettaErrorsTypes.blockNotFound]);
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

    const currentTipHeight = block.result.block_identifier.index;

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

    const nodeInfo = await stacksCoreRpcClient.getInfo();
    const referenceNodeTipHeight = nodeInfo.stacks_tip_height;
    const synced = currentTipHeight === referenceNodeTipHeight;

    const status: RosettaSyncStatus = {
      current_index: currentTipHeight,
      target_index: referenceNodeTipHeight,
      synced: synced,
    };
    response.sync_status = status;

    res.json(response);
  });

  router.postAsync('/options', async (req, res) => {
    const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
    if (!valid.valid) {
      res.status(500).json(makeRosettaError(valid));
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
