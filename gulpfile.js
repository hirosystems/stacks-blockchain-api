const { src, dest, parallel, series } = require('gulp');
const path = require('path');
const prettier = require('gulp-prettier');
const jsonschemaDeref = require('gulp-jsonschema-deref');
const ghPages = require('gulp-gh-pages');
const del = require('del');

const schemaFiles = 'docs/**/*.schema.json';
const buildFolder = 'src/schemas';

function flattenSchemas() {
  return src(schemaFiles)
    .pipe(jsonschemaDeref())
    .pipe(prettier())
    .pipe(dest(buildFolder));
}

function copyFiles() {
  return src(['docs/**/*.example.json', 'docs/**/*.yml']).pipe(
    dest(buildFolder)
  );
}

function deployToGithubPages() {
  const file = path.join(buildFolder, 'index.html'); 
  return src([file]).pipe(ghPages());
}

function clean() {
  return del('.publish');
}

exports.default = parallel(flattenSchemas, copyFiles);
exports.flattenSchemas = flattenSchemas;
exports.deployDocs = series(deployToGithubPages, clean);
