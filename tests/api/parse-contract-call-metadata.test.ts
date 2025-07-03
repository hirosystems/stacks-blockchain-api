import { parseContractCallMetadata } from '../../src/api/controllers/db-controller';

// A minimal mock transaction that only contains the fields required by `parseContractCallMetadata`.
const makeMockContractCallTx = (contractId: string, functionName: string, abiJson: string): any => {
  return {
    // Required contract-call fields
    contract_call_contract_id: contractId,
    contract_call_function_name: functionName,
    abi: abiJson,
    // The remaining BaseTx properties are not used by this helper, so we cast to `any` to satisfy TS.
  } as any;
};

describe('parseContractCallMetadata()', () => {
  test('throws an error when the function name is not found in the ABI', () => {
    const contractId = 'SP000000000000000000002Q6VF78.test-contract';
    const abi = {
      functions: [
        {
          name: 'valid_function',
          access: 'public',
          args: [{ name: 'amount', type: 'uint128' }],
          outputs: { type: 'bool' },
        },
      ],
      maps: [],
      variables: [],
      fungible_tokens: [],
      non_fungible_tokens: [],
    };

    const tx = makeMockContractCallTx(contractId, 'missing_function', JSON.stringify(abi));

    expect(() => parseContractCallMetadata(tx, false)).toThrow(
      `Could not find function name "missing_function" in ABI for ${contractId}`
    );
  });
});
