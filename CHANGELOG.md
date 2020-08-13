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
