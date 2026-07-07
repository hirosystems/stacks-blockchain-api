import {
  handlePrincipalCache,
  handlePrincipalMempoolCache,
  handleTransactionCache,
} from '../../controllers/cache-controller.js';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { getPagingQueryLimit, ResourceType } from '../../pagination.js';
import {
  AddressSchema,
  AssetIdentifierSchema,
  PrincipalSchema,
  TransactionIdSchema,
} from '../../schemas/v3/entities/common.js';
import {
  BondCursorSchema,
  CursorPaginationQuerystring,
  CursorPaginatedResponse,
  FtBalanceCursorSchema,
  MempoolTransactionCursorSchema,
  NftBalanceCursorSchema,
  TransactionCursorSchema,
} from '../../schemas/v3/cursors.js';
import { decodeClarityValueToRepr } from '@stacks/codec';
import { PrincipalTransactionSummarySchema } from '../../schemas/v3/entities/principal-transactions.js';
import { serializePrincipalTransactionSummary } from '../../serializers/v3/transactions.js';
import {
  serializePrincipalBalanceChange,
  serializePrincipalTransactionBalanceChange,
} from '../../serializers/v3/balance-changes.js';
import {
  PrincipalBondPositionSchema,
  PrincipalStakingSummarySchema,
} from '../../schemas/v3/entities/principal-bond-positions.js';
import {
  serializeDbPrincipalBondPosition,
  serializeDbPrincipalStakingSummary,
} from '../../serializers/v3/bonds.js';
import { handleChainTipCache } from '../../controllers/cache-controller.js';
import {
  PrincipalFtPositionSchema,
  PrincipalNftPositionSchema,
  PrincipalStxBalance,
  PrincipalStxBalanceSchema,
} from '../../schemas/v3/entities/principal-balances.js';
import {
  PrincipalBalanceChangeCursorSchema,
  PrincipalTransactionBalanceChangeCursorSchema,
} from '../../schemas/v3/params.js';
import {
  PrincipalBalanceChangeSchema,
  PrincipalTransactionBalanceChangeSchema,
} from '../../schemas/v3/entities/principal-balance-changes.js';
import { PrincipalNoncesSchema } from '../../schemas/v3/entities/principal-nonces.js';
import { MempoolTransactionSummarySchema } from '../../schemas/v3/entities/mempool-transaction-summaries.js';
import { serializeDbMempoolTransactionSummary } from '../../serializers/v3/mempool-transactions.js';

export const PrincipalsRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/principals/:principal/transactions',
    {
      preHandler: handlePrincipalCache,
      schema: {
        operationId: 'get_principal_transactions',
        summary: 'Get principal transactions',
        description: `Returns a list of confirmed transactions sent or received by a Stacks principal, including the transaction summary, the involvement of the principal in the transaction, and the balances affected by the transaction.`,
        tags: ['Transactions'],
        params: Type.Object({ principal: PrincipalSchema }),
        querystring: CursorPaginationQuerystring(TransactionCursorSchema, ResourceType.Tx),
        response: {
          200: CursorPaginatedResponse(
            PrincipalTransactionSummarySchema,
            TransactionCursorSchema,
            ResourceType.Tx
          ),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getPrincipalTransactionSummaries({
        principal: req.params.principal,
        limit: req.query.limit ?? getPagingQueryLimit(ResourceType.Tx),
        cursor: req.query.cursor,
      });
      await reply.send({
        limit: results.limit,
        total: results.total,
        cursor: {
          next: results.next_cursor,
          previous: results.prev_cursor,
          current: results.current_cursor,
        },
        results: results.results.map(r => serializePrincipalTransactionSummary(r)),
      });
    }
  );

  fastify.get(
    '/principals/:principal/transactions/:tx_id/balance-changes',
    {
      preHandler: handleTransactionCache,
      schema: {
        operationId: 'get_principal_transaction_balance_changes',
        summary: 'Get principal transaction balance changes',
        description: `Returns the balance changes for a principal's transaction`,
        tags: ['Transactions'],
        params: Type.Object({ principal: PrincipalSchema, tx_id: TransactionIdSchema }),
        querystring: CursorPaginationQuerystring(
          PrincipalTransactionBalanceChangeCursorSchema,
          ResourceType.Tx
        ),
        response: {
          200: CursorPaginatedResponse(
            PrincipalTransactionBalanceChangeSchema,
            PrincipalTransactionBalanceChangeCursorSchema,
            ResourceType.Tx
          ),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getPrincipalTransactionBalanceChanges({
        principal: req.params.principal,
        tx_id: req.params.tx_id,
        limit: req.query.limit ?? getPagingQueryLimit(ResourceType.Tx),
        cursor: req.query.cursor,
      });
      await reply.send({
        limit: results.limit,
        total: results.total,
        cursor: {
          next: results.next_cursor,
          previous: results.prev_cursor,
          current: results.current_cursor,
        },
        results: results.results.map(r => serializePrincipalTransactionBalanceChange(r)),
      });
    }
  );

  fastify.get(
    '/principals/:principal/balance-changes',
    {
      preHandler: handlePrincipalCache,
      // Accept both repeated (`?tx_id=A&tx_id=B`) and comma-separated (`?tx_id=A,B`) forms.
      // The repeated form is already an array via Fastify's qs parser; this hook normalizes
      // the comma-separated form. Mirrors the convention used by `/extended/v1/tx/multiple`.
      preValidation: (req, _reply, done) => {
        if (typeof req.query.tx_id === 'string') {
          req.query.tx_id = (req.query.tx_id as string).split(',') as typeof req.query.tx_id;
        }
        done();
      },
      schema: {
        operationId: 'get_principal_balance_changes',
        summary: 'Get principal balance changes',
        description: `Returns the balance changes for a principal across one or more transactions, as a single paginated flat array ordered by chain position descending then by asset.`,
        tags: ['Transactions'],
        params: Type.Object({ principal: PrincipalSchema }),
        querystring: Type.Composite([
          CursorPaginationQuerystring(PrincipalBalanceChangeCursorSchema, ResourceType.Tx),
          Type.Object({
            tx_id: Type.Array(TransactionIdSchema, {
              minItems: 1,
              maxItems: getPagingQueryLimit(ResourceType.Tx),
              description:
                'Transaction IDs to query balance changes for. Provide as repeated ' +
                'querystring values (`?tx_id=A&tx_id=B`) or as a single comma-separated ' +
                'value (`?tx_id=A,B`).',
            }),
          }),
        ]),
        response: {
          200: CursorPaginatedResponse(
            PrincipalBalanceChangeSchema,
            PrincipalBalanceChangeCursorSchema,
            ResourceType.Tx
          ),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getPrincipalBalanceChanges({
        principal: req.params.principal,
        tx_ids: req.query.tx_id,
        limit: req.query.limit ?? getPagingQueryLimit(ResourceType.Tx),
        cursor: req.query.cursor,
      });
      await reply.send({
        limit: results.limit,
        total: results.total,
        cursor: {
          next: results.next_cursor,
          previous: results.prev_cursor,
          current: results.current_cursor,
        },
        results: results.results.map(r => serializePrincipalBalanceChange(r)),
      });
    }
  );

  fastify.get(
    '/principals/:principal/staking',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_principal_staking_summary',
        summary: 'Get principal staking summary',
        description:
          "A one-call overview of a principal's staking: its pox-5 STX-staking position (locked STX and its sBTC rewards) plus aggregate totals across all of its bond positions. The per-bond breakdown is paginated at `/principals/:principal/staking/bonds`.",
        tags: ['Staking'],
        params: Type.Object({ principal: PrincipalSchema }),
        response: {
          200: PrincipalStakingSummarySchema,
        },
      },
    },
    async (req, reply) => {
      const summary = await fastify.db.v3.getPrincipalStakingSummary({
        principal: req.params.principal,
      });
      await reply.send(serializeDbPrincipalStakingSummary(summary));
    }
  );

  fastify.get(
    '/principals/:principal/staking/bonds',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_principal_bond_positions',
        summary: 'Get principal bond positions',
        description:
          "Get a principal's bond positions — its enrollment, lock, status, and sBTC rewards in each bond it participates in.",
        tags: ['Staking'],
        params: Type.Object({ principal: PrincipalSchema }),
        querystring: CursorPaginationQuerystring(BondCursorSchema, ResourceType.Tx),
        response: {
          200: CursorPaginatedResponse(
            PrincipalBondPositionSchema,
            BondCursorSchema,
            ResourceType.Tx
          ),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getPrincipalBondPositions({
        principal: req.params.principal,
        limit: req.query.limit ?? getPagingQueryLimit(ResourceType.Tx),
        cursor: req.query.cursor,
      });
      await reply.send({
        limit: results.limit,
        total: results.total,
        cursor: {
          next: results.next_cursor,
          previous: results.prev_cursor,
          current: results.current_cursor,
        },
        results: results.results.map(serializeDbPrincipalBondPosition),
      });
    }
  );

  fastify.get(
    '/principals/:principal/balances/stx',
    {
      preHandler: handlePrincipalMempoolCache,
      schema: {
        operationId: 'get_principal_balances_stx',
        summary: 'Get principal STX balance',
        description:
          "Get a principal's STX balance: its total and spendable (available) balance, any locked STX, and the projected balance from pending mempool transactions.",
        tags: ['Accounts'],
        params: Type.Object({ principal: PrincipalSchema }),
        response: {
          200: PrincipalStxBalanceSchema,
        },
      },
    },
    async (req, reply) => {
      const stxAddress = req.params.principal;
      const result = await fastify.db.sqlTransaction(async sql => {
        const chainTip = await fastify.db.getChainTip(sql);
        const holder = await fastify.db.v2.getStxHolderBalance({ sql, stxAddress });
        const balance = holder.found ? holder.result.balance : 0n;
        const lock = await fastify.db.v2.getStxPoxLockedAtBlock({
          sql,
          stxAddress,
          burnBlockHeight: chainTip.burn_block_height,
        });
        const mempool = await fastify.db.getPrincipalMempoolStxBalanceDelta(sql, stxAddress);

        const available = balance - lock.locked;
        const response: PrincipalStxBalance = {
          balance: balance.toString(),
          available: available.toString(),
          locked:
            lock.locked > 0n
              ? {
                  amount: lock.locked.toString(),
                  pox_version: lock.poxVersion,
                  lock_tx_id: lock.lockTxId,
                  stacks_lock_height: lock.lockHeight,
                  burn_lock_height: lock.burnchainLockHeight,
                  burn_unlock_height: lock.burnchainUnlockHeight,
                }
              : null,
          mempool:
            mempool.inbound > 0n || mempool.outbound > 0n
              ? {
                  estimated_balance: (available + mempool.delta).toString(),
                  inbound: mempool.inbound.toString(),
                  outbound: mempool.outbound.toString(),
                }
              : null,
        };
        return response;
      });
      await reply.send(result);
    }
  );

  fastify.get(
    '/principals/:principal/balances/ft',
    {
      preHandler: handlePrincipalCache,
      schema: {
        operationId: 'get_principal_balances_ft',
        summary: 'Get principal FT balances',
        description: "Get a principal's fungible-token balances, sorted by balance descending.",
        tags: ['Accounts'],
        params: Type.Object({ principal: PrincipalSchema }),
        querystring: CursorPaginationQuerystring(FtBalanceCursorSchema, ResourceType.FtBalance),
        response: {
          200: CursorPaginatedResponse(
            PrincipalFtPositionSchema,
            FtBalanceCursorSchema,
            ResourceType.FtBalance
          ),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getPrincipalFtBalances({
        principal: req.params.principal,
        limit: req.query.limit ?? getPagingQueryLimit(ResourceType.FtBalance),
        cursor: req.query.cursor,
      });
      await reply.send({
        limit: results.limit,
        total: results.total,
        cursor: {
          next: results.next_cursor,
          previous: results.prev_cursor,
          current: results.current_cursor,
        },
        results: results.results.map(r => ({
          asset_identifier: r.token,
          balance: r.balance,
        })),
      });
    }
  );

  fastify.get(
    '/principals/:principal/balances/ft/:asset_identifier',
    {
      preHandler: handlePrincipalCache,
      schema: {
        operationId: 'get_principal_balance_ft',
        summary: 'Get principal FT balance',
        description:
          "Get a principal's balance of a single fungible token. Returns a zero balance if the principal does not currently hold the token.",
        tags: ['Accounts'],
        params: Type.Object({
          principal: PrincipalSchema,
          asset_identifier: AssetIdentifierSchema,
        }),
        response: {
          200: PrincipalFtPositionSchema,
        },
      },
    },
    async (req, reply) => {
      const result = await fastify.db.v3.getPrincipalFtBalance({
        principal: req.params.principal,
        token: req.params.asset_identifier,
      });
      await reply.send({
        asset_identifier: result.token,
        balance: result.balance,
      });
    }
  );

  fastify.get(
    '/principals/:principal/balances/nft',
    {
      preHandler: handlePrincipalCache,
      schema: {
        operationId: 'get_principal_balances_nft',
        summary: 'Get principal NFT balances',
        description:
          'Get the non-fungible token instances currently owned by a principal, ordered by asset identifier and value.',
        tags: ['Accounts'],
        params: Type.Object({ principal: PrincipalSchema }),
        querystring: CursorPaginationQuerystring(NftBalanceCursorSchema, ResourceType.NftBalance),
        response: {
          200: CursorPaginatedResponse(
            PrincipalNftPositionSchema,
            NftBalanceCursorSchema,
            ResourceType.NftBalance
          ),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getPrincipalNftBalances({
        principal: req.params.principal,
        limit: req.query.limit ?? getPagingQueryLimit(ResourceType.NftBalance),
        cursor: req.query.cursor,
      });
      await reply.send({
        limit: results.limit,
        total: results.total,
        cursor: {
          next: results.next_cursor,
          previous: results.prev_cursor,
          current: results.current_cursor,
        },
        results: results.results.map(r => ({
          asset_identifier: r.asset_identifier,
          value: {
            hex: r.value,
            repr: decodeClarityValueToRepr(r.value),
          },
        })),
      });
    }
  );

  fastify.get(
    '/principals/:principal/nonces',
    {
      preHandler: handlePrincipalMempoolCache,
      schema: {
        operationId: 'get_principal_nonces',
        summary: 'Get principal nonces',
        description:
          "Get a Stacks account's latest nonce state by inspecting its confirmed (anchored + microblock) transactions and the mempool, including the nonce to use for its next transaction. Only standard principals have nonces; contract principals are not valid.",
        tags: ['Accounts'],
        params: Type.Object({ principal: AddressSchema }),
        response: {
          200: PrincipalNoncesSchema,
        },
      },
    },
    async (req, reply) => {
      const nonces = await fastify.db.getAddressNonces({ stxAddress: req.params.principal });
      await reply.send({
        next_nonce: nonces.possibleNextNonce,
        last_confirmed_nonce: nonces.lastExecutedTxNonce,
        mempool: {
          last_nonce: nonces.lastMempoolTxNonce,
          pending_nonces: nonces.detectedMempoolNonces,
          missing_nonces: nonces.detectedMissingNonces,
        },
      });
    }
  );

  fastify.get(
    '/principals/:principal/mempool/transactions',
    {
      preHandler: handlePrincipalMempoolCache,
      schema: {
        operationId: 'get_principal_mempool_transactions',
        summary: 'Get principal mempool transactions',
        description:
          'Returns a list of pending mempool transactions that involve a principal — as the sender, a token-transfer recipient, the deployed contract, or the called contract.',
        tags: ['Transactions'],
        params: Type.Object({ principal: PrincipalSchema }),
        querystring: CursorPaginationQuerystring(MempoolTransactionCursorSchema, ResourceType.Tx),
        response: {
          200: CursorPaginatedResponse(
            MempoolTransactionSummarySchema,
            MempoolTransactionCursorSchema,
            ResourceType.Tx
          ),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getPrincipalMempoolTransactionSummaries({
        principal: req.params.principal,
        limit: req.query.limit ?? getPagingQueryLimit(ResourceType.Tx),
        cursor: req.query.cursor,
      });
      await reply.send({
        limit: results.limit,
        total: results.total,
        cursor: {
          next: results.next_cursor,
          previous: results.prev_cursor,
          current: results.current_cursor,
        },
        results: results.results.map(r => serializeDbMempoolTransactionSummary(r)),
      });
    }
  );

  await Promise.resolve();
};
