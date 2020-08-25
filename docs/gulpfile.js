const { src, dest, parallel, series } = require('gulp');
const path = require('path');
const jsonschemaDeref = require('gulp-jsonschema-deref');
const ghPages = require('gulp-gh-pages');
const del = require('del');

const schemaFiles = ['api/**/*.schema.json', 'entities/**/*.schema.json'];
const buildFolder = '.tmp';

function flattenSchemas() {
  return src(schemaFiles, {base: '.'})
    .pipe(jsonschemaDeref())
    .pipe(dest(buildFolder));
}

function copyFiles() {
  return src(['api/**/*.example.json', 'entities/**/*.example.json'], {base: '.'}).pipe(
    dest(buildFolder)
  );
}

function deployToGithubPages() {
  return src([path.join(buildFolder, '**/*')]).pipe(ghPages());
}

function clean() {
  return del('.publish');
}

exports.default = parallel(flattenSchemas, copyFiles);
exports.flattenSchemas = flattenSchemas;
exports.deployDocs = series(deployToGithubPages, clean);
