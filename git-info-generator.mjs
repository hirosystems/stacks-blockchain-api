import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import shell from 'shelljs';

if (!shell.which('git')) {
  throw new Error(`"git is missing", please install git and retry`);
}

const gitInfo = [
  'git rev-parse --abbrev-ref HEAD',
  'git log -1 --pretty=format:%h',
  'git describe --tags --abbrev=0',
].map(r => execSync(r, { encoding: 'utf8' }).trim());
writeFileSync('.git-info', gitInfo.join('\n'));
