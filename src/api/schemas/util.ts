import { StringOptions, TEnumKey, TEnumValue, TSchema, Type } from '@sinclair/typebox';

export const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
export const OptionalNullable = <T extends TSchema>(schema: T) => Type.Optional(Nullable(schema));
export const PaginatedResponse = <T extends TSchema>(type: T, title?: string) =>
  Type.Object(
    {
      limit: Type.Integer({ examples: [20] }),
      offset: Type.Integer({ examples: [0] }),
      total: Type.Integer({ examples: [1] }),
      results: Type.Array(type),
    },
    { title }
  );

// Comma-separated list of enum values, e.g. `age,size,fee`
export const CommaStringList = <V extends TEnumValue, T extends Record<TEnumKey, V>>(
  item: T,
  options?: StringOptions
) => {
  const anyItemPattern = Object.values(item).join('|');
  return Type.String({
    pattern: `^(${anyItemPattern})(,(${anyItemPattern}))*$`,
    ...options,
  });
};
