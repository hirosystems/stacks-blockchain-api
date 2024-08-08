import { handleMempoolCache } from '../../controllers/cache-controller';
import { DbMempoolFeePriority, DbTxTypeId } from '../../../datastore/common';
import { FastifyPluginAsync } from 'fastify';
import { Static, Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';

const MempoolFeePrioritiySchema = Type.Object({
  no_priority: Type.Integer(),
  low_priority: Type.Integer(),
  medium_priority: Type.Integer(),
  high_priority: Type.Integer(),
});

const MempoolFeePrioritiesSchema = Type.Object({
  all: MempoolFeePrioritiySchema,
  token_transfer: Type.Optional(MempoolFeePrioritiySchema),
  contract_call: Type.Optional(MempoolFeePrioritiySchema),
  smart_contract: Type.Optional(MempoolFeePrioritiySchema),
});
type MempoolFeePriorities = Static<typeof MempoolFeePrioritiesSchema>;

function parseMempoolFeePriority(fees: DbMempoolFeePriority[]): MempoolFeePriorities {
  const out: MempoolFeePriorities = {
    all: { no_priority: 0, low_priority: 0, medium_priority: 0, high_priority: 0 },
  };
  for (const fee of fees) {
    const value = {
      no_priority: fee.no_priority,
      low_priority: fee.low_priority,
      medium_priority: fee.medium_priority,
      high_priority: fee.high_priority,
    };
    if (fee.type_id == null) out.all = value;
    else
      switch (fee.type_id) {
        case DbTxTypeId.TokenTransfer:
          out.token_transfer = value;
          break;
        case DbTxTypeId.ContractCall:
          out.contract_call = value;
          break;
        case DbTxTypeId.SmartContract:
        case DbTxTypeId.VersionedSmartContract:
          out.smart_contract = value;
          break;
      }
  }
  return out;
}

export const MempoolRoutesV2: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/fees',
    {
      preHandler: handleMempoolCache,
      schema: {
        operationId: 'get_mempool_fee_priorities',
        summary: 'Get mempool transaction fee priorities',
        description: `Returns estimated fee priorities (in micro-STX) for all transactions that are currently in the mempool. Also returns priorities separated by transaction type.`,
        tags: ['Mempool'],
        response: {
          200: MempoolFeePrioritiesSchema,
        },
      },
    },
    async (_req, reply) => {
      const feePriority = await fastify.db.getMempoolFeePriority();
      const result = parseMempoolFeePriority(feePriority);
      await reply.send(result);
    }
  );

  await Promise.resolve();
};
