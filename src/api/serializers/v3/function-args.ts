import { getTypeString } from '@stacks/transactions';
import { decodeClarityValueList, decodeClarityValueToTypeName } from '@stacks/codec';
import { DbContractCallFunctionAbiArg } from '../../../datastore/v3/types.js';
import { ContractCallFunctionArg } from '../../schemas/v3/entities/common.js';

/**
 * Decodes serialized contract-call arguments and pairs each one, by position, with the called
 * function's ABI argument. Arguments without a matching ABI entry (contract or ABI unavailable)
 * get a `null` name and a type inferred from the value itself.
 * @param functionArgs - Serialized Clarity value list of the call arguments.
 * @param abiArgs - The called function's ABI `args`, as a JSON string or parsed array.
 */
export function serializeContractCallFunctionArgs(
  functionArgs: string,
  abiArgs: string | DbContractCallFunctionAbiArg[] | null | undefined
): ContractCallFunctionArg[] {
  const parsedAbiArgs: DbContractCallFunctionAbiArg[] | null =
    typeof abiArgs === 'string'
      ? (JSON.parse(abiArgs) as DbContractCallFunctionAbiArg[])
      : (abiArgs ?? null);
  return decodeClarityValueList(functionArgs).map((arg, idx) => {
    const abiArg = Array.isArray(parsedAbiArgs) ? parsedAbiArgs[idx] : undefined;
    return {
      hex: arg.hex,
      repr: arg.repr,
      name: abiArg?.name ?? null,
      type: abiArg?.type ? getTypeString(abiArg.type) : decodeClarityValueToTypeName(arg.hex),
    };
  });
}
