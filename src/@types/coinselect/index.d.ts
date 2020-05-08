export = coinselect;

declare function coinselect<
  TInput extends coinselect.CoinSelectInput,
  TOutput extends coinselect.CoinSelectOutput
>(
  utxos: TInput[],
  outputs: TOutput[],
  feeRate: number
): {
  inputs: TInput[];
  outputs: TOutput[];
  fee: number;
};

declare namespace coinselect {
  interface CoinSelectInput {
    value: number;
    script: Buffer;
  }

  interface CoinSelectOutput {
    address: string;
    value: number;
  }
}
