#!/usr/bin/env node 
const imgUrl = process.argv[2];
const encodedUrl = encodeURIComponent(imgUrl);
const [imgixDomain, imgixToken] = [process.env['IMGIX_DOMAIN'], process.env['IMGIX_TOKEN']];
const signature = require('crypto').createHash('md5').update(imgixToken + '/' + encodedUrl).digest('hex');
const resultUrl = new URL(encodedUrl + '?s=' + signature, imgixDomain);
console.log(resultUrl.toString());
