import { FastifyPluginAsync } from 'fastify';
import { Server } from 'node:http';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { RosettaBlockResponse } from '../../../rosetta/types';
import { PgStore } from '../../../datastore/pg-store';
import {
  getRosettaTransactionFromDataStore,
  getRosettaBlockFromDataStore,
} from '../../controllers/db-controller';
import { ChainID } from '../../../helpers';
import { RosettaErrors, RosettaErrorsTypes } from '../../rosetta-constants';
import { rosettaValidateRequest, ValidSchema, makeRosettaError } from '../../rosetta-validate';
import { has0xPrefix } from '@hirosystems/api-toolkit';

export const RosettaBlockRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  const db: PgStore = fastify.db;
  const chainId: ChainID = fastify.chainId;

  fastify.post<{
    Body: Record<string, any>;
  }>('/', async (req, reply) => {
    const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
    if (!valid.valid) {
      return reply.status(400).send(makeRosettaError(valid));
    }

    let block_hash = req.body.block_identifier?.hash as string | undefined;
    const index = req.body.block_identifier?.index as number | undefined;
    if (block_hash && !has0xPrefix(block_hash)) {
      block_hash = '0x' + block_hash;
    }

    const block = await getRosettaBlockFromDataStore(db, true, chainId, block_hash, index);

    if (!block.found) {
      return reply.status(500).send(RosettaErrors[RosettaErrorsTypes.blockNotFound]);
    }
    const blockResponse: RosettaBlockResponse = {
      block: block.result,
    };
    await reply.send(blockResponse);
  });

  fastify.post<{
    Body: Record<string, any>;
  }>('/transaction', async (req, reply) => {
    const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
    if (!valid.valid) {
      return reply.status(400).send(makeRosettaError(valid));
    }

    let tx_hash = req.body.transaction_identifier.hash;
    if (!has0xPrefix(tx_hash)) {
      tx_hash = '0x' + tx_hash;
    }

    const transaction = await getRosettaTransactionFromDataStore(tx_hash, db, chainId);
    if (!transaction.found) {
      return reply.status(500).send(RosettaErrors[RosettaErrorsTypes.transactionNotFound]);
    }

    await reply.send(transaction.result);
  });

  await Promise.resolve();
};
