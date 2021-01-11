import * as crypto from 'crypto';
import * as fs from 'fs';
import * as stream from 'stream';
import * as util from 'util';

import { DbBNSName, DbBNSNamespace, DbBNSSubdomain } from '../datastore/common';
import { PgDataStore } from '../datastore/postgres-store';
import { logError, logger } from '../helpers';

import * as split from 'split2';
import { PoolClient } from 'pg';
import LineByLine = require('n-readlines');

const IMPORTFILES = [
  'chainstate.txt',
  'name_zonefiles.txt',
  'subdomains.csv',
  'subdomain_zonefiles.txt',
];

const finished = util.promisify(stream.finished);
const pipeline = util.promisify(stream.pipeline);
const access = util.promisify(fs.access);
const readFile = util.promisify(fs.readFile);

class ChainProcessor extends stream.Writable {
  tag: string = 'chainprocessor';
  state: string = '';
  rowCount: number = 0;
  zhashes: Record<string, string>;
  db: PgDataStore;
  client: PoolClient;

  constructor(client: PoolClient, db: PgDataStore, zhashes: Record<string, string>) {
    super();
    this.zhashes = zhashes;
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
          const zonefile = this.zhashes[parts[4]] ?? '';
          const obj: DbBNSName = {
            name: parts[0],
            address: parts[1],
            namespace_id: ns,
            registered_at: parseInt(parts[2], 10),
            expire_block: parseInt(parts[3], 10),
            zonefile: zonefile,
            zonefile_hash: parts[4],
            latest: true,
            canonical: true,
          };
          await this.db.updateNames(this.client, obj);
          this.rowCount += 1;
          if (obj.zonefile === '') {
            logger.warn(`${this.tag}: missing zonefile for ${obj.name} hash ${obj.zonefile_hash}`);
          }
        }
      } else {
        // namespace
        if (parts[0] !== 'namespace_id') {
          const obj: DbBNSNamespace = {
            namespace_id: parts[0],
            address: parts[1],
            reveal_block: parseInt(parts[2], 10),
            ready_block: parseInt(parts[3], 10),
            buckets: parts[4],
            base: parseInt(parts[5], 10),
            coeff: parseInt(parts[6], 10),
            nonalpha_discount: parseInt(parts[7], 10),
            no_vowel_discount: parseInt(parts[8], 10),
            lifetime: parseInt(parts[9], 10),
            latest: true,
            canonical: true,
          };
          await this.db.updateNamespaces(this.client, obj);
          this.rowCount += 1;
        }
      }
    }
    return next();
  }
}
class SubdomainTransform extends stream.Transform {
  zfstream: LineByLine;

  constructor(zfname: string) {
    super({ objectMode: true });
    this.zfstream = new LineByLine(zfname);
  }

  _transform(data: any, encoding: string, next: (error?: Error) => void) {
    const line = (data as Buffer).toString();
    const parts = line.split(',');

    if (parts[0] !== 'zonefile_hash') {
      const dots = parts[2].split('.');
      const namespace = dots[dots.length - 1];
      const name = dots.slice(1).join('.');

      const zonefilehash = (this.zfstream.next() as Buffer).toString();
      const zonefile = (this.zfstream.next() as Buffer).toString();

      // TODO: this should be a fatal error
      // if the zonefilehash we expect from the subdomains.csv file is
      // not the one we've read from subdomain_zonefiles.txt, something
      // is either out of sync or worse.
      if (parts[0] !== zonefilehash) {
        console.log(`something went wrong, expected: ${parts[0]}, read ${zonefilehash}`);
      }

      const obj: DbBNSSubdomain = {
        name: name,
        namespace_id: namespace,
        zonefile_hash: zonefilehash,
        parent_zonefile_hash: parts[1],
        fully_qualified_subdomain: parts[2],
        owner: parts[3],
        block_height: parseInt(parts[4], 10),
        parent_zonefile_index: parseInt(parts[5], 10),
        zonefile_offset: parseInt(parts[6], 10),
        resolver: parts[7],
        zonefile: zonefile,
        latest: true,
        canonical: true,
      };
      this.push(obj);
    }
    return next();
  }
}

class SubdomainInsert extends stream.Writable {
  buf: DbBNSSubdomain[] = [];
  bufSize: number = 0;
  maxBufSize: number;
  db: PgDataStore;
  client: PoolClient;

  constructor(client: PoolClient, db: PgDataStore, size: number) {
    super({ objectMode: true });
    this.client = client;
    this.db = db;
    this.maxBufSize = size;
  }

  async _write(chunk: DbBNSSubdomain, encoding: string, next: (error?: Error) => void) {
    this.buf.push(chunk);
    this.bufSize += 1;
    if (this.bufSize == this.maxBufSize) {
      logger.info(`writing ${this.bufSize}`);
      await this.db.updateBatchSubdomains(this.client, this.buf);
      this.buf = [];
      this.bufSize = 0;
    }
    return next();
  }

  async _final(done: (error?: Error) => void) {
    if (this.bufSize > 0) {
      logger.info(`writing ${this.bufSize} (final)`);
      await this.db.updateBatchSubdomains(this.client, this.buf);
    }
    done();
  }
}

async function readzones(zfname: string): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  let key = '';

  const zstream = stream.pipeline(fs.createReadStream(zfname), split(), err => {
    if (err) logError(`readzones: ${err}`);
  });

  zstream.on('readable', () => {
    let chunk;

    while (null !== (chunk = zstream.read())) {
      if (key === '') {
        key = chunk;
      } else {
        hashes[key] = chunk;
        key = '';
      }
    }
  });

  await finished(zstream);

  return hashes;
}

async function valid(fname: string): Promise<boolean> {
  const shafname = `${fname}.sha256`;
  const hash = crypto.createHash('sha256');

  return access(fname, fs.constants.R_OK)
    .then(() => {
      return access(shafname, fs.constants.R_OK);
    })
    .then(() => {
      return readFile(shafname, { encoding: 'utf-8' });
    })
    .then(async expectedHash => {
      await pipeline(fs.createReadStream(fname), hash);
      return {
        expected: expectedHash.trim(),
        calchash: hash.digest('hex'),
      };
    })
    .then(h => {
      if (h.expected !== h.calchash) {
        logError(`calculated ${h.calchash} for ${fname} != ${h.expected}`);
        return false;
      }
      return true;
    })
    .catch(error => {
      logError(`importer failed: ${error}`);
      return false;
    });
}

export async function importV1(db: PgDataStore, importDir?: string) {
  if (importDir === undefined) return;

  let bnsImport = true;
  fs.stat(importDir, (err, statobj) => {
    if (err || !statobj.isDirectory()) {
      logError(`Cannot import from ${importDir}: ${err}`);
      bnsImport = false;
    }
  });

  if (!bnsImport) return;

  // validate contents with their .sha256 files
  // check if the files we need can be read
  for (const fname of IMPORTFILES) {
    console.log(fname);
    if (!(await valid(`${importDir}/${fname}`))) {
      logError(`Cannot read import files: ${fname}`);
      return;
    }
  }

  logger.info('legacy BNS data import started');

  const client = await db.pool.connect();

  const zhashes = await readzones(`${importDir}/name_zonefiles.txt`);

  await pipeline(
    fs.createReadStream(`${importDir}/chainstate.txt`),
    split(),
    new ChainProcessor(client, db, zhashes)
  );

  await pipeline(
    fs.createReadStream(`${importDir}/subdomains.csv`),
    split(),
    new SubdomainTransform(`${importDir}/subdomain_zonefiles.txt`),
    new SubdomainInsert(client, db, 2000)
  );

  client.release();

  logger.info('legacy BNS data import completed');
}
