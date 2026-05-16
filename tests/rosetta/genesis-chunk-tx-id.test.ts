import {
  buildGenesisChunkTxId,
  GENESIS_CHUNK_TX_ID_SEPARATOR,
  parseGenesisChunkTxId,
} from '../../src/api/rosetta-constants';

describe('genesis chunk tx id helpers', () => {
  const genesisTxId = '0x2f079994c9bd92b2272258b9de73e278824d76efe1b5a83a3b00941f9559de8a';

  test('round-trips a normal chunk index', () => {
    const synthetic = buildGenesisChunkTxId(genesisTxId, 42);
    expect(synthetic).toBe(`${genesisTxId}${GENESIS_CHUNK_TX_ID_SEPARATOR}42`);
    expect(parseGenesisChunkTxId(synthetic)).toEqual({
      origTxId: genesisTxId,
      chunkIndex: 42,
    });
  });

  test('round-trips chunk index 0', () => {
    const synthetic = buildGenesisChunkTxId(genesisTxId, 0);
    expect(parseGenesisChunkTxId(synthetic)).toEqual({
      origTxId: genesisTxId,
      chunkIndex: 0,
    });
  });

  test('rejects a non-synthetic tx id', () => {
    expect(parseGenesisChunkTxId(genesisTxId)).toBeNull();
  });

  test('rejects a synthetic id with a non-numeric chunk suffix', () => {
    expect(parseGenesisChunkTxId(`${genesisTxId}${GENESIS_CHUNK_TX_ID_SEPARATOR}abc`)).toBeNull();
    expect(parseGenesisChunkTxId(`${genesisTxId}${GENESIS_CHUNK_TX_ID_SEPARATOR}-1`)).toBeNull();
    expect(parseGenesisChunkTxId(`${genesisTxId}${GENESIS_CHUNK_TX_ID_SEPARATOR}1.5`)).toBeNull();
    expect(parseGenesisChunkTxId(`${genesisTxId}${GENESIS_CHUNK_TX_ID_SEPARATOR}`)).toBeNull();
  });

  test('parses using the last separator so multiple occurrences in the original tx id do not break', () => {
    const weirdTxId = `0xdead${GENESIS_CHUNK_TX_ID_SEPARATOR}beef`;
    const synthetic = buildGenesisChunkTxId(weirdTxId, 7);
    const parsed = parseGenesisChunkTxId(synthetic);
    expect(parsed).toEqual({ origTxId: weirdTxId, chunkIndex: 7 });
  });
});
