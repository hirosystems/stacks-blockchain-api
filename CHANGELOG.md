# [0.12.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.11.3...v0.12.0) (2020-09-02)


### Features

* update jsonrc package—thanks [@zensh](https://github.com/zensh), closes [#208](https://github.com/blockstack/stacks-blockchain-api/issues/208) ([86b575d](https://github.com/blockstack/stacks-blockchain-api/commit/86b575da766f229ce971495139eae0ba68f1002b))

## [0.11.3](https://github.com/blockstack/stacks-blockchain-api/compare/v0.11.2...v0.11.3) (2020-09-01)


### Bug Fixes

* mempool schema files renamed: rosetta-mempool-transaction-list-* -> rosetta-mempool-* ([d24bfe8](https://github.com/blockstack/stacks-blockchain-api/commit/d24bfe8956f4596a143e49f45a8d25111b1c783a))
* missed several request/response files ([09e373b](https://github.com/blockstack/stacks-blockchain-api/commit/09e373b3f93f79c6089c0c791bcb9eceec60d66e))
* separate out rosetta request/response schema files from entity files ([bd4dc86](https://github.com/blockstack/stacks-blockchain-api/commit/bd4dc8649341139a2251024417bfb57805f04367))


### Reverts

* this volume change should not have been committed ([8e46a40](https://github.com/blockstack/stacks-blockchain-api/commit/8e46a40011a4ce07e4057e77966c25d692d5e068))

## [0.11.2](https://github.com/blockstack/stacks-blockchain-api/compare/v0.11.1...v0.11.2) (2020-08-27)


### Bug Fixes

* add tx_result to example ([1ce88a6](https://github.com/blockstack/stacks-blockchain-api/commit/1ce88a65d9bb8ac2df86c036b05b6af1e061aeba)), closes [#212](https://github.com/blockstack/stacks-blockchain-api/issues/212)
* adding block time ([f895fe7](https://github.com/blockstack/stacks-blockchain-api/commit/f895fe7225d3e457137bed719221047560d6ed43)), closes [#213](https://github.com/blockstack/stacks-blockchain-api/issues/213)

## [0.11.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.11.0...v0.11.1) (2020-08-27)


### Bug Fixes

* sidecar do not exit while trying to connect to postgres ([2a3c693](https://github.com/blockstack/stacks-blockchain-api/commit/2a3c693870951d512d44eb296befd48a592c2bf1))

# [0.11.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.10.0...v0.11.0) (2020-08-27)


### Bug Fixes

* add java to follower docker build ([78caee3](https://github.com/blockstack/stacks-blockchain-api/commit/78caee30e9068f8e504f88019621a6a2c71b7e8e))
* restarting services on node exit ([7f86511](https://github.com/blockstack/stacks-blockchain-api/commit/7f86511366df58e8e639cdcc97684a42f6ace312))


### Features

* dockerfile for self-contained follower ([9628148](https://github.com/blockstack/stacks-blockchain-api/commit/96281487229b6fd85d8fc5a2c75d74390a07efda))
* dockerfile with all stacks-blockchain-api dependencies working ([66d64ed](https://github.com/blockstack/stacks-blockchain-api/commit/66d64ed4e068bf6d2a500d8a6a347eff72fcc11a))
* progress on self contained follower ([d544edf](https://github.com/blockstack/stacks-blockchain-api/commit/d544edf9e3ff7769ab333b41aea11f3f472cfa2d))

# [0.10.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.9.0...v0.10.0) (2020-08-26)


### Bug Fixes

* revert test:integration script operator change ([d949119](https://github.com/blockstack/stacks-blockchain-api/commit/d949119fcaeb1ebc8fee9dd2376b168ed4409d9e))
* update readme and openapi client description ([2af816b](https://github.com/blockstack/stacks-blockchain-api/commit/2af816b4a50583f00af481be9fa748ccb41dd21d))
* windows friendly operator ([f1cd6ff](https://github.com/blockstack/stacks-blockchain-api/commit/f1cd6ff27ee5cc368fac5783a92d7682a4b4552f))


### Features

* adding docs tasks to main package.json ([6fda66c](https://github.com/blockstack/stacks-blockchain-api/commit/6fda66c3cc7dab6c250a2dbcd5980c8081623d34))
* client docs ([602a266](https://github.com/blockstack/stacks-blockchain-api/commit/602a2669e3c9ad03f75e012da386c6c1c67f77ea))

# [0.9.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.8.0...v0.9.0) (2020-08-26)


### Bug Fixes

* fetch the api server's version from package.json ([e6efc40](https://github.com/blockstack/stacks-blockchain-api/commit/e6efc40fd11a363cd2f29cbe105bb63a040b972d))


### Features

* add hard-coded status and error messages for rosetta ([84fae9b](https://github.com/blockstack/stacks-blockchain-api/commit/84fae9b7573df995ae029b152172f88a95ae6c91))
* add mempool openapi docs ([b981c49](https://github.com/blockstack/stacks-blockchain-api/commit/b981c499e6d0e0bc3fb3bf0f6049f409921746a9))
* add rosetta api schema for type information ([edb3b14](https://github.com/blockstack/stacks-blockchain-api/commit/edb3b14b597466d49674b07fee2aff615a300ad5))
* fill out rosetta network list and options calls ([a753c96](https://github.com/blockstack/stacks-blockchain-api/commit/a753c9614a9d62ad3cb6579ec36b44a4443208ad))
* stub handlers for rosetta api endpoints ([9603ea4](https://github.com/blockstack/stacks-blockchain-api/commit/9603ea4b46107e21412a2f468df0a6b966e39922))

# [0.8.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.7.0...v0.8.0) (2020-08-25)


### Bug Fixes

* deserializing multisig txs ([db6d264](https://github.com/blockstack/stacks-blockchain-api/commit/db6d264d1995aa5f872a4a8da9c34819e02e58ee))
* N-of-M multisig working ([34ba78c](https://github.com/blockstack/stacks-blockchain-api/commit/34ba78c40376a06dc161bd97b92756553a488cdd))
* N-of-N (one to one) multisig txs working ([4cc155b](https://github.com/blockstack/stacks-blockchain-api/commit/4cc155bf7ca4f2869827593a0d049f508d3f2cd7))


### Features

* initial debug endpoint support for sending multisig transactions ([d12ba53](https://github.com/blockstack/stacks-blockchain-api/commit/d12ba53fb0f1230baed3782d362b5bf3d3d9fa5b))

# [0.7.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.6.0...v0.7.0) (2020-08-24)


### Features

* expose target block time [#192](https://github.com/blockstack/stacks-blockchain-api/issues/192) ([89165b2](https://github.com/blockstack/stacks-blockchain-api/commit/89165b2becc48b9e83f92f54564434fde291a403))

# [0.6.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.5.3...v0.6.0) (2020-08-20)


### Bug Fixes

* add java to gh workflow ([d5ae6ca](https://github.com/blockstack/stacks-blockchain-api/commit/d5ae6caaa4ee9da261f67e47e0a1514ce04980f5))
* add jre to the dockerfile build ([402686c](https://github.com/blockstack/stacks-blockchain-api/commit/402686c1bfb83bbfb6c12aaa83652cce3e411719))
* client package.json files includes ([da6061f](https://github.com/blockstack/stacks-blockchain-api/commit/da6061f1cfc3ce9cf421ae18d38feac9a0950bcd))
* cross-platform openapi generation script ([7ade2fb](https://github.com/blockstack/stacks-blockchain-api/commit/7ade2fb9736943b1ba7690d8d7d3ba2eebd500d5))
* lint fixes ([465a72e](https://github.com/blockstack/stacks-blockchain-api/commit/465a72e651b6721e9e15a7065fb84235f1d99e96))
* postinstall script to build client lib if needed, add readme ([791f763](https://github.com/blockstack/stacks-blockchain-api/commit/791f763120e166bb253da093eb7cf8cf4c5e01e8))
* typing errors with esModuleInterop, default websocket client connection URL ([a1517b1](https://github.com/blockstack/stacks-blockchain-api/commit/a1517b1824d785a82adf30063723e355d575c308))


### Features

* auto-generated client demo ([6eda93d](https://github.com/blockstack/stacks-blockchain-api/commit/6eda93d7ffd4ba886c4ede489fcdf6adda830914))

## [0.5.3](https://github.com/blockstack/stacks-blockchain-api/compare/v0.5.2...v0.5.3) (2020-08-13)


### Bug Fixes

* retry npm publish ([3bda2bb](https://github.com/blockstack/stacks-blockchain-api/commit/3bda2bba4c38663aa075b8475681aa4c7cf49aa1))

## [0.5.2](https://github.com/blockstack/stacks-blockchain-api/compare/v0.5.1...v0.5.2) (2020-08-13)


### Bug Fixes

* gh-action to npm build before publishing ([40cd062](https://github.com/blockstack/stacks-blockchain-api/commit/40cd062178ab78f2940876511c9baac5f1e5df51))

## [0.5.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.5.0...v0.5.1) (2020-08-13)


### Bug Fixes

* gh-action for publishing ws-rpc-client ([544f970](https://github.com/blockstack/stacks-blockchain-api/commit/544f9704ab70ed1dd25979f8cfbb7339250bd02d))

# [0.5.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.4.0...v0.5.0) (2020-08-13)


### Bug Fixes

* remove unnecessary db tx status query from event listeners ([0a0a20d](https://github.com/blockstack/stacks-blockchain-api/commit/0a0a20dcd4b4017019ac9944f235b9ecf15568f8))


### Features

* friendlier ws-rpc-api client subscription functions ([9160039](https://github.com/blockstack/stacks-blockchain-api/commit/9160039afc3f1a674d76ccc2d87f78404adf8525))
* websocket rpc client lib ([0a67a11](https://github.com/blockstack/stacks-blockchain-api/commit/0a67a11043d83cc5aedfa2811e6fc3118e4042d6))
* websocket rpc notifications for address tx and balance updates ([14d92b0](https://github.com/blockstack/stacks-blockchain-api/commit/14d92b0ca43b7638a90eda04ed86d34e66f19097))
* websocket RPC pubsub service for real-time data services ([6eb83e8](https://github.com/blockstack/stacks-blockchain-api/commit/6eb83e8aa1cb6e5eb98c8c5ad8c94ff3954819f6))

# [0.4.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.3.1...v0.4.0) (2020-07-28)


### Bug Fixes

* linting errors after rebase with latest master ([3679652](https://github.com/blockstack/stacks-blockchain-api/commit/3679652058df3b6456ed16c0a8fc170499b2ac88))
* unit tests fixed after rebase with latest master ([a806740](https://github.com/blockstack/stacks-blockchain-api/commit/a806740cb59537cf1048a97114cec64be0daa7a9))
* unit tests for sponsored tx (redundant null property) ([c918235](https://github.com/blockstack/stacks-blockchain-api/commit/c9182357a2e52db97159c04de6b52976ca241409))


### Features

* add sponsor transaction option to debug broadcast endpoints ([4511a50](https://github.com/blockstack/stacks-blockchain-api/commit/4511a502650bc834540ea032eb476ba2b09d8d84))
* support sponsored tx in db and API response ([01703e7](https://github.com/blockstack/stacks-blockchain-api/commit/01703e7222828b6df2ed1ed0e26de3e9ae18d11e))

## [0.3.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.3.0...v0.3.1) (2020-07-28)


### Bug Fixes

* address stx balance schema bug ([b44a9b9](https://github.com/blockstack/stacks-blockchain-api/commit/b44a9b9e20329987d00a8cac90eaa7098c9de1b1))
* make address stx balance take fees into account ([f845086](https://github.com/blockstack/stacks-blockchain-api/commit/f84508668ecb6c264e9d56dfb8f29c4675b40b33))

# [0.3.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.2.5...v0.3.0) (2020-07-28)


### Bug Fixes

* possible fix for core-node proxy in gitpod deployment ([c0aaee8](https://github.com/blockstack/stacks-blockchain-api/commit/c0aaee81863150d024eb82626bee3fa61cf4a404))
* **docs:** conform to 'Response' naming convention ([735006e](https://github.com/blockstack/stacks-blockchain-api/commit/735006e58207e6bcd21ab5ce67e9bd0a0b460fdd))
* **docs:** required props, dictionary for fts, nfts ([63fe101](https://github.com/blockstack/stacks-blockchain-api/commit/63fe101b366df3f28cd554ac937a4a0bd7bea574))
* Mempool tx status to enable union type ([26feddb](https://github.com/blockstack/stacks-blockchain-api/commit/26feddb9483dbc6cae77e78837830d5fcf611baa))
* type errors in build ([c842e2b](https://github.com/blockstack/stacks-blockchain-api/commit/c842e2b4462cba24cc088f1f6f846aa403cb0756))


### Features

* add gitpod to readme ([fa5f3df](https://github.com/blockstack/stacks-blockchain-api/commit/fa5f3dfc6c9d037133cd5ec16db58d4cbcb8bd37))
* add prebuild support to gitpod config ([fe89677](https://github.com/blockstack/stacks-blockchain-api/commit/fe89677bdab1049a0057127c640a664c6fcd4741))
* gitpod support ([f89191d](https://github.com/blockstack/stacks-blockchain-api/commit/f89191d844783e37f38db76d71a6155b320c350a))
* redirect root path to status path ([2e74937](https://github.com/blockstack/stacks-blockchain-api/commit/2e749373293d6d9c0890bc574aa4a0af2f00c9eb))

# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Added
- Add CHANGELOG.md file
