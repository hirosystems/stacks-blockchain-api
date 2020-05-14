const core = require('@actions/core');
const exec = require('@actions/exec');
const docsPackage = require('../../../docs/package.json');
const compareVersion = require('compare-versions');
const npmApi = require('npm-api');

(async () => {
  try {
    const npm = new npmApi();
    const npmPublishedPackage = await npm.repo('@blockstack/stacks-blockchain-sidecar-types').package();

    const publishedVersion = npmPublishedPackage.version;
    const repoVersion = docsPackage.version;

    console.log({ publishedVersion });
    console.log({ repoVersion });

    const isNewerVersion = compareVersion(repoVersion, publishedVersion) === 1;

    if (!isNewerVersion) {
      console.log('Local version is not newer than deployed');
      process.exit(core.ExitCode.Success);
    }

    await exec.exec('npm', ['run', 'generate:types']);

    await exec.exec('cp', ['.tmp/index.d.ts', 'docs/']);

    await exec.exec('npm', ['publish'], { cwd: './docs' });

  } catch (error) {
    core.setFailed(error.message);
  }
})();
