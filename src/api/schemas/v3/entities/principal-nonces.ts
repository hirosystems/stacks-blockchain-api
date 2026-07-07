import { Static, Type } from '@sinclair/typebox';
import { Nullable } from '../../v1/util.js';

export const PrincipalMempoolNoncesSchema = Type.Object(
  {
    last_nonce: Nullable(
      Type.Integer({
        description:
          "Highest nonce among the principal's pending mempool transactions, or null if none.",
      })
    ),
    pending_nonces: Type.Array(Type.Integer(), {
      description:
        'Intermediate nonces found in the mempool between the last confirmed nonce and the highest mempool nonce.',
    }),
    missing_nonces: Type.Array(Type.Integer(), {
      description:
        'Expected intermediate nonces between the last confirmed nonce and the highest mempool nonce that are absent from the mempool — likely stalling transactions.',
    }),
  },
  { title: 'PrincipalMempoolNonces' }
);
export type PrincipalMempoolNonces = Static<typeof PrincipalMempoolNoncesSchema>;

export const PrincipalNoncesSchema = Type.Object(
  {
    next_nonce: Type.Integer({
      description:
        "The nonce to use for this principal's next transaction, derived from the latest confirmed and mempool nonces. May be inaccurate if the API is not fully synchronized.",
    }),
    last_confirmed_nonce: Nullable(
      Type.Integer({
        description:
          "Highest nonce among the principal's confirmed (anchored + microblock) transactions, or null if none.",
      })
    ),
    mempool: PrincipalMempoolNoncesSchema,
  },
  { title: 'PrincipalNonces' }
);
export type PrincipalNonces = Static<typeof PrincipalNoncesSchema>;
