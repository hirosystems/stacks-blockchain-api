import * as express from 'express';
import { asyncHandler } from '../../async-handler';
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
  RosettaBlock,
  RosettaNetworkListResponse,
  RosettaNetworkOptionsResponse,
  RosettaNetworkStatusResponse,
  RosettaSyncStatus,
} from '../../../rosetta/types';
import { rosettaValidateRequest, ValidSchema, makeRosettaError } from '../../rosetta-validate';
import { ChainID } from '../../../helpers';
import { PgStore } from '../../../datastore/pg-store';

export function createRosettaNetworkRouter(db: PgStore, chainId: ChainID): express.Router {
  const router = express.Router();
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

  router.post(
    '/status',
    asyncHandler(async (req, res) => {
      const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
      if (!valid.valid) {
        res.status(400).json(makeRosettaError(valid));
        return;
      }

      let block: RosettaBlock;
      let genesis: RosettaBlock;
      try {
        const results = await db.sqlTransaction(async sql => {
          const block = await getRosettaBlockFromDataStore(db, false, chainId);
          if (!block.found) {
            throw RosettaErrors[RosettaErrorsTypes.blockNotFound];
          }
          const genesis = await getRosettaBlockFromDataStore(db, false, chainId, undefined, 1);
          if (!genesis.found) {
            throw RosettaErrors[RosettaErrorsTypes.blockNotFound];
          }
          return { block: block.result, genesis: genesis.result };
        });
        block = results.block;
        genesis = results.genesis;
      } catch (error) {
        res.status(400).json(error);
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

      const currentTipHeight = block.block_identifier.index;

      const response: RosettaNetworkStatusResponse = {
        current_block_identifier: {
          index: block.block_identifier.index,
          hash: block.block_identifier.hash,
        },
        current_block_timestamp: block.timestamp,
        genesis_block_identifier: {
          index: genesis.block_identifier.index,
          hash: genesis.block_identifier.hash,
        },
        peers,
        current_burn_block_height: block.metadata?.burn_block_height ?? 0,
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
    })
  );

  router.post(
    '/options',
    asyncHandler(async (req, res) => {
      const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
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
    })
  );

  return router;
}
