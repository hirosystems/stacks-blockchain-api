import * as fs from 'fs';
import * as stream from 'stream';
import * as util from 'util';

import { DbBNSName, DbBNSNamespace } from '../datastore/common';
import { logError, logger } from '../helpers';

import * as split from 'split2';
import { PgDataStore } from '../datastore/postgres-store';
import { PoolClient } from 'pg';

const finished = util.promisify(stream.finished);
const pipeline = util.promisify(stream.pipeline);

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

export async function importV1(db: PgDataStore, importDir?: string) {
  if (importDir === undefined) return;

  let bnsImport = true;
  fs.stat(importDir, (err, statobj) => {
    if (err || !statobj.isDirectory()) {
      logError(`Cannot import from ${importDir} ${err}`);
      bnsImport = false;
    }
  });

  if (!bnsImport) return;

  logger.info('legacy BNS data import started');

  // check if the files we need can be read
  try {
    fs.accessSync(`${importDir}/chainstate.txt`, fs.constants.R_OK);
    fs.accessSync(`${importDir}/name_zonefiles.txt`, fs.constants.R_OK);

    fs.accessSync(`${importDir}/subdomains.csv`, fs.constants.R_OK);
    fs.accessSync(`${importDir}/subdomain_zonefiles.txt`, fs.constants.R_OK);
  } catch (error) {
    logError(`Cannot read import files: ${error}`);
    return;
  }

  const client = await db.pool.connect();

  const zhashes = await readzones(`${importDir}/name_zonefiles.txt`);

  await pipeline(
    fs.createReadStream(`${importDir}/chainstate.txt`),
    split(),
    new ChainProcessor(client, db, zhashes)
  );

  // TODO: not in this stage
  // await pipeline(
  //   fs.createReadStream(`${importDir}/subdomains.csv`),
  //   split(),
  //   new SubdomainProcessor(db)
  // );

  client.release();
  logger.info('legacy BNS data import completed');
}
