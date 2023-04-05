import * as fs from 'fs';
import { findTsvBlockHeight } from '../event-replay/helpers';
import { readLinesReversed } from '../event-replay/reverse-file-stream';

describe('helper tests', () => {
  function writeTmpFile(fileName: string, contents: string): string {
    try {
      fs.mkdirSync('./.tmp');
    } catch (error: any) {
      if (error.code != 'EEXIST') throw error;
    }
    const path = `./.tmp/${fileName}`;
    fs.writeFileSync(path, contents, { encoding: 'utf-8' });
    return path;
  }

  test('ReverseFileStream handles backpressure', async () => {
    let contents = '';
    for (let i = 1; i <= 1000; i++) {
      contents += `line${i}\n`;
    }
    // trim tailing \n char
    contents = contents.substring(0, contents.length - 1);
    const testFilePath = writeTmpFile('test1.txt', contents);
    try {
      // Default stream buffer is 64KB, set to 300 bytes so file is larger than memory buffer
      const reverseStream = readLinesReversed(testFilePath, 300);
      const output: string[] = [];
      let linesStreamed = 0;
      for await (const data of reverseStream) {
        linesStreamed++;
        output.push(data);
        if (linesStreamed === 4) {
          break;
        }
      }
      expect(linesStreamed).toEqual(4);
      expect(output).toEqual(['line1000', 'line999', 'line998', 'line997']);
      expect(reverseStream.getBytesRead()).toBeLessThan(reverseStream.getFileSize());

      // Read whole file
      const reverseStream2 = readLinesReversed(testFilePath, 300);
      const output2: string[] = [];
      let linesStreamed2 = 0;
      for await (const data of reverseStream2) {
        linesStreamed2++;
        output2.push(data);
      }
      expect(linesStreamed2).toEqual(1000);
      expect(output2[0]).toBe('line1000');
      expect(output2[output2.length - 1]).toBe('line1');
      expect(reverseStream2.getBytesRead()).toBe(reverseStream2.getFileSize());
    } finally {
      fs.unlinkSync(testFilePath);
    }
  });

  test('ReverseFileStream streams file in reverse', async () => {
    const contents = `line1
line2
line3
line4`;
    const testFilePath = writeTmpFile('test1.txt', contents);
    try {
      const reverseStream = readLinesReversed(testFilePath);
      const output: string[] = [];
      let linesStreamed = 0;
      for await (const data of reverseStream) {
        linesStreamed++;
        output.push(data);
      }
      expect(linesStreamed).toEqual(4);
      expect(output).toEqual(['line4', 'line3', 'line2', 'line1']);
    } finally {
      fs.unlinkSync(testFilePath);
    }
  });

  test('ReverseFileStream streams file in reverse', async () => {
    const contents = ['line1', 'line2', 'line3', 'line4'].join('\n');
    const testFilePath = writeTmpFile('test1.txt', contents);
    try {
      const reverseStream = readLinesReversed(testFilePath);
      const output: string[] = [];
      let linesStreamed = 0;
      for await (const data of reverseStream) {
        linesStreamed++;
        output.push(data);
      }
      expect(linesStreamed).toEqual(4);
      expect(output).toEqual(['line4', 'line3', 'line2', 'line1']);
    } finally {
      fs.unlinkSync(testFilePath);
    }
  });

  test('TSV block height is found', async () => {
    const contents = `744275\t2022-02-21 16:07:01.123587+00\t/new_mempool_tx\t[]
744275\t2022-02-21 16:07:01.123587+00\t/new_block\t{"block_height": 1200}
744275\t2022-02-21 16:07:01.123587+00\t/new_block\t{"block_height": 1201}
744275\t2022-02-21 16:07:01.123587+00\t/new_mempool_tx\t[]`;
    const testFilePath = writeTmpFile('test1.tsv', contents);
    try {
      const blockHeight = await findTsvBlockHeight(testFilePath);
      expect(blockHeight).toEqual(1201);
    } finally {
      fs.unlinkSync(testFilePath);
    }
  });

  test('TSV block height is 0 if not found', async () => {
    const contents = `744275\t2022-02-21 16:07:01.123587+00\t/new_mempool_tx\t[]
744275\t2022-02-21 16:07:01.123587+00\t/new_mempool_tx\t[]
744275\t2022-02-21 16:07:01.123587+00\t/new_mempool_tx\t[]
744275\t2022-02-21 16:07:01.123587+00\t/new_mempool_tx\t[]`;
    const testFilePath = writeTmpFile('test1.tsv', contents);
    try {
      const blockHeight = await findTsvBlockHeight(testFilePath);
      expect(blockHeight).toEqual(0);
    } finally {
      fs.unlinkSync(testFilePath);
    }
  });
});
