import * as crypto from 'crypto';
import * as fs from 'fs';
import * as stream from 'stream';
import * as util from 'util';
import * as readline from 'readline';
import * as path from 'path';

import { DbBnsName, DbBnsNamespace, DbBnsSubdomain, DbConfigState } from '../datastore/common';
import { PgDataStore } from '../datastore/postgres-store';
import { asyncBatchIterate, asyncIterableToGenerator, logError, logger } from '../helpers';

import { PoolClient } from 'pg';

const IMPORT_FILES = [
  'chainstate.txt',
  'name_zonefiles.txt',
  'subdomains.csv',
  'subdomain_zonefiles.txt',
];

const finished = util.promisify(stream.finished);
const pipeline = util.promisify(stream.pipeline);
const access = util.promisify(fs.access);
const readFile = util.promisify(fs.readFile);

const SUBDOMAIN_BATCH_SIZE = 2000;

export class LineReaderStream extends stream.Duplex {
  asyncGen: AsyncGenerator<string, void, unknown>;
  readlineInstance: readline.Interface;
  passthrough: stream.Duplex;
  constructor(opts?: stream.DuplexOptions) {
    super({ readableObjectMode: true, ...opts });
    this.passthrough = new stream.PassThrough();
    this.readlineInstance = readline.createInterface({
      input: this.passthrough,
      crlfDelay: Infinity,
    });
    this.asyncGen = asyncIterableToGenerator(this.readlineInstance);
  }
  async _read(size: number) {
    for (let i = 0; i < size; i++) {
      const chunk = await this.asyncGen.next();
      if (!this.push(chunk.done ? null : chunk.value)) {
        break;
      }
      if (chunk.done) {
        break;
      }
    }
  }
  _write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.passthrough.write(chunk, encoding, callback);
  }
  _destroy(error: any, callback: (error: Error | null) => void) {
    this.passthrough.destroy(error);
    this.readlineInstance.close();
    callback(error);
  }
  _final(callback: (error?: Error | null) => void) {
    this.passthrough.end(() => callback());
  }
}

class ChainProcessor extends stream.Writable {
  tag: string = 'chainprocessor';
  state: string = '';
  rowCount: number = 0;
  zhashes: Map<string, string>;
  namespace: Map<string, DbBnsNamespace>;
  db: PgDataStore;
  client: PoolClient;

  constructor(client: PoolClient, db: PgDataStore, zhashes: Map<string, string>) {
    super();
    this.zhashes = zhashes;
    this.namespace = new Map();
    this.client = client;
    this.db = db;
    logger.info(`${this.tag}: importer starting`);
  }

  _final(done: (error?: Error) => void) {
    logger.info(`${this.tag}: importer done`);
    done();
  }

  async _write(chunk: any, encoding: string, next: (error?: Error) => void) {
    const line = (chunk as Buffer).toString();

    /*
     * Blocks of data inside the chainstate file start with
     * -----BEGIN SOMETHING-----
     * and end with
     * -----END SOMETHING-----
     *
     * Extract text between "BEGIN " and the trailing dashes, replace
     * spaces with underscores, and downcase the strings.
     */

    if (line.startsWith('-----BEGIN')) {
      const state = line
        .slice(line.indexOf(' '))
        .split('-')[0]
        .trim()
        .toLowerCase()
        .replace(/\s+/, '_');

      // we only care about namespaces/names
      if (state.startsWith('name')) {
        this.state = state;
      } else {
        this.state = '';
      }
    } else if (line.startsWith('-----END')) {
      if (this.state.startsWith('name') && this.rowCount > 0) {
        logger.info(`${this.tag}: ${this.state} rows added: ${this.rowCount}`);
      }
      this.state = '';
      this.rowCount = 0;
    } else if (this.state != '') {
      const parts = line.split(',');
      // special case: add zonefile, namespace to names rows
      if (this.state === 'names') {
        // skip header row
        if (parts[0] !== 'name') {
          const ns = parts[0].split('.').slice(1).join('');
          const zonefileHash = parts[2];
          const zonefile = this.zhashes.get(zonefileHash) ?? '';
          const namespace = this.namespace.get(ns);
          if (!namespace) {
            throw new Error(`Missing namespace "${ns}"`);
          }
          const obj: DbBnsName = {
            name: parts[0],
            address: parts[1],
            namespace_id: ns,
            registered_at: 0,
            expire_block: namespace.lifetime,
            zonefile: zonefile,
            zonefile_hash: zonefileHash,
            latest: true,
            canonical: true,
            status: 'name-register',
          };
          await this.db.updateNames(this.client, obj);
          this.rowCount += 1;
          if (obj.zonefile === '') {
            logger.verbose(
              `${this.tag}: [non-critical] no zonefile for ${obj.name} hash ${obj.zonefile_hash}`
            );
          }
        }
      } else {
        // namespace
        if (parts[0] !== 'namespace_id') {
          const obj: DbBnsNamespace = {
            namespace_id: parts[0],
            address: parts[1],
            reveal_block: 0,
            ready_block: 0,
            buckets: parts[2],
            base: parseInt(parts[3], 10),
            coeff: parseInt(parts[4], 10),
            nonalpha_discount: parseInt(parts[5], 10),
            no_vowel_discount: parseInt(parts[6], 10),
            lifetime: parseInt(parts[7], 10),
            latest: true,
            canonical: true,
          };
          this.namespace.set(obj.namespace_id, obj);
          await this.db.updateNamespaces(this.client, obj);
          this.rowCount += 1;
        }
      }
    }
    return next();
  }
}

interface SubdomainZonefile {
  hash: string;
  content: string;
}

class SubdomainZonefileParser extends stream.Transform {
  lastHash: string | undefined;
  constructor() {
    super({ objectMode: true, highWaterMark: SUBDOMAIN_BATCH_SIZE });
  }
  _transform(chunk: string, _encoding: string, callback: stream.TransformCallback) {
    if (this.lastHash === undefined) {
      this.lastHash = chunk;
    } else {
      const item: SubdomainZonefile = {
        hash: this.lastHash,
        content: chunk.replace(/\\n/g, '\n'),
      };
      this.push(item);
      this.lastHash = undefined;
    }
    callback();
  }
}

class SubdomainTransform extends stream.Transform {
  constructor() {
    super({ objectMode: true, highWaterMark: SUBDOMAIN_BATCH_SIZE });
  }
  _transform(data: string, _encoding: string, callback: stream.TransformCallback) {
    const parts = data.split(',');
    if (parts[0] !== 'zonefile_hash') {
      const fqn = parts[2]; // fully qualified name
      const dots = fqn.split('.');
      const namespace = dots[dots.length - 1];
      const subdomain: DbBnsSubdomain = {
        name: fqn,
        namespace_id: namespace,
        zonefile_hash: parts[0],
        zonefile: '',
        parent_zonefile_hash: parts[1],
        fully_qualified_subdomain: parts[2],
        owner: parts[3],
        block_height: parseInt(parts[4], 10),
        parent_zonefile_index: parseInt(parts[5], 10),
        zonefile_offset: parseInt(parts[6], 10),
        resolver: parts[7],
        latest: true,
        canonical: true,
      };
      this.push(subdomain);
    }
    callback();
  }
}

async function readZones(zfname: string): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();

  const zstream = stream.pipeline(fs.createReadStream(zfname), new LineReaderStream(), err => {
    if (err) logError(`readzones: ${err}`);
  });

  const generator = asyncIterableToGenerator<string>(zstream);

  while (true) {
    const [keyRes, chunkRes] = [await generator.next(), await generator.next()];
    if (!keyRes.done && !chunkRes.done) {
      hashes.set(keyRes.value, chunkRes.value.replace(/\\n/g, '\n'));
    } else {
      break;
    }
  }

  await finished(zstream);

  return hashes;
}

async function valid(fileName: string): Promise<boolean> {
  const shafname = `${fileName}.sha256`;
  const hash = crypto.createHash('sha256');
  await access(fileName, fs.constants.R_OK);
  await access(shafname, fs.constants.R_OK);
  const expected = (await readFile(shafname, { encoding: 'utf-8' })).trim();
  await pipeline(fs.createReadStream(fileName), hash);
  const calchash = hash.digest('hex');
  if (expected !== calchash) {
    logError(`calculated ${calchash} for ${fileName} != ${expected}`);
    return false;
  }
  return true;
}

async function* readSubdomains(importDir: string) {
  const metaIter = asyncIterableToGenerator<DbBnsSubdomain>(
    stream.pipeline(
      fs.createReadStream(path.join(importDir, 'subdomains.csv')),
      new LineReaderStream({ highWaterMark: SUBDOMAIN_BATCH_SIZE }),
      new SubdomainTransform(),
      error => {
        if (error) {
          console.error('Error reading subdomains.csv');
          console.error(error);
        }
      }
    )
  );

  const zfIter = asyncIterableToGenerator<SubdomainZonefile>(
    stream.pipeline(
      fs.createReadStream(path.join(importDir, 'subdomain_zonefiles.txt')),
      new LineReaderStream({ highWaterMark: SUBDOMAIN_BATCH_SIZE }),
      new SubdomainZonefileParser(),
      error => {
        if (error) {
          console.error('Error reading subdomain_zonefiles.txt');
          console.error(error);
        }
      }
    )
  );

  while (true) {
    const meta = await metaIter.next();
    const zf = await zfIter.next();
    if (meta.done !== zf.done) {
      throw new Error(
        `Unexpected subdomain streams end mismatch; zonefiles ended: ${zf.done}, metadata ended: ${meta.done}`
      );
    }
    if (meta.done || zf.done) {
      break;
    }
    const subdomain = meta.value;
    if (subdomain.zonefile_hash !== zf.value.hash) {
      throw new Error(
        `Unordered entries between subdomains.csv and subdomain_zonefiles.txt! Expected hash ${subdomain.zonefile_hash} got ${zf.value.hash}`
      );
    }
    subdomain.zonefile = zf.value.content;
    yield subdomain;
  }
}

export async function importV1(db: PgDataStore, importDir: string) {
  const configState = await db.getConfigState();
  if (configState.bns_names_onchain_imported && configState.bns_subdomains_imported) {
    logger.verbose('Stacks 1.0 BNS data is already imported');
    return;
  }

  try {
    const statResult = fs.statSync(importDir);
    if (!statResult.isDirectory()) {
      throw new Error(`${importDir} is not a directory`);
    }
  } catch (error) {
    logError(`Cannot import from ${importDir}`, error);
    throw error;
  }

  logger.info('Stacks 1.0 BNS data import started');
  logger.info(`Using BNS export data from: ${importDir}`);

  // validate contents with their .sha256 files
  // check if the files we need can be read
  for (const fname of IMPORT_FILES) {
    if (!(await valid(path.join(importDir, fname)))) {
      const errMsg = `Cannot read import file due to sha256 mismatch: ${fname}`;
      logError(errMsg);
      throw new Error(errMsg);
    }
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const zhashes = await readZones(path.join(importDir, 'name_zonefiles.txt'));
    await pipeline(
      fs.createReadStream(path.join(importDir, 'chainstate.txt')),
      new LineReaderStream({ highWaterMark: 100 }),
      new ChainProcessor(client, db, zhashes)
    );

    let subdomainsImported = 0;
    const subdomainIter = readSubdomains(importDir);
    for await (const subdomainBatch of asyncBatchIterate(
      subdomainIter,
      SUBDOMAIN_BATCH_SIZE,
      false
    )) {
      await db.updateBatchSubdomains(client, subdomainBatch);
      subdomainsImported += subdomainBatch.length;
      if (subdomainsImported % 10_000 === 0) {
        logger.info(`Subdomains imported: ${subdomainsImported}`);
      }
    }
    const updatedConfigState: DbConfigState = {
      bns_names_onchain_imported: true,
      bns_subdomains_imported: true,
    };
    await db.updateConfigState(updatedConfigState, client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  logger.info('Stacks 1.0 BNS data import completed');
}
