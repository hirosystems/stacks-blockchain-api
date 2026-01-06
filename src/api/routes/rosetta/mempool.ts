import { FastifyPluginAsync } from 'fastify';
import { Server } from 'node:http';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@fastify/type-provider-typebox';
import { PgStore } from '../../../datastore/pg-store';
import { ChainID } from '../../../helpers';
import { rosettaValidateRequest, ValidSchema, makeRosettaError } from '../../rosetta-validate';
import {
  RosettaMempoolResponse,
  RosettaMempoolTransactionResponse,
  RosettaTransaction,
} from '../../../rosetta/types';
import { getOperations, parseTransactionMemo } from '../../../rosetta/rosetta-helpers';
import { RosettaErrors, RosettaErrorsTypes } from '../../rosetta-constants';
import { has0xPrefix } from '@hirosystems/api-toolkit';

export const RosettaMempoolRoutes: FastifyPluginAsync<
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

    const { results: txResults } = await db.getMempoolTxList({
      limit: Number.MAX_SAFE_INTEGER,
      offset: 0,
      includeUnanchored: false,
    });

    const transaction_identifiers = txResults.map(tx => {
      return { hash: tx.tx_id };
    });
    const response: RosettaMempoolResponse = {
      transaction_identifiers,
    };
    await reply.send(response);
  });

  fastify.post<{
    Body: Record<string, any>;
  }>('/transaction', async (req, reply) => {
    const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
    if (!valid.valid) {
      return reply.status(400).send(makeRosettaError(valid));
    }

    let tx_id: string = req.body.transaction_identifier.hash;

    if (!has0xPrefix(tx_id)) {
      tx_id = '0x' + tx_id;
    }
    await db
      .sqlTransaction(async sql => {
        const mempoolTxQuery = await db.getMempoolTx({
          txId: tx_id,
          includeUnanchored: false,
        });

        if (!mempoolTxQuery.found) {
          throw RosettaErrors[RosettaErrorsTypes.transactionNotFound];
        }

        const operations = await getOperations(mempoolTxQuery.result, db, chainId);
        const txMemo = parseTransactionMemo(mempoolTxQuery.result.token_transfer_memo);
        const transaction: RosettaTransaction = {
          transaction_identifier: { hash: tx_id },
          operations: operations,
        };
        if (txMemo) {
          transaction.metadata = {
            memo: txMemo,
          };
        }
        const result: RosettaMempoolTransactionResponse = {
          transaction: transaction,
        };
        return result;
      })
      .then(result => {
        return reply.send(result);
      })
      .catch(error => {
        return reply.status(400).send(error);
      });
  });

  await Promise.resolve();
};
