import  shell from 'shelljs';

if (!shell.which('git')) {
  throw new Error(`"git is missing", please install git and retry`);
}
shell
  .exec(
    `echo \"$(git rev-parse --abbrev-ref HEAD)\n$(git log -1 --pretty=format:%h)\n$(git describe --tags --abbrev=0)\"`
  )
  .to('./.git-info');
