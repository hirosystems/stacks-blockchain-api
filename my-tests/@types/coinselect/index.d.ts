declare module 'coinselect' {
  interface CoinSelectInput {
    value: number;
    script: Buffer;
  }

  interface CoinSelectOutput {
    address: string;
    value: number;
  }
  function fn<TInput extends CoinSelectInput, TOutput extends CoinSelectOutput>(
    utxos: TInput[],
    outputs: TOutput[],
    feeRate: number
  ): {
    inputs: TInput[];
    outputs: TOutput[];
    fee: number;
  };
  namespace fn {}
  export = fn;
}
