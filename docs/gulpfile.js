const { src, series } = require('gulp');
const path = require('path');
const ghPages = require('gulp-gh-pages');
const del = require('del');

const buildFolder = '.tmp';

function deployToGithubPages() {
  return src([path.join(buildFolder, '**/*')]).pipe(ghPages());
}

function clean() {
  return del('.publish');
}

exports.deployDocs = series(deployToGithubPages, clean);
