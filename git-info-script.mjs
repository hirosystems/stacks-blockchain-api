import { exec } from 'child_process';

exec('git --version', (error, _stdout, stderr) => {
  if (error) {
    throw new Error(`"git is missing", please install git and retry\n${error.message}`);
  }
  if (stderr) {
    throw new Error(`"git is missing", please install git and retry\n${stderr}`);
  }
  const gitInfo = `echo \"$(git rev-parse --abbrev-ref HEAD)\n$(git log -1 --pretty=format:%h)\n$(git describe --tags --abbrev=0)\" > ./.git-info`;
  console.log(gitInfo);
  exec(gitInfo);
});
