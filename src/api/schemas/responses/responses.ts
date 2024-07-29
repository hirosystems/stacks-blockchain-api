import { Static, TSchema, Type } from '@sinclair/typebox';

const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const OptionalNullable = <T extends TSchema>(schema: T) => Type.Optional(Nullable(schema));

export const ServerStatusResponseSchema = Type.Object(
  {
    server_version: Type.String({
      description: 'the server version that is currently running',
    }),
    status: Type.String({
      description: 'the current server status',
    }),
    pox_v1_unlock_height: OptionalNullable(Type.Integer()),
    pox_v2_unlock_height: OptionalNullable(Type.Integer()),
    pox_v3_unlock_height: OptionalNullable(Type.Integer()),
    chain_tip: OptionalNullable(
      Type.Object({
        block_height: Type.Integer({
          description: 'the current block height',
        }),
        block_hash: Type.String({
          description: 'the current block hash',
        }),
        index_block_hash: Type.String({
          description: 'the current index block hash',
        }),
        microblock_hash: Type.Optional(
          Type.String({
            description: 'the current microblock hash',
          })
        ),
        microblock_sequence: Type.Optional(
          Type.Integer({
            description: 'the current microblock sequence number',
          })
        ),
        burn_block_height: Type.Integer({
          description: 'the current burn chain block height',
        }),
      })
    ),
  },
  { title: 'Api Status Response' }
);
export type ServerStatusResponse = Static<typeof ServerStatusResponseSchema>;
