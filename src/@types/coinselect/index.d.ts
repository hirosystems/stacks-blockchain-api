declare module 'coinselect' {
  interface CoinSelectInput {
    value: number;
    script: Buffer;
  }

  interface CoinSelectOutput {
    address: string;
    value: number;
  }

  function coinSelectFunction<TInput extends CoinSelectInput, TOutput extends CoinSelectOutput>(
    utxos: TInput[],
    outputs: TOutput[],
    feeRate: number
  ): {
    inputs: TInput[];
    outputs: TOutput[];
    fee: number;
  };

  export = coinSelectFunction;
}
