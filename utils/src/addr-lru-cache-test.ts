import * as util from 'util';
import * as assert from 'assert';
import * as c32check from 'c32check';
import * as c32AddrCache from '../../src/c32-addr-cache';

if (!global.gc) {
  throw new Error('Enable --expose-gc');
}

const iters = 500_000;
process.env[c32AddrCache.ADDR_CACHE_ENV_VAR] = iters.toString();

c32AddrCache.injectC32addressEncodeCache();

const buff = Buffer.alloc(20);
c32check.c32address(1, buff.toString('hex'));
const startMemory = process.memoryUsage();
const startRss = startMemory.rss;
const startMemoryStr = util.inspect(startMemory);

for (let i = 0; i < iters; i++) {
  // hash160 hex string
  buff.writeInt32LE(i);
  c32check.c32address(1, buff.toString('hex'));
}

global.gc();

const endMemory = process.memoryUsage();
const endRss = endMemory.rss;
const endMemoryStr = util.inspect(endMemory);
console.log('Start memory', startMemoryStr);
console.log('End memory', endMemoryStr);

assert.equal(c32AddrCache.getAddressLruCache().itemCount, iters);

const rn = (num: number) => Math.round(num * 100) / 100;
const megabytes = (bytes: number) => rn(bytes / 1024 / 1024);

const byteDiff = (endRss - startRss) / (iters / 10_000);

console.log(`Start RSS: ${megabytes(startRss)}, end RSS: ${megabytes(endRss)}`);
console.log(`Around ${megabytes(byteDiff)} megabytes per 10k cache entries`);

/*
Several rounds of running this benchmark show "Around 4.44 megabytes per 10k cache entries":

Start memory {
  rss: 26202112,
  heapTotal: 5578752,
  heapUsed: 3642392,
  external: 1147316,
  arrayBuffers: 59931
}
End memory {
  rss: 259125248,
  heapTotal: 216875008,
  heapUsed: 181636328,
  external: 1261038,
  arrayBuffers: 18090
}
Start RSS: 24.99, end RSS: 247.12
*/
