import { ObjectOptions, TSchema, Type } from '@sinclair/typebox';

export const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
export const OptionalNullable = <T extends TSchema>(schema: T) => Type.Optional(Nullable(schema));
export const PaginatedResponse = <T extends TSchema>(type: T, options?: ObjectOptions) =>
  Type.Object(
    {
      limit: Type.Integer({ examples: [20] }),
      offset: Type.Integer({ examples: [0] }),
      total: Type.Integer({ examples: [1] }),
      results: Type.Array(type),
    },
    options
  );

export const PaginatedCursorResponse = <T extends TSchema>(type: T, options?: ObjectOptions) =>
  Type.Object(
    {
      limit: Type.Integer({ examples: [20] }),
      offset: Type.Integer({ examples: [0] }),
      total: Type.Integer({ examples: [1] }),
      next_cursor: Nullable(Type.String({ description: 'Next page cursor' })),
      prev_cursor: Nullable(Type.String({ description: 'Previous page cursor' })),
      cursor: Nullable(Type.String({ description: 'Current page cursor' })),
      results: Type.Array(type),
    },
    options
  );
