const fs = require('fs');
const https = require('https');
const path = require('path');
const util = require('util');
const readline = require('readline');
const { PassThrough, pipeline } = require('stream');
const { execSync, spawn } = require('child_process');
const { Storage } = require('@google-cloud/storage');
const deepmerge = require('deepmerge');

const pipelineAsync = util.promisify(pipeline);

const BUCKET_NAME = 'blockstack-stacks-blockchain_artifacts';
const BUCKET_URL = `https://${BUCKET_NAME}.storage.googleapis.com/`;
const STACKS_BLOCKCHAIN_REPO = 'https://github.com/blockstack/stacks-blockchain.git';

const envVars = {
  STACKS_BLOCKCHAIN_BRANCH: 'master',
  STACKS_BLOCKCHAIN_BIN: 'blockstack-core',
  STACKS_BLOCKCHAIN_DIST_PLATFORM: 'linux-x64',
};
Object.entries(envVars).forEach(([key, val]) => envVars[key] = process.env[key] || val);

const gitCommit = (() => {
  const cmd = `git ls-remote ${STACKS_BLOCKCHAIN_REPO} ${envVars.STACKS_BLOCKCHAIN_BRANCH}`;
  console.log(`Fetching commit hash for ${cmd}`);
  const [commitHash] = execSync(cmd, {encoding: 'utf8'}).split(/(\s+)/);
  return commitHash;
})();
const shortCommit = gitCommit.substr(0, 7);
console.log(`Using commit hash: ${gitCommit}`);

const [dateString] = new Date().toISOString().split('T');

const releaseFileName = `${envVars.STACKS_BLOCKCHAIN_BIN}-${envVars.STACKS_BLOCKCHAIN_DIST_PLATFORM}-${dateString}-${shortCommit}`;
console.log(`Upload dist file: '${releaseFileName}'`);

const buildOutputDir = fs.mkdtempSync(path.join(__dirname, '.stacks-core-build-'));
console.log(`Building stacks-blockchain binaries into '${buildOutputDir}'`);

const storage = new Storage({
  projectId: 'ops-shared',
  // TODO: use env vars GOOGLE_APPLICATION_CREDENTIALS (path to keyfile json)
});
const bucket = storage.bucket(BUCKET_NAME);

function buildDist() {
  return new Promise((resolve, reject) => {
    const cargoCmd = `cargo install --git https://github.com/blockstack/stacks-blockchain.git --rev "${gitCommit}" --bin=blockstack-core --debug --root /build-out`;
    const dockerRunCmd = `docker run -v "${buildOutputDir}:/build-out" rust:stretch ${cargoCmd}`;
    console.log(`Running build via docker: ${dockerRunCmd}`);
    const result = spawn(dockerRunCmd, {
      cwd: __dirname,
      shell: '/bin/bash',
    });
    readline.createInterface(result.stderr).on('line', console.error);
    readline.createInterface(result.stdout).on('line', console.log);
    result.on('error', (error) => reject(error))
    result.on('exit', (code, signal) => {
      try {
        if (code !== 0) {
          const msg = `Cargo bad exit code: ${code}, signal: ${signal}`;
          console.error(msg);
          process.exit(code);
        }
      }
      finally {
        const binFileResult = `${buildOutputDir}/bin/blockstack-core`;
        console.log(`Build complete: ${binFileResult}`);
        resolve(binFileResult);
      }
    });
  });
}

const getBucketFileUrl = (file) => BUCKET_URL + file;
const fetchBucketFile = (file) => new Promise((resolve, reject) => {
  const request = https.get(getBucketFileUrl(file), (response) => {
    if (response.statusCode < 200 || response.statusCode > 299) {
        reject(new Error('Failed to load page, status code: ' + response.statusCode));
      }
    const body = [];
    response.on('data', (chunk) => body.push(chunk));
    response.on('end', () => resolve(body.join('')));
  });
  request.on('error', (err) => reject(err))
});

async function uploadBucketFile(distFilePath) {
  // First, upload the new (unique) dist file.
  console.log('Uploading release binary');
  await bucket.upload(distFilePath, {
    destination: releaseFileName,
    resumable: false,
    gzip: true,
    contentType: 'application/octet-stream',
  });

  // Second, update the index.json pointers
  const releaseEntry = {
    commit_hash: gitCommit,
    date: dateString,
    file: releaseFileName,
    url: getBucketFileUrl(releaseFileName)
  };
  console.log('Fetching latest release index.json');
  const currentIndex = JSON.parse(await fetchBucketFile('index.json'));
  const indexEntry = {
    [envVars.STACKS_BLOCKCHAIN_BIN]: {
      [envVars.STACKS_BLOCKCHAIN_DIST_PLATFORM]: {
          latest: {...releaseEntry}, 
          releases: [
            {...releaseEntry}  
          ]
        }
      }
  };
  const indexDataStream = new PassThrough()
  indexDataStream.end(JSON.stringify(deepmerge(currentIndex, indexEntry), null, '  '));
  console.log('Uploading updated release index.json');
  const writeStream = bucket.file('index.json').createWriteStream({
    resumable: false,
    contentType: 'application/json',
    metadata: { cacheControl: 'no-cache' }
  });
  await pipelineAsync(indexDataStream, writeStream);
  console.log('release distribution completed');
}

async function run() {
  const distFilePath = await buildDist();
  await uploadBucketFile(distFilePath);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
