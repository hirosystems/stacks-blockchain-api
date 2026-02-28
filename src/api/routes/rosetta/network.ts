import { FastifyPluginAsync } from 'fastify';
import { Server } from 'node:http';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
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

export const RosettaNetworkRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  const db: PgStore = fastify.db;
  const chainId: ChainID = fastify.chainId;

  fastify.post('/list', async (_req, reply) => {
    const response: RosettaNetworkListResponse = {
      network_identifiers: [
        {
          blockchain: RosettaConstants.blockchain,
          network: getRosettaNetworkName(chainId),
        },
      ],
    };
    await reply.send(response);
  });

  fastify.post<{
    Body: Record<string, any>;
  }>('/status', async (req, reply) => {
    const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
    if (!valid.valid) {
      return reply.status(400).send(makeRosettaError(valid));
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
      return reply.status(400).send(error);
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
    await reply.send(response);
  });

  fastify.post<{
    Body: Record<string, any>;
  }>('/options', async (req, reply) => {
    const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
    if (!valid.valid) {
      return reply.status(400).send(makeRosettaError(valid));
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

    await reply.send(response);
  });

  await Promise.resolve();
};
