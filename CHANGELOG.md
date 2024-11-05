## [8.2.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v8.2.0...v8.2.1) (2024-11-05)


### Bug Fixes

* indexes to optimize principal-based etag db lookups ([#2157](https://github.com/hirosystems/stacks-blockchain-api/issues/2157)) ([9da4dcd](https://github.com/hirosystems/stacks-blockchain-api/commit/9da4dcde18291d0e251820cc2e8fadaca568a4af))

## [8.2.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v8.1.2...v8.2.0) (2024-10-25)


### Features

* allow stackerdb_chunks messages to be stored in db raw events table ([d03f2ef](https://github.com/hirosystems/stacks-blockchain-api/commit/d03f2ef940fd90e9b9e99d9b3636aaf2d348f0e7))
* include `tenure-height` in block responses ([#2134](https://github.com/hirosystems/stacks-blockchain-api/issues/2134)) ([07426a2](https://github.com/hirosystems/stacks-blockchain-api/commit/07426a2e0060029ffe908597120a820c16cb3db3))
* ingest `signer_signature` from `/new_block` event and expose in new endpoint ([#2125](https://github.com/hirosystems/stacks-blockchain-api/issues/2125)) ([c389154](https://github.com/hirosystems/stacks-blockchain-api/commit/c389154a47fee6f382be2343abdb9e01bc093300))


### Bug Fixes

* event-replay block parsing outdated and incorrect ([#2133](https://github.com/hirosystems/stacks-blockchain-api/issues/2133)) ([2cd69fa](https://github.com/hirosystems/stacks-blockchain-api/commit/2cd69face8953541fcc2697a5a3b7b350de33383))

## [8.1.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v8.1.1...v8.1.2) (2024-10-21)


### Bug Fixes

* **rosetta:** support tenure change transactions ([#2128](https://github.com/hirosystems/stacks-blockchain-api/issues/2128)) ([bfbf65c](https://github.com/hirosystems/stacks-blockchain-api/commit/bfbf65c6f3a7baf869e3d5124e53b7c5861c5afb))
* **rosetta:** use Nakamoto block timestamps for epoch3/Nakamoto block responses ([#2132](https://github.com/hirosystems/stacks-blockchain-api/issues/2132)) ([bd13962](https://github.com/hirosystems/stacks-blockchain-api/commit/bd13962dacc4023a247da40e06c6861cd1e8f2bf))

## [8.1.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v8.1.0...v8.1.1) (2024-10-18)


### Bug Fixes

* identify mempool transactions separately when calculating principal etag ([#2126](https://github.com/hirosystems/stacks-blockchain-api/issues/2126)) ([b9dee2a](https://github.com/hirosystems/stacks-blockchain-api/commit/b9dee2a85cb6e733cb0ab2f4d1c7c12cd303bec4))

## [8.1.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v8.0.4...v8.1.0) (2024-10-16)


### Features

* add block etag ([#2103](https://github.com/hirosystems/stacks-blockchain-api/issues/2103)) ([66e6800](https://github.com/hirosystems/stacks-blockchain-api/commit/66e680051061f25de2acc87898aeac145b5c9093))
* add cache handler for principal activity including mempool transactions ([#2100](https://github.com/hirosystems/stacks-blockchain-api/issues/2100)) ([2370c21](https://github.com/hirosystems/stacks-blockchain-api/commit/2370c211e957ed2191f52710b93e4456c0b2fb89))
* add principal cache etag to account endpoints ([#2097](https://github.com/hirosystems/stacks-blockchain-api/issues/2097)) ([28e9864](https://github.com/hirosystems/stacks-blockchain-api/commit/28e9864844a22994205f44fc279be6b019d4b019))
* return estimated balance in account balance endpoints ([#2104](https://github.com/hirosystems/stacks-blockchain-api/issues/2104)) ([e217cea](https://github.com/hirosystems/stacks-blockchain-api/commit/e217ceac6bb3340688445fa346bc2d01b212f6d2))


### Bug Fixes

* add declaration copy step in build ([#2110](https://github.com/hirosystems/stacks-blockchain-api/issues/2110)) ([2b6aa6a](https://github.com/hirosystems/stacks-blockchain-api/commit/2b6aa6a6971e029bca8b7a7cd4c171ae8aca4a03))
* prune and restore mempool transactions with equal nonces for the same sender ([#2091](https://github.com/hirosystems/stacks-blockchain-api/issues/2091)) ([1ce75de](https://github.com/hirosystems/stacks-blockchain-api/commit/1ce75de8f7866c6e528b56706e624c4600b17412))
* randomize key order for testnet stx faucet transactions ([#2120](https://github.com/hirosystems/stacks-blockchain-api/issues/2120)) ([f7265f9](https://github.com/hirosystems/stacks-blockchain-api/commit/f7265f952d3e4232546c1cd0792eaf12444a0af7))
* update mempool garbage collection logic for 3.0 ([#2117](https://github.com/hirosystems/stacks-blockchain-api/issues/2117)) ([8b10b69](https://github.com/hirosystems/stacks-blockchain-api/commit/8b10b693861b2ab7a0f9a8c2bfc321886e9d1f3d))
* use total_count CTE and return it with the parsed results ([#2073](https://github.com/hirosystems/stacks-blockchain-api/issues/2073)) ([bb30911](https://github.com/hirosystems/stacks-blockchain-api/commit/bb30911bae0d3cb5fb26312d84dce7b04f5ffa97))

## [8.1.0-beta.4](https://github.com/hirosystems/stacks-blockchain-api/compare/v8.1.0-beta.3...v8.1.0-beta.4) (2024-10-15)


### Bug Fixes

* /extended/v2/pox/cycles/{n}/signers/{key}/stackers returning 500 error ([d6e0010](https://github.com/hirosystems/stacks-blockchain-api/commit/d6e0010ca7104d4fdf3a1593a41b29e6d56578bc))

## [8.1.0-beta.3](https://github.com/hirosystems/stacks-blockchain-api/compare/v8.1.0-beta.2...v8.1.0-beta.3) (2024-10-15)


### Bug Fixes

* randomize key order for testnet stx faucet transactions ([#2120](https://github.com/hirosystems/stacks-blockchain-api/issues/2120)) ([f7265f9](https://github.com/hirosystems/stacks-blockchain-api/commit/f7265f952d3e4232546c1cd0792eaf12444a0af7))
* update mempool garbage collection logic for 3.0 ([#2117](https://github.com/hirosystems/stacks-blockchain-api/issues/2117)) ([8b10b69](https://github.com/hirosystems/stacks-blockchain-api/commit/8b10b693861b2ab7a0f9a8c2bfc321886e9d1f3d))

## [8.1.0-beta.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v8.1.0-beta.1...v8.1.0-beta.2) (2024-10-11)


### Bug Fixes

* add declaration copy step in build ([#2110](https://github.com/hirosystems/stacks-blockchain-api/issues/2110)) ([2b6aa6a](https://github.com/hirosystems/stacks-blockchain-api/commit/2b6aa6a6971e029bca8b7a7cd4c171ae8aca4a03))

## [8.1.0-beta.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v8.0.3...v8.1.0-beta.1) (2024-10-07)


### Features

* add block etag ([#2103](https://github.com/hirosystems/stacks-blockchain-api/issues/2103)) ([66e6800](https://github.com/hirosystems/stacks-blockchain-api/commit/66e680051061f25de2acc87898aeac145b5c9093))
* add cache handler for principal activity including mempool transactions ([#2100](https://github.com/hirosystems/stacks-blockchain-api/issues/2100)) ([2370c21](https://github.com/hirosystems/stacks-blockchain-api/commit/2370c211e957ed2191f52710b93e4456c0b2fb89))
* add principal cache etag to account endpoints ([#2097](https://github.com/hirosystems/stacks-blockchain-api/issues/2097)) ([28e9864](https://github.com/hirosystems/stacks-blockchain-api/commit/28e9864844a22994205f44fc279be6b019d4b019))
* return estimated balance in account balance endpoints ([#2104](https://github.com/hirosystems/stacks-blockchain-api/issues/2104)) ([e217cea](https://github.com/hirosystems/stacks-blockchain-api/commit/e217ceac6bb3340688445fa346bc2d01b212f6d2))


### Bug Fixes

* prune and restore mempool transactions with equal nonces for the same sender ([#2091](https://github.com/hirosystems/stacks-blockchain-api/issues/2091)) ([1ce75de](https://github.com/hirosystems/stacks-blockchain-api/commit/1ce75de8f7866c6e528b56706e624c4600b17412))
* use total_count CTE and return it with the parsed results ([#2073](https://github.com/hirosystems/stacks-blockchain-api/issues/2073)) ([bb30911](https://github.com/hirosystems/stacks-blockchain-api/commit/bb30911bae0d3cb5fb26312d84dce7b04f5ffa97))

## [8.0.4](https://github.com/hirosystems/stacks-blockchain-api/compare/v8.0.3...v8.0.4) (2024-10-14)

### Bug Fixes

* /extended/v2/pox/cycles/{n}/signers/{key}/stackers returning 500 error ([d6e0010](https://github.com/hirosystems/stacks-blockchain-api/commit/d6e0010ca7104d4fdf3a1593a41b29e6d56578bc))

## [8.0.3](https://github.com/hirosystems/stacks-blockchain-api/compare/v8.0.2...v8.0.3) (2024-10-01)


### Bug Fixes

* query param `until_block` not working in several endpoints ([#2101](https://github.com/hirosystems/stacks-blockchain-api/issues/2101)) ([fce15d6](https://github.com/hirosystems/stacks-blockchain-api/commit/fce15d68377b6fe5fabeab65b34bd4e7a8d3bef6))

## [8.0.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v8.0.1...v8.0.2) (2024-09-27)


### Bug Fixes

* tests ([689ff18](https://github.com/hirosystems/stacks-blockchain-api/commit/689ff183dd0bdd1779f0220835123a0cc99e37c6))


## [8.0.2-beta.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v8.0.1...v8.0.2-beta.1) (2024-09-26)

### Bug Fixes

* use current circulating STX tokens for `stx_supply` endpoint, year 2050 estimate in new field ([b3e08e7](https://github.com/hirosystems/stacks-blockchain-api/commit/b3e08e7872c4a6b5a076d8bbcc22eb388ecef5ab))

## [8.0.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v8.0.0...v8.0.1) (2024-09-23)


### Bug Fixes

* package.json & package-lock.json to reduce vulnerabilities ([159d0ca](https://github.com/hirosystems/stacks-blockchain-api/commit/159d0ca1a2b55017883661b5c6ffb3cf5aefeb9f))

## [8.0.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.14.1...v8.0.0) (2024-08-28)


### ⚠ BREAKING CHANGES

> [!NOTE]
> This is only a breaking change because significant changes were made to the JavaScript client library's interface and how its types are generated, and because its library version always matches the API version.
> There are **no changes** to endpoints or database schemas that necessitate a full Stacks node event replay i.e. you may upgrade to v8.0.0 from v7.x directly.

* refactor from express to fastify (#2045)
* refactor from Express to Fastify

### Features

* cursor-based pagination on blocks endpoint ([#2060](https://github.com/hirosystems/stacks-blockchain-api/issues/2060)) ([bfdcce1](https://github.com/hirosystems/stacks-blockchain-api/commit/bfdcce1c2936980299c90bf36f3d45fe74bd573c))
* export events tsv directly to postgres instance ([#2048](https://github.com/hirosystems/stacks-blockchain-api/issues/2048)) ([f401a0f](https://github.com/hirosystems/stacks-blockchain-api/commit/f401a0f676ced14572b9f3f263dcc8559e831cdf))
* refactor from Express to Fastify ([aa0e51e](https://github.com/hirosystems/stacks-blockchain-api/commit/aa0e51e557491daff1a98dd36c4e952e05c58dd4)), closes [#2042](https://github.com/hirosystems/stacks-blockchain-api/issues/2042)
* refactor from express to fastify ([#2045](https://github.com/hirosystems/stacks-blockchain-api/issues/2045)) ([bd65fcf](https://github.com/hirosystems/stacks-blockchain-api/commit/bd65fcf93984c37a9de3cb284c43a49cb6b3694a)), closes [#2042](https://github.com/hirosystems/stacks-blockchain-api/issues/2042)


### Bug Fixes

* missing event limit max overrides on a few endpoints ([4f70930](https://github.com/hirosystems/stacks-blockchain-api/commit/4f709308fb95721866b523142536b738aa64a3eb))
* pagination and query param parsing bugs ([a382d2b](https://github.com/hirosystems/stacks-blockchain-api/commit/a382d2b80fc8d3e7ff49ce96047f1621749172b2)), closes [#2042](https://github.com/hirosystems/stacks-blockchain-api/issues/2042)
* perform status endpoint sql inside transactions ([b23445c](https://github.com/hirosystems/stacks-blockchain-api/commit/b23445c85f826d0e6cf98695f985c3670d00c1db))
* tx event-limit default should be 100 ([32d0670](https://github.com/hirosystems/stacks-blockchain-api/commit/32d0670a531582b8eb269790fa7a3695a8ce7610))

## [8.0.0-beta.6](https://github.com/hirosystems/stacks-blockchain-api/compare/v8.0.0-beta.5...v8.0.0-beta.6) (2024-08-27)


### ⚠ BREAKING CHANGES

* refactor from express to fastify (#2045)

### Features

* cursor-based pagination on blocks endpoint ([#2060](https://github.com/hirosystems/stacks-blockchain-api/issues/2060)) ([bfdcce1](https://github.com/hirosystems/stacks-blockchain-api/commit/bfdcce1c2936980299c90bf36f3d45fe74bd573c))
* export events tsv directly to postgres instance ([#2048](https://github.com/hirosystems/stacks-blockchain-api/issues/2048)) ([f401a0f](https://github.com/hirosystems/stacks-blockchain-api/commit/f401a0f676ced14572b9f3f263dcc8559e831cdf))
* export events tsv directly to postgres instance ([#2048](https://github.com/hirosystems/stacks-blockchain-api/issues/2048)) ([#2058](https://github.com/hirosystems/stacks-blockchain-api/issues/2058)) ([a1f5b12](https://github.com/hirosystems/stacks-blockchain-api/commit/a1f5b12675118f6d7742c54e3420c38151aef4a7))
* refactor from express to fastify ([#2045](https://github.com/hirosystems/stacks-blockchain-api/issues/2045)) ([bd65fcf](https://github.com/hirosystems/stacks-blockchain-api/commit/bd65fcf93984c37a9de3cb284c43a49cb6b3694a)), closes [#2042](https://github.com/hirosystems/stacks-blockchain-api/issues/2042)


### Bug Fixes

* index on `principal_stx_txs` table for faster `/v1/address/{addr}/transactions` lookups ([#2059](https://github.com/hirosystems/stacks-blockchain-api/issues/2059)) ([ab64ab7](https://github.com/hirosystems/stacks-blockchain-api/commit/ab64ab7148a3656f81f0a3c5a176c40caca3345a))

## [8.0.0-beta.5](https://github.com/hirosystems/stacks-blockchain-api/compare/v8.0.0-beta.4...v8.0.0-beta.5) (2024-08-16)


### Bug Fixes

* perform status endpoint sql inside transactions ([b23445c](https://github.com/hirosystems/stacks-blockchain-api/commit/b23445c85f826d0e6cf98695f985c3670d00c1db))

## [8.0.0-beta.4](https://github.com/hirosystems/stacks-blockchain-api/compare/v8.0.0-beta.3...v8.0.0-beta.4) (2024-08-15)


### Bug Fixes

* missing event limit max overrides on a few endpoints ([4f70930](https://github.com/hirosystems/stacks-blockchain-api/commit/4f709308fb95721866b523142536b738aa64a3eb))

## [8.0.0-beta.3](https://github.com/hirosystems/stacks-blockchain-api/compare/v8.0.0-beta.2...v8.0.0-beta.3) (2024-08-15)


### Bug Fixes

* tx event-limit default should be 100 ([32d0670](https://github.com/hirosystems/stacks-blockchain-api/commit/32d0670a531582b8eb269790fa7a3695a8ce7610))

## [8.0.0-beta.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v8.0.0-beta.1...v8.0.0-beta.2) (2024-08-15)


### Bug Fixes

* pagination and query param parsing bugs ([a382d2b](https://github.com/hirosystems/stacks-blockchain-api/commit/a382d2b80fc8d3e7ff49ce96047f1621749172b2)), closes [#2042](https://github.com/hirosystems/stacks-blockchain-api/issues/2042)

## [8.0.0-beta.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.13.2...v8.0.0-beta.1) (2024-08-13)


### ⚠ BREAKING CHANGES

* refactor from Express to Fastify

### Features

* refactor from Express to Fastify ([aa0e51e](https://github.com/hirosystems/stacks-blockchain-api/commit/aa0e51e557491daff1a98dd36c4e952e05c58dd4)), closes [#2042](https://github.com/hirosystems/stacks-blockchain-api/issues/2042)

* index on `principal_stx_txs` table for faster `/v1/address/{addr}/transactions` lookups ([#2059](https://github.com/hirosystems/stacks-blockchain-api/issues/2059)) ([ab64ab7](https://github.com/hirosystems/stacks-blockchain-api/commit/ab64ab7148a3656f81f0a3c5a176c40caca3345a))

## [7.14.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.13.2...v7.14.0) (2024-08-20)


### Features

* export events tsv directly to postgres instance ([#2048](https://github.com/hirosystems/stacks-blockchain-api/issues/2048)) ([#2058](https://github.com/hirosystems/stacks-blockchain-api/issues/2058)) ([a1f5b12](https://github.com/hirosystems/stacks-blockchain-api/commit/a1f5b12675118f6d7742c54e3420c38151aef4a7))

## [7.13.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.13.1...v7.13.2) (2024-08-05)


### Bug Fixes

* batch insert length assertion ([#2042](https://github.com/hirosystems/stacks-blockchain-api/issues/2042)) ([fe720d0](https://github.com/hirosystems/stacks-blockchain-api/commit/fe720d07c34cbc9efb4c3f641a6ca6ed35ee962c))

## [7.13.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.13.0...v7.13.1) (2024-08-02)


### Bug Fixes

* support parsing Clarity3 version contract deploy txs ([#2039](https://github.com/hirosystems/stacks-blockchain-api/issues/2039)) ([ef31cb4](https://github.com/hirosystems/stacks-blockchain-api/commit/ef31cb417d727e3a6771ad9d6ec9f826da6ea21a))

## [7.13.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.12.0...v7.13.0) (2024-07-18)


### Features

* ft holder indexing ([#2030](https://github.com/hirosystems/stacks-blockchain-api/issues/2030)) ([815c16f](https://github.com/hirosystems/stacks-blockchain-api/commit/815c16fcc6e87b63ff74fa034dc8cd6d725eb174))


### Bug Fixes

* `/v2/addresses/{addr}/transactions` incorrect when address only involved with token events ([#2033](https://github.com/hirosystems/stacks-blockchain-api/issues/2033)) ([1d9d0a6](https://github.com/hirosystems/stacks-blockchain-api/commit/1d9d0a681458addaaf556c988e1b11975b9d0371))

## [7.12.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.11.1...v7.12.0) (2024-07-08)


### Features

* tx list contract id/name filter options ([#2018](https://github.com/hirosystems/stacks-blockchain-api/issues/2018)) ([9c2fd78](https://github.com/hirosystems/stacks-blockchain-api/commit/9c2fd78ba821afd98e52d11d999d22523d03e1f7))
* tx list nonce filter option ([#2023](https://github.com/hirosystems/stacks-blockchain-api/issues/2023)) ([88fc5ce](https://github.com/hirosystems/stacks-blockchain-api/commit/88fc5ce66f7c8af9b7d19c4a432309e5da91bb10))
* tx list timestamp filter options ([#2015](https://github.com/hirosystems/stacks-blockchain-api/issues/2015)) ([e7c224b](https://github.com/hirosystems/stacks-blockchain-api/commit/e7c224bf8bcf06ed37e50bf83a3a23a56751f851))
* tx ordering options ([#2005](https://github.com/hirosystems/stacks-blockchain-api/issues/2005)) ([ae78773](https://github.com/hirosystems/stacks-blockchain-api/commit/ae78773930c92819709c148933d3daae32f87d4c))
* tx to/from address options ([#2012](https://github.com/hirosystems/stacks-blockchain-api/issues/2012)) ([542973c](https://github.com/hirosystems/stacks-blockchain-api/commit/542973c080f75536fe6ad04421b0e329692af2cd))
* update api toolkit ([71da884](https://github.com/hirosystems/stacks-blockchain-api/commit/71da88454c896d6678d8e962eb9573348e5779e8))


### Bug Fixes

* pox events should use same index as associated contract log event ([#1994](https://github.com/hirosystems/stacks-blockchain-api/issues/1994)) ([b1d6be9](https://github.com/hirosystems/stacks-blockchain-api/commit/b1d6be9b91b77f3e24abf1976bdf53158cf28d17)), closes [#1983](https://github.com/hirosystems/stacks-blockchain-api/issues/1983)

## [7.11.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.11.0...v7.11.1) (2024-06-21)


### Bug Fixes

* package.json & package-lock.json to reduce vulnerabilities ([#2020](https://github.com/hirosystems/stacks-blockchain-api/issues/2020)) ([9f63d8c](https://github.com/hirosystems/stacks-blockchain-api/commit/9f63d8c70978605bca44dde0e3aea09c396ef24e))

## [7.11.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.10.0...v7.11.0) (2024-06-07)


### Features

* add average stacks block time to burn block endpoints ([#1963](https://github.com/hirosystems/stacks-blockchain-api/issues/1963)) ([31c2eed](https://github.com/hirosystems/stacks-blockchain-api/commit/31c2eedfb5f778d5f0bf61bf3dd8effbf80511c4))
* add burn_block_height to Rosetta endpoints ([#1974](https://github.com/hirosystems/stacks-blockchain-api/issues/1974)) ([9648ac8](https://github.com/hirosystems/stacks-blockchain-api/commit/9648ac8a373229b384089339545e49e5164bc165))
* add burn_block_height to transactions ([#1969](https://github.com/hirosystems/stacks-blockchain-api/issues/1969)) ([3e2d524](https://github.com/hirosystems/stacks-blockchain-api/commit/3e2d524ca369b88a53fc4dfc2287aa3f0fb92e64))
* add signer_address to pox signer endpoints ([#1975](https://github.com/hirosystems/stacks-blockchain-api/issues/1975)) ([7d3444b](https://github.com/hirosystems/stacks-blockchain-api/commit/7d3444b96541e8883aa7f858cf56dd457d50a2b0))
* add total tx count to burn block endpoints ([#1965](https://github.com/hirosystems/stacks-blockchain-api/issues/1965)) ([d38b78a](https://github.com/hirosystems/stacks-blockchain-api/commit/d38b78a53e6dfa1774ba61a149a5931f29f64230))
* average block times endpoint ([#1962](https://github.com/hirosystems/stacks-blockchain-api/issues/1962)) ([cd151aa](https://github.com/hirosystems/stacks-blockchain-api/commit/cd151aaa289c679fc20b82ee751e55776a8d6c42))
* docker build for arm ([#1947](https://github.com/hirosystems/stacks-blockchain-api/issues/1947)) ([2c526fc](https://github.com/hirosystems/stacks-blockchain-api/commit/2c526fcf8ead66ff3055bbd77e37f663726503af))
* include solo and pooled stackers in signer stacker endpoints ([#1987](https://github.com/hirosystems/stacks-blockchain-api/issues/1987)) ([302a5d8](https://github.com/hirosystems/stacks-blockchain-api/commit/302a5d830bc15ecf060e875d6336d0b530ff4af0))
* support multiple STX faucet source accounts ([#1946](https://github.com/hirosystems/stacks-blockchain-api/issues/1946)) ([be5db0c](https://github.com/hirosystems/stacks-blockchain-api/commit/be5db0c5fadb0d0278e10b6de3586bbd7f5c85be))
* support multiple STX faucet source accounts ([#1946](https://github.com/hirosystems/stacks-blockchain-api/issues/1946)) ([5d69c7c](https://github.com/hirosystems/stacks-blockchain-api/commit/5d69c7c1b5ccbd6020b436c379f0ae9b6f9982bb))


### Bug Fixes

* ensure events are inserted into the raw event request table ([#1925](https://github.com/hirosystems/stacks-blockchain-api/issues/1925)) ([34a8454](https://github.com/hirosystems/stacks-blockchain-api/commit/34a8454db3d76cd67f1d3310894b175d23bb4411))
* inconsistent block transaction results in Rosetta response ([#1958](https://github.com/hirosystems/stacks-blockchain-api/issues/1958)) ([a5bec61](https://github.com/hirosystems/stacks-blockchain-api/commit/a5bec614ec99d0729e89200c56525cf062cdda23))
* issue with block_time receipt not being written to db ([#1961](https://github.com/hirosystems/stacks-blockchain-api/issues/1961)) ([74c06c6](https://github.com/hirosystems/stacks-blockchain-api/commit/74c06c68574ef38400c0d4e4b8e3378adb6fbbf2))
* pox4 properties missing in various endpoints ([#1977](https://github.com/hirosystems/stacks-blockchain-api/issues/1977)) ([521d771](https://github.com/hirosystems/stacks-blockchain-api/commit/521d7712409a9d9bffa3278ca44c21394167a085))
* rosetta account endpoint should assume chain tip if block not specified ([#1956](https://github.com/hirosystems/stacks-blockchain-api/issues/1956)) ([4bba526](https://github.com/hirosystems/stacks-blockchain-api/commit/4bba526327db0ae9cf778df69db0d7505e280ea3))
* signer stacker query using string instead of int for cycle_id ([#1991](https://github.com/hirosystems/stacks-blockchain-api/issues/1991)) ([5ce9b44](https://github.com/hirosystems/stacks-blockchain-api/commit/5ce9b448d30a4c59fcdd6dbaececda546e2d6f6c))
* socket-io client must only use websocket transport ([#1976](https://github.com/hirosystems/stacks-blockchain-api/issues/1976)) ([85ea5af](https://github.com/hirosystems/stacks-blockchain-api/commit/85ea5afef4b3134b1481e5b001c1f45619ccdb62))

## [7.10.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.9.1...v7.10.0) (2024-04-15)


### Features

* add nakamoto block time to v2 endpoints ([#1921](https://github.com/hirosystems/stacks-blockchain-api/issues/1921)) ([ae6bbe8](https://github.com/hirosystems/stacks-blockchain-api/commit/ae6bbe80b66520b7c7c7bc42b29716fb60146229))
* add signer-keys from pox4 events ([#1857](https://github.com/hirosystems/stacks-blockchain-api/issues/1857)) ([c17ad23](https://github.com/hirosystems/stacks-blockchain-api/commit/c17ad23d3f451d7c072ff94f4cb1ae7a2f78705d))
* ingest signer_bitvec ([#1900](https://github.com/hirosystems/stacks-blockchain-api/issues/1900)) ([aa1750f](https://github.com/hirosystems/stacks-blockchain-api/commit/aa1750f7ebbdfe4c2a84583f98c3ff465236f8aa))
* nakamoto block timestamps ([#1886](https://github.com/hirosystems/stacks-blockchain-api/issues/1886)) ([f547832](https://github.com/hirosystems/stacks-blockchain-api/commit/f5478329d7267a65b5f3c557b197feadff298afb))
* pox 4 revoke events and signer-key support ([#1829](https://github.com/hirosystems/stacks-blockchain-api/issues/1829)) ([5e5650a](https://github.com/hirosystems/stacks-blockchain-api/commit/5e5650a29bcc5950f061ed0a84961075c855a863)), closes [#1849](https://github.com/hirosystems/stacks-blockchain-api/issues/1849)
* pox stacker & signer cycle details ([#1873](https://github.com/hirosystems/stacks-blockchain-api/issues/1873)) ([d2c2805](https://github.com/hirosystems/stacks-blockchain-api/commit/d2c28059cfca99cd9b9a35cb8c96074a60fedd35))
* rosetta pox4 stacking support ([#1928](https://github.com/hirosystems/stacks-blockchain-api/issues/1928)) ([2ba36f9](https://github.com/hirosystems/stacks-blockchain-api/commit/2ba36f9846f3d85de093376ad68ee7660e697846)), closes [#1929](https://github.com/hirosystems/stacks-blockchain-api/issues/1929)


### Bug Fixes

* add nakamoto testnet to openapi docs ([#1910](https://github.com/hirosystems/stacks-blockchain-api/issues/1910)) ([01fb971](https://github.com/hirosystems/stacks-blockchain-api/commit/01fb9713e86b1a289dbca016ad7b5c366aaef74c))
* batch drop mempool transactions ([#1920](https://github.com/hirosystems/stacks-blockchain-api/issues/1920)) ([a7ee96d](https://github.com/hirosystems/stacks-blockchain-api/commit/a7ee96de55c8a61c1e2d6bf9ef7c3b220fd82803))
* cycle signer filter ([#1916](https://github.com/hirosystems/stacks-blockchain-api/issues/1916)) ([dc7d600](https://github.com/hirosystems/stacks-blockchain-api/commit/dc7d6009556b833ff3994b35c96ba4456ca7e81f))
* cycles response for empty cycle info ([#1914](https://github.com/hirosystems/stacks-blockchain-api/issues/1914)) ([a7a4558](https://github.com/hirosystems/stacks-blockchain-api/commit/a7a4558105f669260cc4948b28213196c4c62079))
* delegate-stx burn-op parsing and test fix ([#1939](https://github.com/hirosystems/stacks-blockchain-api/issues/1939)) ([73ec0db](https://github.com/hirosystems/stacks-blockchain-api/commit/73ec0db76e8004370e6c9ccf02fd520449d6e9ba))
* event-replay readiness for nakamoto & fix for [#1879](https://github.com/hirosystems/stacks-blockchain-api/issues/1879) ([#1903](https://github.com/hirosystems/stacks-blockchain-api/issues/1903)) ([1572e73](https://github.com/hirosystems/stacks-blockchain-api/commit/1572e737337680510850b23662e1f36c57ebc198))
* log message when sql migration is performed ([#1942](https://github.com/hirosystems/stacks-blockchain-api/issues/1942)) ([49a4d25](https://github.com/hirosystems/stacks-blockchain-api/commit/49a4d25f0a251d28aef81c588f04d329825579e6))
* other empty result responses ([#1915](https://github.com/hirosystems/stacks-blockchain-api/issues/1915)) ([3cd2c64](https://github.com/hirosystems/stacks-blockchain-api/commit/3cd2c64674e7abe0b4ba3ed7c1890ea63c1b87b2))
* pox4 stack-stx burn-op handling ([#1936](https://github.com/hirosystems/stacks-blockchain-api/issues/1936)) ([9e9a464](https://github.com/hirosystems/stacks-blockchain-api/commit/9e9a464488cb6963c93e88d78e1a7ed67ae65ca2))
* remove signer columns from tenure-change transactions ([#1845](https://github.com/hirosystems/stacks-blockchain-api/issues/1845)) ([8ec726b](https://github.com/hirosystems/stacks-blockchain-api/commit/8ec726b05531abb7787d035d21f7afc276574b9c))
* sql transactional consistency bug with fetching chaintip in various areas ([#1853](https://github.com/hirosystems/stacks-blockchain-api/issues/1853)) ([ada8536](https://github.com/hirosystems/stacks-blockchain-api/commit/ada85364b5465b59e1dba0e82815bd8b8057f23f))

## [7.9.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.9.0...v7.9.1) (2024-04-05)


### Bug Fixes

* batch drop mempool transactions ([#1920](https://github.com/hirosystems/stacks-blockchain-api/issues/1920)) ([#1927](https://github.com/hirosystems/stacks-blockchain-api/issues/1927)) ([f522d79](https://github.com/hirosystems/stacks-blockchain-api/commit/f522d795cef9b3f3ac0f1222b74a261f332c3065))

## [7.9.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.8.2...v7.9.0) (2024-03-15)


### Features

* add v2 addresses endpoints ([#1876](https://github.com/hirosystems/stacks-blockchain-api/issues/1876)) ([c9440dd](https://github.com/hirosystems/stacks-blockchain-api/commit/c9440dd8efc0ac0589567f51bb8700d52d8d348f))


### Bug Fixes

* include address transactions from genesis block ([#1888](https://github.com/hirosystems/stacks-blockchain-api/issues/1888)) ([cdea9e6](https://github.com/hirosystems/stacks-blockchain-api/commit/cdea9e61230850444e2227f4d15ec8ffce28ab9b))
* include address transactions with no stx transfers ([#1887](https://github.com/hirosystems/stacks-blockchain-api/issues/1887)) ([d308e46](https://github.com/hirosystems/stacks-blockchain-api/commit/d308e463b4bb5569b2dc2d8da8892050c1d4b40f))
* show status endpoint in /extended ([#1869](https://github.com/hirosystems/stacks-blockchain-api/issues/1869)) ([cf47f8f](https://github.com/hirosystems/stacks-blockchain-api/commit/cf47f8fe220d9388c204798b547699a44c27fab5))

## [7.9.0-beta.3](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.9.0-beta.2...v7.9.0-beta.3) (2024-03-15)


### Bug Fixes

* include address transactions from genesis block ([#1888](https://github.com/hirosystems/stacks-blockchain-api/issues/1888)) ([cdea9e6](https://github.com/hirosystems/stacks-blockchain-api/commit/cdea9e61230850444e2227f4d15ec8ffce28ab9b))

## [7.9.0-beta.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.9.0-beta.1...v7.9.0-beta.2) (2024-03-15)


### Bug Fixes

* include address transactions with no stx transfers ([#1887](https://github.com/hirosystems/stacks-blockchain-api/issues/1887)) ([d308e46](https://github.com/hirosystems/stacks-blockchain-api/commit/d308e463b4bb5569b2dc2d8da8892050c1d4b40f))

## [7.9.0-beta.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.8.2...v7.9.0-beta.1) (2024-03-11)


### Features

* add v2 addresses endpoints ([#1876](https://github.com/hirosystems/stacks-blockchain-api/issues/1876)) ([c9440dd](https://github.com/hirosystems/stacks-blockchain-api/commit/c9440dd8efc0ac0589567f51bb8700d52d8d348f))


### Bug Fixes

* show status endpoint in /extended ([#1869](https://github.com/hirosystems/stacks-blockchain-api/issues/1869)) ([cf47f8f](https://github.com/hirosystems/stacks-blockchain-api/commit/cf47f8fe220d9388c204798b547699a44c27fab5))

## [7.8.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.8.1...v7.8.2) (2024-02-19)


### Bug Fixes

* report placeholder in prom metrics for invalid request paths ([#1867](https://github.com/hirosystems/stacks-blockchain-api/issues/1867)) ([7921488](https://github.com/hirosystems/stacks-blockchain-api/commit/79214883a5c58724ddc3e7d7b57381317cb6e27d))

## [7.8.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.8.0...v7.8.1) (2024-02-02)


### Bug Fixes

* **rosetta:** use /v2/fees/transaction for fee estimation ([b287b7b](https://github.com/hirosystems/stacks-blockchain-api/commit/b287b7bb3426719553e9ffa3b88178fb24207a6b))
* sql transactional consistency bug with fetching chaintip in various areas ([#1853](https://github.com/hirosystems/stacks-blockchain-api/issues/1853)) ([07339c0](https://github.com/hirosystems/stacks-blockchain-api/commit/07339c08f3f42bc7b08c2e830939bfadcd308cb0))

## [7.8.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.7.2...v7.8.0) (2024-01-23)


### Features

* add `/extended/v2/smart-contracts/status` endpoint ([#1833](https://github.com/hirosystems/stacks-blockchain-api/issues/1833)) ([3535c11](https://github.com/hirosystems/stacks-blockchain-api/commit/3535c113e0d3b730b3e0d9df630c51b04e516a7e))
* run inserts in batch and in parallel when processing new block ([#1818](https://github.com/hirosystems/stacks-blockchain-api/issues/1818)) ([86dfdb5](https://github.com/hirosystems/stacks-blockchain-api/commit/86dfdb5d536fee8d7490ca5213f7005a8800f9fa))
* upgrade to node 20, use bookworm-slim image ([#1832](https://github.com/hirosystems/stacks-blockchain-api/issues/1832)) ([0a42109](https://github.com/hirosystems/stacks-blockchain-api/commit/0a42109242ab5804004e01338f236f61ef07651b))


### Bug Fixes

* change all HASH indexes to BTREE to optimize writes ([#1825](https://github.com/hirosystems/stacks-blockchain-api/issues/1825)) ([234936b](https://github.com/hirosystems/stacks-blockchain-api/commit/234936b430640fb7108e6cb57bdb21d1085a65b2))
* log block event counts after processing ([#1820](https://github.com/hirosystems/stacks-blockchain-api/issues/1820)) ([9c39743](https://github.com/hirosystems/stacks-blockchain-api/commit/9c397439e6eb2830186cda90a213b3ab3d5a4301)), closes [#1819](https://github.com/hirosystems/stacks-blockchain-api/issues/1819) [#1819](https://github.com/hirosystems/stacks-blockchain-api/issues/1819)
* optimize re-org queries and indexes ([#1821](https://github.com/hirosystems/stacks-blockchain-api/issues/1821)) ([5505d35](https://github.com/hirosystems/stacks-blockchain-api/commit/5505d354ecae6e52c751b3b634752fd56d24642f))
* parallelize re-org update queries ([#1835](https://github.com/hirosystems/stacks-blockchain-api/issues/1835)) ([340a304](https://github.com/hirosystems/stacks-blockchain-api/commit/340a3043529ca12316198d8f4605128396f02560))

## [7.8.0-beta.4](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.8.0-beta.3...v7.8.0-beta.4) (2024-01-16)


### Features

* upgrade to node 20, use bookworm-slim image ([#1832](https://github.com/hirosystems/stacks-blockchain-api/issues/1832)) ([0a42109](https://github.com/hirosystems/stacks-blockchain-api/commit/0a42109242ab5804004e01338f236f61ef07651b))

## [7.8.0-beta.3](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.8.0-beta.2...v7.8.0-beta.3) (2024-01-12)


### Bug Fixes

* change all HASH indexes to BTREE to optimize writes ([#1825](https://github.com/hirosystems/stacks-blockchain-api/issues/1825)) ([234936b](https://github.com/hirosystems/stacks-blockchain-api/commit/234936b430640fb7108e6cb57bdb21d1085a65b2))

## [7.8.0-beta.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.8.0-beta.1...v7.8.0-beta.2) (2024-01-12)


### Bug Fixes

* optimize re-org queries and indexes ([#1821](https://github.com/hirosystems/stacks-blockchain-api/issues/1821)) ([5505d35](https://github.com/hirosystems/stacks-blockchain-api/commit/5505d354ecae6e52c751b3b634752fd56d24642f))

## [7.8.0-beta.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.7.1...v7.8.0-beta.1) (2024-01-11)


### Features

* run inserts in batch and in parallel when processing new block ([#1818](https://github.com/hirosystems/stacks-blockchain-api/issues/1818)) ([86dfdb5](https://github.com/hirosystems/stacks-blockchain-api/commit/86dfdb5d536fee8d7490ca5213f7005a8800f9fa))

### Bug Fixes

* log block event counts after processing ([#1820](https://github.com/hirosystems/stacks-blockchain-api/issues/1820)) ([9c39743](https://github.com/hirosystems/stacks-blockchain-api/commit/9c397439e6eb2830186cda90a213b3ab3d5a4301)), closes [#1819](https://github.com/hirosystems/stacks-blockchain-api/issues/1819) [#1819](https://github.com/hirosystems/stacks-blockchain-api/issues/1819)


## [7.7.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.7.1...v7.7.2) (2024-01-16)


### Bug Fixes

* revive dropped mempool rebroadcasts ([#1823](https://github.com/hirosystems/stacks-blockchain-api/issues/1823)) ([862b36c](https://github.com/hirosystems/stacks-blockchain-api/commit/862b36c3fa896bcf9b5434ecf33c1bc0c9077aed))

## [7.7.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.7.0...v7.7.1) (2024-01-11)


### Bug Fixes

* log re-orgs at `INFO` level ([#1819](https://github.com/hirosystems/stacks-blockchain-api/issues/1819)) ([3b502f7](https://github.com/hirosystems/stacks-blockchain-api/commit/3b502f73149c185265fc8948e75ba064892ce6d2))

## [7.7.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.6.0...v7.7.0) (2024-01-10)


### Features

* remove reconcile mempool & debounce stats ([#1815](https://github.com/hirosystems/stacks-blockchain-api/issues/1815)) ([c5a7a8c](https://github.com/hirosystems/stacks-blockchain-api/commit/c5a7a8ca5289cdc3eeb0de5bb7d43c05ab960439))

## [7.6.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.5.0...v7.6.0) (2024-01-09)


### Features

* `GET /extended/v1/burn_block` ([#1766](https://github.com/hirosystems/stacks-blockchain-api/issues/1766)) ([cb38b68](https://github.com/hirosystems/stacks-blockchain-api/commit/cb38b6811c65aa700d4de527329216ba3c2ff6c9))
* add `/extended/v2/blocks/:height_or_hash` ([#1774](https://github.com/hirosystems/stacks-blockchain-api/issues/1774)) ([e532a5e](https://github.com/hirosystems/stacks-blockchain-api/commit/e532a5e173340f732536b9236d60585501f2da5f))
* add `/extended/v2/blocks` endpoint with burn block filters ([#1769](https://github.com/hirosystems/stacks-blockchain-api/issues/1769)) ([ceb7be0](https://github.com/hirosystems/stacks-blockchain-api/commit/ceb7be08daa5ca2d9baaa1a3de9f6c0569987724))
* add `order_by` and `order` params to `/extended/v1/tx/mempool` ([#1810](https://github.com/hirosystems/stacks-blockchain-api/issues/1810)) ([2d45b2e](https://github.com/hirosystems/stacks-blockchain-api/commit/2d45b2eafdec0ca478de65237de953d7bc63e827))
* add `tx_count` property to `/extended/v2/blocks` ([#1778](https://github.com/hirosystems/stacks-blockchain-api/issues/1778)) ([da4cd56](https://github.com/hirosystems/stacks-blockchain-api/commit/da4cd569a5c5e0c9a6aefc2877d3d8ef8716425f))
* create `/extended/v2/burn-blocks/:height_or_hash/blocks` endpoint ([#1782](https://github.com/hirosystems/stacks-blockchain-api/issues/1782)) ([20466a1](https://github.com/hirosystems/stacks-blockchain-api/commit/20466a16573bff1634bc9b6ff1180bb8e0f620a0))
* disable rosetta via an ENV var ([#1804](https://github.com/hirosystems/stacks-blockchain-api/issues/1804)) ([2d2aee3](https://github.com/hirosystems/stacks-blockchain-api/commit/2d2aee38263c3e457462ba5fd4cf4fd305178039))
* event-replay optimizations ([#1694](https://github.com/hirosystems/stacks-blockchain-api/pull/1694)) ([cb658a9](https://github.com/hirosystems/stacks-blockchain-api/commit/cb658a941f2f12063f1e68a45c6fb2912279d396))
* ingestion for `TenureChange` and `NakamotoCoinbase` tx types ([#1753](https://github.com/hirosystems/stacks-blockchain-api/issues/1753)) ([7c45f53](https://github.com/hirosystems/stacks-blockchain-api/commit/7c45f53622338170477948d38f549c2136d830c1))
* pox-4 support ([#1754](https://github.com/hirosystems/stacks-blockchain-api/issues/1754)) ([285806f](https://github.com/hirosystems/stacks-blockchain-api/commit/285806f46cebd365cc424a7a0155a531f34d7438))
* support tenure_change in tx type filter queries ([#1808](https://github.com/hirosystems/stacks-blockchain-api/issues/1808)) ([0831393](https://github.com/hirosystems/stacks-blockchain-api/commit/083139316350650c6cc97af377a6ae1cf6006be8))
* update to latest TenureChange tx payload ([#1767](https://github.com/hirosystems/stacks-blockchain-api/issues/1767)) ([2afb65c](https://github.com/hirosystems/stacks-blockchain-api/commit/2afb65cbb821658416eb41197ce8b72f239970b4))


### Bug Fixes

* allow contract-principals in `/extended/v1/address/:principal/mempool` endpoint [#1685](https://github.com/hirosystems/stacks-blockchain-api/issues/1685) ([#1704](https://github.com/hirosystems/stacks-blockchain-api/issues/1704)) ([163b76a](https://github.com/hirosystems/stacks-blockchain-api/commit/163b76a31a548c84b9d8be8e07ef94e5631b311b))
* convert `chain_tip` materialized view into a table ([#1751](https://github.com/hirosystems/stacks-blockchain-api/issues/1751)) ([04b71cc](https://github.com/hirosystems/stacks-blockchain-api/commit/04b71cc392b4e9b6518fd59b79886cc437656de7))
* do not load duckdb binary unless required ([#1776](https://github.com/hirosystems/stacks-blockchain-api/issues/1776)) ([db859ae](https://github.com/hirosystems/stacks-blockchain-api/commit/db859ae980368db22b9d1c4c7096918d5f7f4c4b))
* **docs:** URL query arrays should be formatted with `form` rather than comma-separated ([#1807](https://github.com/hirosystems/stacks-blockchain-api/issues/1807)) ([e184fb5](https://github.com/hirosystems/stacks-blockchain-api/commit/e184fb59d0c21d56bced1f5d53c29f1dbedbed51))
* handle `Problematic` status in `/drop_mempool_tx` event ([#1790](https://github.com/hirosystems/stacks-blockchain-api/issues/1790)) ([ce9b38f](https://github.com/hirosystems/stacks-blockchain-api/commit/ce9b38f051216d149375d64b3dfb90a75ab50fcd))
* import statement in replay controller ([7a10cd8](https://github.com/hirosystems/stacks-blockchain-api/commit/7a10cd8c4bb585c75a2437508802c7e5d908a564))
* insert block transaction data in batches ([#1760](https://github.com/hirosystems/stacks-blockchain-api/issues/1760)) ([bf99e90](https://github.com/hirosystems/stacks-blockchain-api/commit/bf99e90fa56ed04e6cb6bcc83559658f9e551183))
* move `/extended/v1/burn_block` to `/extended/v2/burn-blocks` ([#1772](https://github.com/hirosystems/stacks-blockchain-api/issues/1772)) ([bf2ef0a](https://github.com/hirosystems/stacks-blockchain-api/commit/bf2ef0a1ba579ef4d1c6fdaa7be623fe71d812d5))
* optimize mempool transaction reads and writes ([#1781](https://github.com/hirosystems/stacks-blockchain-api/issues/1781)) ([3a02f57](https://github.com/hirosystems/stacks-blockchain-api/commit/3a02f5741f4109c1e662b4e7014189ae95430df8))
* remove deprecated token endpoints ([#1775](https://github.com/hirosystems/stacks-blockchain-api/issues/1775)) ([18f74b7](https://github.com/hirosystems/stacks-blockchain-api/commit/18f74b7b77c95a81c2f6d47641af229c5c833b8f))
* support comma-separated strings in array query params ([#1809](https://github.com/hirosystems/stacks-blockchain-api/issues/1809)) ([c9a4df8](https://github.com/hirosystems/stacks-blockchain-api/commit/c9a4df8f43f56a0d9ebbc4a065c54cb32bae350a))
* upgrade semver package to fix ReDoS vulnerability ([6b1605b](https://github.com/hirosystems/stacks-blockchain-api/commit/6b1605b74d7c1bad39fcb491caf4ed51426b7618))
* vercel preview builds ([#1783](https://github.com/hirosystems/stacks-blockchain-api/issues/1783)) ([d36b1c2](https://github.com/hirosystems/stacks-blockchain-api/commit/d36b1c2d37b050eb826e1c80e5ef4674ca0ea699))

## [7.6.0-nakamoto.3](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.6.0-nakamoto.2...v7.6.0-nakamoto.3) (2024-01-09)


### Features

* add `order_by` and `order` params to `/extended/v1/tx/mempool` ([#1810](https://github.com/hirosystems/stacks-blockchain-api/issues/1810)) ([2d45b2e](https://github.com/hirosystems/stacks-blockchain-api/commit/2d45b2eafdec0ca478de65237de953d7bc63e827))

## [7.6.0-nakamoto.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.6.0-nakamoto.1...v7.6.0-nakamoto.2) (2024-01-09)


### Features

* support tenure_change in tx type filter queries ([#1808](https://github.com/hirosystems/stacks-blockchain-api/issues/1808)) ([0831393](https://github.com/hirosystems/stacks-blockchain-api/commit/083139316350650c6cc97af377a6ae1cf6006be8))


### Bug Fixes

* **docs:** URL query arrays should be formatted with `form` rather than comma-separated ([#1807](https://github.com/hirosystems/stacks-blockchain-api/issues/1807)) ([e184fb5](https://github.com/hirosystems/stacks-blockchain-api/commit/e184fb59d0c21d56bced1f5d53c29f1dbedbed51))
* support comma-separated strings in array query params ([#1809](https://github.com/hirosystems/stacks-blockchain-api/issues/1809)) ([c9a4df8](https://github.com/hirosystems/stacks-blockchain-api/commit/c9a4df8f43f56a0d9ebbc4a065c54cb32bae350a))

## [7.6.0-nakamoto.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.5.0...v7.6.0-nakamoto.1) (2024-01-09)


### Features

* `GET /extended/v1/burn_block` ([#1766](https://github.com/hirosystems/stacks-blockchain-api/issues/1766)) ([cb38b68](https://github.com/hirosystems/stacks-blockchain-api/commit/cb38b6811c65aa700d4de527329216ba3c2ff6c9))
* add `/extended/v2/blocks/:height_or_hash` ([#1774](https://github.com/hirosystems/stacks-blockchain-api/issues/1774)) ([e532a5e](https://github.com/hirosystems/stacks-blockchain-api/commit/e532a5e173340f732536b9236d60585501f2da5f))
* add `/extended/v2/blocks` endpoint with burn block filters ([#1769](https://github.com/hirosystems/stacks-blockchain-api/issues/1769)) ([ceb7be0](https://github.com/hirosystems/stacks-blockchain-api/commit/ceb7be08daa5ca2d9baaa1a3de9f6c0569987724))
* add `tx_count` property to `/extended/v2/blocks` ([#1778](https://github.com/hirosystems/stacks-blockchain-api/issues/1778)) ([da4cd56](https://github.com/hirosystems/stacks-blockchain-api/commit/da4cd569a5c5e0c9a6aefc2877d3d8ef8716425f))
* add dataset store ([4211328](https://github.com/hirosystems/stacks-blockchain-api/commit/42113284381bc7d0913feb05cfecc65b37fdf814))
* add step to compile duckdb for Alpine image ([0f40e14](https://github.com/hirosystems/stacks-blockchain-api/commit/0f40e14aecd8390b90ea6c5c34a47601f3866e23))
* better handling of raw events insertion ([bb70ca9](https://github.com/hirosystems/stacks-blockchain-api/commit/bb70ca99c07bf777557bca5e4b9924d104d8f7fd))
* create `/extended/v2/burn-blocks/:height_or_hash/blocks` endpoint ([#1782](https://github.com/hirosystems/stacks-blockchain-api/issues/1782)) ([20466a1](https://github.com/hirosystems/stacks-blockchain-api/commit/20466a16573bff1634bc9b6ff1180bb8e0f620a0))
* disable rosetta via an ENV var ([#1804](https://github.com/hirosystems/stacks-blockchain-api/issues/1804)) ([2d2aee3](https://github.com/hirosystems/stacks-blockchain-api/commit/2d2aee38263c3e457462ba5fd4cf4fd305178039))
* event-replay new_block events handling ([1708b42](https://github.com/hirosystems/stacks-blockchain-api/commit/1708b42c02b75882ec8ce8d05df5eddc7ef835b9))
* event-replay new_burn_block events handling ([6c0f448](https://github.com/hirosystems/stacks-blockchain-api/commit/6c0f4481c0f903d707c09e4e46a2330e67f32fff))
* event-replay raw events handling ([81f43cf](https://github.com/hirosystems/stacks-blockchain-api/commit/81f43cf7c314853f0d849ed8c8f6c0d0d6130a79))
* event-replay remainder events handling ([3ede07f](https://github.com/hirosystems/stacks-blockchain-api/commit/3ede07f134ac121505ca00b5bab7dba93a3def17))
* event-replay supporting parallel insertions ([f33ecee](https://github.com/hirosystems/stacks-blockchain-api/commit/f33ecee858a8d300e5926cb8238617e6e8b935a5))
* events folder as environment var ([701bd1a](https://github.com/hirosystems/stacks-blockchain-api/commit/701bd1a984c4ab064ddb1273a74cdb25975d7c1c))
* ingestion for `TenureChange` and `NakamotoCoinbase` tx types ([#1753](https://github.com/hirosystems/stacks-blockchain-api/issues/1753)) ([7c45f53](https://github.com/hirosystems/stacks-blockchain-api/commit/7c45f53622338170477948d38f549c2136d830c1))
* parallel processing using node cluster ([d02a7e8](https://github.com/hirosystems/stacks-blockchain-api/commit/d02a7e8ad87c9374bdf5f3e14740757984d0be75))
* pox-4 support ([#1754](https://github.com/hirosystems/stacks-blockchain-api/issues/1754)) ([285806f](https://github.com/hirosystems/stacks-blockchain-api/commit/285806f46cebd365cc424a7a0155a531f34d7438))
* processing raw events in parallel ([7a6f241](https://github.com/hirosystems/stacks-blockchain-api/commit/7a6f241923d0511b3d80308990dcf045b22562b6))
* update to latest TenureChange tx payload ([#1767](https://github.com/hirosystems/stacks-blockchain-api/issues/1767)) ([2afb65c](https://github.com/hirosystems/stacks-blockchain-api/commit/2afb65cbb821658416eb41197ce8b72f239970b4))


### Bug Fixes

* add token offering ([8ef039e](https://github.com/hirosystems/stacks-blockchain-api/commit/8ef039e89a083b555b88ce509f4e80d6270d096a))
* allow contract-principals in `/extended/v1/address/:principal/mempool` endpoint [#1685](https://github.com/hirosystems/stacks-blockchain-api/issues/1685) ([#1704](https://github.com/hirosystems/stacks-blockchain-api/issues/1704)) ([163b76a](https://github.com/hirosystems/stacks-blockchain-api/commit/163b76a31a548c84b9d8be8e07ef94e5631b311b))
* better args handlling ([c77ac57](https://github.com/hirosystems/stacks-blockchain-api/commit/c77ac57a9613a85418174355f6922f74676158e5))
* better path handling for workers ([1bd8f17](https://github.com/hirosystems/stacks-blockchain-api/commit/1bd8f17f07fc8bfff30684aa67deed1de56f7b11))
* changed processing order ([62a12bd](https://github.com/hirosystems/stacks-blockchain-api/commit/62a12bdef93c77a5ac6eb5b7e15c20b4c672e041))
* convert `chain_tip` materialized view into a table ([#1751](https://github.com/hirosystems/stacks-blockchain-api/issues/1751)) ([04b71cc](https://github.com/hirosystems/stacks-blockchain-api/commit/04b71cc392b4e9b6518fd59b79886cc437656de7))
* do not load duckdb binary unless required ([#1776](https://github.com/hirosystems/stacks-blockchain-api/issues/1776)) ([db859ae](https://github.com/hirosystems/stacks-blockchain-api/commit/db859ae980368db22b9d1c4c7096918d5f7f4c4b))
* flaky test ([484d2ea](https://github.com/hirosystems/stacks-blockchain-api/commit/484d2ea0cd765431e8017e42c53669e5bc6e8728))
* flaky test ([65175f5](https://github.com/hirosystems/stacks-blockchain-api/commit/65175f5cca0853c6bb07a9f377b8e39a134c8a8c))
* handle `Problematic` status in `/drop_mempool_tx` event ([#1790](https://github.com/hirosystems/stacks-blockchain-api/issues/1790)) ([ce9b38f](https://github.com/hirosystems/stacks-blockchain-api/commit/ce9b38f051216d149375d64b3dfb90a75ab50fcd))
* import statement in replay controller ([7a10cd8](https://github.com/hirosystems/stacks-blockchain-api/commit/7a10cd8c4bb585c75a2437508802c7e5d908a564))
* insert block transaction data in batches ([#1760](https://github.com/hirosystems/stacks-blockchain-api/issues/1760)) ([bf99e90](https://github.com/hirosystems/stacks-blockchain-api/commit/bf99e90fa56ed04e6cb6bcc83559658f9e551183))
* lint ([01589ea](https://github.com/hirosystems/stacks-blockchain-api/commit/01589eabbb88d2bc6453368a7b753813bd247a34))
* lint ([82eadcb](https://github.com/hirosystems/stacks-blockchain-api/commit/82eadcbe2fefd6ec5fc74b098445a6dedc63528b))
* lint ([8c67ae5](https://github.com/hirosystems/stacks-blockchain-api/commit/8c67ae532b9a992e93e0d00561e331197a5ca8ea))
* move `/extended/v1/burn_block` to `/extended/v2/burn-blocks` ([#1772](https://github.com/hirosystems/stacks-blockchain-api/issues/1772)) ([bf2ef0a](https://github.com/hirosystems/stacks-blockchain-api/commit/bf2ef0a1ba579ef4d1c6fdaa7be623fe71d812d5))
* on attachments_new events processing ([0707313](https://github.com/hirosystems/stacks-blockchain-api/commit/07073139ccb4b6d71d429864e4612944ef84c646))
* optimize mempool transaction reads and writes ([#1781](https://github.com/hirosystems/stacks-blockchain-api/issues/1781)) ([3a02f57](https://github.com/hirosystems/stacks-blockchain-api/commit/3a02f5741f4109c1e662b4e7014189ae95430df8))
* re-enable indexes when finishing the replay ([fc379eb](https://github.com/hirosystems/stacks-blockchain-api/commit/fc379ebab97e41dc20645bfff34fb484251508b9))
* remove dangling promise ([62a48ae](https://github.com/hirosystems/stacks-blockchain-api/commit/62a48ae37d86591dcaa8a928c1b63ddf2b1a6056))
* remove deprecated token endpoints ([#1775](https://github.com/hirosystems/stacks-blockchain-api/issues/1775)) ([18f74b7](https://github.com/hirosystems/stacks-blockchain-api/commit/18f74b7b77c95a81c2f6d47641af229c5c833b8f))
* revert configurable DB index type ([86154b2](https://github.com/hirosystems/stacks-blockchain-api/commit/86154b29e4e4af530da162133c99ebd609fab0e1))
* upgrade semver package to fix ReDoS vulnerability ([6b1605b](https://github.com/hirosystems/stacks-blockchain-api/commit/6b1605b74d7c1bad39fcb491caf4ed51426b7618))
* vercel preview builds ([#1783](https://github.com/hirosystems/stacks-blockchain-api/issues/1783)) ([d36b1c2](https://github.com/hirosystems/stacks-blockchain-api/commit/d36b1c2d37b050eb826e1c80e5ef4674ca0ea699))

## [7.5.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.4.0...v7.5.0) (2024-01-05)


### Features

* add listener callback to socket-io client subscription functions ([#1799](https://github.com/hirosystems/stacks-blockchain-api/issues/1799)) ([5634522](https://github.com/hirosystems/stacks-blockchain-api/commit/5634522132448fa480fcb18978a9cf2bf6f50a37))


### Bug Fixes

* socket-io client should not disconnect with no event reply ([#1800](https://github.com/hirosystems/stacks-blockchain-api/issues/1800)) ([d596fd5](https://github.com/hirosystems/stacks-blockchain-api/commit/d596fd5cc7efe588983d8a902771cc38c21fee82))

## [7.5.0-beta.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.5.0-beta.1...v7.5.0-beta.2) (2024-01-05)


### Bug Fixes

* socket-io client should not disconnect with no event reply ([#1800](https://github.com/hirosystems/stacks-blockchain-api/issues/1800)) ([d596fd5](https://github.com/hirosystems/stacks-blockchain-api/commit/d596fd5cc7efe588983d8a902771cc38c21fee82))

## [7.5.0-beta.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.4.0...v7.5.0-beta.1) (2024-01-05)


### Features

* add listener callback to socket-io client subscription functions ([#1799](https://github.com/hirosystems/stacks-blockchain-api/issues/1799)) ([5634522](https://github.com/hirosystems/stacks-blockchain-api/commit/5634522132448fa480fcb18978a9cf2bf6f50a37))

## [7.4.0-nakamoto.12](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.4.0-nakamoto.11...v7.4.0-nakamoto.12) (2024-01-08)


### Features

* disable rosetta via an ENV var ([#1804](https://github.com/hirosystems/stacks-blockchain-api/issues/1804)) ([2d2aee3](https://github.com/hirosystems/stacks-blockchain-api/commit/2d2aee38263c3e457462ba5fd4cf4fd305178039))

## [7.4.0-nakamoto.11](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.4.0-nakamoto.10...v7.4.0-nakamoto.11) (2024-01-03)


### Features

* create `/extended/v2/burn-blocks/:height_or_hash/blocks` endpoint ([#1782](https://github.com/hirosystems/stacks-blockchain-api/issues/1782)) ([20466a1](https://github.com/hirosystems/stacks-blockchain-api/commit/20466a16573bff1634bc9b6ff1180bb8e0f620a0))


### Bug Fixes

* optimize mempool transaction reads and writes ([#1781](https://github.com/hirosystems/stacks-blockchain-api/issues/1781)) ([3a02f57](https://github.com/hirosystems/stacks-blockchain-api/commit/3a02f5741f4109c1e662b4e7014189ae95430df8))

## [7.4.0-nakamoto.10](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.4.0-nakamoto.9...v7.4.0-nakamoto.10) (2024-01-01)


### Bug Fixes

* handle `Problematic` status in `/drop_mempool_tx` event ([#1790](https://github.com/hirosystems/stacks-blockchain-api/issues/1790)) ([ce9b38f](https://github.com/hirosystems/stacks-blockchain-api/commit/ce9b38f051216d149375d64b3dfb90a75ab50fcd))

## [7.4.0-nakamoto.9](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.4.0-nakamoto.8...v7.4.0-nakamoto.9) (2023-12-26)


### Bug Fixes

* vercel preview builds ([#1783](https://github.com/hirosystems/stacks-blockchain-api/issues/1783)) ([d36b1c2](https://github.com/hirosystems/stacks-blockchain-api/commit/d36b1c2d37b050eb826e1c80e5ef4674ca0ea699))

## [7.4.0-nakamoto.8](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.4.0-nakamoto.7...v7.4.0-nakamoto.8) (2023-12-21)


### Bug Fixes

* do not load duckdb binary unless required ([#1776](https://github.com/hirosystems/stacks-blockchain-api/issues/1776)) ([db859ae](https://github.com/hirosystems/stacks-blockchain-api/commit/db859ae980368db22b9d1c4c7096918d5f7f4c4b))

## [7.4.0-nakamoto.7](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.4.0-nakamoto.6...v7.4.0-nakamoto.7) (2023-12-19)


### Features

* add `tx_count` property to `/extended/v2/blocks` ([#1778](https://github.com/hirosystems/stacks-blockchain-api/issues/1778)) ([da4cd56](https://github.com/hirosystems/stacks-blockchain-api/commit/da4cd569a5c5e0c9a6aefc2877d3d8ef8716425f))


### Bug Fixes

* insert block transaction data in batches ([#1760](https://github.com/hirosystems/stacks-blockchain-api/issues/1760)) ([bf99e90](https://github.com/hirosystems/stacks-blockchain-api/commit/bf99e90fa56ed04e6cb6bcc83559658f9e551183))
* remove deprecated token endpoints ([#1775](https://github.com/hirosystems/stacks-blockchain-api/issues/1775)) ([18f74b7](https://github.com/hirosystems/stacks-blockchain-api/commit/18f74b7b77c95a81c2f6d47641af229c5c833b8f))

## [7.4.0-nakamoto.6](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.4.0-nakamoto.5...v7.4.0-nakamoto.6) (2023-12-15)


### Features

* add `/extended/v2/blocks/:height_or_hash` ([#1774](https://github.com/hirosystems/stacks-blockchain-api/issues/1774)) ([e532a5e](https://github.com/hirosystems/stacks-blockchain-api/commit/e532a5e173340f732536b9236d60585501f2da5f))

## [7.4.0-nakamoto.5](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.4.0-nakamoto.4...v7.4.0-nakamoto.5) (2023-12-15)


### Bug Fixes

* move `/extended/v1/burn_block` to `/extended/v2/burn-blocks` ([#1772](https://github.com/hirosystems/stacks-blockchain-api/issues/1772)) ([bf2ef0a](https://github.com/hirosystems/stacks-blockchain-api/commit/bf2ef0a1ba579ef4d1c6fdaa7be623fe71d812d5))

## [7.4.0-nakamoto.4](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.4.0-nakamoto.3...v7.4.0-nakamoto.4) (2023-12-14)


### Features

* add `/extended/v2/blocks` endpoint with burn block filters ([#1769](https://github.com/hirosystems/stacks-blockchain-api/issues/1769)) ([ceb7be0](https://github.com/hirosystems/stacks-blockchain-api/commit/ceb7be08daa5ca2d9baaa1a3de9f6c0569987724))
* update to latest TenureChange tx payload ([#1767](https://github.com/hirosystems/stacks-blockchain-api/issues/1767)) ([2afb65c](https://github.com/hirosystems/stacks-blockchain-api/commit/2afb65cbb821658416eb41197ce8b72f239970b4))

## [7.4.0-nakamoto.3](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.4.0-nakamoto.2...v7.4.0-nakamoto.3) (2023-12-13)


### Features

* `GET /extended/v1/burn_block` ([#1766](https://github.com/hirosystems/stacks-blockchain-api/issues/1766)) ([cb38b68](https://github.com/hirosystems/stacks-blockchain-api/commit/cb38b6811c65aa700d4de527329216ba3c2ff6c9))
* ingestion for `TenureChange` and `NakamotoCoinbase` tx types ([#1753](https://github.com/hirosystems/stacks-blockchain-api/issues/1753)) ([7c45f53](https://github.com/hirosystems/stacks-blockchain-api/commit/7c45f53622338170477948d38f549c2136d830c1))
* pox-4 support ([#1754](https://github.com/hirosystems/stacks-blockchain-api/issues/1754)) ([285806f](https://github.com/hirosystems/stacks-blockchain-api/commit/285806f46cebd365cc424a7a0155a531f34d7438))

## [7.4.0-nakamoto.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.4.0-nakamoto.1...v7.4.0-nakamoto.2) (2023-11-17)


### Bug Fixes

* import statement in replay controller ([7a10cd8](https://github.com/hirosystems/stacks-blockchain-api/commit/7a10cd8c4bb585c75a2437508802c7e5d908a564))

## [7.4.0-nakamoto.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.3.2...v7.4.0-nakamoto.1) (2023-11-16)


### Features

* add dataset store ([4211328](https://github.com/hirosystems/stacks-blockchain-api/commit/42113284381bc7d0913feb05cfecc65b37fdf814))
* add step to compile duckdb for Alpine image ([0f40e14](https://github.com/hirosystems/stacks-blockchain-api/commit/0f40e14aecd8390b90ea6c5c34a47601f3866e23))
* better handling of raw events insertion ([bb70ca9](https://github.com/hirosystems/stacks-blockchain-api/commit/bb70ca99c07bf777557bca5e4b9924d104d8f7fd))
* event-replay new_block events handling ([1708b42](https://github.com/hirosystems/stacks-blockchain-api/commit/1708b42c02b75882ec8ce8d05df5eddc7ef835b9))
* event-replay new_burn_block events handling ([6c0f448](https://github.com/hirosystems/stacks-blockchain-api/commit/6c0f4481c0f903d707c09e4e46a2330e67f32fff))
* event-replay raw events handling ([81f43cf](https://github.com/hirosystems/stacks-blockchain-api/commit/81f43cf7c314853f0d849ed8c8f6c0d0d6130a79))
* event-replay remainder events handling ([3ede07f](https://github.com/hirosystems/stacks-blockchain-api/commit/3ede07f134ac121505ca00b5bab7dba93a3def17))
* event-replay supporting parallel insertions ([f33ecee](https://github.com/hirosystems/stacks-blockchain-api/commit/f33ecee858a8d300e5926cb8238617e6e8b935a5))
* events folder as environment var ([701bd1a](https://github.com/hirosystems/stacks-blockchain-api/commit/701bd1a984c4ab064ddb1273a74cdb25975d7c1c))
* parallel processing using node cluster ([d02a7e8](https://github.com/hirosystems/stacks-blockchain-api/commit/d02a7e8ad87c9374bdf5f3e14740757984d0be75))
* processing raw events in parallel ([7a6f241](https://github.com/hirosystems/stacks-blockchain-api/commit/7a6f241923d0511b3d80308990dcf045b22562b6))


### Bug Fixes

* add token offering ([8ef039e](https://github.com/hirosystems/stacks-blockchain-api/commit/8ef039e89a083b555b88ce509f4e80d6270d096a))
* allow contract-principals in `/extended/v1/address/:principal/mempool` endpoint [#1685](https://github.com/hirosystems/stacks-blockchain-api/issues/1685) ([#1704](https://github.com/hirosystems/stacks-blockchain-api/issues/1704)) ([163b76a](https://github.com/hirosystems/stacks-blockchain-api/commit/163b76a31a548c84b9d8be8e07ef94e5631b311b))
* better args handlling ([c77ac57](https://github.com/hirosystems/stacks-blockchain-api/commit/c77ac57a9613a85418174355f6922f74676158e5))
* better path handling for workers ([1bd8f17](https://github.com/hirosystems/stacks-blockchain-api/commit/1bd8f17f07fc8bfff30684aa67deed1de56f7b11))
* changed processing order ([62a12bd](https://github.com/hirosystems/stacks-blockchain-api/commit/62a12bdef93c77a5ac6eb5b7e15c20b4c672e041))
* convert `chain_tip` materialized view into a table ([#1751](https://github.com/hirosystems/stacks-blockchain-api/issues/1751)) ([04b71cc](https://github.com/hirosystems/stacks-blockchain-api/commit/04b71cc392b4e9b6518fd59b79886cc437656de7))
* flaky test ([484d2ea](https://github.com/hirosystems/stacks-blockchain-api/commit/484d2ea0cd765431e8017e42c53669e5bc6e8728))
* flaky test ([65175f5](https://github.com/hirosystems/stacks-blockchain-api/commit/65175f5cca0853c6bb07a9f377b8e39a134c8a8c))
* lint ([01589ea](https://github.com/hirosystems/stacks-blockchain-api/commit/01589eabbb88d2bc6453368a7b753813bd247a34))
* lint ([82eadcb](https://github.com/hirosystems/stacks-blockchain-api/commit/82eadcbe2fefd6ec5fc74b098445a6dedc63528b))
* lint ([8c67ae5](https://github.com/hirosystems/stacks-blockchain-api/commit/8c67ae532b9a992e93e0d00561e331197a5ca8ea))
* on attachments_new events processing ([0707313](https://github.com/hirosystems/stacks-blockchain-api/commit/07073139ccb4b6d71d429864e4612944ef84c646))
* re-enable indexes when finishing the replay ([fc379eb](https://github.com/hirosystems/stacks-blockchain-api/commit/fc379ebab97e41dc20645bfff34fb484251508b9))
* remove dangling promise ([62a48ae](https://github.com/hirosystems/stacks-blockchain-api/commit/62a48ae37d86591dcaa8a928c1b63ddf2b1a6056))
* revert configurable DB index type ([86154b2](https://github.com/hirosystems/stacks-blockchain-api/commit/86154b29e4e4af530da162133c99ebd609fab0e1))
* upgrade semver package to fix ReDoS vulnerability ([6b1605b](https://github.com/hirosystems/stacks-blockchain-api/commit/6b1605b74d7c1bad39fcb491caf4ed51426b7618))

## [7.4.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.3.6...v7.4.0) (2024-01-04)


### Features

* add `/extended/v2/mempool/fees` endpoint ([#1795](https://github.com/hirosystems/stacks-blockchain-api/issues/1795)) ([ea9c378](https://github.com/hirosystems/stacks-blockchain-api/commit/ea9c3783e62715747db06eea5dd837297271c21e))


### Bug Fixes

* convert `chain_tip` materialized view into a table ([#1789](https://github.com/hirosystems/stacks-blockchain-api/issues/1789)) ([0211932](https://github.com/hirosystems/stacks-blockchain-api/commit/02119326993891cc586274fab0e0fc3f5fd15ef1)), closes [#1751](https://github.com/hirosystems/stacks-blockchain-api/issues/1751)
* optimize mempool transaction reads and writes ([#1781](https://github.com/hirosystems/stacks-blockchain-api/issues/1781)) ([#1792](https://github.com/hirosystems/stacks-blockchain-api/issues/1792)) ([2700642](https://github.com/hirosystems/stacks-blockchain-api/commit/2700642ed2225ce8598ee5fff833603007d5289f))
* release pino logger and mempool nonces ([16d3593](https://github.com/hirosystems/stacks-blockchain-api/commit/16d359370b413de36444d15a3a48cf479823367f))
* update client code, fix mempool fee return type ([#1797](https://github.com/hirosystems/stacks-blockchain-api/issues/1797)) ([9853e29](https://github.com/hirosystems/stacks-blockchain-api/commit/9853e29d89b2846454197438c7d1b4b636384d6d))

## [7.4.0-beta.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.4.0-beta.1...v7.4.0-beta.2) (2024-01-04)


### Bug Fixes

* update client code, fix mempool fee return type ([#1797](https://github.com/hirosystems/stacks-blockchain-api/issues/1797)) ([9853e29](https://github.com/hirosystems/stacks-blockchain-api/commit/9853e29d89b2846454197438c7d1b4b636384d6d))

## [7.4.0-beta.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.3.7-beta.1...v7.4.0-beta.1) (2024-01-03)


### Features

* add `/extended/v2/mempool/fees` endpoint ([#1795](https://github.com/hirosystems/stacks-blockchain-api/issues/1795)) ([ea9c378](https://github.com/hirosystems/stacks-blockchain-api/commit/ea9c3783e62715747db06eea5dd837297271c21e))


### Bug Fixes

* optimize mempool transaction reads and writes ([#1781](https://github.com/hirosystems/stacks-blockchain-api/issues/1781)) ([#1792](https://github.com/hirosystems/stacks-blockchain-api/issues/1792)) ([2700642](https://github.com/hirosystems/stacks-blockchain-api/commit/2700642ed2225ce8598ee5fff833603007d5289f))

## [7.3.7-beta.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.3.6...v7.3.7-beta.1) (2023-12-29)


### Bug Fixes

* convert `chain_tip` materialized view into a table ([#1789](https://github.com/hirosystems/stacks-blockchain-api/issues/1789)) ([0211932](https://github.com/hirosystems/stacks-blockchain-api/commit/02119326993891cc586274fab0e0fc3f5fd15ef1)), closes [#1751](https://github.com/hirosystems/stacks-blockchain-api/issues/1751)
* release pino logger and mempool nonces ([16d3593](https://github.com/hirosystems/stacks-blockchain-api/commit/16d359370b413de36444d15a3a48cf479823367f))

## [7.3.6](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.3.5...v7.3.6) (2023-12-11)


### Bug Fixes

* use the mempool etag for the /nonces endpoint ([#1765](https://github.com/hirosystems/stacks-blockchain-api/issues/1765)) ([773c01b](https://github.com/hirosystems/stacks-blockchain-api/commit/773c01b21a7d4e830d7ed4e58716539c563fecdc))

## [7.3.5](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.3.4...v7.3.5) (2023-12-08)


### Bug Fixes

* disable stx faucet POST body ([#1759](https://github.com/hirosystems/stacks-blockchain-api/issues/1759)) ([4cb6b56](https://github.com/hirosystems/stacks-blockchain-api/commit/4cb6b5641fc7ea295fac029eee0d571226d21248))

## [7.3.4](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.3.3...v7.3.4) (2023-11-14)


### Bug Fixes

* release without token metadata processor ([b35be4f](https://github.com/hirosystems/stacks-blockchain-api/commit/b35be4f2dc6e98923063700839427afa5568389f))

## [7.3.3](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.3.2...v7.3.3) (2023-11-13)


### Bug Fixes

* move nft custody view into a table ([#1741](https://github.com/hirosystems/stacks-blockchain-api/issues/1741)) ([fb0d0ea](https://github.com/hirosystems/stacks-blockchain-api/commit/fb0d0eaa93a0614c54cfa28464fe5df25ac9c7dd))

## [7.3.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.3.1...v7.3.2) (2023-09-14)


### Bug Fixes

* log block ingestion time ([#1713](https://github.com/hirosystems/stacks-blockchain-api/issues/1713)) ([e7c01a8](https://github.com/hirosystems/stacks-blockchain-api/commit/e7c01a8b5c1fb8c3fbd3eeb4795be8b35c1bcbcd))

## [7.3.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.3.0...v7.3.1) (2023-09-11)


### Bug Fixes

* allow more than one Rosetta `stx_unlock` operation per block ([#1712](https://github.com/hirosystems/stacks-blockchain-api/issues/1712)) ([81221c8](https://github.com/hirosystems/stacks-blockchain-api/commit/81221c8c1388d4e2d92cebce85311b7941e15be1))

## [7.3.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.2.2...v7.3.0) (2023-07-12)


### Features

* stacking pool members endpoint ([#1592](https://github.com/hirosystems/stacks-blockchain-api/issues/1592)) ([3cd6023](https://github.com/hirosystems/stacks-blockchain-api/commit/3cd6023e895c964ed3d744652b169d51254ea6ed)), closes [#465](https://github.com/hirosystems/stacks-blockchain-api/issues/465)
* support custom chain_id (e.g. for subnets) ([#1669](https://github.com/hirosystems/stacks-blockchain-api/issues/1669)) ([1c6e35a](https://github.com/hirosystems/stacks-blockchain-api/commit/1c6e35a2dc0b5c161d35f291220a0bef6c6f5d28))
* support for subnets ([#1549](https://github.com/hirosystems/stacks-blockchain-api/issues/1549)) ([5d7056c](https://github.com/hirosystems/stacks-blockchain-api/commit/5d7056c1ba0aa0b202f341a83adf0f6bd2d13c71))
* support for subnets ([#1625](https://github.com/hirosystems/stacks-blockchain-api/issues/1625)) ([bfac932](https://github.com/hirosystems/stacks-blockchain-api/commit/bfac932f098f0311c9cf180b87724f871d1df82b)), closes [#1549](https://github.com/hirosystems/stacks-blockchain-api/issues/1549) [#1528](https://github.com/hirosystems/stacks-blockchain-api/issues/1528) [#1583](https://github.com/hirosystems/stacks-blockchain-api/issues/1583) [#1583](https://github.com/hirosystems/stacks-blockchain-api/issues/1583)


### Bug Fixes

* add indexes to pox3_events table used for stacker lookup endpoints ([86304be](https://github.com/hirosystems/stacks-blockchain-api/commit/86304beb34a560d0452af5161e304046d97f8beb))
* disabled BTC faucet endpoint ([#1530](https://github.com/hirosystems/stacks-blockchain-api/issues/1530)) ([ce55212](https://github.com/hirosystems/stacks-blockchain-api/commit/ce55212f95fc52a3e890e78681e89682079c8f0f))
* domain migration ([#1596](https://github.com/hirosystems/stacks-blockchain-api/issues/1596)) ([2769e68](https://github.com/hirosystems/stacks-blockchain-api/commit/2769e684688f6d6c049baabc1d7777a330bc3f40))
* enable requests auto logging ([#1656](https://github.com/hirosystems/stacks-blockchain-api/issues/1656)) ([2015b9c](https://github.com/hirosystems/stacks-blockchain-api/commit/2015b9c8805c189ebd80dfe16b775f805810a63f))
* fixed the order of microblocks_streamed returned in reverse order in block endpoint ([#1528](https://github.com/hirosystems/stacks-blockchain-api/issues/1528)) ([764f64a](https://github.com/hirosystems/stacks-blockchain-api/commit/764f64a538c88a17c381eccb867ed3032e73bea1))
* log cleanup ([#1613](https://github.com/hirosystems/stacks-blockchain-api/issues/1613)) ([a067e39](https://github.com/hirosystems/stacks-blockchain-api/commit/a067e3906b89f9e1b40adb98072927d977f870d2))
* log level issues ([#1605](https://github.com/hirosystems/stacks-blockchain-api/issues/1605)) ([c3a2377](https://github.com/hirosystems/stacks-blockchain-api/commit/c3a237709a241eef4867258c8aac79dfdf4569e3)), closes [#1603](https://github.com/hirosystems/stacks-blockchain-api/issues/1603) [#1603](https://github.com/hirosystems/stacks-blockchain-api/issues/1603) [#1604](https://github.com/hirosystems/stacks-blockchain-api/issues/1604) [#1604](https://github.com/hirosystems/stacks-blockchain-api/issues/1604) [#1452](https://github.com/hirosystems/stacks-blockchain-api/issues/1452)
* npm publish step ([#1617](https://github.com/hirosystems/stacks-blockchain-api/issues/1617)) ([c9cdbb6](https://github.com/hirosystems/stacks-blockchain-api/commit/c9cdbb693eb95cc0048041339ef3f0a7c2f5219f))
* optimize queries to retrieve BNS names ([#1581](https://github.com/hirosystems/stacks-blockchain-api/issues/1581)) ([1a6fde1](https://github.com/hirosystems/stacks-blockchain-api/commit/1a6fde145bd979614c614af95cd38d08a022ea3d))
* use chaintip-cache-control in `/stx_supply` endpoints [#1590](https://github.com/hirosystems/stacks-blockchain-api/issues/1590) ([#1594](https://github.com/hirosystems/stacks-blockchain-api/issues/1594)) ([a47f153](https://github.com/hirosystems/stacks-blockchain-api/commit/a47f1530a24da18bdcd9e6da64076a722e76af20))
* use pox3 for `/extended/beta/stacking/...` endpoint ([872f7e6](https://github.com/hirosystems/stacks-blockchain-api/commit/872f7e614443c2f26d4ca749782b8b96ef77fa93))
* warning logger level for RPC proxy errors ([#1612](https://github.com/hirosystems/stacks-blockchain-api/issues/1612)) ([2454932](https://github.com/hirosystems/stacks-blockchain-api/commit/24549328d2e5ae974b7beb18baaccaa5e9d6685e))

## [7.2.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.2.1...v7.2.2) (2023-06-07)


### Bug Fixes

* option to skip RPC request during init which may avoid startup deadlocks [#1584](https://github.com/hirosystems/stacks-blockchain-api/issues/1584) ([#1640](https://github.com/hirosystems/stacks-blockchain-api/issues/1640)) ([e0e61d3](https://github.com/hirosystems/stacks-blockchain-api/commit/e0e61d383963673fbc1ed7bb4f75c9f5af69bcdf))

## [7.2.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.2.0...v7.2.1) (2023-05-24)


### Bug Fixes

* bump socket.io-parser from 4.2.1 to 4.2.3 ([#1663](https://github.com/hirosystems/stacks-blockchain-api/issues/1663)) ([c7eb1c2](https://github.com/hirosystems/stacks-blockchain-api/commit/c7eb1c29838197862378e6dfe7605f5c880ce04b))

## [7.2.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.1.10...v7.2.0) (2023-05-23)


### Features

* Stacks 2.4 / `pox-3` ([#1650](https://github.com/hirosystems/stacks-blockchain-api/issues/1650)) ([30922c8](https://github.com/hirosystems/stacks-blockchain-api/commit/30922c8a7375e454871bf6b114c0be7ec8a0dfab))

## [7.2.0-beta.4](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.2.0-beta.3...v7.2.0-beta.4) (2023-06-10)


### Features

* support custom chain_id (e.g. for subnets) ([#1669](https://github.com/hirosystems/stacks-blockchain-api/issues/1669)) ([1c6e35a](https://github.com/hirosystems/stacks-blockchain-api/commit/1c6e35a2dc0b5c161d35f291220a0bef6c6f5d28))

## [7.2.0-beta.3](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.2.0-beta.2...v7.2.0-beta.3) (2023-05-12)


### Bug Fixes

* enable requests auto logging ([#1656](https://github.com/hirosystems/stacks-blockchain-api/issues/1656)) ([2015b9c](https://github.com/hirosystems/stacks-blockchain-api/commit/2015b9c8805c189ebd80dfe16b775f805810a63f))

## [7.2.0-beta.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.2.0-beta.1...v7.2.0-beta.2) (2023-05-11)


### Bug Fixes

* release pino logger and mempool nonces ([16d3593](https://github.com/hirosystems/stacks-blockchain-api/commit/16d359370b413de36444d15a3a48cf479823367f))

## [7.2.0-beta.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.1.7...v7.2.0-beta.1) (2023-04-20)


### Features

* stacking pool members endpoint ([#1592](https://github.com/hirosystems/stacks-blockchain-api/issues/1592)) ([3cd6023](https://github.com/hirosystems/stacks-blockchain-api/commit/3cd6023e895c964ed3d744652b169d51254ea6ed)), closes [#465](https://github.com/hirosystems/stacks-blockchain-api/issues/465)
* support for subnets ([#1549](https://github.com/hirosystems/stacks-blockchain-api/issues/1549)) ([5d7056c](https://github.com/hirosystems/stacks-blockchain-api/commit/5d7056c1ba0aa0b202f341a83adf0f6bd2d13c71))
* support for subnets ([#1625](https://github.com/hirosystems/stacks-blockchain-api/issues/1625)) ([bfac932](https://github.com/hirosystems/stacks-blockchain-api/commit/bfac932f098f0311c9cf180b87724f871d1df82b)), closes [#1549](https://github.com/hirosystems/stacks-blockchain-api/issues/1549) [#1528](https://github.com/hirosystems/stacks-blockchain-api/issues/1528) [#1583](https://github.com/hirosystems/stacks-blockchain-api/issues/1583) [#1583](https://github.com/hirosystems/stacks-blockchain-api/issues/1583)


### Bug Fixes

* disabled BTC faucet endpoint ([#1530](https://github.com/hirosystems/stacks-blockchain-api/issues/1530)) ([ce55212](https://github.com/hirosystems/stacks-blockchain-api/commit/ce55212f95fc52a3e890e78681e89682079c8f0f))
* domain migration ([#1596](https://github.com/hirosystems/stacks-blockchain-api/issues/1596)) ([2769e68](https://github.com/hirosystems/stacks-blockchain-api/commit/2769e684688f6d6c049baabc1d7777a330bc3f40))
* fixed the order of microblocks_streamed returned in reverse order in block endpoint ([#1528](https://github.com/hirosystems/stacks-blockchain-api/issues/1528)) ([764f64a](https://github.com/hirosystems/stacks-blockchain-api/commit/764f64a538c88a17c381eccb867ed3032e73bea1))
* log cleanup ([#1613](https://github.com/hirosystems/stacks-blockchain-api/issues/1613)) ([a067e39](https://github.com/hirosystems/stacks-blockchain-api/commit/a067e3906b89f9e1b40adb98072927d977f870d2))
* log level issues ([#1605](https://github.com/hirosystems/stacks-blockchain-api/issues/1605)) ([c3a2377](https://github.com/hirosystems/stacks-blockchain-api/commit/c3a237709a241eef4867258c8aac79dfdf4569e3)), closes [#1603](https://github.com/hirosystems/stacks-blockchain-api/issues/1603) [#1603](https://github.com/hirosystems/stacks-blockchain-api/issues/1603) [#1604](https://github.com/hirosystems/stacks-blockchain-api/issues/1604) [#1604](https://github.com/hirosystems/stacks-blockchain-api/issues/1604) [#1452](https://github.com/hirosystems/stacks-blockchain-api/issues/1452)
* npm publish step ([#1617](https://github.com/hirosystems/stacks-blockchain-api/issues/1617)) ([c9cdbb6](https://github.com/hirosystems/stacks-blockchain-api/commit/c9cdbb693eb95cc0048041339ef3f0a7c2f5219f))
* optimize queries to retrieve BNS names ([#1581](https://github.com/hirosystems/stacks-blockchain-api/issues/1581)) ([1a6fde1](https://github.com/hirosystems/stacks-blockchain-api/commit/1a6fde145bd979614c614af95cd38d08a022ea3d))
* use chaintip-cache-control in `/stx_supply` endpoints [#1590](https://github.com/hirosystems/stacks-blockchain-api/issues/1590) ([#1594](https://github.com/hirosystems/stacks-blockchain-api/issues/1594)) ([a47f153](https://github.com/hirosystems/stacks-blockchain-api/commit/a47f1530a24da18bdcd9e6da64076a722e76af20))
* warning logger level for RPC proxy errors ([#1612](https://github.com/hirosystems/stacks-blockchain-api/issues/1612)) ([2454932](https://github.com/hirosystems/stacks-blockchain-api/commit/24549328d2e5ae974b7beb18baaccaa5e9d6685e))


## [7.1.11-stacks-2.4.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.1.10...v7.1.11-stacks-2.4.1) (2023-05-09)


### Bug Fixes

* add pox-3 events table migration ([4c78556](https://github.com/hirosystems/stacks-blockchain-api/commit/4c785565a1cf168f966710d6b749edbf88bf7cf1))
* add pox3_events array ([f9f4f42](https://github.com/hirosystems/stacks-blockchain-api/commit/f9f4f42c35789968c257072cb10563112189bb53))
* include pox-3 events in reader filter ([dc36080](https://github.com/hirosystems/stacks-blockchain-api/commit/dc360802ab3424d57171999e52cb093472f2262c))
* pox-3 support in Rosetta stacking ops parsing ([2397186](https://github.com/hirosystems/stacks-blockchain-api/commit/239718626215fdfea4c0cabd3365f256eab470fd))
* switching routes/methods to pox3 ([b0c6bef](https://github.com/hirosystems/stacks-blockchain-api/commit/b0c6beffb376ab5130f3d22b6cdaf82be927bdc9))


### Reverts

* accidental discord notification removal ([a150258](https://github.com/hirosystems/stacks-blockchain-api/commit/a150258bdd1dcaf6472fbcfa604516783719dac8))

## [7.1.10](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.1.9...v7.1.10) (2023-05-04)


### Bug Fixes

* bump engine.io and socket.io ([#1643](https://github.com/hirosystems/stacks-blockchain-api/issues/1643)) ([04b92ce](https://github.com/hirosystems/stacks-blockchain-api/commit/04b92ce1cce2ef5386e7074ea99f11504c5cf35b))

## [7.1.9](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.1.8...v7.1.9) (2023-05-01)


### Bug Fixes

* generate synthetic `stx_unlock` rosetta operations for all locked accounts after pox2 force unlock [#1639](https://github.com/hirosystems/stacks-blockchain-api/issues/1639) ([#1638](https://github.com/hirosystems/stacks-blockchain-api/issues/1638)) ([9b58bb6](https://github.com/hirosystems/stacks-blockchain-api/commit/9b58bb6b06a7a2a8b0bce967748f0fed909e2be5))

## [7.1.8](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.1.7...v7.1.8) (2023-04-28)


### Bug Fixes

* support Stacks 2.2 force pox-2 unlocks [#1634](https://github.com/hirosystems/stacks-blockchain-api/issues/1634) ([#1636](https://github.com/hirosystems/stacks-blockchain-api/issues/1636)) ([14706bd](https://github.com/hirosystems/stacks-blockchain-api/commit/14706bd64a27a70e88bb47fe61f40a6b1bec1dcc))

## [7.1.7](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.1.5...v7.1.7) (2023-04-18)


### Bug Fixes

* allow negative fee value in Rosetta tx construction ([#1614](https://github.com/hirosystems/stacks-blockchain-api/issues/1614)) ([74877c4](https://github.com/hirosystems/stacks-blockchain-api/commit/74877c4f96afe2a923f4c0e0d0852fdee0c386b3))
* only calculate IBD height reach once per update ([#1620](https://github.com/hirosystems/stacks-blockchain-api/issues/1620)) ([94e4686](https://github.com/hirosystems/stacks-blockchain-api/commit/94e46864235ac8220fda31a9eed7db4bd11e64f6)), closes [#1617](https://github.com/hirosystems/stacks-blockchain-api/issues/1617)

## [7.1.5](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.1.4...v7.1.5) (2023-04-07)


### Bug Fixes

* materialized view refresh after IBD height has passed ([#1604](https://github.com/hirosystems/stacks-blockchain-api/issues/1604)) ([e62fb72](https://github.com/hirosystems/stacks-blockchain-api/commit/e62fb722d4971da74e6ccc9a5d90fc6882acd355))

## [7.1.4](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.1.3...v7.1.4) (2023-04-06)


### Bug Fixes

* sha256 tx cache etags to make them shorter ([#1603](https://github.com/hirosystems/stacks-blockchain-api/issues/1603)) ([02ebb4c](https://github.com/hirosystems/stacks-blockchain-api/commit/02ebb4cc990a6e6bda5201a39bf394b1fb4c4afb))

## [7.1.3](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.1.2...v7.1.3) (2023-03-27)


### Bug Fixes

* domain migration ([#1596](https://github.com/hirosystems/stacks-blockchain-api/issues/1596)) ([#1597](https://github.com/hirosystems/stacks-blockchain-api/issues/1597)) ([e348ac0](https://github.com/hirosystems/stacks-blockchain-api/commit/e348ac05b325272e0317b3af314469b3e94c0adc))
* postgres should not be required in STACKS_API_MODE=offline mode [#1391](https://github.com/hirosystems/stacks-blockchain-api/issues/1391) ([#1599](https://github.com/hirosystems/stacks-blockchain-api/issues/1599)) ([299705f](https://github.com/hirosystems/stacks-blockchain-api/commit/299705f270981b226fdeae2c7c37c00ce16fe4ce))

## [7.1.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.1.1...v7.1.2) (2023-03-22)


### Bug Fixes

* expand namespace discount column types to numeric ([#1591](https://github.com/hirosystems/stacks-blockchain-api/issues/1591)) ([276b5d2](https://github.com/hirosystems/stacks-blockchain-api/commit/276b5d20f9d7dbb84fec231ee36ac14f522aeeaa))

## [7.1.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.1.0...v7.1.1) (2023-03-03)


### Bug Fixes

* duplicate BNS imports and event-replay prune mode bug with large tsv files ([#1571](https://github.com/hirosystems/stacks-blockchain-api/issues/1571)) ([e2b58b2](https://github.com/hirosystems/stacks-blockchain-api/commit/e2b58b2208e6a06a498472599159235ebb821a08))

## [7.1.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.0.1...v7.1.0) (2023-03-03)


### Features

* initial block download option to speed up chain sync ([#1373](https://github.com/hirosystems/stacks-blockchain-api/issues/1373)) ([1f350ec](https://github.com/hirosystems/stacks-blockchain-api/commit/1f350ec45a44840b879c2e31958ada68e1c204e4))

## [7.0.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.0.0...v7.0.1) (2023-02-23)


### Bug Fixes

* ensure transactions are never reported as both pending and confirmed ([#1561](https://github.com/hirosystems/stacks-blockchain-api/issues/1561)) ([a5a398e](https://github.com/hirosystems/stacks-blockchain-api/commit/a5a398e0d665980fd42f27e86e068076beac16ea))
* support genesis block 0 during BNS sync ([#1559](https://github.com/hirosystems/stacks-blockchain-api/issues/1559)) ([6750861](https://github.com/hirosystems/stacks-blockchain-api/commit/6750861e99c88a6a672f007c26ec36cfb0cce6b1))

## [7.0.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.3.4...v7.0.0) (2023-02-07)


### ⚠ BREAKING CHANGES

* support for upcoming Stacks 2.1 features, event-replay required;
* a sync from genesis is required to use with a Stacks v2.1-rc node

### Features

* [Stacks 2.1] `delegate-stx` Bitcoin-op parsing ([#1527](https://github.com/hirosystems/stacks-blockchain-api/issues/1527)) ([ea01587](https://github.com/hirosystems/stacks-blockchain-api/commit/ea0158700ef172abb8c54bbf78cfaba8154a009f))
* **agg-paging-limits:** aggregated all paging query limits ([#1401](https://github.com/hirosystems/stacks-blockchain-api/issues/1401)) ([0203d36](https://github.com/hirosystems/stacks-blockchain-api/commit/0203d36342569803db6a59a64193ae02f7fc4098)), closes [#1379](https://github.com/hirosystems/stacks-blockchain-api/issues/1379) [#1379](https://github.com/hirosystems/stacks-blockchain-api/issues/1379)
* Stacks 2.1 support ([#1498](https://github.com/hirosystems/stacks-blockchain-api/issues/1498)) ([dcbdfb9](https://github.com/hirosystems/stacks-blockchain-api/commit/dcbdfb9069d9e3541265dbfd5cd1a933d7c6ffa2)), closes [#1279](https://github.com/hirosystems/stacks-blockchain-api/issues/1279) [#1280](https://github.com/hirosystems/stacks-blockchain-api/issues/1280) [#1283](https://github.com/hirosystems/stacks-blockchain-api/issues/1283) [#1285](https://github.com/hirosystems/stacks-blockchain-api/issues/1285) [#1289](https://github.com/hirosystems/stacks-blockchain-api/issues/1289) [#1290](https://github.com/hirosystems/stacks-blockchain-api/issues/1290) [#1295](https://github.com/hirosystems/stacks-blockchain-api/issues/1295) [#1339](https://github.com/hirosystems/stacks-blockchain-api/issues/1339) [#1363](https://github.com/hirosystems/stacks-blockchain-api/issues/1363) [#1367](https://github.com/hirosystems/stacks-blockchain-api/issues/1367) [#1372](https://github.com/hirosystems/stacks-blockchain-api/issues/1372) [#1413](https://github.com/hirosystems/stacks-blockchain-api/issues/1413) [#1449](https://github.com/hirosystems/stacks-blockchain-api/issues/1449) [#1205](https://github.com/hirosystems/stacks-blockchain-api/issues/1205) [#1197](https://github.com/hirosystems/stacks-blockchain-api/issues/1197) [#1206](https://github.com/hirosystems/stacks-blockchain-api/issues/1206) [#1179](https://github.com/hirosystems/stacks-blockchain-api/issues/1179) [#1190](https://github.com/hirosystems/stacks-blockchain-api/issues/1190) [#1167](https://github.com/hirosystems/stacks-blockchain-api/issues/1167) [#1363](https://github.com/hirosystems/stacks-blockchain-api/issues/1363) [#1193](https://github.com/hirosystems/stacks-blockchain-api/issues/1193) [#1162](https://github.com/hirosystems/stacks-blockchain-api/issues/1162) [#1216](https://github.com/hirosystems/stacks-blockchain-api/issues/1216) [#1289](https://github.com/hirosystems/stacks-blockchain-api/issues/1289) [#1290](https://github.com/hirosystems/stacks-blockchain-api/issues/1290) [#1241](https://github.com/hirosystems/stacks-blockchain-api/issues/1241) [#1168](https://github.com/hirosystems/stacks-blockchain-api/issues/1168) [#1218](https://github.com/hirosystems/stacks-blockchain-api/issues/1218) [#1339](https://github.com/hirosystems/stacks-blockchain-api/issues/1339) [#1413](https://github.com/hirosystems/stacks-blockchain-api/issues/1413) [#1283](https://github.com/hirosystems/stacks-blockchain-api/issues/1283) [#1280](https://github.com/hirosystems/stacks-blockchain-api/issues/1280) [#1285](https://github.com/hirosystems/stacks-blockchain-api/issues/1285) [#1403](https://github.com/hirosystems/stacks-blockchain-api/issues/1403) [#1456](https://github.com/hirosystems/stacks-blockchain-api/issues/1456) [#1454](https://github.com/hirosystems/stacks-blockchain-api/issues/1454) [#1454](https://github.com/hirosystems/stacks-blockchain-api/issues/1454) [#1456](https://github.com/hirosystems/stacks-blockchain-api/issues/1456) [#1403](https://github.com/hirosystems/stacks-blockchain-api/issues/1403) [#1461](https://github.com/hirosystems/stacks-blockchain-api/issues/1461) [#1476](https://github.com/hirosystems/stacks-blockchain-api/issues/1476) [#1329](https://github.com/hirosystems/stacks-blockchain-api/issues/1329) [#1287](https://github.com/hirosystems/stacks-blockchain-api/issues/1287) [#1476](https://github.com/hirosystems/stacks-blockchain-api/issues/1476) [#1366](https://github.com/hirosystems/stacks-blockchain-api/issues/1366) [#1304](https://github.com/hirosystems/stacks-blockchain-api/issues/1304) [#1331](https://github.com/hirosystems/stacks-blockchain-api/issues/1331) [#1332](https://github.com/hirosystems/stacks-blockchain-api/issues/1332) [#1379](https://github.com/hirosystems/stacks-blockchain-api/issues/1379) [#1379](https://github.com/hirosystems/stacks-blockchain-api/issues/1379) [#1355](https://github.com/hirosystems/stacks-blockchain-api/issues/1355) [#1287](https://github.com/hirosystems/stacks-blockchain-api/issues/1287) [#1389](https://github.com/hirosystems/stacks-blockchain-api/issues/1389) [#1323](https://github.com/hirosystems/stacks-blockchain-api/issues/1323) [#1368](https://github.com/hirosystems/stacks-blockchain-api/issues/1368) [#1348](https://github.com/hirosystems/stacks-blockchain-api/issues/1348) [#1314](https://github.com/hirosystems/stacks-blockchain-api/issues/1314) [#1303](https://github.com/hirosystems/stacks-blockchain-api/issues/1303) [#1425](https://github.com/hirosystems/stacks-blockchain-api/issues/1425) [#1334](https://github.com/hirosystems/stacks-blockchain-api/issues/1334) [#1309](https://github.com/hirosystems/stacks-blockchain-api/issues/1309) [#1445](https://github.com/hirosystems/stacks-blockchain-api/issues/1445) [#1374](https://github.com/hirosystems/stacks-blockchain-api/issues/1374) [#1345](https://github.com/hirosystems/stacks-blockchain-api/issues/1345) [#1353](https://github.com/hirosystems/stacks-blockchain-api/issues/1353) [#1433](https://github.com/hirosystems/stacks-blockchain-api/issues/1433) [#1424](https://github.com/hirosystems/stacks-blockchain-api/issues/1424) [#1427](https://github.com/hirosystems/stacks-blockchain-api/issues/1427) [#1301](https://github.com/hirosystems/stacks-blockchain-api/issues/1301) [#1458](https://github.com/hirosystems/stacks-blockchain-api/issues/1458) [#1379](https://github.com/hirosystems/stacks-blockchain-api/issues/1379) [#1270](https://github.com/hirosystems/stacks-blockchain-api/issues/1270) [#1324](https://github.com/hirosystems/stacks-blockchain-api/issues/1324) [#1356](https://github.com/hirosystems/stacks-blockchain-api/issues/1356) [#1360](https://github.com/hirosystems/stacks-blockchain-api/issues/1360) [#1315](https://github.com/hirosystems/stacks-blockchain-api/issues/1315) [#1326](https://github.com/hirosystems/stacks-blockchain-api/issues/1326) [#1440](https://github.com/hirosystems/stacks-blockchain-api/issues/1440) [#1351](https://github.com/hirosystems/stacks-blockchain-api/issues/1351) [#1410](https://github.com/hirosystems/stacks-blockchain-api/issues/1410) [#1337](https://github.com/hirosystems/stacks-blockchain-api/issues/1337) [#1420](https://github.com/hirosystems/stacks-blockchain-api/issues/1420) [#1328](https://github.com/hirosystems/stacks-blockchain-api/issues/1328) [#1329](https://github.com/hirosystems/stacks-blockchain-api/issues/1329) [#1343](https://github.com/hirosystems/stacks-blockchain-api/issues/1343) [#1329](https://github.com/hirosystems/stacks-blockchain-api/issues/1329) [#1495](https://github.com/hirosystems/stacks-blockchain-api/issues/1495)


### Bug Fixes

* add bnsImportUpdate to event emitter to fix BNS import test ([#1491](https://github.com/hirosystems/stacks-blockchain-api/issues/1491)) ([2f9cb0c](https://github.com/hirosystems/stacks-blockchain-api/commit/2f9cb0c21f761b1cf505672e4f8541de626b1e21))
* build rosetta with node 16 ([654b64f](https://github.com/hirosystems/stacks-blockchain-api/commit/654b64f60fe4f8cccfc95db9dcef1d57fae9c88b))
* datastore tests ([bb96507](https://github.com/hirosystems/stacks-blockchain-api/commit/bb96507296a251da94b7a3b64b341192503c654e))
* guarantee db is empty before performing a replay ([#1374](https://github.com/hirosystems/stacks-blockchain-api/issues/1374)) ([ef8e7a9](https://github.com/hirosystems/stacks-blockchain-api/commit/ef8e7a9185e4b2cc57e3a66fd1f63cb2ce7b39b2))
* lint docs ci dependencies ([#1458](https://github.com/hirosystems/stacks-blockchain-api/issues/1458)) ([90d0c7b](https://github.com/hirosystems/stacks-blockchain-api/commit/90d0c7b8314867f0900f3ab3952925bf1a30814d))
* make query limits backwards compatible ([#1509](https://github.com/hirosystems/stacks-blockchain-api/issues/1509)) ([a0cebf5](https://github.com/hirosystems/stacks-blockchain-api/commit/a0cebf5ce66ce953f11d2b25fca37db329018fdc))
* prevent token metadata processor from blocking api launch ([#1514](https://github.com/hirosystems/stacks-blockchain-api/issues/1514)) ([63da7e1](https://github.com/hirosystems/stacks-blockchain-api/commit/63da7e140b8d436125947b21bf9067e71cb26229))
* reorg txs by inserting txs that are missing from the mempool table ([#1429](https://github.com/hirosystems/stacks-blockchain-api/issues/1429)) ([a512511](https://github.com/hirosystems/stacks-blockchain-api/commit/a512511b5ba2f2692605e0b58425e4cffdb0774d))
* synthetic tx parsing for pox2 bitcoin-ops ([#1505](https://github.com/hirosystems/stacks-blockchain-api/issues/1505)) ([720dc87](https://github.com/hirosystems/stacks-blockchain-api/commit/720dc871618d49fdcb1f84f59cca84d0fdb434d1))
* test tx types ([11b9013](https://github.com/hirosystems/stacks-blockchain-api/commit/11b901343516ceb58e006a17d7ca72049aa036de))
* use correct `pox-addr` arg while parsing `stack-stx` bitcoin-op [#415](https://github.com/hirosystems/stacks-blockchain-api/issues/415) ([#1533](https://github.com/hirosystems/stacks-blockchain-api/issues/1533)) ([ab14ad5](https://github.com/hirosystems/stacks-blockchain-api/commit/ab14ad52f0d38772096d5f82f69d85d976c58eb2))
* use pg bigint for `pox_v1_unlock_height` column ([#1521](https://github.com/hirosystems/stacks-blockchain-api/issues/1521)) ([d3fd685](https://github.com/hirosystems/stacks-blockchain-api/commit/d3fd6856590f2e2ab4a41d2ca79a607e9ef32493))


### Miscellaneous Chores

* note for Stacks 2.1 support and major version bump ([d27f956](https://github.com/hirosystems/stacks-blockchain-api/commit/d27f9563e14dac5f7ea8f5fa7c7b6e7619dccd5f))
* support for Stacks 2.1 ([e88ec29](https://github.com/hirosystems/stacks-blockchain-api/commit/e88ec295ac9da11c8ac0df271fa7c7722ae8e2d7))

## [7.0.0-beta.5](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.0.0-beta.4...v7.0.0-beta.5) (2023-02-06)


### Features

* [Stacks 2.1] `delegate-stx` Bitcoin-op parsing ([#1527](https://github.com/hirosystems/stacks-blockchain-api/issues/1527)) ([ea01587](https://github.com/hirosystems/stacks-blockchain-api/commit/ea0158700ef172abb8c54bbf78cfaba8154a009f))


### Bug Fixes

* use correct `pox-addr` arg while parsing `stack-stx` bitcoin-op [#415](https://github.com/hirosystems/stacks-blockchain-api/issues/415) ([#1533](https://github.com/hirosystems/stacks-blockchain-api/issues/1533)) ([ab14ad5](https://github.com/hirosystems/stacks-blockchain-api/commit/ab14ad52f0d38772096d5f82f69d85d976c58eb2))

## [7.0.0-beta.4](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.0.0-beta.3...v7.0.0-beta.4) (2023-02-03)


### Features

* add `smartContractUpdate` and `smartContractLogUpdate` to `PgWriteStore` event emitter ([#1462](https://github.com/hirosystems/stacks-blockchain-api/issues/1462)) ([bce0ef9](https://github.com/hirosystems/stacks-blockchain-api/commit/bce0ef9b09d944d3f7b8f6299b9375b59f17322d))


### Bug Fixes

* add block_height index to contract_logs ([#1534](https://github.com/hirosystems/stacks-blockchain-api/issues/1534)) ([dc53af2](https://github.com/hirosystems/stacks-blockchain-api/commit/dc53af261370582898bdf6779fd7ffc97502112a))
* add contract_identifier index on contract_logs table ([#1523](https://github.com/hirosystems/stacks-blockchain-api/issues/1523)) ([1f16513](https://github.com/hirosystems/stacks-blockchain-api/commit/1f16513c0f3c040874aae3b95f8a00e4332aab75))
* avoid selecting `raw_tx` column on read queries ([#1453](https://github.com/hirosystems/stacks-blockchain-api/issues/1453)) ([5acfc96](https://github.com/hirosystems/stacks-blockchain-api/commit/5acfc9688af6ba7a6a4ca83bdaf8e5aee9df633e))
* build rosetta with node 16 ([654b64f](https://github.com/hirosystems/stacks-blockchain-api/commit/654b64f60fe4f8cccfc95db9dcef1d57fae9c88b))
* datastore tests ([bb96507](https://github.com/hirosystems/stacks-blockchain-api/commit/bb96507296a251da94b7a3b64b341192503c654e))
* is_unanchored property on /extended/v1/tx/:tx_id ([#1487](https://github.com/hirosystems/stacks-blockchain-api/issues/1487)) ([4b85058](https://github.com/hirosystems/stacks-blockchain-api/commit/4b850580be5b5520dcf63e41acdfb602ed6d256a))
* lint docs ci dependencies ([#1458](https://github.com/hirosystems/stacks-blockchain-api/issues/1458)) ([19c3a0d](https://github.com/hirosystems/stacks-blockchain-api/commit/19c3a0d0acae6aeb890afcfff167312149994ec8))
* stop resolving revoked BNS names ([#1519](https://github.com/hirosystems/stacks-blockchain-api/issues/1519)) ([095c4fc](https://github.com/hirosystems/stacks-blockchain-api/commit/095c4fc6c1da53bafe2f2db055bafc856548b1e6))
* test tx types ([11b9013](https://github.com/hirosystems/stacks-blockchain-api/commit/11b901343516ceb58e006a17d7ca72049aa036de))
* update total STX supply to the year 2050 projected amount ([#1531](https://github.com/hirosystems/stacks-blockchain-api/issues/1531)) ([0689f60](https://github.com/hirosystems/stacks-blockchain-api/commit/0689f60121e921229a5b7da87fc63e1e1a97d029))

## [7.0.0-beta.3](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.0.0-beta.2...v7.0.0-beta.3) (2023-01-13)


### Bug Fixes

* use pg bigint for `pox_v1_unlock_height` column ([#1521](https://github.com/hirosystems/stacks-blockchain-api/issues/1521)) ([d3fd685](https://github.com/hirosystems/stacks-blockchain-api/commit/d3fd6856590f2e2ab4a41d2ca79a607e9ef32493))

## [7.0.0-beta.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.0.0-beta.1...v7.0.0-beta.2) (2023-01-13)


### Bug Fixes

* prevent token metadata processor from blocking api launch ([#1514](https://github.com/hirosystems/stacks-blockchain-api/issues/1514)) ([63da7e1](https://github.com/hirosystems/stacks-blockchain-api/commit/63da7e140b8d436125947b21bf9067e71cb26229))

## [7.0.0-beta.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.2.1...v7.0.0-beta.1) (2023-01-10)


### ⚠ BREAKING CHANGES

* a sync from genesis is required to use with a Stacks v2.1-rc node

### Features

* **agg-paging-limits:** aggregated all paging query limits ([#1401](https://github.com/hirosystems/stacks-blockchain-api/issues/1401)) ([0203d36](https://github.com/hirosystems/stacks-blockchain-api/commit/0203d36342569803db6a59a64193ae02f7fc4098)), closes [#1379](https://github.com/hirosystems/stacks-blockchain-api/issues/1379) [#1379](https://github.com/hirosystems/stacks-blockchain-api/issues/1379)
* Stacks 2.1 support ([#1498](https://github.com/hirosystems/stacks-blockchain-api/issues/1498)) ([dcbdfb9](https://github.com/hirosystems/stacks-blockchain-api/commit/dcbdfb9069d9e3541265dbfd5cd1a933d7c6ffa2)), closes [#1279](https://github.com/hirosystems/stacks-blockchain-api/issues/1279) [#1280](https://github.com/hirosystems/stacks-blockchain-api/issues/1280) [#1283](https://github.com/hirosystems/stacks-blockchain-api/issues/1283) [#1285](https://github.com/hirosystems/stacks-blockchain-api/issues/1285) [#1289](https://github.com/hirosystems/stacks-blockchain-api/issues/1289) [#1290](https://github.com/hirosystems/stacks-blockchain-api/issues/1290) [#1295](https://github.com/hirosystems/stacks-blockchain-api/issues/1295) [#1339](https://github.com/hirosystems/stacks-blockchain-api/issues/1339) [#1363](https://github.com/hirosystems/stacks-blockchain-api/issues/1363) [#1367](https://github.com/hirosystems/stacks-blockchain-api/issues/1367) [#1372](https://github.com/hirosystems/stacks-blockchain-api/issues/1372) [#1413](https://github.com/hirosystems/stacks-blockchain-api/issues/1413) [#1449](https://github.com/hirosystems/stacks-blockchain-api/issues/1449) [#1205](https://github.com/hirosystems/stacks-blockchain-api/issues/1205) [#1197](https://github.com/hirosystems/stacks-blockchain-api/issues/1197) [#1206](https://github.com/hirosystems/stacks-blockchain-api/issues/1206) [#1179](https://github.com/hirosystems/stacks-blockchain-api/issues/1179) [#1190](https://github.com/hirosystems/stacks-blockchain-api/issues/1190) [#1167](https://github.com/hirosystems/stacks-blockchain-api/issues/1167) [#1363](https://github.com/hirosystems/stacks-blockchain-api/issues/1363) [#1193](https://github.com/hirosystems/stacks-blockchain-api/issues/1193) [#1162](https://github.com/hirosystems/stacks-blockchain-api/issues/1162) [#1216](https://github.com/hirosystems/stacks-blockchain-api/issues/1216) [#1289](https://github.com/hirosystems/stacks-blockchain-api/issues/1289) [#1290](https://github.com/hirosystems/stacks-blockchain-api/issues/1290) [#1241](https://github.com/hirosystems/stacks-blockchain-api/issues/1241) [#1168](https://github.com/hirosystems/stacks-blockchain-api/issues/1168) [#1218](https://github.com/hirosystems/stacks-blockchain-api/issues/1218) [#1339](https://github.com/hirosystems/stacks-blockchain-api/issues/1339) [#1413](https://github.com/hirosystems/stacks-blockchain-api/issues/1413) [#1283](https://github.com/hirosystems/stacks-blockchain-api/issues/1283) [#1280](https://github.com/hirosystems/stacks-blockchain-api/issues/1280) [#1285](https://github.com/hirosystems/stacks-blockchain-api/issues/1285) [#1403](https://github.com/hirosystems/stacks-blockchain-api/issues/1403) [#1456](https://github.com/hirosystems/stacks-blockchain-api/issues/1456) [#1454](https://github.com/hirosystems/stacks-blockchain-api/issues/1454) [#1454](https://github.com/hirosystems/stacks-blockchain-api/issues/1454) [#1456](https://github.com/hirosystems/stacks-blockchain-api/issues/1456) [#1403](https://github.com/hirosystems/stacks-blockchain-api/issues/1403) [#1461](https://github.com/hirosystems/stacks-blockchain-api/issues/1461) [#1476](https://github.com/hirosystems/stacks-blockchain-api/issues/1476) [#1329](https://github.com/hirosystems/stacks-blockchain-api/issues/1329) [#1287](https://github.com/hirosystems/stacks-blockchain-api/issues/1287) [#1476](https://github.com/hirosystems/stacks-blockchain-api/issues/1476) [#1366](https://github.com/hirosystems/stacks-blockchain-api/issues/1366) [#1304](https://github.com/hirosystems/stacks-blockchain-api/issues/1304) [#1331](https://github.com/hirosystems/stacks-blockchain-api/issues/1331) [#1332](https://github.com/hirosystems/stacks-blockchain-api/issues/1332) [#1379](https://github.com/hirosystems/stacks-blockchain-api/issues/1379) [#1379](https://github.com/hirosystems/stacks-blockchain-api/issues/1379) [#1355](https://github.com/hirosystems/stacks-blockchain-api/issues/1355) [#1287](https://github.com/hirosystems/stacks-blockchain-api/issues/1287) [#1389](https://github.com/hirosystems/stacks-blockchain-api/issues/1389) [#1323](https://github.com/hirosystems/stacks-blockchain-api/issues/1323) [#1368](https://github.com/hirosystems/stacks-blockchain-api/issues/1368) [#1348](https://github.com/hirosystems/stacks-blockchain-api/issues/1348) [#1314](https://github.com/hirosystems/stacks-blockchain-api/issues/1314) [#1303](https://github.com/hirosystems/stacks-blockchain-api/issues/1303) [#1425](https://github.com/hirosystems/stacks-blockchain-api/issues/1425) [#1334](https://github.com/hirosystems/stacks-blockchain-api/issues/1334) [#1309](https://github.com/hirosystems/stacks-blockchain-api/issues/1309) [#1445](https://github.com/hirosystems/stacks-blockchain-api/issues/1445) [#1374](https://github.com/hirosystems/stacks-blockchain-api/issues/1374) [#1345](https://github.com/hirosystems/stacks-blockchain-api/issues/1345) [#1353](https://github.com/hirosystems/stacks-blockchain-api/issues/1353) [#1433](https://github.com/hirosystems/stacks-blockchain-api/issues/1433) [#1424](https://github.com/hirosystems/stacks-blockchain-api/issues/1424) [#1427](https://github.com/hirosystems/stacks-blockchain-api/issues/1427) [#1301](https://github.com/hirosystems/stacks-blockchain-api/issues/1301) [#1458](https://github.com/hirosystems/stacks-blockchain-api/issues/1458) [#1379](https://github.com/hirosystems/stacks-blockchain-api/issues/1379) [#1270](https://github.com/hirosystems/stacks-blockchain-api/issues/1270) [#1324](https://github.com/hirosystems/stacks-blockchain-api/issues/1324) [#1356](https://github.com/hirosystems/stacks-blockchain-api/issues/1356) [#1360](https://github.com/hirosystems/stacks-blockchain-api/issues/1360) [#1315](https://github.com/hirosystems/stacks-blockchain-api/issues/1315) [#1326](https://github.com/hirosystems/stacks-blockchain-api/issues/1326) [#1440](https://github.com/hirosystems/stacks-blockchain-api/issues/1440) [#1351](https://github.com/hirosystems/stacks-blockchain-api/issues/1351) [#1410](https://github.com/hirosystems/stacks-blockchain-api/issues/1410) [#1337](https://github.com/hirosystems/stacks-blockchain-api/issues/1337) [#1420](https://github.com/hirosystems/stacks-blockchain-api/issues/1420) [#1328](https://github.com/hirosystems/stacks-blockchain-api/issues/1328) [#1329](https://github.com/hirosystems/stacks-blockchain-api/issues/1329) [#1343](https://github.com/hirosystems/stacks-blockchain-api/issues/1343) [#1329](https://github.com/hirosystems/stacks-blockchain-api/issues/1329) [#1495](https://github.com/hirosystems/stacks-blockchain-api/issues/1495)


### Bug Fixes

* add bnsImportUpdate to event emitter to fix BNS import test ([#1491](https://github.com/hirosystems/stacks-blockchain-api/issues/1491)) ([2f9cb0c](https://github.com/hirosystems/stacks-blockchain-api/commit/2f9cb0c21f761b1cf505672e4f8541de626b1e21))
* guarantee db is empty before performing a replay ([#1374](https://github.com/hirosystems/stacks-blockchain-api/issues/1374)) ([ef8e7a9](https://github.com/hirosystems/stacks-blockchain-api/commit/ef8e7a9185e4b2cc57e3a66fd1f63cb2ce7b39b2))
* lint docs ci dependencies ([#1458](https://github.com/hirosystems/stacks-blockchain-api/issues/1458)) ([90d0c7b](https://github.com/hirosystems/stacks-blockchain-api/commit/90d0c7b8314867f0900f3ab3952925bf1a30814d))
* make query limits backwards compatible ([#1509](https://github.com/hirosystems/stacks-blockchain-api/issues/1509)) ([a0cebf5](https://github.com/hirosystems/stacks-blockchain-api/commit/a0cebf5ce66ce953f11d2b25fca37db329018fdc))
* reorg txs by inserting txs that are missing from the mempool table ([#1429](https://github.com/hirosystems/stacks-blockchain-api/issues/1429)) ([a512511](https://github.com/hirosystems/stacks-blockchain-api/commit/a512511b5ba2f2692605e0b58425e4cffdb0774d))
* synthetic tx parsing for pox2 bitcoin-ops ([#1505](https://github.com/hirosystems/stacks-blockchain-api/issues/1505)) ([720dc87](https://github.com/hirosystems/stacks-blockchain-api/commit/720dc871618d49fdcb1f84f59cca84d0fdb434d1))


### Miscellaneous Chores

* support for Stacks 2.1 ([e88ec29](https://github.com/hirosystems/stacks-blockchain-api/commit/e88ec295ac9da11c8ac0df271fa7c7722ae8e2d7))

## [7.0.0-stacks-2.1.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.0.0-stacks-2.1.1...v7.0.0-stacks-2.1.2) (2022-12-21)


### ⚠ BREAKING CHANGES

* remove deprecated `/nft_events` endpoint (#1329)
* mark breaking change
* optimize tables and improve canonical treatment of BNS data (#1287)

### Features

* [Stacks 2.1] Support new "block 0" boot events ([#1476](https://github.com/hirosystems/stacks-blockchain-api/issues/1476)) ([3d1b8f6](https://github.com/hirosystems/stacks-blockchain-api/commit/3d1b8f6f86db297343f082187dc9561e67800f1d))
* add ENV configs for DB close and API shutdown timeouts ([#1366](https://github.com/hirosystems/stacks-blockchain-api/issues/1366)) ([444f008](https://github.com/hirosystems/stacks-blockchain-api/commit/444f008fe2f188148ce14c519373a053a3fc8c89))
* add indexes for index_block_hash on BNS tables ([#1304](https://github.com/hirosystems/stacks-blockchain-api/issues/1304)) ([bbf4b2d](https://github.com/hirosystems/stacks-blockchain-api/commit/bbf4b2d2b8c7f6ed30bfda6eaa430d5c2e84cdf5))
* add owner index to subdomains table ([#1331](https://github.com/hirosystems/stacks-blockchain-api/issues/1331)) ([a6c5e12](https://github.com/hirosystems/stacks-blockchain-api/commit/a6c5e12faa256633a7c9ae4c7cf8524013d187d6))
* add token_type metadata for rosetta ft operations ([#1332](https://github.com/hirosystems/stacks-blockchain-api/issues/1332)) ([09af27b](https://github.com/hirosystems/stacks-blockchain-api/commit/09af27b24be8e30a840707707b79d65cd45f2351))
* **agg-paging-limits:** aggregated all paging query limits ([#1401](https://github.com/hirosystems/stacks-blockchain-api/issues/1401)) ([0203d36](https://github.com/hirosystems/stacks-blockchain-api/commit/0203d36342569803db6a59a64193ae02f7fc4098)), closes [#1379](https://github.com/hirosystems/stacks-blockchain-api/issues/1379) [#1379](https://github.com/hirosystems/stacks-blockchain-api/issues/1379)
* configurable pg connection lifetime and idle timeouts ([#1355](https://github.com/hirosystems/stacks-blockchain-api/issues/1355)) ([46ccf06](https://github.com/hirosystems/stacks-blockchain-api/commit/46ccf0640de0c42e5fd71795521992fdfdc8d293))
* mark breaking change ([669fd0d](https://github.com/hirosystems/stacks-blockchain-api/commit/669fd0d8c00b8ca9224c9b5411a070b32c3b0529))
* optimize tables and improve canonical treatment of BNS data ([#1287](https://github.com/hirosystems/stacks-blockchain-api/issues/1287)) ([1f64818](https://github.com/hirosystems/stacks-blockchain-api/commit/1f648187b8c701e802a06bac52b077fd10571ff7))


### Bug Fixes

* add memos to send-many-memo rosetta STX transfer operations ([#1389](https://github.com/hirosystems/stacks-blockchain-api/issues/1389)) ([0a552b8](https://github.com/hirosystems/stacks-blockchain-api/commit/0a552b8d8c193f64199e63b0956b1c070ce2c530))
* add owner index on subdomains table ([#1323](https://github.com/hirosystems/stacks-blockchain-api/issues/1323)) ([c9c6d05](https://github.com/hirosystems/stacks-blockchain-api/commit/c9c6d053fd8896187a26a788aaaa56fb48285e61))
* add postgres connection error checking for ECONNRESET code ([03a1896](https://github.com/hirosystems/stacks-blockchain-api/commit/03a1896cff8937a5f39a8b75e5adf51a6344592c))
* bump version ([3863cce](https://github.com/hirosystems/stacks-blockchain-api/commit/3863cce1a64cf7a4c6cffd4f888c049cfd3ada65))
* catch cache controller db errors ([#1368](https://github.com/hirosystems/stacks-blockchain-api/issues/1368)) ([f15df41](https://github.com/hirosystems/stacks-blockchain-api/commit/f15df41fa98a171b5e20289240c391a847fd1460))
* catch pg exceptions on queries outside of express ([#1348](https://github.com/hirosystems/stacks-blockchain-api/issues/1348)) ([1f07b85](https://github.com/hirosystems/stacks-blockchain-api/commit/1f07b8587ccf0206e085d272e6cb5ee62f816fd9))
* consolidate db migrations ([#1314](https://github.com/hirosystems/stacks-blockchain-api/issues/1314)) ([d6bdf9f](https://github.com/hirosystems/stacks-blockchain-api/commit/d6bdf9faff905d5e208e61b04c34321e954a2fb1))
* detect name transfers and renewals in special circumstances ([#1303](https://github.com/hirosystems/stacks-blockchain-api/issues/1303)) ([cd381a9](https://github.com/hirosystems/stacks-blockchain-api/commit/cd381a95b4d0d3f4bb08e447500153c3f652eff6))
* disable faucet endpoints on mainnet ([#1425](https://github.com/hirosystems/stacks-blockchain-api/issues/1425)) ([b79b9b4](https://github.com/hirosystems/stacks-blockchain-api/commit/b79b9b43d5bce5d65f5bc322589704e40de1ad55))
* event_observer_requests json writes ([#1334](https://github.com/hirosystems/stacks-blockchain-api/issues/1334)) ([465aa0b](https://github.com/hirosystems/stacks-blockchain-api/commit/465aa0b42ca3dda57d06f6c0756b03d591e7f027))
* filter BNS processing for successful txs only ([#1309](https://github.com/hirosystems/stacks-blockchain-api/issues/1309)) ([6a12936](https://github.com/hirosystems/stacks-blockchain-api/commit/6a129369c6d9fcdc79b5a7ad288d37784cbe77cc))
* get rosetta latest block from chain_tip view ([#1445](https://github.com/hirosystems/stacks-blockchain-api/issues/1445)) ([ad386d3](https://github.com/hirosystems/stacks-blockchain-api/commit/ad386d30d18afcf22aba51f0c898f306eaaf5fdf))
* guarantee db is empty before performing a replay ([#1374](https://github.com/hirosystems/stacks-blockchain-api/issues/1374)) ([ef8e7a9](https://github.com/hirosystems/stacks-blockchain-api/commit/ef8e7a9185e4b2cc57e3a66fd1f63cb2ce7b39b2))
* guard against empty lists before querying postgres ([#1345](https://github.com/hirosystems/stacks-blockchain-api/issues/1345)) ([6c88a16](https://github.com/hirosystems/stacks-blockchain-api/commit/6c88a166c8742c869222f7f754838af386e2cd16))
* handle pg exceptions on web socket transmitter ([#1353](https://github.com/hirosystems/stacks-blockchain-api/issues/1353)) ([2e6448d](https://github.com/hirosystems/stacks-blockchain-api/commit/2e6448d7afc7bb35d5bcd3da88105f0552a13764))
* handle postgres dns lookup error ([#1433](https://github.com/hirosystems/stacks-blockchain-api/issues/1433)) ([e00efd4](https://github.com/hirosystems/stacks-blockchain-api/commit/e00efd4e64a3f0072ffa103e9ec011e5a080e7ed))
* handle postgres.js connection timeouts ([#1424](https://github.com/hirosystems/stacks-blockchain-api/issues/1424)) ([4a2a342](https://github.com/hirosystems/stacks-blockchain-api/commit/4a2a342b56c24e9b27b37116960555a425a0eb42))
* handle websocket messages with a priority queue ([#1427](https://github.com/hirosystems/stacks-blockchain-api/issues/1427)) ([f0cb01c](https://github.com/hirosystems/stacks-blockchain-api/commit/f0cb01c0541496959b924b29b5962caf63099432))
* import BNS v1 data during event replay ([#1301](https://github.com/hirosystems/stacks-blockchain-api/issues/1301)) ([bc59817](https://github.com/hirosystems/stacks-blockchain-api/commit/bc59817aa98dd3a978a27b73d14738b64eb823f9))
* lint docs ci dependencies ([#1458](https://github.com/hirosystems/stacks-blockchain-api/issues/1458)) ([90d0c7b](https://github.com/hirosystems/stacks-blockchain-api/commit/90d0c7b8314867f0900f3ab3952925bf1a30814d))
* log PoisonMicroblock tx instead rather than throwing ([#1379](https://github.com/hirosystems/stacks-blockchain-api/issues/1379)) ([cee6352](https://github.com/hirosystems/stacks-blockchain-api/commit/cee63529b4785d9bedc8fcfd568a27aedef0914d))
* refresh materialized views concurrently ([#1270](https://github.com/hirosystems/stacks-blockchain-api/issues/1270)) ([057c541](https://github.com/hirosystems/stacks-blockchain-api/commit/057c541b8c31402b6ff823cce0e3ed435ebe74a8))
* refresh materialized views concurrently in new pg format ([#1324](https://github.com/hirosystems/stacks-blockchain-api/issues/1324)) ([20b284f](https://github.com/hirosystems/stacks-blockchain-api/commit/20b284fa381041fb842bf61d8a184be6ea84810f))
* refresh materialized views in their own pg connection ([#1356](https://github.com/hirosystems/stacks-blockchain-api/issues/1356)) ([9433d3c](https://github.com/hirosystems/stacks-blockchain-api/commit/9433d3c9c2d46eeff143a6c04438a94505549f3f))
* remove duplicate tx socket updates inside db transactions ([#1360](https://github.com/hirosystems/stacks-blockchain-api/issues/1360)) ([60c185d](https://github.com/hirosystems/stacks-blockchain-api/commit/60c185d83970fe7cf590075029cd5fd878da96fa))
* remove live tsv append ([#1315](https://github.com/hirosystems/stacks-blockchain-api/issues/1315)) ([e2a1247](https://github.com/hirosystems/stacks-blockchain-api/commit/e2a124710f955d9d32ff5a928af7da08823689d4))
* retry pg connection on new library code ([#1326](https://github.com/hirosystems/stacks-blockchain-api/issues/1326)) ([35db939](https://github.com/hirosystems/stacks-blockchain-api/commit/35db939199a2d826e7ee4dbe31af48cc42364ea2))
* revert to 404 error code on bns name errors ([#1440](https://github.com/hirosystems/stacks-blockchain-api/issues/1440)) ([cdc039c](https://github.com/hirosystems/stacks-blockchain-api/commit/cdc039cea88749103a48cfc66d55d3ba14b3c2a3))
* skip migrations on read-only start ([#1351](https://github.com/hirosystems/stacks-blockchain-api/issues/1351)) ([1d32261](https://github.com/hirosystems/stacks-blockchain-api/commit/1d322614e70e125b924c7d0a8b9f536ca81eb48f))
* sql transaction consistency ([#1410](https://github.com/hirosystems/stacks-blockchain-api/issues/1410)) ([01e26d9](https://github.com/hirosystems/stacks-blockchain-api/commit/01e26d9c89472c8e07ee9d44372d3de86ee0fdb0))
* support multiple BNS name events in the same transaction ([#1337](https://github.com/hirosystems/stacks-blockchain-api/issues/1337)) ([1edb256](https://github.com/hirosystems/stacks-blockchain-api/commit/1edb25697df689dbf1da5d412f5d40e4aac024f3))
* tests ([1c1fd16](https://github.com/hirosystems/stacks-blockchain-api/commit/1c1fd1619c8ea97c2636082203fb678f06493786))
* update testnet send-many-memo contract id ENV ([#1420](https://github.com/hirosystems/stacks-blockchain-api/issues/1420)) ([45ea24d](https://github.com/hirosystems/stacks-blockchain-api/commit/45ea24d9a2df96d582aaae70e433b0717a0e47cf))
* upgrade stacks node versions to 2.05.0.3.0 ([#1328](https://github.com/hirosystems/stacks-blockchain-api/issues/1328)) ([e30636e](https://github.com/hirosystems/stacks-blockchain-api/commit/e30636e30f716a7335792914a142fa54f423dc9a))
* use new `this.sqlTransaction(...)` in pox2 db queries ([27102da](https://github.com/hirosystems/stacks-blockchain-api/commit/27102da4d4c7c7cb70639fab104095a4be1941f1))


### Reverts

* Revert "chore!: remove deprecated `/nft_events` endpoint (#1329)" (#1343) ([c537ee4](https://github.com/hirosystems/stacks-blockchain-api/commit/c537ee4c6f333c0a43c9e9e1ca1e073f03c58fc5)), closes [#1329](https://github.com/hirosystems/stacks-blockchain-api/issues/1329) [#1343](https://github.com/hirosystems/stacks-blockchain-api/issues/1343)


### Miscellaneous Chores

* remove deprecated `/nft_events` endpoint ([#1329](https://github.com/hirosystems/stacks-blockchain-api/issues/1329)) ([65bb4e5](https://github.com/hirosystems/stacks-blockchain-api/commit/65bb4e55fabf21a70183d2b16c8bc1f6f742d04e))

# [7.0.0-stacks-2.1.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v7.0.0-beta.1...v7.0.0-stacks-2.1.1) (2022-11-29)


### Bug Fixes

* add automatic pox switching to rosetta ([#1454](https://github.com/hirosystems/stacks-blockchain-api/issues/1454)) ([ad7e492](https://github.com/hirosystems/stacks-blockchain-api/commit/ad7e49216bad0b0c36670b31adb78ac4dc9c5cb0))
* add default stx faucet tx fee if estimate not available ([#1456](https://github.com/hirosystems/stacks-blockchain-api/issues/1456)) ([eeeffd0](https://github.com/hirosystems/stacks-blockchain-api/commit/eeeffd0244471662710bc335790694d87a2e594c))


### Features

* ingestion and querying for new PoX-2 events ([#1403](https://github.com/hirosystems/stacks-blockchain-api/issues/1403)) ([1936ba6](https://github.com/hirosystems/stacks-blockchain-api/commit/1936ba65196506746d50ab1ab201ff38ce2011b1))

## [6.3.4](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.3.3...v6.3.4) (2023-01-30)


### Bug Fixes

* add block_height index to contract_logs ([#1534](https://github.com/hirosystems/stacks-blockchain-api/issues/1534)) ([dc53af2](https://github.com/hirosystems/stacks-blockchain-api/commit/dc53af261370582898bdf6779fd7ffc97502112a))

## [6.3.3](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.3.2...v6.3.3) (2023-01-27)


### Bug Fixes

* update total STX supply to the year 2050 projected amount ([#1531](https://github.com/hirosystems/stacks-blockchain-api/issues/1531)) ([0689f60](https://github.com/hirosystems/stacks-blockchain-api/commit/0689f60121e921229a5b7da87fc63e1e1a97d029))

## [6.3.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.3.1...v6.3.2) (2023-01-16)


### Bug Fixes

* add contract_identifier index on contract_logs table ([#1523](https://github.com/hirosystems/stacks-blockchain-api/issues/1523)) ([1f16513](https://github.com/hirosystems/stacks-blockchain-api/commit/1f16513c0f3c040874aae3b95f8a00e4332aab75))

## [6.3.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.3.0...v6.3.1) (2023-01-13)


### Bug Fixes

* stop resolving revoked BNS names ([#1519](https://github.com/hirosystems/stacks-blockchain-api/issues/1519)) ([095c4fc](https://github.com/hirosystems/stacks-blockchain-api/commit/095c4fc6c1da53bafe2f2db055bafc856548b1e6))

## [6.3.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.2.3...v6.3.0) (2023-01-10)


### Features

* add `smartContractUpdate` and `smartContractLogUpdate` to `PgWriteStore` event emitter ([#1462](https://github.com/hirosystems/stacks-blockchain-api/issues/1462)) ([bce0ef9](https://github.com/hirosystems/stacks-blockchain-api/commit/bce0ef9b09d944d3f7b8f6299b9375b59f17322d))

## [6.3.0-beta.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.3.0-beta.1...v6.3.0-beta.2) (2023-01-06)


### Bug Fixes

* is_unanchored property on /extended/v1/tx/:tx_id ([#1487](https://github.com/hirosystems/stacks-blockchain-api/issues/1487)) ([4b85058](https://github.com/hirosystems/stacks-blockchain-api/commit/4b850580be5b5520dcf63e41acdfb602ed6d256a))

## [6.3.0-beta.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.2.2...v6.3.0-beta.1) (2022-12-06)


### Features

* add `smartContractUpdate` and `smartContractLogUpdate` to `PgWriteStore` event emitter ([#1462](https://github.com/hirosystems/stacks-blockchain-api/issues/1462)) ([bce0ef9](https://github.com/hirosystems/stacks-blockchain-api/commit/bce0ef9b09d944d3f7b8f6299b9375b59f17322d))


## [6.2.3](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.2.2...v6.2.3) (2022-12-14)


### Bug Fixes

* is_unanchored property on /extended/v1/tx/:tx_id ([#1487](https://github.com/hirosystems/stacks-blockchain-api/issues/1487)) ([4b85058](https://github.com/hirosystems/stacks-blockchain-api/commit/4b850580be5b5520dcf63e41acdfb602ed6d256a))


## [6.2.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.2.1...v6.2.2) (2022-12-06)


### Bug Fixes

* avoid selecting `raw_tx` column on read queries ([#1453](https://github.com/hirosystems/stacks-blockchain-api/issues/1453)) ([5acfc96](https://github.com/hirosystems/stacks-blockchain-api/commit/5acfc9688af6ba7a6a4ca83bdaf8e5aee9df633e))
* lint docs ci dependencies ([#1458](https://github.com/hirosystems/stacks-blockchain-api/issues/1458)) ([19c3a0d](https://github.com/hirosystems/stacks-blockchain-api/commit/19c3a0d0acae6aeb890afcfff167312149994ec8))

## [6.2.2-beta.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.2.1...v6.2.2-beta.1) (2022-11-29)


### Bug Fixes

* avoid selecting `raw_tx` column on read queries ([#1453](https://github.com/hirosystems/stacks-blockchain-api/issues/1453)) ([5acfc96](https://github.com/hirosystems/stacks-blockchain-api/commit/5acfc9688af6ba7a6a4ca83bdaf8e5aee9df633e))
* lint docs ci dependencies ([#1458](https://github.com/hirosystems/stacks-blockchain-api/issues/1458)) ([19c3a0d](https://github.com/hirosystems/stacks-blockchain-api/commit/19c3a0d0acae6aeb890afcfff167312149994ec8))

## [6.2.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.2.0...v6.2.1) (2022-11-18)


### Bug Fixes

* get rosetta latest block from chain_tip view ([#1445](https://github.com/hirosystems/stacks-blockchain-api/issues/1445)) ([ad386d3](https://github.com/hirosystems/stacks-blockchain-api/commit/ad386d30d18afcf22aba51f0c898f306eaaf5fdf))
* handle postgres dns lookup error ([#1433](https://github.com/hirosystems/stacks-blockchain-api/issues/1433)) ([e00efd4](https://github.com/hirosystems/stacks-blockchain-api/commit/e00efd4e64a3f0072ffa103e9ec011e5a080e7ed))
* handle websocket messages with a priority queue ([#1427](https://github.com/hirosystems/stacks-blockchain-api/issues/1427)) ([f0cb01c](https://github.com/hirosystems/stacks-blockchain-api/commit/f0cb01c0541496959b924b29b5962caf63099432))
* revert to 404 error code on bns name errors ([#1440](https://github.com/hirosystems/stacks-blockchain-api/issues/1440)) ([cdc039c](https://github.com/hirosystems/stacks-blockchain-api/commit/cdc039cea88749103a48cfc66d55d3ba14b3c2a3))

## [6.2.0-beta.6](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.2.0-beta.5...v6.2.0-beta.6) (2022-11-18)


### Bug Fixes

* get rosetta latest block from chain_tip view ([#1445](https://github.com/hirosystems/stacks-blockchain-api/issues/1445)) ([ad386d3](https://github.com/hirosystems/stacks-blockchain-api/commit/ad386d30d18afcf22aba51f0c898f306eaaf5fdf))

## [6.2.0-beta.5](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.2.0-beta.4...v6.2.0-beta.5) (2022-11-15)


### Bug Fixes

* handle postgres dns lookup error ([#1433](https://github.com/hirosystems/stacks-blockchain-api/issues/1433)) ([e00efd4](https://github.com/hirosystems/stacks-blockchain-api/commit/e00efd4e64a3f0072ffa103e9ec011e5a080e7ed))
* handle websocket messages with a priority queue ([#1427](https://github.com/hirosystems/stacks-blockchain-api/issues/1427)) ([f0cb01c](https://github.com/hirosystems/stacks-blockchain-api/commit/f0cb01c0541496959b924b29b5962caf63099432))
* revert to 404 error code on bns name errors ([#1440](https://github.com/hirosystems/stacks-blockchain-api/issues/1440)) ([cdc039c](https://github.com/hirosystems/stacks-blockchain-api/commit/cdc039cea88749103a48cfc66d55d3ba14b3c2a3))

## [6.2.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.1.1...v6.2.0) (2022-11-15)


### Features

* add ENV configs for DB close and API shutdown timeouts ([#1366](https://github.com/hirosystems/stacks-blockchain-api/issues/1366)) ([444f008](https://github.com/hirosystems/stacks-blockchain-api/commit/444f008fe2f188148ce14c519373a053a3fc8c89))
* add memos to send-many-memo rosetta STX transfer operations ([#1389](https://github.com/hirosystems/stacks-blockchain-api/issues/1389)) ([0a552b8](https://github.com/hirosystems/stacks-blockchain-api/commit/0a552b8d8c193f64199e63b0956b1c070ce2c530))
* catch cache controller db errors ([#1368](https://github.com/hirosystems/stacks-blockchain-api/issues/1368)) ([f15df41](https://github.com/hirosystems/stacks-blockchain-api/commit/f15df41fa98a171b5e20289240c391a847fd1460))
* disable faucet endpoints on mainnet ([#1425](https://github.com/hirosystems/stacks-blockchain-api/issues/1425)) ([b79b9b4](https://github.com/hirosystems/stacks-blockchain-api/commit/b79b9b43d5bce5d65f5bc322589704e40de1ad55))
* handle postgres.js connection timeouts ([#1424](https://github.com/hirosystems/stacks-blockchain-api/issues/1424)) ([4a2a342](https://github.com/hirosystems/stacks-blockchain-api/commit/4a2a342b56c24e9b27b37116960555a425a0eb42))
* remove duplicate tx socket updates inside db transactions ([#1360](https://github.com/hirosystems/stacks-blockchain-api/issues/1360)) ([60c185d](https://github.com/hirosystems/stacks-blockchain-api/commit/60c185d83970fe7cf590075029cd5fd878da96fa))
* sql transaction consistency ([#1410](https://github.com/hirosystems/stacks-blockchain-api/issues/1410)) ([01e26d9](https://github.com/hirosystems/stacks-blockchain-api/commit/01e26d9c89472c8e07ee9d44372d3de86ee0fdb0))
* update testnet send-many-memo contract id ENV ([#1420](https://github.com/hirosystems/stacks-blockchain-api/issues/1420)) ([45ea24d](https://github.com/hirosystems/stacks-blockchain-api/commit/45ea24d9a2df96d582aaae70e433b0717a0e47cf))


## [6.2.0-beta.4](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.2.0-beta.3...v6.2.0-beta.4) (2022-11-08)


### Bug Fixes

* disable faucet endpoints on mainnet ([#1425](https://github.com/hirosystems/stacks-blockchain-api/issues/1425)) ([b79b9b4](https://github.com/hirosystems/stacks-blockchain-api/commit/b79b9b43d5bce5d65f5bc322589704e40de1ad55))
* handle postgres.js connection timeouts ([#1424](https://github.com/hirosystems/stacks-blockchain-api/issues/1424)) ([4a2a342](https://github.com/hirosystems/stacks-blockchain-api/commit/4a2a342b56c24e9b27b37116960555a425a0eb42))

## [6.2.0-beta.3](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.2.0-beta.2...v6.2.0-beta.3) (2022-11-07)


### Bug Fixes

* update testnet send-many-memo contract id ENV ([#1420](https://github.com/hirosystems/stacks-blockchain-api/issues/1420)) ([45ea24d](https://github.com/hirosystems/stacks-blockchain-api/commit/45ea24d9a2df96d582aaae70e433b0717a0e47cf))

## [6.2.0-beta.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.2.0-beta.1...v6.2.0-beta.2) (2022-11-04)


### Bug Fixes

* log PoisonMicroblock tx instead rather than throwing ([#1379](https://github.com/hirosystems/stacks-blockchain-api/issues/1379)) ([cee6352](https://github.com/hirosystems/stacks-blockchain-api/commit/cee63529b4785d9bedc8fcfd568a27aedef0914d))

## [6.2.0-beta.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.1.0...v6.2.0-beta.1) (2022-11-03)


### Features

* add ENV configs for DB close and API shutdown timeouts ([#1366](https://github.com/hirosystems/stacks-blockchain-api/issues/1366)) ([444f008](https://github.com/hirosystems/stacks-blockchain-api/commit/444f008fe2f188148ce14c519373a053a3fc8c89))

### Bug Fixes

* add memos to send-many-memo rosetta STX transfer operations ([#1389](https://github.com/hirosystems/stacks-blockchain-api/issues/1389)) ([0a552b8](https://github.com/hirosystems/stacks-blockchain-api/commit/0a552b8d8c193f64199e63b0956b1c070ce2c530))
* catch cache controller db errors ([#1368](https://github.com/hirosystems/stacks-blockchain-api/issues/1368)) ([f15df41](https://github.com/hirosystems/stacks-blockchain-api/commit/f15df41fa98a171b5e20289240c391a847fd1460))
* remove duplicate tx socket updates inside db transactions ([#1360](https://github.com/hirosystems/stacks-blockchain-api/issues/1360)) ([60c185d](https://github.com/hirosystems/stacks-blockchain-api/commit/60c185d83970fe7cf590075029cd5fd878da96fa))
* sql transaction consistency ([#1410](https://github.com/hirosystems/stacks-blockchain-api/issues/1410)) ([01e26d9](https://github.com/hirosystems/stacks-blockchain-api/commit/01e26d9c89472c8e07ee9d44372d3de86ee0fdb0))



## [6.1.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.1.0...v6.1.1) (2022-10-24)


### Bug Fixes

* log PoisonMicroblock tx instead rather than throwing ([#1379](https://github.com/hirosystems/stacks-blockchain-api/issues/1379)) ([cee6352](https://github.com/hirosystems/stacks-blockchain-api/commit/cee63529b4785d9bedc8fcfd568a27aedef0914d))


## [6.1.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.0.4...v6.1.0) (2022-10-13)


### Features

* configurable pg connection lifetime and idle timeouts ([#1355](https://github.com/hirosystems/stacks-blockchain-api/issues/1355)) ([46ccf06](https://github.com/hirosystems/stacks-blockchain-api/commit/46ccf0640de0c42e5fd71795521992fdfdc8d293))


### Bug Fixes

* refresh materialized views in their own pg connection ([#1356](https://github.com/hirosystems/stacks-blockchain-api/issues/1356)) ([9433d3c](https://github.com/hirosystems/stacks-blockchain-api/commit/9433d3c9c2d46eeff143a6c04438a94505549f3f))

## [6.0.4](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.0.3...v6.0.4) (2022-10-12)


### Bug Fixes

* handle pg exceptions on web socket transmitter ([#1353](https://github.com/hirosystems/stacks-blockchain-api/issues/1353)) ([2e6448d](https://github.com/hirosystems/stacks-blockchain-api/commit/2e6448d7afc7bb35d5bcd3da88105f0552a13764))

## [6.0.3](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.0.2...v6.0.3) (2022-10-12)


### Bug Fixes

* skip migrations on read-only start ([#1351](https://github.com/hirosystems/stacks-blockchain-api/issues/1351)) ([1d32261](https://github.com/hirosystems/stacks-blockchain-api/commit/1d322614e70e125b924c7d0a8b9f536ca81eb48f))

## [6.0.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.0.1...v6.0.2) (2022-10-12)


### Bug Fixes

* catch pg exceptions on queries outside of express ([#1348](https://github.com/hirosystems/stacks-blockchain-api/issues/1348)) ([1f07b85](https://github.com/hirosystems/stacks-blockchain-api/commit/1f07b8587ccf0206e085d272e6cb5ee62f816fd9))

## [6.0.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.0.0...v6.0.1) (2022-10-06)


### Bug Fixes

* guard against empty lists before querying postgres ([#1345](https://github.com/hirosystems/stacks-blockchain-api/issues/1345)) ([6c88a16](https://github.com/hirosystems/stacks-blockchain-api/commit/6c88a166c8742c869222f7f754838af386e2cd16))

## [6.0.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v5.0.1...v6.0.0) (2022-10-06)


### ⚠ BREAKING CHANGES

* remove deprecated `/nft_events` endpoint (#1329)
* mark breaking change

### Features

* add `transaction_count` for `microblocks_accepted` in block ([#1162](https://github.com/hirosystems/stacks-blockchain-api/issues/1162)) ([78d7d9c](https://github.com/hirosystems/stacks-blockchain-api/commit/78d7d9c9f72db8ce6c59e0ea59a2579aceec014e))
* add API version in response header ([#1216](https://github.com/hirosystems/stacks-blockchain-api/issues/1216)) ([1e998db](https://github.com/hirosystems/stacks-blockchain-api/commit/1e998db7d1c87c064376cb950d05b073d9d3f076))
* add owner index to subdomains table ([#1331](https://github.com/hirosystems/stacks-blockchain-api/issues/1331)) ([a6c5e12](https://github.com/hirosystems/stacks-blockchain-api/commit/a6c5e12faa256633a7c9ae4c7cf8524013d187d6))
* add token_type metadata for rosetta ft operations ([#1332](https://github.com/hirosystems/stacks-blockchain-api/issues/1332)) ([09af27b](https://github.com/hirosystems/stacks-blockchain-api/commit/09af27b24be8e30a840707707b79d65cd45f2351))
* mark breaking change ([669fd0d](https://github.com/hirosystems/stacks-blockchain-api/commit/669fd0d8c00b8ca9224c9b5411a070b32c3b0529))
* mempool stats endpoint and prometheus metrics ([#1241](https://github.com/hirosystems/stacks-blockchain-api/issues/1241)) ([9482238](https://github.com/hirosystems/stacks-blockchain-api/commit/9482238599549fd651c8c87b545c175d8a219521))
* refactor pg classes, switch to postgres.js ([#1148](https://github.com/hirosystems/stacks-blockchain-api/issues/1148)) ([3ff4177](https://github.com/hirosystems/stacks-blockchain-api/commit/3ff41779f844c611fbd95429aeefbdb085a59026)), closes [#1168](https://github.com/hirosystems/stacks-blockchain-api/issues/1168)
* send nft updates through websocket channels ([#1218](https://github.com/hirosystems/stacks-blockchain-api/issues/1218)) ([920a7b8](https://github.com/hirosystems/stacks-blockchain-api/commit/920a7b892a39f0f1e76363211573d935ae2c75da))


### Bug Fixes

* consolidate db migrations ([#1314](https://github.com/hirosystems/stacks-blockchain-api/issues/1314)) ([d6bdf9f](https://github.com/hirosystems/stacks-blockchain-api/commit/d6bdf9faff905d5e208e61b04c34321e954a2fb1))
* event_observer_requests json writes ([#1334](https://github.com/hirosystems/stacks-blockchain-api/issues/1334)) ([465aa0b](https://github.com/hirosystems/stacks-blockchain-api/commit/465aa0b42ca3dda57d06f6c0756b03d591e7f027))
* included query params in redirecting to prefix 0x in tx endpoint ([#1205](https://github.com/hirosystems/stacks-blockchain-api/issues/1205)) ([664cce7](https://github.com/hirosystems/stacks-blockchain-api/commit/664cce744d1aecc0b3226ae07ac81e5d0cd13871))
* incorrect websocket/socket.io transaction updates ([#1197](https://github.com/hirosystems/stacks-blockchain-api/issues/1197)) ([8ee1da8](https://github.com/hirosystems/stacks-blockchain-api/commit/8ee1da840bfa3fcecac79e09e375b720cd0ccc04))
* mobx breakage by locking package dependencies ([#1206](https://github.com/hirosystems/stacks-blockchain-api/issues/1206)) ([5f8bc9f](https://github.com/hirosystems/stacks-blockchain-api/commit/5f8bc9fd4f45877eedbfbce29c7feb5905ba8836))
* optimize `getMicroblocks` query ([#1179](https://github.com/hirosystems/stacks-blockchain-api/issues/1179)) ([7691109](https://github.com/hirosystems/stacks-blockchain-api/commit/769110926eb7b7c9a4d2754af8ce6f1213e2c56f))
* optimize block endpoint ([#1190](https://github.com/hirosystems/stacks-blockchain-api/issues/1190)) ([943e2d1](https://github.com/hirosystems/stacks-blockchain-api/commit/943e2d1c555473f7f0fb61959ed89185e89ed062))
* refresh materialized views concurrently in new pg format ([#1324](https://github.com/hirosystems/stacks-blockchain-api/issues/1324)) ([20b284f](https://github.com/hirosystems/stacks-blockchain-api/commit/20b284fa381041fb842bf61d8a184be6ea84810f))
* remove duplicate txs in microblock responses ([#1167](https://github.com/hirosystems/stacks-blockchain-api/issues/1167)) ([15c0c11](https://github.com/hirosystems/stacks-blockchain-api/commit/15c0c1124a2c91756389274c8a6ebfa8aa44228b))
* remove live tsv append ([#1315](https://github.com/hirosystems/stacks-blockchain-api/issues/1315)) ([e2a1247](https://github.com/hirosystems/stacks-blockchain-api/commit/e2a124710f955d9d32ff5a928af7da08823689d4))
* retry pg connection on new library code ([#1326](https://github.com/hirosystems/stacks-blockchain-api/issues/1326)) ([35db939](https://github.com/hirosystems/stacks-blockchain-api/commit/35db939199a2d826e7ee4dbe31af48cc42364ea2))
* support multiple BNS name events in the same transaction ([#1337](https://github.com/hirosystems/stacks-blockchain-api/issues/1337)) ([1edb256](https://github.com/hirosystems/stacks-blockchain-api/commit/1edb25697df689dbf1da5d412f5d40e4aac024f3))
* tests ([1c1fd16](https://github.com/hirosystems/stacks-blockchain-api/commit/1c1fd1619c8ea97c2636082203fb678f06493786))
* upgrade stacks node versions to 2.05.0.3.0 ([#1328](https://github.com/hirosystems/stacks-blockchain-api/issues/1328)) ([e30636e](https://github.com/hirosystems/stacks-blockchain-api/commit/e30636e30f716a7335792914a142fa54f423dc9a))
* upsert nft and ft metadata ([#1193](https://github.com/hirosystems/stacks-blockchain-api/issues/1193)) ([c4eec5d](https://github.com/hirosystems/stacks-blockchain-api/commit/c4eec5d060666b660c48d326e74b4f989b9ee21d))


### Reverts

* Revert "chore!: remove deprecated `/nft_events` endpoint (#1329)" (#1343) ([c537ee4](https://github.com/hirosystems/stacks-blockchain-api/commit/c537ee4c6f333c0a43c9e9e1ca1e073f03c58fc5)), closes [#1329](https://github.com/hirosystems/stacks-blockchain-api/issues/1329) [#1343](https://github.com/hirosystems/stacks-blockchain-api/issues/1343)


### Miscellaneous Chores

* remove deprecated `/nft_events` endpoint ([#1329](https://github.com/hirosystems/stacks-blockchain-api/issues/1329)) ([65bb4e5](https://github.com/hirosystems/stacks-blockchain-api/commit/65bb4e55fabf21a70183d2b16c8bc1f6f742d04e))

## [6.0.0-beta.10](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.0.0-beta.9...v6.0.0-beta.10) (2022-10-06)


### Reverts

* Revert "chore!: remove deprecated `/nft_events` endpoint (#1329)" (#1343) ([c537ee4](https://github.com/hirosystems/stacks-blockchain-api/commit/c537ee4c6f333c0a43c9e9e1ca1e073f03c58fc5)), closes [#1329](https://github.com/hirosystems/stacks-blockchain-api/issues/1329) [#1343](https://github.com/hirosystems/stacks-blockchain-api/issues/1343)

## [6.0.0-beta.9](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.0.0-beta.8...v6.0.0-beta.9) (2022-09-30)


### Bug Fixes

* support multiple BNS name events in the same transaction ([#1337](https://github.com/hirosystems/stacks-blockchain-api/issues/1337)) ([1edb256](https://github.com/hirosystems/stacks-blockchain-api/commit/1edb25697df689dbf1da5d412f5d40e4aac024f3))

## [6.0.0-beta.8](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.0.0-beta.7...v6.0.0-beta.8) (2022-09-29)


### Bug Fixes

* add owner index on subdomains table ([#1323](https://github.com/hirosystems/stacks-blockchain-api/issues/1323)) ([c9c6d05](https://github.com/hirosystems/stacks-blockchain-api/commit/c9c6d053fd8896187a26a788aaaa56fb48285e61))

## [6.0.0-beta.7](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.0.0-beta.6...v6.0.0-beta.7) (2022-09-28)


### ⚠ BREAKING CHANGES

* remove deprecated `/nft_events` endpoint (#1329)

### Bug Fixes

* event_observer_requests json writes ([#1334](https://github.com/hirosystems/stacks-blockchain-api/issues/1334)) ([465aa0b](https://github.com/hirosystems/stacks-blockchain-api/commit/465aa0b42ca3dda57d06f6c0756b03d591e7f027))


### Miscellaneous Chores

* remove deprecated `/nft_events` endpoint ([#1329](https://github.com/hirosystems/stacks-blockchain-api/issues/1329)) ([65bb4e5](https://github.com/hirosystems/stacks-blockchain-api/commit/65bb4e55fabf21a70183d2b16c8bc1f6f742d04e))

## [6.0.0-beta.6](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.0.0-beta.5...v6.0.0-beta.6) (2022-09-23)


### Features

* add token_type metadata for rosetta ft operations ([#1332](https://github.com/hirosystems/stacks-blockchain-api/issues/1332)) ([09af27b](https://github.com/hirosystems/stacks-blockchain-api/commit/09af27b24be8e30a840707707b79d65cd45f2351))

## [6.0.0-beta.5](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.0.0-beta.4...v6.0.0-beta.5) (2022-09-22)


### Features

* add owner index to subdomains table ([#1331](https://github.com/hirosystems/stacks-blockchain-api/issues/1331)) ([a6c5e12](https://github.com/hirosystems/stacks-blockchain-api/commit/a6c5e12faa256633a7c9ae4c7cf8524013d187d6))

## [6.0.0-beta.4](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.0.0-beta.3...v6.0.0-beta.4) (2022-09-22)


### Bug Fixes

* upgrade stacks node versions to 2.05.0.3.0 ([#1328](https://github.com/hirosystems/stacks-blockchain-api/issues/1328)) ([e30636e](https://github.com/hirosystems/stacks-blockchain-api/commit/e30636e30f716a7335792914a142fa54f423dc9a))

## [6.0.0-beta.3](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.0.0-beta.2...v6.0.0-beta.3) (2022-09-21)


### Bug Fixes

* refresh materialized views concurrently in new pg format ([#1324](https://github.com/hirosystems/stacks-blockchain-api/issues/1324)) ([20b284f](https://github.com/hirosystems/stacks-blockchain-api/commit/20b284fa381041fb842bf61d8a184be6ea84810f))
* retry pg connection on new library code ([#1326](https://github.com/hirosystems/stacks-blockchain-api/issues/1326)) ([35db939](https://github.com/hirosystems/stacks-blockchain-api/commit/35db939199a2d826e7ee4dbe31af48cc42364ea2))

## [6.0.0-beta.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v6.0.0-beta.1...v6.0.0-beta.2) (2022-09-13)


### Bug Fixes

* remove live tsv append ([#1315](https://github.com/hirosystems/stacks-blockchain-api/issues/1315)) ([e2a1247](https://github.com/hirosystems/stacks-blockchain-api/commit/e2a124710f955d9d32ff5a928af7da08823689d4))

## [6.0.0-beta.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v5.0.0...v6.0.0-beta.1) (2022-09-13)


### ⚠ BREAKING CHANGES

* mark breaking change

### Features

* add `transaction_count` for `microblocks_accepted` in block ([#1162](https://github.com/hirosystems/stacks-blockchain-api/issues/1162)) ([78d7d9c](https://github.com/hirosystems/stacks-blockchain-api/commit/78d7d9c9f72db8ce6c59e0ea59a2579aceec014e))
* add API version in response header ([#1216](https://github.com/hirosystems/stacks-blockchain-api/issues/1216)) ([1e998db](https://github.com/hirosystems/stacks-blockchain-api/commit/1e998db7d1c87c064376cb950d05b073d9d3f076))
* mark breaking change ([669fd0d](https://github.com/hirosystems/stacks-blockchain-api/commit/669fd0d8c00b8ca9224c9b5411a070b32c3b0529))
* mempool stats endpoint and prometheus metrics ([#1241](https://github.com/hirosystems/stacks-blockchain-api/issues/1241)) ([9482238](https://github.com/hirosystems/stacks-blockchain-api/commit/9482238599549fd651c8c87b545c175d8a219521))
* refactor pg classes, switch to postgres.js ([#1148](https://github.com/hirosystems/stacks-blockchain-api/issues/1148)) ([3ff4177](https://github.com/hirosystems/stacks-blockchain-api/commit/3ff41779f844c611fbd95429aeefbdb085a59026)), closes [#1168](https://github.com/hirosystems/stacks-blockchain-api/issues/1168)
* send nft updates through websocket channels ([#1218](https://github.com/hirosystems/stacks-blockchain-api/issues/1218)) ([920a7b8](https://github.com/hirosystems/stacks-blockchain-api/commit/920a7b892a39f0f1e76363211573d935ae2c75da))

### Bug Fixes

* consolidate db migrations ([#1314](https://github.com/hirosystems/stacks-blockchain-api/issues/1314)) ([d6bdf9f](https://github.com/hirosystems/stacks-blockchain-api/commit/d6bdf9faff905d5e208e61b04c34321e954a2fb1))
* included query params in redirecting to prefix 0x in tx endpoint ([#1205](https://github.com/hirosystems/stacks-blockchain-api/issues/1205)) ([664cce7](https://github.com/hirosystems/stacks-blockchain-api/commit/664cce744d1aecc0b3226ae07ac81e5d0cd13871))
* incorrect websocket/socket.io transaction updates ([#1197](https://github.com/hirosystems/stacks-blockchain-api/issues/1197)) ([8ee1da8](https://github.com/hirosystems/stacks-blockchain-api/commit/8ee1da840bfa3fcecac79e09e375b720cd0ccc04))
* mobx breakage by locking package dependencies ([#1206](https://github.com/hirosystems/stacks-blockchain-api/issues/1206)) ([5f8bc9f](https://github.com/hirosystems/stacks-blockchain-api/commit/5f8bc9fd4f45877eedbfbce29c7feb5905ba8836))
* optimize `getMicroblocks` query ([#1179](https://github.com/hirosystems/stacks-blockchain-api/issues/1179)) ([7691109](https://github.com/hirosystems/stacks-blockchain-api/commit/769110926eb7b7c9a4d2754af8ce6f1213e2c56f))
* optimize block endpoint ([#1190](https://github.com/hirosystems/stacks-blockchain-api/issues/1190)) ([943e2d1](https://github.com/hirosystems/stacks-blockchain-api/commit/943e2d1c555473f7f0fb61959ed89185e89ed062))
* remove duplicate txs in microblock responses ([#1167](https://github.com/hirosystems/stacks-blockchain-api/issues/1167)) ([15c0c11](https://github.com/hirosystems/stacks-blockchain-api/commit/15c0c1124a2c91756389274c8a6ebfa8aa44228b))
* tests ([1c1fd16](https://github.com/hirosystems/stacks-blockchain-api/commit/1c1fd1619c8ea97c2636082203fb678f06493786))
* upsert nft and ft metadata ([#1193](https://github.com/hirosystems/stacks-blockchain-api/issues/1193)) ([c4eec5d](https://github.com/hirosystems/stacks-blockchain-api/commit/c4eec5d060666b660c48d326e74b4f989b9ee21d))

## [5.0.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v5.0.0...v5.0.1) (2022-09-20)


* add owner index on subdomains table ([#1323](https://github.com/hirosystems/stacks-blockchain-api/issues/1323)) ([c9c6d05](https://github.com/hirosystems/stacks-blockchain-api/commit/c9c6d053fd8896187a26a788aaaa56fb48285e61))

## [5.0.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v4.1.2...v5.0.0) (2022-09-07)


### ⚠ BREAKING CHANGES

* optimize tables and improve canonical treatment of BNS data (#1287)

### Features

* add indexes for index_block_hash on BNS tables ([#1304](https://github.com/hirosystems/stacks-blockchain-api/issues/1304)) ([bbf4b2d](https://github.com/hirosystems/stacks-blockchain-api/commit/bbf4b2d2b8c7f6ed30bfda6eaa430d5c2e84cdf5))
* optimize tables and improve canonical treatment of BNS data ([#1287](https://github.com/hirosystems/stacks-blockchain-api/issues/1287)) ([1f64818](https://github.com/hirosystems/stacks-blockchain-api/commit/1f648187b8c701e802a06bac52b077fd10571ff7))


### Bug Fixes

* add postgres connection error checking for ECONNRESET code ([03a1896](https://github.com/hirosystems/stacks-blockchain-api/commit/03a1896cff8937a5f39a8b75e5adf51a6344592c))
* bump version ([3863cce](https://github.com/hirosystems/stacks-blockchain-api/commit/3863cce1a64cf7a4c6cffd4f888c049cfd3ada65))
* detect name transfers and renewals in special circumstances ([#1303](https://github.com/hirosystems/stacks-blockchain-api/issues/1303)) ([cd381a9](https://github.com/hirosystems/stacks-blockchain-api/commit/cd381a95b4d0d3f4bb08e447500153c3f652eff6))
* filter BNS processing for successful txs only ([#1309](https://github.com/hirosystems/stacks-blockchain-api/issues/1309)) ([6a12936](https://github.com/hirosystems/stacks-blockchain-api/commit/6a129369c6d9fcdc79b5a7ad288d37784cbe77cc))
* import BNS v1 data during event replay ([#1301](https://github.com/hirosystems/stacks-blockchain-api/issues/1301)) ([bc59817](https://github.com/hirosystems/stacks-blockchain-api/commit/bc59817aa98dd3a978a27b73d14738b64eb823f9))

## [5.0.0-beta.7](https://github.com/hirosystems/stacks-blockchain-api/compare/v5.0.0-beta.6...v5.0.0-beta.7) (2022-09-07)


### Bug Fixes

* filter BNS processing for successful txs only ([#1309](https://github.com/hirosystems/stacks-blockchain-api/issues/1309)) ([6a12936](https://github.com/hirosystems/stacks-blockchain-api/commit/6a129369c6d9fcdc79b5a7ad288d37784cbe77cc))

## [5.0.0-beta.6](https://github.com/hirosystems/stacks-blockchain-api/compare/v5.0.0-beta.5...v5.0.0-beta.6) (2022-09-01)


### Features

* add indexes for index_block_hash on BNS tables ([#1304](https://github.com/hirosystems/stacks-blockchain-api/issues/1304)) ([bbf4b2d](https://github.com/hirosystems/stacks-blockchain-api/commit/bbf4b2d2b8c7f6ed30bfda6eaa430d5c2e84cdf5))

## [5.0.0-beta.5](https://github.com/hirosystems/stacks-blockchain-api/compare/v5.0.0-beta.4...v5.0.0-beta.5) (2022-08-31)


### Bug Fixes

* detect name transfers and renewals in special circumstances ([#1303](https://github.com/hirosystems/stacks-blockchain-api/issues/1303)) ([cd381a9](https://github.com/hirosystems/stacks-blockchain-api/commit/cd381a95b4d0d3f4bb08e447500153c3f652eff6))

## [5.0.0-beta.4](https://github.com/hirosystems/stacks-blockchain-api/compare/v5.0.0-beta.3...v5.0.0-beta.4) (2022-08-31)


### Bug Fixes

* add postgres connection error checking for ECONNRESET code ([03a1896](https://github.com/hirosystems/stacks-blockchain-api/commit/03a1896cff8937a5f39a8b75e5adf51a6344592c))

## [5.0.0-beta.3](https://github.com/hirosystems/stacks-blockchain-api/compare/v5.0.0-beta.2...v5.0.0-beta.3) (2022-08-31)


### Bug Fixes

* import BNS v1 data during event replay ([#1301](https://github.com/hirosystems/stacks-blockchain-api/issues/1301)) ([bc59817](https://github.com/hirosystems/stacks-blockchain-api/commit/bc59817aa98dd3a978a27b73d14738b64eb823f9))

## [5.0.0-beta.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v5.0.0-beta.1...v5.0.0-beta.2) (2022-08-26)


### Bug Fixes

* bump version ([3863cce](https://github.com/hirosystems/stacks-blockchain-api/commit/3863cce1a64cf7a4c6cffd4f888c049cfd3ada65))

## [5.0.0-beta.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v4.1.2...v5.0.0-beta.1) (2022-08-26)


### ⚠ BREAKING CHANGES

* optimize tables and improve canonical treatment of BNS data (#1287)

### Features

* optimize tables and improve canonical treatment of BNS data ([#1287](https://github.com/hirosystems/stacks-blockchain-api/issues/1287)) ([1f64818](https://github.com/hirosystems/stacks-blockchain-api/commit/1f648187b8c701e802a06bac52b077fd10571ff7))

## [4.1.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v4.1.1...v4.1.2) (2022-08-18)


### Bug Fixes

* refresh materialized views concurrently ([#1270](https://github.com/hirosystems/stacks-blockchain-api/issues/1270)) ([057c541](https://github.com/hirosystems/stacks-blockchain-api/commit/057c541b8c31402b6ff823cce0e3ed435ebe74a8))

## [4.1.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v4.1.0...v4.1.1) (2022-08-03)


### Bug Fixes

* include `index_block_hash` in `/block` ([#1253](https://github.com/hirosystems/stacks-blockchain-api/issues/1253)) ([8cd7606](https://github.com/hirosystems/stacks-blockchain-api/commit/8cd7606797bf1b744441d68b3db834fd11c25bfa))

# [4.1.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v4.0.4...v4.1.0) (2022-07-07)


### Features

* add cache control to `/extended/v1/tx/:tx_id` ([#1229](https://github.com/hirosystems/stacks-blockchain-api/issues/1229)) ([8d5ca2c](https://github.com/hirosystems/stacks-blockchain-api/commit/8d5ca2cce558f7f849fe3837930f66943c0738a7))

## [4.0.4](https://github.com/hirosystems/stacks-blockchain-api/compare/v4.0.3...v4.0.4) (2022-06-23)


### Bug Fixes

* arm64-alpine image, bump stacks-encoding-native-js [#1217](https://github.com/hirosystems/stacks-blockchain-api/issues/1217) ([#1220](https://github.com/hirosystems/stacks-blockchain-api/issues/1220)) ([d49f007](https://github.com/hirosystems/stacks-blockchain-api/commit/d49f007b6e099cf9bc2ba0a98798e9c431af09c7))

## [4.0.3](https://github.com/hirosystems/stacks-blockchain-api/compare/v4.0.2...v4.0.3) (2022-06-21)


### Bug Fixes

* add value indices on nft_custody views ([#1207](https://github.com/hirosystems/stacks-blockchain-api/issues/1207)) ([aac13c6](https://github.com/hirosystems/stacks-blockchain-api/commit/aac13c613044ae053e63d39a12a0e320e0104c86))

## [4.0.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v4.0.1...v4.0.2) (2022-06-21)


### Bug Fixes

* mobx build dependencies ([#1215](https://github.com/hirosystems/stacks-blockchain-api/issues/1215)) ([6e1eceb](https://github.com/hirosystems/stacks-blockchain-api/commit/6e1eceb843d28699d9d825212cf89d12cf37413f))

## [4.0.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v4.0.0...v4.0.1) (2022-06-01)


### Bug Fixes

* contract-call txs returning null args in some situations, closes [#1188](https://github.com/hirosystems/stacks-blockchain-api/issues/1188) ([#1192](https://github.com/hirosystems/stacks-blockchain-api/issues/1192)) ([9b77ca2](https://github.com/hirosystems/stacks-blockchain-api/commit/9b77ca22fcaa814ef0266ce3ab4efd32d5ae2da7))

# [4.0.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v3.0.3...v4.0.0) (2022-05-26)


### Bug Fixes

* `/v1/names/[:name]` name resolution ([#1159](https://github.com/hirosystems/stacks-blockchain-api/issues/1159)) ([e656520](https://github.com/hirosystems/stacks-blockchain-api/commit/e656520701bea584fe7336c1a26388406cd167fe))
* bns download script download path ([#1091](https://github.com/hirosystems/stacks-blockchain-api/issues/1091)) ([55fa41e](https://github.com/hirosystems/stacks-blockchain-api/commit/55fa41eb31fcc1869a4c16de36ad4f01be9565a9))
* disable notifier for tests that don't need it ([#1102](https://github.com/hirosystems/stacks-blockchain-api/issues/1102)) ([9765cf0](https://github.com/hirosystems/stacks-blockchain-api/commit/9765cf06819767cae88eab6c106bc1d0bd87e47e))
* propagate chain id correctly to bns router ([#1180](https://github.com/hirosystems/stacks-blockchain-api/issues/1180)) ([3a0ead1](https://github.com/hirosystems/stacks-blockchain-api/commit/3a0ead18fd3d65ec8221feada334477ebb576805))
* resolve bns names correctly in `/v1/addresses/stacks/[:address]` ([#1175](https://github.com/hirosystems/stacks-blockchain-api/issues/1175)) ([8797ded](https://github.com/hirosystems/stacks-blockchain-api/commit/8797ded691acab322c6c671403ea60bf1bc27294))
* shorten token metadata pg notifications ([#1143](https://github.com/hirosystems/stacks-blockchain-api/issues/1143)) ([1f09c0e](https://github.com/hirosystems/stacks-blockchain-api/commit/1f09c0e2bffb42a680e899848980b13a6652d51f))
* treat incorrect `get-token-uri` none values as undefined ([#1183](https://github.com/hirosystems/stacks-blockchain-api/issues/1183)) ([33313b1](https://github.com/hirosystems/stacks-blockchain-api/commit/33313b1d78e75a1900de9162cd97a76ff0a64ee0))
* use 128 max size when deserializing contract principals [#1181](https://github.com/hirosystems/stacks-blockchain-api/issues/1181) ([#1182](https://github.com/hirosystems/stacks-blockchain-api/issues/1182)) ([f4d4733](https://github.com/hirosystems/stacks-blockchain-api/commit/f4d4733ad4956c6acc36f73337cc55b6aae5c5fb))


* feat!: prune garbage collected (256 blocks old) mempool txs (#1101) ([fe56756](https://github.com/hirosystems/stacks-blockchain-api/commit/fe56756cdeb3c71dbd2ebbbf820bc2a56fc35f02)), closes [#1101](https://github.com/hirosystems/stacks-blockchain-api/issues/1101)


### Features

* [CPU optimizations] use native rust module for decoding Clarity values, binary transaction blobs, post-condition binary blobs, Stacks addresses ([#1094](https://github.com/hirosystems/stacks-blockchain-api/issues/1094)) ([f5c4da7](https://github.com/hirosystems/stacks-blockchain-api/commit/f5c4da7b87e7eacecc6cd5d7075ecd0a39127ea0))
* add `pruned` event import mode that ignores some historical events ([#1125](https://github.com/hirosystems/stacks-blockchain-api/issues/1125)) ([da992d7](https://github.com/hirosystems/stacks-blockchain-api/commit/da992d77b18bd49eef36e32b1d96d7e924d84cfc))
* add block height to responses in `/extended/v1/tokens/nft/holdings` ([#1151](https://github.com/hirosystems/stacks-blockchain-api/issues/1151)) ([7cc8bd0](https://github.com/hirosystems/stacks-blockchain-api/commit/7cc8bd06339a9bf53ef5d133ef4885b26e48cd18))
* add strict ft/nft metadata processing mode for better error handling ([#1165](https://github.com/hirosystems/stacks-blockchain-api/issues/1165)) ([b9ca4bb](https://github.com/hirosystems/stacks-blockchain-api/commit/b9ca4bb69d7f78c634c076855652937e0e1743f1))
* events-only endpoint for address and tx_id ([#1027](https://github.com/hirosystems/stacks-blockchain-api/issues/1027)) ([508afc7](https://github.com/hirosystems/stacks-blockchain-api/commit/508afc7b09641b79d5c8136b70088fc471f94433))
* fetch subdomain list for bns name ([#1132](https://github.com/hirosystems/stacks-blockchain-api/issues/1132)) ([e34120f](https://github.com/hirosystems/stacks-blockchain-api/commit/e34120f70bcad5c6474f7631cad31fb04b9dfdfa))
* pin exact dependencies in package.json ([#1068](https://github.com/hirosystems/stacks-blockchain-api/issues/1068)) ([303eaaa](https://github.com/hirosystems/stacks-blockchain-api/commit/303eaaa8cd520cf8db89a4ef359ca739a945cbbc))


### BREAKING CHANGES

* use event-replay to upgrade, this version includes breaking changes to the db sql schema

# [4.0.0-beta.8](https://github.com/hirosystems/stacks-blockchain-api/compare/v4.0.0-beta.7...v4.0.0-beta.8) (2022-05-26)


### Bug Fixes

* treat incorrect `get-token-uri` none values as undefined ([#1183](https://github.com/hirosystems/stacks-blockchain-api/issues/1183)) ([33313b1](https://github.com/hirosystems/stacks-blockchain-api/commit/33313b1d78e75a1900de9162cd97a76ff0a64ee0))

# [4.0.0-beta.7](https://github.com/hirosystems/stacks-blockchain-api/compare/v4.0.0-beta.6...v4.0.0-beta.7) (2022-05-25)


### Bug Fixes

* use 128 max size when deserializing contract principals [#1181](https://github.com/hirosystems/stacks-blockchain-api/issues/1181) ([#1182](https://github.com/hirosystems/stacks-blockchain-api/issues/1182)) ([f4d4733](https://github.com/hirosystems/stacks-blockchain-api/commit/f4d4733ad4956c6acc36f73337cc55b6aae5c5fb))

# [4.0.0-beta.6](https://github.com/hirosystems/stacks-blockchain-api/compare/v4.0.0-beta.5...v4.0.0-beta.6) (2022-05-20)


### Bug Fixes

* propagate chain id correctly to bns router ([#1180](https://github.com/hirosystems/stacks-blockchain-api/issues/1180)) ([3a0ead1](https://github.com/hirosystems/stacks-blockchain-api/commit/3a0ead18fd3d65ec8221feada334477ebb576805))

# [4.0.0-beta.5](https://github.com/hirosystems/stacks-blockchain-api/compare/v4.0.0-beta.4...v4.0.0-beta.5) (2022-05-17)


### Features

* add strict ft/nft metadata processing mode for better error handling ([#1165](https://github.com/hirosystems/stacks-blockchain-api/issues/1165)) ([b9ca4bb](https://github.com/hirosystems/stacks-blockchain-api/commit/b9ca4bb69d7f78c634c076855652937e0e1743f1))

# [4.0.0-beta.4](https://github.com/hirosystems/stacks-blockchain-api/compare/v4.0.0-beta.3...v4.0.0-beta.4) (2022-05-17)


### Bug Fixes

* resolve bns names correctly in `/v1/addresses/stacks/[:address]` ([#1175](https://github.com/hirosystems/stacks-blockchain-api/issues/1175)) ([8797ded](https://github.com/hirosystems/stacks-blockchain-api/commit/8797ded691acab322c6c671403ea60bf1bc27294))

# [4.0.0-beta.3](https://github.com/hirosystems/stacks-blockchain-api/compare/v4.0.0-beta.2...v4.0.0-beta.3) (2022-05-11)


### Features

* add block height to responses in `/extended/v1/tokens/nft/holdings` ([#1151](https://github.com/hirosystems/stacks-blockchain-api/issues/1151)) ([7cc8bd0](https://github.com/hirosystems/stacks-blockchain-api/commit/7cc8bd06339a9bf53ef5d133ef4885b26e48cd18))

# [4.0.0-beta.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v4.0.0-beta.1...v4.0.0-beta.2) (2022-05-04)


### Bug Fixes

* `/v1/names/[:name]` name resolution ([#1159](https://github.com/hirosystems/stacks-blockchain-api/issues/1159)) ([e656520](https://github.com/hirosystems/stacks-blockchain-api/commit/e656520701bea584fe7336c1a26388406cd167fe))

# [4.0.0-beta.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v3.0.3...v4.0.0-beta.1) (2022-04-20)


### Bug Fixes

* bns download script download path ([#1091](https://github.com/hirosystems/stacks-blockchain-api/issues/1091)) ([55fa41e](https://github.com/hirosystems/stacks-blockchain-api/commit/55fa41eb31fcc1869a4c16de36ad4f01be9565a9))
* disable notifier for tests that don't need it ([#1102](https://github.com/hirosystems/stacks-blockchain-api/issues/1102)) ([9765cf0](https://github.com/hirosystems/stacks-blockchain-api/commit/9765cf06819767cae88eab6c106bc1d0bd87e47e))
* shorten token metadata pg notifications ([#1143](https://github.com/hirosystems/stacks-blockchain-api/issues/1143)) ([1f09c0e](https://github.com/hirosystems/stacks-blockchain-api/commit/1f09c0e2bffb42a680e899848980b13a6652d51f))


* feat!: prune garbage collected (256 blocks old) mempool txs (#1101) ([fe56756](https://github.com/hirosystems/stacks-blockchain-api/commit/fe56756cdeb3c71dbd2ebbbf820bc2a56fc35f02)), closes [#1101](https://github.com/hirosystems/stacks-blockchain-api/issues/1101)


### Features

* [CPU optimizations] use native rust module for decoding Clarity values, binary transaction blobs, post-condition binary blobs, Stacks addresses ([#1094](https://github.com/hirosystems/stacks-blockchain-api/issues/1094)) ([f5c4da7](https://github.com/hirosystems/stacks-blockchain-api/commit/f5c4da7b87e7eacecc6cd5d7075ecd0a39127ea0))
* add `pruned` event import mode that ignores some historical events ([#1125](https://github.com/hirosystems/stacks-blockchain-api/issues/1125)) ([da992d7](https://github.com/hirosystems/stacks-blockchain-api/commit/da992d77b18bd49eef36e32b1d96d7e924d84cfc))
* events-only endpoint for address and tx_id ([#1027](https://github.com/hirosystems/stacks-blockchain-api/issues/1027)) ([508afc7](https://github.com/hirosystems/stacks-blockchain-api/commit/508afc7b09641b79d5c8136b70088fc471f94433))
* fetch subdomain list for bns name ([#1132](https://github.com/hirosystems/stacks-blockchain-api/issues/1132)) ([e34120f](https://github.com/hirosystems/stacks-blockchain-api/commit/e34120f70bcad5c6474f7631cad31fb04b9dfdfa))
* pin exact dependencies in package.json ([#1068](https://github.com/hirosystems/stacks-blockchain-api/issues/1068)) ([303eaaa](https://github.com/hirosystems/stacks-blockchain-api/commit/303eaaa8cd520cf8db89a4ef359ca739a945cbbc))


### BREAKING CHANGES

* use event-replay to upgrade, this version includes breaking changes to the db sql schema

## [3.0.3](https://github.com/hirosystems/stacks-blockchain-api/compare/v3.0.2...v3.0.3) (2022-04-04)


### Bug Fixes

* addr txs count ([6a8f237](https://github.com/hirosystems/stacks-blockchain-api/commit/6a8f237b93575f9b4da5d9e21802f83c59744ac7))
* adjust pagination tests for new bug ([bf83110](https://github.com/hirosystems/stacks-blockchain-api/commit/bf8311038d0690378265fdf8d76b1419f969c6f0))
* missing txs from address/transactions endpoint [#1119](https://github.com/hirosystems/stacks-blockchain-api/issues/1119) [#1098](https://github.com/hirosystems/stacks-blockchain-api/issues/1098) ([72de7d3](https://github.com/hirosystems/stacks-blockchain-api/commit/72de7d3cbecbe8feff1397481dedf392b8388952))
* pagination bug ([b22cc04](https://github.com/hirosystems/stacks-blockchain-api/commit/b22cc042cfcd5c5634ac8899fa9d29ef9ef7d989))
* prefer a higher principal_tx count bug ([e14fe2c](https://github.com/hirosystems/stacks-blockchain-api/commit/e14fe2cd3ba99cd20a56e278233e70c971c8c93b))

## [3.0.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v3.0.1...v3.0.2) (2022-03-23)


### Bug Fixes

* filter canonical txs correctly for account tx history ([#1120](https://github.com/hirosystems/stacks-blockchain-api/issues/1120)) ([eabe27b](https://github.com/hirosystems/stacks-blockchain-api/commit/eabe27b4ac5e94a844805c2fee144b8c3df0fce4))

## [3.0.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v3.0.0...v3.0.1) (2022-03-08)


### Bug Fixes

* send address tx updates correctly on microblocks ([#1089](https://github.com/hirosystems/stacks-blockchain-api/issues/1089)) ([dbd5a49](https://github.com/hirosystems/stacks-blockchain-api/commit/dbd5a49c6e3dab06cb080c8c2de7dcc07aeb6805))

# [3.0.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v2.1.1...v3.0.0) (2022-03-03)


### Bug Fixes

* capture re-organized txs correctly in `/extended/v1/:address/transactions` ([#1074](https://github.com/hirosystems/stacks-blockchain-api/issues/1074)) ([81d039d](https://github.com/hirosystems/stacks-blockchain-api/commit/81d039d72219c51d517d27e69cedfc0cc8e10c7e))
* deactivate indices before subdomain import ([#1086](https://github.com/hirosystems/stacks-blockchain-api/issues/1086)) ([d8d4d4c](https://github.com/hirosystems/stacks-blockchain-api/commit/d8d4d4c35e0fd197668b0b6c56700f437290c734))
* index principal_stx_txs tx_id to speed up reorg updates ([#1080](https://github.com/hirosystems/stacks-blockchain-api/issues/1080)) ([f6d7d0c](https://github.com/hirosystems/stacks-blockchain-api/commit/f6d7d0cbf6b0bfd5a2cf0406570ed1c5d99e9220))
* principal_stx_txs sorting ([#1056](https://github.com/hirosystems/stacks-blockchain-api/issues/1056)) ([b0a0e94](https://github.com/hirosystems/stacks-blockchain-api/commit/b0a0e94ecd40bab5ea7d3c7705198ac9ea0ab399))
* remove unused indices, add others for re-org queries ([#1087](https://github.com/hirosystems/stacks-blockchain-api/issues/1087)) ([2a2fb8d](https://github.com/hirosystems/stacks-blockchain-api/commit/2a2fb8d415e1910cb4e7ae721c28c0f711a11601))
* sort NFT events by event_index too ([#1063](https://github.com/hirosystems/stacks-blockchain-api/issues/1063)) ([77b2587](https://github.com/hirosystems/stacks-blockchain-api/commit/77b25878f652393a6066dad5c6b39569eb8a194a))


* chore!: major version bump for breaking db schema changes ([296c619](https://github.com/hirosystems/stacks-blockchain-api/commit/296c619f81c480db9246ab8ea0b9fbf3c7b982b1))


### Features

* add `chain_tip` materialized view to track chain tip stats ([#1028](https://github.com/hirosystems/stacks-blockchain-api/issues/1028)) ([803ac18](https://github.com/hirosystems/stacks-blockchain-api/commit/803ac189c25b6a31ae94063a6f1a4ede1f0dba98))
* add chain tip info to `/extended/v1/status` ([#1070](https://github.com/hirosystems/stacks-blockchain-api/issues/1070)) ([fb573b1](https://github.com/hirosystems/stacks-blockchain-api/commit/fb573b11e4b8768d87e6b9c557fec92945fadd9a))
* added feature for rendering docs ([#991](https://github.com/hirosystems/stacks-blockchain-api/issues/991)) ([a521a39](https://github.com/hirosystems/stacks-blockchain-api/commit/a521a390b2d973851f94a8962ec2b70a5937c6a7))
* change string and hex column indices to Hash method ([#1042](https://github.com/hirosystems/stacks-blockchain-api/issues/1042)) ([aae6cc0](https://github.com/hirosystems/stacks-blockchain-api/commit/aae6cc0c643a5c6056e596768080119e2c84bb21))


### BREAKING CHANGES

* use event-replay to upgrade, this version includes breaking changes to the db sql schema

# [3.0.0-beta.3](https://github.com/hirosystems/stacks-blockchain-api/compare/v3.0.0-beta.2...v3.0.0-beta.3) (2022-02-28)


### Bug Fixes

* remove unused indices, add others for re-org queries ([#1087](https://github.com/hirosystems/stacks-blockchain-api/issues/1087)) ([2a2fb8d](https://github.com/hirosystems/stacks-blockchain-api/commit/2a2fb8d415e1910cb4e7ae721c28c0f711a11601))

# [3.0.0-beta.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v3.0.0-beta.1...v3.0.0-beta.2) (2022-02-28)


### Bug Fixes

* deactivate indices before subdomain import ([#1086](https://github.com/hirosystems/stacks-blockchain-api/issues/1086)) ([d8d4d4c](https://github.com/hirosystems/stacks-blockchain-api/commit/d8d4d4c35e0fd197668b0b6c56700f437290c734))
* index principal_stx_txs tx_id to speed up reorg updates ([#1080](https://github.com/hirosystems/stacks-blockchain-api/issues/1080)) ([f6d7d0c](https://github.com/hirosystems/stacks-blockchain-api/commit/f6d7d0cbf6b0bfd5a2cf0406570ed1c5d99e9220))

# [3.0.0-beta.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v2.1.1...v3.0.0-beta.1) (2022-02-25)


### Bug Fixes

* capture re-organized txs correctly in `/extended/v1/:address/transactions` ([#1074](https://github.com/hirosystems/stacks-blockchain-api/issues/1074)) ([81d039d](https://github.com/hirosystems/stacks-blockchain-api/commit/81d039d72219c51d517d27e69cedfc0cc8e10c7e))
* principal_stx_txs sorting ([#1056](https://github.com/hirosystems/stacks-blockchain-api/issues/1056)) ([b0a0e94](https://github.com/hirosystems/stacks-blockchain-api/commit/b0a0e94ecd40bab5ea7d3c7705198ac9ea0ab399))
* sort NFT events by event_index too ([#1063](https://github.com/hirosystems/stacks-blockchain-api/issues/1063)) ([77b2587](https://github.com/hirosystems/stacks-blockchain-api/commit/77b25878f652393a6066dad5c6b39569eb8a194a))


* chore!: major version bump for breaking db schema changes ([296c619](https://github.com/hirosystems/stacks-blockchain-api/commit/296c619f81c480db9246ab8ea0b9fbf3c7b982b1))


### Features

* add `chain_tip` materialized view to track chain tip stats ([#1028](https://github.com/hirosystems/stacks-blockchain-api/issues/1028)) ([803ac18](https://github.com/hirosystems/stacks-blockchain-api/commit/803ac189c25b6a31ae94063a6f1a4ede1f0dba98))
* add chain tip info to `/extended/v1/status` ([#1070](https://github.com/hirosystems/stacks-blockchain-api/issues/1070)) ([fb573b1](https://github.com/hirosystems/stacks-blockchain-api/commit/fb573b11e4b8768d87e6b9c557fec92945fadd9a))
* added feature for rendering docs ([#991](https://github.com/hirosystems/stacks-blockchain-api/issues/991)) ([a521a39](https://github.com/hirosystems/stacks-blockchain-api/commit/a521a390b2d973851f94a8962ec2b70a5937c6a7))
* change string and hex column indices to Hash method ([#1042](https://github.com/hirosystems/stacks-blockchain-api/issues/1042)) ([aae6cc0](https://github.com/hirosystems/stacks-blockchain-api/commit/aae6cc0c643a5c6056e596768080119e2c84bb21))


### BREAKING CHANGES

* use event-replay to upgrade, this version includes breaking changes to the db sql schema

## [2.1.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v2.1.0...v2.1.1) (2022-02-09)


### Bug Fixes

* use primary pg config for notifier ([#1053](https://github.com/hirosystems/stacks-blockchain-api/issues/1053)) ([018cd5b](https://github.com/hirosystems/stacks-blockchain-api/commit/018cd5b83492a004759eafea003abff581e31380))

# [2.1.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v2.0.0...v2.1.0) (2022-02-09)


### Bug Fixes

* add token metadata error modes to warn on missing rosetta FT metadata ([#1049](https://github.com/hirosystems/stacks-blockchain-api/issues/1049)) ([abff4b4](https://github.com/hirosystems/stacks-blockchain-api/commit/abff4b474ed0ba17defb6becad785472e493b2e2))
* bug in tx ordering when querying txs by address ([#1044](https://github.com/hirosystems/stacks-blockchain-api/issues/1044)) ([bbde339](https://github.com/hirosystems/stacks-blockchain-api/commit/bbde3394d1226fbfe82f91c482d7dba9d6781b5e))
* change status code for Rosetta request client errors to 400 [#1009](https://github.com/hirosystems/stacks-blockchain-api/issues/1009) ([#1036](https://github.com/hirosystems/stacks-blockchain-api/issues/1036)) ([b29466c](https://github.com/hirosystems/stacks-blockchain-api/commit/b29466c46558b45986790d28b08cf55eed2e19bf))
* include more types of pg connection errors in startup retry logic ([#1051](https://github.com/hirosystems/stacks-blockchain-api/issues/1051)) ([f9e88cb](https://github.com/hirosystems/stacks-blockchain-api/commit/f9e88cba6d47c3b755aed372cb9cd08a69a4d4fe))
* reconnect broken pgnotify clients ([#970](https://github.com/hirosystems/stacks-blockchain-api/issues/970)) ([9758e51](https://github.com/hirosystems/stacks-blockchain-api/commit/9758e51806f04a804846fd9e3b9b51189f940c23))


### Features

* add usage details for each pg connection via application_name ([#1043](https://github.com/hirosystems/stacks-blockchain-api/issues/1043)) ([87596c7](https://github.com/hirosystems/stacks-blockchain-api/commit/87596c7980a20c8bb0b485d9e1c0e184e9fa5e2b))

# [2.0.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v1.0.7...v2.0.0) (2022-02-01)


### Bug Fixes

* asset_event_type on history examples ([85e1f4c](https://github.com/hirosystems/stacks-blockchain-api/commit/85e1f4ca4a54d5e3a6e87abdf0e1b1ef26ef3604))
* fee rate and nonce for sponsored txs [#857](https://github.com/hirosystems/stacks-blockchain-api/issues/857) ([52f7ad5](https://github.com/hirosystems/stacks-blockchain-api/commit/52f7ad57152c6d838b00dd872c164612441b5ef6))
* incorrect tx list returned for block result  ([#931](https://github.com/hirosystems/stacks-blockchain-api/issues/931)) ([aab33a1](https://github.com/hirosystems/stacks-blockchain-api/commit/aab33a156a0e9e9cfe276e5a37810b5c3ffdc02f))
* nft event sorting ([#992](https://github.com/hirosystems/stacks-blockchain-api/issues/992)) ([487a6cb](https://github.com/hirosystems/stacks-blockchain-api/commit/487a6cbda45336b8059448cf44a9b48a895eb54f))
* npm audit fixes, dependency cleanup ([#945](https://github.com/hirosystems/stacks-blockchain-api/issues/945)) ([7ea3ae3](https://github.com/hirosystems/stacks-blockchain-api/commit/7ea3ae368f0c39d6767244edd2f06fe7c0df1453))
* optimize indexes for `blocks`, `microblocks`, `txs`, `mempool_txs` ([#988](https://github.com/hirosystems/stacks-blockchain-api/issues/988)) ([8afa66b](https://github.com/hirosystems/stacks-blockchain-api/commit/8afa66bf9a42fef5726f8854d3fa8419ca6be7d4))
* remove redundand indexes ([51301e4](https://github.com/hirosystems/stacks-blockchain-api/commit/51301e4b9b6e751be60c66f5cec2fb9010d6e5ae))
* return 400 for invalid requests [#851](https://github.com/hirosystems/stacks-blockchain-api/issues/851) ([#864](https://github.com/hirosystems/stacks-blockchain-api/issues/864)) ([695210d](https://github.com/hirosystems/stacks-blockchain-api/commit/695210d064350999254cc8d47960aaafca11a205))
* rosetta add FT support (balance, operations) and return `contract_call` metadata ([#997](https://github.com/hirosystems/stacks-blockchain-api/issues/997)) ([a78a9c1](https://github.com/hirosystems/stacks-blockchain-api/commit/a78a9c19e550ef049b09378831f643d2f5250149))
* tx pagination ordering bug [#924](https://github.com/hirosystems/stacks-blockchain-api/issues/924) ([#933](https://github.com/hirosystems/stacks-blockchain-api/issues/933)) ([d6587fd](https://github.com/hirosystems/stacks-blockchain-api/commit/d6587fda02e8cb3f810ded76ca626f1beeb5c401))


* chore!: major version bump for breaking db schema changes ([3c3f9d6](https://github.com/hirosystems/stacks-blockchain-api/commit/3c3f9d6da50c90445f9c461112c0187ddaa5d830))


### Features

* add `/extended/v1/tokens/nft/history` endpoint ([6688079](https://github.com/hirosystems/stacks-blockchain-api/commit/6688079122ed84d819c7c6f47fea641a1ccbd8db))
* add `/extended/v1/tokens/nft/holdings` endpoint ([12242b8](https://github.com/hirosystems/stacks-blockchain-api/commit/12242b81942aef3b4c468e6b280a5d5ee553c2ec))
* add `/extended/v1/tokens/nft/mints` endpoint ([0fc9f42](https://github.com/hirosystems/stacks-blockchain-api/commit/0fc9f425a7e202a54ee1b602480fcf483f7a6c24))
* add `principal_stx_txs` table to speed up `/transfers` endpoint ([6c8466e](https://github.com/hirosystems/stacks-blockchain-api/commit/6c8466e0635f483297ea6fbaf11bb9e84ae525f6))
* add write-only mode ([adf3821](https://github.com/hirosystems/stacks-blockchain-api/commit/adf382182114c46997f5689fe4a756a3d04f5286))
* update txs on microblocks ([52986d2](https://github.com/hirosystems/stacks-blockchain-api/commit/52986d2c34628d82e516469fdd316a3e0207b6b0))
* use primary pg server for notifier ([#993](https://github.com/hirosystems/stacks-blockchain-api/issues/993)) ([208e373](https://github.com/hirosystems/stacks-blockchain-api/commit/208e373ded7ffd3d2dbf73269f598def9ce9ebc6))


### BREAKING CHANGES

* use event-replay to upgrade, this version includes breaking changes to the db sql schema

## [1.0.7](https://github.com/hirosystems/stacks-blockchain-api/compare/v1.0.6...v1.0.7) (2022-01-12)


### Bug Fixes

* ensure `Cache-Control` is specified in 304 response as required by some CDNs to cache properly ([#971](https://github.com/hirosystems/stacks-blockchain-api/issues/971)) ([a0fd2fe](https://github.com/hirosystems/stacks-blockchain-api/commit/a0fd2fe0baf396866f5ca8bb8b9ab91807f02349))

## [1.0.6](https://github.com/hirosystems/stacks-blockchain-api/compare/v1.0.5...v1.0.6) (2022-01-07)


### Bug Fixes

* **rosetta:** off-by-one nonce returned with rosetta /account/balance endpoint [#961](https://github.com/hirosystems/stacks-blockchain-api/issues/961) ([#964](https://github.com/hirosystems/stacks-blockchain-api/issues/964)) ([64a4401](https://github.com/hirosystems/stacks-blockchain-api/commit/64a440122a6d91327fd067c67a8ecff0a3f79d29))

## [1.0.5](https://github.com/hirosystems/stacks-blockchain-api/compare/v1.0.4...v1.0.5) (2022-01-05)


### Bug Fixes

* **rosetta:** incorrect nonce in rosetta /account/balance endpoint [#955](https://github.com/hirosystems/stacks-blockchain-api/issues/955) ([#959](https://github.com/hirosystems/stacks-blockchain-api/issues/959)) ([e65e932](https://github.com/hirosystems/stacks-blockchain-api/commit/e65e932b5ebac4fe50b3647e4fd08baff7446791))

## [1.0.4](https://github.com/hirosystems/stacks-blockchain-api/compare/v1.0.3...v1.0.4) (2021-12-23)


### Bug Fixes

* join canonical txs on latest_contract_txs view ([#943](https://github.com/hirosystems/stacks-blockchain-api/issues/943)) ([0783249](https://github.com/hirosystems/stacks-blockchain-api/commit/0783249c2829afaf772a1d8a8afc779875f663e8))

## [1.0.3](https://github.com/hirosystems/stacks-blockchain-api/compare/v1.0.2...v1.0.3) (2021-12-22)


### Bug Fixes

* doc build error, pin openAPI generator-cli version ([#939](https://github.com/hirosystems/stacks-blockchain-api/issues/939)) ([df4a1c9](https://github.com/hirosystems/stacks-blockchain-api/commit/df4a1c923a214db186d1bb723fa8c73a09641040))

## [1.0.2](https://github.com/hirosystems/stacks-blockchain-api/compare/v1.0.1...v1.0.2) (2021-12-22)


### Bug Fixes

* rosetta block tx sql query not using index_block_hash ([#938](https://github.com/hirosystems/stacks-blockchain-api/issues/938)) ([1b2c19d](https://github.com/hirosystems/stacks-blockchain-api/commit/1b2c19d2c77684bade7cbccf76554d6256ab974f))

## [1.0.1](https://github.com/hirosystems/stacks-blockchain-api/compare/v1.0.0...v1.0.1) (2021-12-21)


### Bug Fixes

* ignore out of order attachments failing to resolve tx data ([#935](https://github.com/hirosystems/stacks-blockchain-api/issues/935)) ([13b5225](https://github.com/hirosystems/stacks-blockchain-api/commit/13b5225727b95067438b8681514609e72263e5bf))

# [1.0.0](https://github.com/hirosystems/stacks-blockchain-api/compare/v0.71.2...v1.0.0) (2021-12-20)


### Bug Fixes

* add parsed abi to mempool tx endpoints ([#904](https://github.com/hirosystems/stacks-blockchain-api/issues/904)) ([dfcc591](https://github.com/hirosystems/stacks-blockchain-api/commit/dfcc591d2a33e2f95df8d6d2e43b915aee390764))
* address txs abi and reported total ([a280073](https://github.com/hirosystems/stacks-blockchain-api/commit/a280073daea7ca5d307c59c4a1a711ffb49bccd9))
* buffer profiler heap snapshot data to disk before to http client request ([#906](https://github.com/hirosystems/stacks-blockchain-api/issues/906)) ([820bfff](https://github.com/hirosystems/stacks-blockchain-api/commit/820bfff1dbf9ad74a2953e8baa296a43ac76926a))
* build/publish Dockerfile python installation issues ([7a11384](https://github.com/hirosystems/stacks-blockchain-api/commit/7a1138452ad60c3b4c49f8b97ba557e3609dc40f))
* consolidate latest_conrtact_txs materialized view into one migration ([949a96d](https://github.com/hirosystems/stacks-blockchain-api/commit/949a96d3fa74c81bd95953bf2cbdec2ce4983576))
* contract-call tx arg bug in `/extended/v1/address/<principal>/transactions_with_transfers` ([#894](https://github.com/hirosystems/stacks-blockchain-api/issues/894)) ([b254083](https://github.com/hirosystems/stacks-blockchain-api/commit/b2540831c35fe46daf35b74764c82c89954e90ab))
* error reading contract abi [#850](https://github.com/hirosystems/stacks-blockchain-api/issues/850) ([f9b4e72](https://github.com/hirosystems/stacks-blockchain-api/commit/f9b4e725178bc28f41faa94305a883d8694407d0))
* fetch abi on tx /with-transfers ([#895](https://github.com/hirosystems/stacks-blockchain-api/issues/895)) ([196f612](https://github.com/hirosystems/stacks-blockchain-api/commit/196f6120ce46487770206f1ceb1769d18bee488c))
* get abi for all tx queries ([7d5940d](https://github.com/hirosystems/stacks-blockchain-api/commit/7d5940d20ea0b9261fc4e4645e17f7b663286441))
* git-info error message ([61f6e7c](https://github.com/hirosystems/stacks-blockchain-api/commit/61f6e7c27add2fc9e385e2e731dd7fe2d632acd4))
* go back to all branches ([#917](https://github.com/hirosystems/stacks-blockchain-api/issues/917)) ([d251674](https://github.com/hirosystems/stacks-blockchain-api/commit/d2516740c6bc3dc6740f85c16e77450b466ab957))
* nft value encoding in `/transactions_with_transfers` [#885](https://github.com/hirosystems/stacks-blockchain-api/issues/885) ([4964fe7](https://github.com/hirosystems/stacks-blockchain-api/commit/4964fe7c5e41ad3576f7298b7e237f330eb00be9))
* regression introduced in [#860](https://github.com/hirosystems/stacks-blockchain-api/issues/860) where `contract` http response `abi` field is no longer a json string ([#905](https://github.com/hirosystems/stacks-blockchain-api/issues/905)) ([ee61346](https://github.com/hirosystems/stacks-blockchain-api/commit/ee61346ac9f0de15e5f64baa12a7477df2889f6d))
* remove unnecessary socket-io logEvent when init ([8ddec2c](https://github.com/hirosystems/stacks-blockchain-api/commit/8ddec2c45865f2a3a3e8983acaa72a3edbd08a4c))
* removed empty events array from response [#668](https://github.com/hirosystems/stacks-blockchain-api/issues/668) ([172e6a2](https://github.com/hirosystems/stacks-blockchain-api/commit/172e6a2123bec4366fd41258a0914a03ffa3e015))
* revert [#792](https://github.com/hirosystems/stacks-blockchain-api/issues/792), restore `events` array to tx responses ([#907](https://github.com/hirosystems/stacks-blockchain-api/issues/907)) ([a8a8776](https://github.com/hirosystems/stacks-blockchain-api/commit/a8a87762f4364dff462ed788c75abfc37998f640))
* set explicit context for github actions docker builds ([f34c7d5](https://github.com/hirosystems/stacks-blockchain-api/commit/f34c7d518d9b4953dd97482633a83a523d5f7c0d))
* transaction broadcast log ([e1c6882](https://github.com/hirosystems/stacks-blockchain-api/commit/e1c688297578b266983fc1daa30f41f44b082049))


### Documentation

* add major version upgrade instructions ([#908](https://github.com/hirosystems/stacks-blockchain-api/issues/908)) ([28ebe2d](https://github.com/hirosystems/stacks-blockchain-api/commit/28ebe2d1ebf67fba8bf80922e756c7467349f6b2))


### Features

* add `at_block` query param for `/address` endpoints ([9f206a3](https://github.com/hirosystems/stacks-blockchain-api/commit/9f206a3d744eb83c5593ed8418a2d7b896775bc4))
* add heartbeat to websockets ([e7d8efa](https://github.com/hirosystems/stacks-blockchain-api/commit/e7d8efa9f309691279ce24aeae939a2896b07584))
* add latest smart contract txs materialized view ([67c453c](https://github.com/hirosystems/stacks-blockchain-api/commit/67c453cb6cef9f39555ed1dc025f23ffa9bbd561))
* add nft_custody pg materialized view to speed up nft event lookup ([aaafb5a](https://github.com/hirosystems/stacks-blockchain-api/commit/aaafb5ae2feb35354339267c5ba4b53e13079250))
* add prometheus metrics for websockets ([ab9b3de](https://github.com/hirosystems/stacks-blockchain-api/commit/ab9b3de70a516aef08fc604701ba41b837494884))
* chaintip-based cache-control, caching with zero stale data ([#834](https://github.com/hirosystems/stacks-blockchain-api/issues/834)) ([581bef4](https://github.com/hirosystems/stacks-blockchain-api/commit/581bef4b2a5adfb42f11af73d8692f3c3141a0e9))
* docker cleanup ([216b9ab](https://github.com/hirosystems/stacks-blockchain-api/commit/216b9ab715b207d0c79562a70f5b830718befa9a))
* endpoint for list of transactions [#647](https://github.com/hirosystems/stacks-blockchain-api/issues/647) ([7edc7b5](https://github.com/hirosystems/stacks-blockchain-api/commit/7edc7b54a6f856afe8411a5b9e1a6f4946a8715d))
* include entity metadata in search endpoint responses [#651](https://github.com/hirosystems/stacks-blockchain-api/issues/651) ([f993e0d](https://github.com/hirosystems/stacks-blockchain-api/commit/f993e0d2efa172089fd6ec76c310093670d95cf1))
* move build-publish github actions to docker/build-push-action@v2 ([352a054](https://github.com/hirosystems/stacks-blockchain-api/commit/352a054b71573179bdc882bc019a74e7913e7fe9))
* openapi lint config and grouping [#744](https://github.com/hirosystems/stacks-blockchain-api/issues/744) [#762](https://github.com/hirosystems/stacks-blockchain-api/issues/762) [#745](https://github.com/hirosystems/stacks-blockchain-api/issues/745) ([ca1220c](https://github.com/hirosystems/stacks-blockchain-api/commit/ca1220c02b95fd7b34e88fdcd256316eab8de144))
* return all the contracts implement a given trait ([f18068c](https://github.com/hirosystems/stacks-blockchain-api/commit/f18068c300465b0944b9160de7d0f6c3e1d18827))
* rosetta data api and construction validation with rosetta-cli ([f764054](https://github.com/hirosystems/stacks-blockchain-api/commit/f764054cb800c10bc0b44221c77b4d1cd5934e08))
* stx addr encoding LRU cache ([285632a](https://github.com/hirosystems/stacks-blockchain-api/commit/285632a983f2ae83d4f6250c339898dda75bb14e))


### BREAKING CHANGES

* SQL schema changes have been made, follow the readme upgrade instructions

## [0.71.2](https://github.com/blockstack/stacks-blockchain-api/compare/v0.71.1...v0.71.2) (2021-11-16)


### Bug Fixes

* tx broadcast logging error [#852](https://github.com/blockstack/stacks-blockchain-api/issues/852) ([b0c43d9](https://github.com/blockstack/stacks-blockchain-api/commit/b0c43d9395e8ef56881945e48f1df9786d8790ba))

## [0.71.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.71.0...v0.71.1) (2021-11-15)


### Bug Fixes

* build/publish Dockerfile python installation issues ([7bc217a](https://github.com/blockstack/stacks-blockchain-api/commit/7bc217a40fee5ba3fb65aa4608867b60c88978ba))
* change to python3 ([676fd05](https://github.com/blockstack/stacks-blockchain-api/commit/676fd05612f29a0df22c568d4bab71ffcbe4d20c))
* transaction broadcast log ([7fef7a8](https://github.com/blockstack/stacks-blockchain-api/commit/7fef7a8123a86b4e3755ef6e124f0af344c11d99))

# [0.71.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.70.1...v0.71.0) (2021-11-01)


### Bug Fixes

* export api version variable for resolution ([5134183](https://github.com/blockstack/stacks-blockchain-api/commit/5134183a33afda7ebf49a9d6d582e69bb084c7c6))


### Features

* production-capable CPU profiling [#641](https://github.com/blockstack/stacks-blockchain-api/issues/641) ([edb8d12](https://github.com/blockstack/stacks-blockchain-api/commit/edb8d121d1e9e031841ccb364362892c4748fc05))

## [0.70.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.70.0...v0.70.1) (2021-10-22)


### Bug Fixes

* api versioning ([4ade5ee](https://github.com/blockstack/stacks-blockchain-api/commit/4ade5ee39bba1210845127a7d051e63736f13243))
* microblock related re-org bug causing txs to be incorrectly orphaned [#804](https://github.com/blockstack/stacks-blockchain-api/issues/804) [#818](https://github.com/blockstack/stacks-blockchain-api/issues/818) ([bae619d](https://github.com/blockstack/stacks-blockchain-api/commit/bae619d653e559909c10e08bfa1d1ad2647ee7de))

# [0.70.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.69.0...v0.70.0) (2021-10-20)


### Bug Fixes

* **docs:** ensure naming convention is followed ([ff7f9d3](https://github.com/blockstack/stacks-blockchain-api/commit/ff7f9d347264796b297fae838011fbd18d7a5759))
* rosetta account/balance speed ([c49a4d4](https://github.com/blockstack/stacks-blockchain-api/commit/c49a4d4a1d7ac34d2b41c54684568087a846c097))
* socket.io incorrect microblock and mempool updates ([95d4108](https://github.com/blockstack/stacks-blockchain-api/commit/95d4108d0b8c851ff423a2ee367cbd1dd1e35010))


### Features

* add broadcast/confirmed tx logs ([26e50fd](https://github.com/blockstack/stacks-blockchain-api/commit/26e50fd1b06b2afdc357ff662395ab5c02d16c87))
* set api version in openapi schema automatically ([1b9126e](https://github.com/blockstack/stacks-blockchain-api/commit/1b9126e73da7efd2b911e779a9e7481cb6101996))

# [0.69.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.68.0...v0.69.0) (2021-10-05)


### Bug Fixes

* **bns:** save new owner in the db in case of name-transfer [#779](https://github.com/blockstack/stacks-blockchain-api/issues/779) ([37efffc](https://github.com/blockstack/stacks-blockchain-api/commit/37efffcdf3bfaa16ae30798d2523c1225d2fbc67))
* move zonefiles into new table [#621](https://github.com/blockstack/stacks-blockchain-api/issues/621) ([0f46131](https://github.com/blockstack/stacks-blockchain-api/commit/0f4613169cf9b50be869540b95a1cf9409d767c8))
* removed regtest references [#784](https://github.com/blockstack/stacks-blockchain-api/issues/784) ([13c33e5](https://github.com/blockstack/stacks-blockchain-api/commit/13c33e5475686d3f19908a93ba4cddf672374856))


### Features

* add microblock update support to socket-io ([204d797](https://github.com/blockstack/stacks-blockchain-api/commit/204d7979a96c3f29b5ec21ff4680ecb64871c3fb))
* add read-only mode ([d1adca4](https://github.com/blockstack/stacks-blockchain-api/commit/d1adca4d5001b7b592fb917e27e1cadceb73d567))
* added execution cost to block response [#735](https://github.com/blockstack/stacks-blockchain-api/issues/735) ([8d2d86f](https://github.com/blockstack/stacks-blockchain-api/commit/8d2d86f972bef61e42f45a7e09cc847e046d0df1))

# [0.68.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.67.1...v0.68.0) (2021-09-20)


### Bug Fixes

* return the latest name by address [#714](https://github.com/blockstack/stacks-blockchain-api/issues/714) ([101922b](https://github.com/blockstack/stacks-blockchain-api/commit/101922bc843140fbe5df2113f2e7d396925cbb40))


### Features

* ability to configure multiple tx broadcast endpoints [#765](https://github.com/blockstack/stacks-blockchain-api/issues/765) ([8a9222a](https://github.com/blockstack/stacks-blockchain-api/commit/8a9222a3cb6ba47ee2c90473e34f433b88e73572))

## [0.67.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.67.0...v0.67.1) (2021-09-17)


### Bug Fixes

* ignore out of order microblocks causing API to crash ([1e0b3d0](https://github.com/blockstack/stacks-blockchain-api/commit/1e0b3d0e18ca8e98f6a602d173b8cef9b1b9652b))

# [0.67.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.66.1...v0.67.0) (2021-09-16)


### Bug Fixes

* **rosetta:** use coinbase txs hash instead of stx_lock for forged unlock_transaction [#760](https://github.com/blockstack/stacks-blockchain-api/issues/760) ([37adcc7](https://github.com/blockstack/stacks-blockchain-api/commit/37adcc70aa55e58c9ad3dd0684b24972130fa6d4))
* disable http keep-alive for stacks-node /v2 proxied endpoints ([cebeda0](https://github.com/blockstack/stacks-blockchain-api/commit/cebeda0e376dd7afd6729b2cd525e3c2373f27cd))
* increase the 10 second cap on prometheus http metric reporting ([735874e](https://github.com/blockstack/stacks-blockchain-api/commit/735874e45c1e198724e7d01ca9e4eec4d108706c))
* replicate query optimizations to other asset txs queries ([05c9931](https://github.com/blockstack/stacks-blockchain-api/commit/05c9931b6168aed48ae8c980d4d882002ad34a49))


### Features

* automatically generate postman collection from the openapi spec ([5f07d74](https://github.com/blockstack/stacks-blockchain-api/commit/5f07d7455fefa61f3f7d35e05e56b06da28987db))
* **rosetta:** support memos in stx token transfer operations [#752](https://github.com/blockstack/stacks-blockchain-api/issues/752) ([6f4f3e2](https://github.com/blockstack/stacks-blockchain-api/commit/6f4f3e2a9129975a5252b5e33cf18168ec1c0acf))

## [0.66.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.66.0...v0.66.1) (2021-09-09)


### Bug Fixes

* support post in api status endpoint ([7dcb019](https://github.com/blockstack/stacks-blockchain-api/commit/7dcb01901bccdfc50d97bc68a0cdebf9d431307d))

# [0.66.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.65.0...v0.66.0) (2021-09-09)


### Bug Fixes

* optimize query that retrieves txs with asset transfers ([821f578](https://github.com/blockstack/stacks-blockchain-api/commit/821f578792454737700b2960e0167d1b974c3819))
* **rosetta:** do not assume encoding of delegate-stx `pox_addr` data [#732](https://github.com/blockstack/stacks-blockchain-api/issues/732) ([a97bd6f](https://github.com/blockstack/stacks-blockchain-api/commit/a97bd6f0d23bc32f3d13b5840f3d41bffaaf79ee))


### Features

* added a new endpoint fee_rate [#729](https://github.com/blockstack/stacks-blockchain-api/issues/729) ([7c09ac5](https://github.com/blockstack/stacks-blockchain-api/commit/7c09ac53a9886f7369ff95bd1781eca1f744c054))

# [0.65.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.64.2...v0.65.0) (2021-09-07)


### Bug Fixes

* added types for search endpoint [#645](https://github.com/blockstack/stacks-blockchain-api/issues/645) ([7cc78fb](https://github.com/blockstack/stacks-blockchain-api/commit/7cc78fb5733930d5d3c2b5c7c773dabd4bdeb294))
* short summaries for BNS endpoints ([e37b5af](https://github.com/blockstack/stacks-blockchain-api/commit/e37b5afbf57ca4d0c183b05eae6e14f87ebc3afd))
* sql optimizations to speed up various tx queries ([10b1c67](https://github.com/blockstack/stacks-blockchain-api/commit/10b1c67d20b99f7c57a6b2c4657faf5019b59745))
* **rosetta:** change sender and receiver operations to token_transfer [#683](https://github.com/blockstack/stacks-blockchain-api/issues/683) ([91856c8](https://github.com/blockstack/stacks-blockchain-api/commit/91856c865598f11c358165ead9f39bd4a73f9128))


### Features

* add execution cost data to transactions ([d9e1131](https://github.com/blockstack/stacks-blockchain-api/commit/d9e1131f8371232129779813704548e266e1916f))
* emit prometheus metrics for socket.io ([3100c56](https://github.com/blockstack/stacks-blockchain-api/commit/3100c5661e62fece6b33bfe2806940e3ea655425))
* expose FT and NFT transfers in /extended/v1/address/[:principal]/transactions_with_transfers ([439d4f4](https://github.com/blockstack/stacks-blockchain-api/commit/439d4f46cdd9b8fcc3f6fa1016482a4df0a02129))
* return git info in /extended/v1/status ([0538ae2](https://github.com/blockstack/stacks-blockchain-api/commit/0538ae297f5c5c211825b0a173be34ccf6e96353))
* token metadata ([33f11bb](https://github.com/blockstack/stacks-blockchain-api/commit/33f11bbcf3345623fbc0ae5a96eec706a351ff05))

## [0.64.2](https://github.com/blockstack/stacks-blockchain-api/compare/v0.64.1...v0.64.2) (2021-08-20)


### Bug Fixes

* Revert "fix(rosetta): conflicting nonce issue in rosetta tx construction [#685](https://github.com/blockstack/stacks-blockchain-api/issues/685)" ([408f1c0](https://github.com/blockstack/stacks-blockchain-api/commit/408f1c02795d483a7a145d1dcc671d7ec760244d))

## [0.64.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.64.0...v0.64.1) (2021-08-19)


### Bug Fixes

* client lib and docs build fix ([c54b11d](https://github.com/blockstack/stacks-blockchain-api/commit/c54b11d25514cf334240c9c87678f15b07355572))

# [0.64.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.63.1...v0.64.0) (2021-08-19)


### Bug Fixes

* **rosetta:** `/block/transaction` endpoint missing ops [#704](https://github.com/blockstack/stacks-blockchain-api/issues/704) ([33425d8](https://github.com/blockstack/stacks-blockchain-api/commit/33425d8eb917f96ee2fd308276c500805f0454db))
* **rosetta:** conflicting nonce issue in rosetta tx construction [#685](https://github.com/blockstack/stacks-blockchain-api/issues/685) ([0ec3710](https://github.com/blockstack/stacks-blockchain-api/commit/0ec371095f04faef1237b795fe7bdcaefb130ce3))


### Features

* add smart contract id or contract call id queries to /extended/v1/tx/mempool ([592dc24](https://github.com/blockstack/stacks-blockchain-api/commit/592dc2409a9fcaece0bc8ce0919c17bcebe0b9c0))
* return tx_id on every asset in /extended/v1/address/[:addr]/assets ([fb6150a](https://github.com/blockstack/stacks-blockchain-api/commit/fb6150a008367b5b540ce82a1d9269c3df6f2cb3))

## [0.63.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.63.0...v0.63.1) (2021-08-16)


### Bug Fixes

* bug in Clarity value type parsing breaking some API tx respsonses ([55227e2](https://github.com/blockstack/stacks-blockchain-api/commit/55227e299d25ab44afd6b40a9eb674c0660174b2))

# [0.63.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.62.3...v0.63.0) (2021-08-11)


### Bug Fixes

* bugged re-org logic introduced in microblock implementation [#670](https://github.com/blockstack/stacks-blockchain-api/issues/670) ([7dfc5a9](https://github.com/blockstack/stacks-blockchain-api/commit/7dfc5a9b1f8e636c91b6acec37f711c82169eb10))
* **rosetta:** contract details in payload stacking transactions ([a903cb0](https://github.com/blockstack/stacks-blockchain-api/commit/a903cb05184afce7f515d085ff5c808ef27f8822))
* all unit and integration tests working with microblock-capable stacks-node ([bf89f6a](https://github.com/blockstack/stacks-blockchain-api/commit/bf89f6a41423797c9b512719649082bed3bf1593))
* bns queries not using the pg query function ([51c762f](https://github.com/blockstack/stacks-blockchain-api/commit/51c762f641ad611697e79d6121cd7a704b3a47ce))
* bundling issues ([ab45a15](https://github.com/blockstack/stacks-blockchain-api/commit/ab45a151f4136a1e8907befc1d6047035f6fd6f8))
* duplicated mempool-tx and mined-tx schemas leading to buggy tx parsing code ([a85dcad](https://github.com/blockstack/stacks-blockchain-api/commit/a85dcad9e7fd24f439f4bf3b81e6576a718a6231))
* fixed invalid URL crash, added route for invalid requests ([81e5bec](https://github.com/blockstack/stacks-blockchain-api/commit/81e5becfcad2fbb68ead4d99de5f4efd58f43469))
* handling for receiving stale microblock events from stacks-node ([b82b3e0](https://github.com/blockstack/stacks-blockchain-api/commit/b82b3e010f11dfd2da539589d10d64114f01308c))
* ignore 'data system is starting' error while connecting to postgres ([f637e8a](https://github.com/blockstack/stacks-blockchain-api/commit/f637e8a822f0cef11e6321f045f37a03b44592b5))
* include contract-call metadata in mempool/pending transactions ([8f36f85](https://github.com/blockstack/stacks-blockchain-api/commit/8f36f858fbbfcebe806089a36c5a6627f71a2124))
* issue with client doc generation in gh actions ([3a017f9](https://github.com/blockstack/stacks-blockchain-api/commit/3a017f91f3b22f36b2c344fe46a9dd6bdc2d24c1))
* missing sponsor_address property in some tx responses ([cbe16dd](https://github.com/blockstack/stacks-blockchain-api/commit/cbe16dd2ee7f38cf072344f4bcc4dd9e99cacabc))
* preprocess bug to remove network from the dummy transaction ([95cd1be](https://github.com/blockstack/stacks-blockchain-api/commit/95cd1be12884de945e95dfdadb76ac43cd4ed2d4))
* preserve logical transaction ordering using INT32_MAX value rather than -1 for batched tx microblock_sequence ([654669c](https://github.com/blockstack/stacks-blockchain-api/commit/654669ca81cf4b1901722ea7654fd93808b3edbc))
* prevent querying duplicate tx data when existing in both micro-orphaned and unanchored-microblock form ([4903148](https://github.com/blockstack/stacks-blockchain-api/commit/49031484cd810fd14068edc266584050b098fd44))
* remove token_transfer_recipient_address from stacking transactions ([fc95319](https://github.com/blockstack/stacks-blockchain-api/commit/fc9531973e70835d0e89227d4180b0eb3fd2f10a))
* repair bns integration tests ([c0e0a69](https://github.com/blockstack/stacks-blockchain-api/commit/c0e0a698f6bb0b6ffb094b892da0ca0214c4caf0))
* repair syntax in sample clarity contracts for debug endpoints ([e576361](https://github.com/blockstack/stacks-blockchain-api/commit/e576361cc7106989d8e259afef3d734d2f2cb684))
* various bugs and typing issues with parsing mined and mempool tx db data ([97bb2cb](https://github.com/blockstack/stacks-blockchain-api/commit/97bb2cbc36d1d30352ad42b7b4c6610786abb31e))
* wip- add try catch and log ([fcb1216](https://github.com/blockstack/stacks-blockchain-api/commit/fcb12160fe3b82d7b7c80ad78fd3d8b71695e709))


### Features

* **rosetta:** support passing btc address for rosetta stacking op [#672](https://github.com/blockstack/stacks-blockchain-api/issues/672) ([cf36b8f](https://github.com/blockstack/stacks-blockchain-api/commit/cf36b8fddf3a82478ef2218cf7e21f7adad3b707))
* **rosetta:** support stacking, delegate stacking and revoke stacking event ([f5190c5](https://github.com/blockstack/stacks-blockchain-api/commit/f5190c53f4814f37694e3cc28a299db1f5eb26cf))
* add anchored microblock hash array to API anchor block response ([f6a307a](https://github.com/blockstack/stacks-blockchain-api/commit/f6a307a0ce28a3e0509f0e6a6333041efb33ea8e))
* add explicit `is_unanchored: boolean` flag to tx responses ([267a5eb](https://github.com/blockstack/stacks-blockchain-api/commit/267a5eb3ecb91baaf0b2ce9900ae2065c52b8269))
* add get block by burn block height and by burn block hash ([#675](https://github.com/blockstack/stacks-blockchain-api/issues/675)) ([d002dad](https://github.com/blockstack/stacks-blockchain-api/commit/d002dadefe024c7273f0c60038ad2bf7438d8cf5))
* add microblock metadata to tx byproduct tables ([a3a9605](https://github.com/blockstack/stacks-blockchain-api/commit/a3a96059e68e7c7c2efcb296a1221ea403c6e173))
* add nonce gap detection and recommended nonce value to /address/{principal}/nonces ([119615e](https://github.com/blockstack/stacks-blockchain-api/commit/119615e84967dc3cfd205c80b2722ce87293c1eb))
* add parent_burn_block_{time,hash,height} to txs and microblock API responses ([977db77](https://github.com/blockstack/stacks-blockchain-api/commit/977db77a71a373668259732976ef748c09ba115a))
* added microblock metadata to regular/anchor block API responses ([39a8d32](https://github.com/blockstack/stacks-blockchain-api/commit/39a8d328186f5410cea11202d714e560c5bfc6ce))
* allow dangerous `--force` option to drop tables during event-import when migrations had breaking changes ([7f71f2d](https://github.com/blockstack/stacks-blockchain-api/commit/7f71f2d657c829bee90bb1435ee7a6025b8a5a19))
* anticipated sql schema required for storing microblock data with the ability to handle micro-fork reorgs ([5457a9e](https://github.com/blockstack/stacks-blockchain-api/commit/5457a9e027fcf36be46e0577a843d3060d4b49db))
* API endpoint to return unanchored txs ([6f3aed9](https://github.com/blockstack/stacks-blockchain-api/commit/6f3aed942cfeb89e27d6829fd4c62a873bdf2d38))
* ensure microblock data is marked with the correct anchor-canonical status on receipt of anchor block ([dc89c98](https://github.com/blockstack/stacks-blockchain-api/commit/dc89c98ab435908f66af4d3e5edd52a3560ea8f3))
* env var to enable streaming events to file as they are received ([6114ae0](https://github.com/blockstack/stacks-blockchain-api/commit/6114ae0554c598e89718a6bf7023335a05f62739))
* exclude micro-orphaned data from applicable sql queries ([9cff795](https://github.com/blockstack/stacks-blockchain-api/commit/9cff795e1aff27af773d30f3b6711e0aebac148a))
* flag microblock tx data as non-canonical when orphaned by an anchor block ([0f2a3ec](https://github.com/blockstack/stacks-blockchain-api/commit/0f2a3ec4bc4fe6ebd40bc6b0d44dc25498f42088))
* handle microblocks reorgs for micro-forks off the same same unanchored chain tip, e.g. a leader orphaning it's own unconfirmed microblocks ([ecb2c79](https://github.com/blockstack/stacks-blockchain-api/commit/ecb2c798e32d9cddc619b5903beaac85352bf466))
* handling for the happy-path of microblock-txs accepted in the next anchor block ([8ce3366](https://github.com/blockstack/stacks-blockchain-api/commit/8ce336653a23bcea2d6e1f6ed20674507e6c1143))
* implement endpoint to get the latest account nonce based off mempool and unanchored or anchored tx data ([0b33bcb](https://github.com/blockstack/stacks-blockchain-api/commit/0b33bcbfef97ea6e4e8c9b19e4f2864afd4692d7))
* logical ordering of txs and events (e.g. for pagination) using microblock_sequence with tx_index ([0593591](https://github.com/blockstack/stacks-blockchain-api/commit/0593591703a64f209086c0093bba54c207a84979))
* microblocks API endpoints ([19e92ae](https://github.com/blockstack/stacks-blockchain-api/commit/19e92ae735dd333ab5ee8ec7bb01b209e1751c23))
* new database connection options ([d3f23d3](https://github.com/blockstack/stacks-blockchain-api/commit/d3f23d39b8ec7b86be6f9f795a1a0be2bd9d430a))
* option to "replay" event emitter data via program args ([e0d5c5f](https://github.com/blockstack/stacks-blockchain-api/commit/e0d5c5f0eb5af14205e7faca5d4297ab62c045e2))
* option to export all raw event observer requests to file via program args, progress on replaying requests through the observer interface ([912113d](https://github.com/blockstack/stacks-blockchain-api/commit/912113ded8d7fc61899d94682c7b5512936b9815))
* parse txs from microblock event payloads and inserted into db ([dc32f4e](https://github.com/blockstack/stacks-blockchain-api/commit/dc32f4e646ba73cfc2a6ba7b4eb49b1f599bf2ab))
* populate tx metadata tables (stx transfers, contract deployments, etc) with index_block_hash on microblock acceptance ([e8689b1](https://github.com/blockstack/stacks-blockchain-api/commit/e8689b121922e8e395c54317d8435f2f5fd8d151))
* progress on making unanchored microblock tx data opt-in in API requests and db sql queries ([3057ab3](https://github.com/blockstack/stacks-blockchain-api/commit/3057ab3350c9f156b044a3509fba5fec5b62b28f))
* prune txs from mempool on microblock-tx receipt ([36158ba](https://github.com/blockstack/stacks-blockchain-api/commit/36158ba471191f84f04093e3ca23ee0399f7e2ed))
* refactoring microblock data oprhaning logic into separate functions for usage in streamed micro-fork handling ([60fcd0a](https://github.com/blockstack/stacks-blockchain-api/commit/60fcd0a9bd7d7dbd0e85bbf957fc622ab3580c8d))
* singular tx with STX transfer events endpoint [#622](https://github.com/blockstack/stacks-blockchain-api/issues/622) ([6dbbba6](https://github.com/blockstack/stacks-blockchain-api/commit/6dbbba6a41d9fb584606c9f7ca9db1f5786556a5))
* store raw event observer request payloads in db ([33fe79e](https://github.com/blockstack/stacks-blockchain-api/commit/33fe79edd3eb25e95ca511e9a732e3ec8b2e3741))
* storing microblock headers, progress towards storing microblock txs ([6fa003c](https://github.com/blockstack/stacks-blockchain-api/commit/6fa003ce0e2d960d806f8b12cf0909021e03294d))
* storing microblock tx events and other metadata ([1871446](https://github.com/blockstack/stacks-blockchain-api/commit/1871446b1f69b802a0e66f83d30e3ba916e3743e))
* support microblock canonical status updating during anchor block re-orgs ([09844c2](https://github.com/blockstack/stacks-blockchain-api/commit/09844c289750d7142b266d84e00e4fdaafd9843e))
* support processing of confirmed-only microblock data, see https://github.com/blockstack/stacks-blockchain/issues/2668 ([d4b72e8](https://github.com/blockstack/stacks-blockchain-api/commit/d4b72e83d4cab6dfc2a4368ce8b14f264f1b744c))
* **debug:** ability to broadcast test txs using unconfirmed chain tip nonce ([ab672f8](https://github.com/blockstack/stacks-blockchain-api/commit/ab672f89c9a2203a70e0e3b5660bfe59948c764b))

## [0.62.3](https://github.com/blockstack/stacks-blockchain-api/compare/v0.62.2...v0.62.3) (2021-07-28)


### Bug Fixes

* cherrypick fix from https://github.com/blockstack/stacks-blockchain-api/pull/638 ([2c85910](https://github.com/blockstack/stacks-blockchain-api/commit/2c859101d926d2bf1bfecbe6638ba701d4a92cff))

## [0.62.2](https://github.com/blockstack/stacks-blockchain-api/compare/v0.62.1...v0.62.2) (2021-07-20)


### Bug Fixes

* remove hard coded stacks.co urls and use core rpc client which uses env variables ([05bc3cc](https://github.com/blockstack/stacks-blockchain-api/commit/05bc3cc35b8687b59a4e4aff064499497e8963da))

## [0.62.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.62.0...v0.62.1) (2021-06-29)


### Bug Fixes

* prioritize blockhash over block index when both are provided ([feab6a6](https://github.com/blockstack/stacks-blockchain-api/commit/feab6a65ea037c9c85bfc30fe6718251f681af01))
* remove possibility of -0 amount ([b28d890](https://github.com/blockstack/stacks-blockchain-api/commit/b28d8900d31e858f7f3d2ce077fe9331f9eeb346))

# [0.62.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.61.0...v0.62.0) (2021-06-24)


### Features

* adding regtest network ([d333d30](https://github.com/blockstack/stacks-blockchain-api/commit/d333d3071fe2da365bed987b3efe17a471c189a9))

# [0.61.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.60.0...v0.61.0) (2021-05-19)


### Bug Fixes

* [Rosetta] fix unintentional global error object mutations ([ee4e62e](https://github.com/blockstack/stacks-blockchain-api/commit/ee4e62edbd50fdbcbbf918b2fb00ffd39fc19a39))
* add a no-op handler for `/new_microblocks` events to support stacks-node 2.0.12.0.0 ([1ccd9a8](https://github.com/blockstack/stacks-blockchain-api/commit/1ccd9a8021948db320daad43945177b90dea4c6f))
* dockerfile STACKS_CHAIN_ID mismatch ([d6c7b45](https://github.com/blockstack/stacks-blockchain-api/commit/d6c7b452eab59646e1969ef3c50c85f4cc5547aa))
* rosetta no signature format modification ([15432fe](https://github.com/blockstack/stacks-blockchain-api/commit/15432fe28a506ea8bf2b95427e251165d9d492d6))
* skip subdomain with malformed zone files [#582](https://github.com/blockstack/stacks-blockchain-api/issues/582) ([e2a6f90](https://github.com/blockstack/stacks-blockchain-api/commit/e2a6f904758f49df825faf2b1ba0ca99ea9888af))
* subdomains not queried in `/v1/addresses/*` ([ea233a6](https://github.com/blockstack/stacks-blockchain-api/commit/ea233a69503cbaa2664c6d4afe3f225f61d76a45))


### Features

* [rosetta] delegated stacking ([9718c35](https://github.com/blockstack/stacks-blockchain-api/commit/9718c3557e85afd99df8e51c7e9c7149e10c37c5))
* socket.io server and client implementation ([fd8f62f](https://github.com/blockstack/stacks-blockchain-api/commit/fd8f62ff69e4ec7f00e4fb5206cea9ba3d896e90))

# [0.60.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.59.0...v0.60.0) (2021-05-18)


### Bug Fixes

* [Rosetta] fix unintentional global error object mutations ([5de257f](https://github.com/blockstack/stacks-blockchain-api/commit/5de257f81618f40c7c5ed86f51341b28126841e8))
* dockerfile STACKS_CHAIN_ID mismatch ([4ce462b](https://github.com/blockstack/stacks-blockchain-api/commit/4ce462b6b2df4684a5f1438a09a2653707600c85))
* rosetta no signature format modification ([961fc0e](https://github.com/blockstack/stacks-blockchain-api/commit/961fc0e6d71d84be53e80f2e4adf3c4d8770cf72))
* skip subdomain with malformed zone files [#582](https://github.com/blockstack/stacks-blockchain-api/issues/582) ([6fe8fa4](https://github.com/blockstack/stacks-blockchain-api/commit/6fe8fa4fc2eb9fc0a8dbd33e71f05975304fabda))
* subdomains not queried in `/v1/addresses/*` ([20bb6f3](https://github.com/blockstack/stacks-blockchain-api/commit/20bb6f3e6f528162c17c2e7eb560630585edab2c))


### Features

* [rosetta] delegated stacking ([ba2e4ed](https://github.com/blockstack/stacks-blockchain-api/commit/ba2e4ed86cfea1eed3d6a4ab47b1c55c10fa4de5))
* socket.io server and client implementation ([715e2b3](https://github.com/blockstack/stacks-blockchain-api/commit/715e2b36dfeacdaf721f47b3261d86116c682279))

# [0.59.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.58.0...v0.59.0) (2021-05-10)


### Features

* updating rosetta dockerfile ([9039c20](https://github.com/blockstack/stacks-blockchain-api/commit/9039c20be68fd25f9b74084b4aeb286175850cbd))

# [0.58.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.57.0...v0.58.0) (2021-05-03)


### Bug Fixes

* [rosetta] remove stack call on /payload ([e8b86d2](https://github.com/blockstack/stacks-blockchain-api/commit/e8b86d2715b59e84dfa0849da2fa40488ff1e392))
* Rosetta Construction api `/submit` signature format ([946396c](https://github.com/blockstack/stacks-blockchain-api/commit/946396cbfac68da1268096d41feeca9a1f183334))


### Features

* add vesting info & remove public keys requirement in /metadata ([eac8acd](https://github.com/blockstack/stacks-blockchain-api/commit/eac8acd72cf443e980e56047acd1c33aa9eccdbf))

# [0.57.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.56.0...v0.57.0) (2021-04-30)


### Bug Fixes

* Rosetta Construction api `/submit` signature format ([049742e](https://github.com/blockstack/stacks-blockchain-api/commit/049742e3eaa99cd5840cecb1598ff9e8a31a5586))


### Features

* add vesting info & remove public keys requirement in /metadata ([9074599](https://github.com/blockstack/stacks-blockchain-api/commit/907459937bfd4f51c69585b990b6d9d2c4e7f0bf))

# [0.56.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.55.3...v0.56.0) (2021-04-29)


### Bug Fixes

*  added canonical and latest flags in query ([ff01c6f](https://github.com/blockstack/stacks-blockchain-api/commit/ff01c6fae520f647ce3bd818a34019aa49c27721))
* [Rosetta] Error 500 & fee operation ([523c0af](https://github.com/blockstack/stacks-blockchain-api/commit/523c0af4eacffe7acea3ab1789161c778d9f1f28))
* add devenv:stop in  bns test ([3d8374b](https://github.com/blockstack/stacks-blockchain-api/commit/3d8374bc55b073885b839caa3e9d6e2af65126be))
* add support for mainnet contract address ([a9a8573](https://github.com/blockstack/stacks-blockchain-api/commit/a9a857345db1ee99a11b623eccbd524549e5513f))
* add tx_id and status to names and  namespaces table ([493c9d8](https://github.com/blockstack/stacks-blockchain-api/commit/493c9d8b52725ffdded852c68ac4df808d3fd25e))
* added latest in getName ([fa0efc3](https://github.com/blockstack/stacks-blockchain-api/commit/fa0efc350012da4c50f2e2cf73a8a614643c8489))
* assign subdomain name field to name part in v1-import ([#555](https://github.com/blockstack/stacks-blockchain-api/issues/555)) ([f8fe7b6](https://github.com/blockstack/stacks-blockchain-api/commit/f8fe7b6037db6fdfefc24dd87c3e357edc398be3))
* bns v1-import test ([6a91ad9](https://github.com/blockstack/stacks-blockchain-api/commit/6a91ad98c9046fe479434de622147483bc11ef17))
* bug with EADDRINUSE server init errors not being handled correctly ([da51f7b](https://github.com/blockstack/stacks-blockchain-api/commit/da51f7bc6d36d223f8dca23b0e6f36b29b73083d))
* chainprocessor logging messages are shorter ([c993436](https://github.com/blockstack/stacks-blockchain-api/commit/c9934369222c0b751c90e4c9751c04e0fe6cc130))
* chainprocessor was not ending properly -- forgot to call the empty callback ([fc6b75c](https://github.com/blockstack/stacks-blockchain-api/commit/fc6b75c38e69604bd639813fb32c48821382d8a0))
* change tx_id from string to bytea in all  bns tables ([a05da3a](https://github.com/blockstack/stacks-blockchain-api/commit/a05da3a9e74f723db1b5efecc389a61a24f1facb))
* clean up console logs, do not hide subdomain insert query error ([740f0cf](https://github.com/blockstack/stacks-blockchain-api/commit/740f0cf652f3874440b9635e9186797363d5626c))
* comma added in imports ([e6198ee](https://github.com/blockstack/stacks-blockchain-api/commit/e6198eee37caf926de4bd585af85635cf19e0888))
* datastore tests update ([3ed9868](https://github.com/blockstack/stacks-blockchain-api/commit/3ed9868f2af1709b23a173c8b390bcde8fe158ab))
* distinction between total locked and total unlocked token offering schedule amounts ([44f7a06](https://github.com/blockstack/stacks-blockchain-api/commit/44f7a062329f2b189e47cc610ea4bb0fcf36e43e))
* do not re-import Stacks 1.0 BNS data ([66a0371](https://github.com/blockstack/stacks-blockchain-api/commit/66a03714f04f4c75a9be2f0d68fcdc329d63abfc))
* empty status from imported bns names ([44076b2](https://github.com/blockstack/stacks-blockchain-api/commit/44076b26ea98b0ef2818ee420e3e7a1cc24e2120))
* emtpy subdomains issue in event-server ([b4f3c15](https://github.com/blockstack/stacks-blockchain-api/commit/b4f3c152b06ad34c00eb0097158496c1354166dc))
* ensure that importV1 is called with a PgDataStore object ([0f2952b](https://github.com/blockstack/stacks-blockchain-api/commit/0f2952b10331335867cc343a6649cb7b98567201))
* event count added in transaction ([141c85c](https://github.com/blockstack/stacks-blockchain-api/commit/141c85cae06efbf236bc40e868f437a3575a6813))
* fix package-lock.json error ([fbf4a6d](https://github.com/blockstack/stacks-blockchain-api/commit/fbf4a6df897e2be5a17fedcd1ba3a4585aa616c5))
* fix tx_id conversion issue ([db02047](https://github.com/blockstack/stacks-blockchain-api/commit/db0204731a0be313967c87d7aaddd5732740fb39))
* fixed a chunk size comparison (== instead of >), trying 4000 subdomains at a time ([4deb007](https://github.com/blockstack/stacks-blockchain-api/commit/4deb0077f3c681c461188178f98bc08402874461))
* fixed a lint issue ([974a608](https://github.com/blockstack/stacks-blockchain-api/commit/974a608472b36508d2ca6b0e156f684f514380a2))
* fixed datastore error ([ce3f071](https://github.com/blockstack/stacks-blockchain-api/commit/ce3f07160b01662bda70072448c11177bb3a93b2))
* fixed lint issue ([12183db](https://github.com/blockstack/stacks-blockchain-api/commit/12183db2db83ab2a98103ae48fa0f056ef01e4a9))
* fixed name not being updated issue, update names for name update ([a0d7828](https://github.com/blockstack/stacks-blockchain-api/commit/a0d7828ca30308517076de1c8fc52f505c31dc2e))
* fixed name-register missing issue ([ba38df2](https://github.com/blockstack/stacks-blockchain-api/commit/ba38df29cf03c4f902026f138affd5a5305c8dd5))
* fixed schema paths (open-api) ([6d7d669](https://github.com/blockstack/stacks-blockchain-api/commit/6d7d669ea6c1cdf163eda0eb7af7927423231141))
* fixed subdomains zonefile ([fca5c25](https://github.com/blockstack/stacks-blockchain-api/commit/fca5c25919c6c858ee9f614cb26aa6e5a7c9676e))
* fixed type ([8a4cf53](https://github.com/blockstack/stacks-blockchain-api/commit/8a4cf53cac9d125ec6953983f0e7bc00f392ccfe))
* fixed zonefile type in name info response schema ([7092ed6](https://github.com/blockstack/stacks-blockchain-api/commit/7092ed673ecaedbf22ddf9afcd22a4193fa8efdd))
* handle invalid BTC addresses in import ([0a92015](https://github.com/blockstack/stacks-blockchain-api/commit/0a92015319d10e6cbbb3ad0eb24e59ef7739210a))
* handle re-org for subdomains ([054ff56](https://github.com/blockstack/stacks-blockchain-api/commit/054ff560cd411a93229dfe748fa98bc06aaa704e))
* import path format safety ([001301a](https://github.com/blockstack/stacks-blockchain-api/commit/001301ac88ef3b68cdd51405e11be8fc0342abb2))
* linting errors after an eslint dependency disregarded semver and implemented breaking changes ([63bfca2](https://github.com/blockstack/stacks-blockchain-api/commit/63bfca25de84a67cf92a5b565bcdcd25b20b6e1f))
* liquid STX discrepancy between sql db and /v2/pox [#468](https://github.com/blockstack/stacks-blockchain-api/issues/468) ([106c595](https://github.com/blockstack/stacks-blockchain-api/commit/106c595caee6ebdd2a013b1e96099c49817fbe4a))
* namespaces, name insertions in db - updated tests ([502c1ec](https://github.com/blockstack/stacks-blockchain-api/commit/502c1ec42951ff0b63e14a237587ead35a8f68a1))
* namespaces, names used from tx (DataStoreUpdateData) ([977a9fb](https://github.com/blockstack/stacks-blockchain-api/commit/977a9fbd02bc0a8bb6912edde72cfa1878523430))
* parsing updated chainstate.txt format ([200455a](https://github.com/blockstack/stacks-blockchain-api/commit/200455a5e7bfce9f4ad2c6879dbbb3071636f39c))
* redirect url in bns names api ([#560](https://github.com/blockstack/stacks-blockchain-api/issues/560)) ([d36dc62](https://github.com/blockstack/stacks-blockchain-api/commit/d36dc62234fb39ea613eb8ac7025428eb9d469a0))
* remove /v2/pox override, no longer needed [#474](https://github.com/blockstack/stacks-blockchain-api/issues/474) ([72fc7ef](https://github.com/blockstack/stacks-blockchain-api/commit/72fc7ef9ede0a30e0349694d94b755f2ce6e0354))
* remove empty line for lint ([7b92455](https://github.com/blockstack/stacks-blockchain-api/commit/7b92455745b08bf8b331940c7dbd145b8fda6b8b))
* remove extra space ([75fd47d](https://github.com/blockstack/stacks-blockchain-api/commit/75fd47d441ee3436e2a80f833bdfe7a26890a3b9))
* removed logs added TODO for tests ([88bc889](https://github.com/blockstack/stacks-blockchain-api/commit/88bc8891a01c2d99aab19031a134259c2f10544a))
* rename src/importV1 to src/import-v1 ([bf3d4c1](https://github.com/blockstack/stacks-blockchain-api/commit/bf3d4c15a01cde7665309dc451df423883a1cf6c))
* rename the @blockstack/stacks-blockchain-api-types package to @stacks/stacks-blockchain-api-types ([0393c12](https://github.com/blockstack/stacks-blockchain-api/commit/0393c128d6e71f58bfe27502f50730fd0715e461))
* revert package.json changes ([5914abc](https://github.com/blockstack/stacks-blockchain-api/commit/5914abc73e0d80f0d74307f13af2e3987e1c4acc))
* tests updated ([a06b015](https://github.com/blockstack/stacks-blockchain-api/commit/a06b015e6cdf4aedbdc8bcb4b3b8e09ff4b123e9))
* update zone-file lib to latest with typescript support ([966d14b](https://github.com/blockstack/stacks-blockchain-api/commit/966d14b68fcad057111e9d56ed81ab4318087a43))
* updated schema file ref in open api ([de796d1](https://github.com/blockstack/stacks-blockchain-api/commit/de796d17282a24eba09c069b826c0e7d5430a454))
* use a single db client connection for the import ([9ee4d16](https://github.com/blockstack/stacks-blockchain-api/commit/9ee4d16a58a1fac7eb06a1eb6ec4f6dff7d8949b))
* use index_block_hash for unresolved subdomain attachment handling ([7f88860](https://github.com/blockstack/stacks-blockchain-api/commit/7f8886024a4caf0d57a825dc2b526e6b94c4c1ef))


### Features

* [rosetta] stacking operation ([1cb8e9c](https://github.com/blockstack/stacks-blockchain-api/commit/1cb8e9cdb9b0a5933c429e1616325bacebc97060))
* add pricing names and namespaces ([98989a5](https://github.com/blockstack/stacks-blockchain-api/commit/98989a59c9dde782233cc68d86e088d578b5d033))
* address transactions with stx transfers endpoint ([#547](https://github.com/blockstack/stacks-blockchain-api/issues/547)) ([01bcbf7](https://github.com/blockstack/stacks-blockchain-api/commit/01bcbf7cb474986f9b464f4a50f1ad60392dc0b7))
* API endpoint to get reward slot holder entries for a given address ([5be97a2](https://github.com/blockstack/stacks-blockchain-api/commit/5be97a2e1a8d1f3232464ec88b6bc5ff77e91227))
* bns: namespaces endpoints implementation ([5d87dd3](https://github.com/blockstack/stacks-blockchain-api/commit/5d87dd3745f779c2bb5e7b23816c0a04689aa7c4))
* db handling and API endpoint for burnchain reward slot holder event data ([382036c](https://github.com/blockstack/stacks-blockchain-api/commit/382036c48a6a3f346a4935fa6cc36c82c285e2d1))
* expose token sale locking/unlocking data ([#553](https://github.com/blockstack/stacks-blockchain-api/issues/553)) ([78d475f](https://github.com/blockstack/stacks-blockchain-api/commit/78d475f9a31f5440ebc027bce18d3e0dad0b3d70))
* get names by address and historical zonefile ([bdde26c](https://github.com/blockstack/stacks-blockchain-api/commit/bdde26c2c98cf625fc5e9e6de4d09bef572923f9))
* implement graceful shutdown handler for the event http server ([07048bd](https://github.com/blockstack/stacks-blockchain-api/commit/07048bdceda9c2bfaa9437a58971b072189cfe7f))
* implement offline mode ([#545](https://github.com/blockstack/stacks-blockchain-api/issues/545)) ([be2358b](https://github.com/blockstack/stacks-blockchain-api/commit/be2358b13f298e3f201db5a14783625bc20c502b))
* include chainstate.txt and import token offering locked data by default ([#556](https://github.com/blockstack/stacks-blockchain-api/issues/556)) ([d0f966c](https://github.com/blockstack/stacks-blockchain-api/commit/d0f966c0975a775f2ea6ab6176a43cf297904cdd))
* make the v2 proxy cache control file configurable via env var [#519](https://github.com/blockstack/stacks-blockchain-api/issues/519) ([#559](https://github.com/blockstack/stacks-blockchain-api/issues/559)) ([8929191](https://github.com/blockstack/stacks-blockchain-api/commit/89291913fe881d902d5285c4507a7a8f2dd79329))
* streams and async iterators for subdomain import reading ([8b00a5e](https://github.com/blockstack/stacks-blockchain-api/commit/8b00a5e4057d1887e9fc743152742a374ec5aa64))
* test for fetch burnchain rewards for testnet STX address ([0f7d02e](https://github.com/blockstack/stacks-blockchain-api/commit/0f7d02e8797cb62f750cb52bab49378f6b2299cb))

## [0.55.3](https://github.com/blockstack/stacks-blockchain-api/compare/v0.55.2...v0.55.3) (2021-03-31)


### Bug Fixes

* Added  suggested fee ([1d66eee](https://github.com/blockstack/stacks-blockchain-api/commit/1d66eee3e097a8b8d2b3b2462c70e07725434354))
* better variable name ([4d2ade3](https://github.com/blockstack/stacks-blockchain-api/commit/4d2ade3cd059cb8786e94ab4e3db996470a42d21))
* fee deprecate ([bc803a1](https://github.com/blockstack/stacks-blockchain-api/commit/bc803a197e77e4a2007a67a4a66d9827680f5b60))
* fix name ([4c3e6c0](https://github.com/blockstack/stacks-blockchain-api/commit/4c3e6c00c1ee69f6bd654232d0c159610b33f77f))
* linter complaints ([508b71a](https://github.com/blockstack/stacks-blockchain-api/commit/508b71a88ede1a1573915ab3d1d2508e3085aabe))
* renaming getStacksTestnetNetwork to fit naming standard ([86756f5](https://github.com/blockstack/stacks-blockchain-api/commit/86756f5c46f28803aef996496c6164c3f9abd378))
* size should be integer type and not number ([5f75b40](https://github.com/blockstack/stacks-blockchain-api/commit/5f75b4005ebea486f2de3c95ec5d370530e84475))
* use BigInt to calculate fee ([f5468ad](https://github.com/blockstack/stacks-blockchain-api/commit/f5468add845b8325e26211765e1f948a56b997a3))

## [0.55.2](https://github.com/blockstack/stacks-blockchain-api/compare/v0.55.1...v0.55.2) (2021-03-18)


### Bug Fixes

* support fetching raw tx data for mempool transactions [#509](https://github.com/blockstack/stacks-blockchain-api/issues/509) ([18b4f5c](https://github.com/blockstack/stacks-blockchain-api/commit/18b4f5c52565b839fa30886ffe63cfccee45fabf))

## [0.55.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.55.0...v0.55.1) (2021-03-18)


### Bug Fixes

* add total in account asset query ([b9ea4fa](https://github.com/blockstack/stacks-blockchain-api/commit/b9ea4fa2f4c2a29bfb399b5bb2d9bd765485b944))
* remove extra comma ([a86423e](https://github.com/blockstack/stacks-blockchain-api/commit/a86423ed2e4e622ac69bd614ecebb1448f7876f3))
* update schema ([7be87c2](https://github.com/blockstack/stacks-blockchain-api/commit/7be87c2812e00d90ea5df98e813324d2d47d655d))
* use common clarity type in NFTEvent (506) ([bfd1a9c](https://github.com/blockstack/stacks-blockchain-api/commit/bfd1a9cd7e3c890b3e8502cd6a921e66dcbf44d5))

# [0.55.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.54.0...v0.55.0) (2021-03-17)


### Bug Fixes

* proxy cache file watcher preventing process from exiting ([15ee8ce](https://github.com/blockstack/stacks-blockchain-api/commit/15ee8cedf2f8fe878823936232a10345fe244b1c))


### Features

* ability to specify cache-control headers for v2 proxied paths ([ed07e73](https://github.com/blockstack/stacks-blockchain-api/commit/ed07e732ddd73594478587d5ae8ae466216c98c7))

# [0.54.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.53.5...v0.54.0) (2021-03-17)


### Bug Fixes

* add ETIMEDOUT error code to postgres connection retry logic ([02f8916](https://github.com/blockstack/stacks-blockchain-api/commit/02f8916ecbb4bb4de06403a709daf3dfef0dc12d))
* handle transient postgres connection errors [#497](https://github.com/blockstack/stacks-blockchain-api/issues/497) ([3b721c7](https://github.com/blockstack/stacks-blockchain-api/commit/3b721c760be9c0ada6410ac7df3234f16375e17b))
* more accurate v2 path labels ([8652036](https://github.com/blockstack/stacks-blockchain-api/commit/86520365f69b7c879b072b5dedb8c49defd9b470))


### Features

* add a few common v2 paths to the prom route catch all ([8897b55](https://github.com/blockstack/stacks-blockchain-api/commit/8897b5560b71e76468ffb28597fb69283cf9d6c7))
* condence all v2 routes into a single prom metric bucket ([3f82786](https://github.com/blockstack/stacks-blockchain-api/commit/3f827869469970fb59635c5331211e8793c7b254))

## [0.53.5](https://github.com/blockstack/stacks-blockchain-api/compare/v0.53.4...v0.53.5) (2021-03-17)


### Bug Fixes

* convert nft Buffer value to string ([a3c404e](https://github.com/blockstack/stacks-blockchain-api/commit/a3c404e621289ad409b2e10abacb6945519d939a))
* eslint issues ([1da22d4](https://github.com/blockstack/stacks-blockchain-api/commit/1da22d464a18e4cab970ce135f4b823d1ab3d647))
* fixed nft events query to check for ownership ([512a3ad](https://github.com/blockstack/stacks-blockchain-api/commit/512a3ad3a057190cab6f8e899a5c6937d6cca2b9))
* remove unnecessary sender from query ([78d211a](https://github.com/blockstack/stacks-blockchain-api/commit/78d211a2f97436f5061d220c0722a36a77d71079))

## [0.53.4](https://github.com/blockstack/stacks-blockchain-api/compare/v0.53.3...v0.53.4) (2021-03-16)


### Bug Fixes

* lint-semicolon added ([2d73c82](https://github.com/blockstack/stacks-blockchain-api/commit/2d73c82396a535c9501f9924af218c61984481f6))
* raw trasaction type - docs updated - tests update ([cef4ba3](https://github.com/blockstack/stacks-blockchain-api/commit/cef4ba395110df879f731123bcd46c602e499b35))
* schema path updated in openapi.yaml ([16dd9de](https://github.com/blockstack/stacks-blockchain-api/commit/16dd9def3d1d00f8f5e1327ca8993d9d97447f73))

## [0.53.3](https://github.com/blockstack/stacks-blockchain-api/compare/v0.53.2...v0.53.3) (2021-03-16)


### Bug Fixes

* reduce to 90 days ([1b8d855](https://github.com/blockstack/stacks-blockchain-api/commit/1b8d8555d45b063efa889aa83f11c2c864657476))
* set 90 days for pulls only ([b19be3e](https://github.com/blockstack/stacks-blockchain-api/commit/b19be3ed0553bbc13d06ac673163357b6e6bfd6f))

## [0.53.2](https://github.com/blockstack/stacks-blockchain-api/compare/v0.53.1...v0.53.2) (2021-03-15)


### Bug Fixes

* construction api improvement ([7c31495](https://github.com/blockstack/stacks-blockchain-api/commit/7c3149516b9738b309956711047b9567f6d3b1b5))
* status should be null for construction api ([782e097](https://github.com/blockstack/stacks-blockchain-api/commit/782e097e2acd40ea4f003e2ad5d3e15d126704d4))

## [0.53.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.53.0...v0.53.1) (2021-03-12)


### Bug Fixes

* openAPI plain string example breaking redoc generator ([241d89a](https://github.com/blockstack/stacks-blockchain-api/commit/241d89a23c8189c319f1a182b9e9075ad9343f9f))

# [0.53.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.52.5...v0.53.0) (2021-03-12)


### Features

* expand stx-supply endpoints ([b130740](https://github.com/blockstack/stacks-blockchain-api/commit/b1307406560fbcfd2d8f598e0b395397798f0995))

## [0.52.5](https://github.com/blockstack/stacks-blockchain-api/compare/v0.52.4...v0.52.5) (2021-03-12)


### Bug Fixes

* do not store aborted events ([dc63573](https://github.com/blockstack/stacks-blockchain-api/commit/dc635734149a670dfcbd076215805dbf64db1c82))

## [0.52.4](https://github.com/blockstack/stacks-blockchain-api/compare/v0.52.3...v0.52.4) (2021-03-12)


### Bug Fixes

* correct post-condition code string (greater than vs greater than or equal) ([5758a9e](https://github.com/blockstack/stacks-blockchain-api/commit/5758a9e49202169070c931b5304802bc286cc7dd))
* post condition code unit test fixes ([b67eb14](https://github.com/blockstack/stacks-blockchain-api/commit/b67eb1454f98aadbf6f66a2e1343a33f899abe8c))

## [0.52.3](https://github.com/blockstack/stacks-blockchain-api/compare/v0.52.2...v0.52.3) (2021-03-11)


### Bug Fixes

* linter errors ([9ea187f](https://github.com/blockstack/stacks-blockchain-api/commit/9ea187f1f3a3f65b7b2267f143de6a86bee67d4e))
* support `nft_burn_event` and `ft_burn_event` ([607707e](https://github.com/blockstack/stacks-blockchain-api/commit/607707edb5d0f448a31c40e3e3fc3e288cccfebd))

## [0.52.2](https://github.com/blockstack/stacks-blockchain-api/compare/v0.52.1...v0.52.2) (2021-03-08)


### Bug Fixes

* add missing index.d.ts generated file ([9749511](https://github.com/blockstack/stacks-blockchain-api/commit/9749511a6608c52b9c755d453bba146b7d22c66e))
* block endpoint & minor fixes (rosetta) ([#23](https://github.com/blockstack/stacks-blockchain-api/issues/23)) ([6426cbc](https://github.com/blockstack/stacks-blockchain-api/commit/6426cbc9eecf172df40575027fa763acaf6f0057))
* change rosetta construction parse api ([#22](https://github.com/blockstack/stacks-blockchain-api/issues/22)) ([2e8ff92](https://github.com/blockstack/stacks-blockchain-api/commit/2e8ff92245a20e94e79f3208fdc70e5adb2a1259)), closes [#11](https://github.com/blockstack/stacks-blockchain-api/issues/11)
* combine endpoint to revert RSV to VRS (rebasing) and use 'ecdsa_recovery' ([6fc0888](https://github.com/blockstack/stacks-blockchain-api/commit/6fc088805fee4b39b88af509ea331099216e485f))
* data API fixes ([#27](https://github.com/blockstack/stacks-blockchain-api/issues/27)) ([b7d3d5a](https://github.com/blockstack/stacks-blockchain-api/commit/b7d3d5addf1eb12c555342e92dc19128886daba9))
* missing generated index file ([98f06e9](https://github.com/blockstack/stacks-blockchain-api/commit/98f06e9ce1c89bc9bf534be8c0195ec6b2f4f008))
* rename getCurrencyData to getStxCurrencyMetadata ([afdbf28](https://github.com/blockstack/stacks-blockchain-api/commit/afdbf2880f535689f1eb9ac9c8f5033dec2b3791))
* revert modifying .env ([ccb2935](https://github.com/blockstack/stacks-blockchain-api/commit/ccb29352ed82f50d93e96de22c3d61ea126e89b0))
* rosetta construction derive api ([#21](https://github.com/blockstack/stacks-blockchain-api/issues/21)) ([cade138](https://github.com/blockstack/stacks-blockchain-api/commit/cade138987df5ffe77d683c0392900925f07a161)), closes [#10](https://github.com/blockstack/stacks-blockchain-api/issues/10)
* spaces ([53981c1](https://github.com/blockstack/stacks-blockchain-api/commit/53981c191f2e9cd9cec3b0736dd55edd26a2ab1e))

## [0.52.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.52.0...v0.52.1) (2021-03-08)


### Bug Fixes

* also generate client docs ([475ba26](https://github.com/blockstack/stacks-blockchain-api/commit/475ba26e45dfbb867ba3eacc27060e0d5396f7cc))

# [0.52.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.51.0...v0.52.0) (2021-03-05)


### Features

* add dotenv-flow ([1776443](https://github.com/blockstack/stacks-blockchain-api/commit/1776443b103789aea5c1a782cf73c5a68a7b6f99))

# [0.51.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.50.0...v0.51.0) (2021-03-04)


### Bug Fixes

* dropped mempool tx list count property ([58d0e31](https://github.com/blockstack/stacks-blockchain-api/commit/58d0e31195b89e9631bc1904f8e37ea763a46efb))
* improve conditions in which a dropped vs non-canonical tx result is returned ([2a57fbc](https://github.com/blockstack/stacks-blockchain-api/commit/2a57fbc5c2884ce874f20d8f71ac354b991eb283))
* update conditions for when a mined canonical vs non-canonical, vs mempool tx is returned ([573f75c](https://github.com/blockstack/stacks-blockchain-api/commit/573f75cc0dee34c6efab8176ebb00b7c28269515))


### Features

* distinct tx status values for mempool txs vs mined tx responses ([3236053](https://github.com/blockstack/stacks-blockchain-api/commit/3236053431732dd74fadd7316471094058e61d4c))
* endpoint to query dropped mempool txs ([4556cd7](https://github.com/blockstack/stacks-blockchain-api/commit/4556cd7c257355be6a1972d4bd5c04f4d6f550e4))
* implement dropped transaction event handling and API responses ([9936c66](https://github.com/blockstack/stacks-blockchain-api/commit/9936c6628b95e16a301143c19347d755bfc940ab))

# [0.50.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.49.0...v0.50.0) (2021-02-26)


### Features

* implement total supply endpoint with legacy formatting support ([811f06b](https://github.com/blockstack/stacks-blockchain-api/commit/811f06b6ed02770cf2c0bc8c9a5a513b4e4c6646))
* openAPI docs for total-supply endpoint ([cec343a](https://github.com/blockstack/stacks-blockchain-api/commit/cec343a1ea20f5aa0d230be94def12e9bdfc6b08))
* openAPI docs for total-supply legacy format endpoint ([e627209](https://github.com/blockstack/stacks-blockchain-api/commit/e627209351ad4e4e74f86a1fb92ac6edb2f1ac9b))

# [0.49.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.48.3...v0.49.0) (2021-02-23)


### Bug Fixes

* signature fix(ecdsa) combine api ([a52e172](https://github.com/blockstack/stacks-blockchain-api/commit/a52e17249439a8d715500107160f059a46fb2d2a))
* specify radix in `height` parseInt ([eb7b623](https://github.com/blockstack/stacks-blockchain-api/commit/eb7b623476ec727e53b5cea196694757bc07191d))
* specify radix in `height` parseInt ([5dcf73e](https://github.com/blockstack/stacks-blockchain-api/commit/5dcf73e47ee454287e3649557c404b7fbe09dd7d))


### Features

* add `height` filter to `/stx_inbound`, increase pagination limit, fix error response msg ([dc0d111](https://github.com/blockstack/stacks-blockchain-api/commit/dc0d11193ebd1d1c99764ca676744ca969a366e9))
* get block by height endpoint ([f05332b](https://github.com/blockstack/stacks-blockchain-api/commit/f05332b077c364d5fabc05c2c0bce90d84decac0))

## [0.48.3](https://github.com/blockstack/stacks-blockchain-api/compare/v0.48.2...v0.48.3) (2021-02-16)


### Bug Fixes

* move stx_inbound extended text to `description` ([62511d8](https://github.com/blockstack/stacks-blockchain-api/commit/62511d87d2141ced8939e890f844d4d35b7cd807))

## [0.48.2](https://github.com/blockstack/stacks-blockchain-api/compare/v0.48.1...v0.48.2) (2021-02-16)


### Bug Fixes

* error fetching coinbase tx containing events [#446](https://github.com/blockstack/stacks-blockchain-api/issues/446) ([d3b1e96](https://github.com/blockstack/stacks-blockchain-api/commit/d3b1e969f52db3059bba6f128d717d230a103dfa))

## [0.48.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.48.0...v0.48.1) (2021-02-15)


### Bug Fixes

* bump stacks-node docker image versions to 2.0.5 ([8ebdf25](https://github.com/blockstack/stacks-blockchain-api/commit/8ebdf25a0f4f554740cfdd7508599ebb65e9194e))

# [0.48.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.47.5...v0.48.0) (2021-02-15)


### Features

* add block height filter to `/extended/v1/address/:address/transactions` ([5d9492f](https://github.com/blockstack/stacks-blockchain-api/commit/5d9492f1b7b581c656fac9ed08b04df894ad3100))
* add recipients of stx from contract-call txs to `:address/transactions` ([1280dd0](https://github.com/blockstack/stacks-blockchain-api/commit/1280dd0d240c93553eed0acebe499c5c52bc81b0))
* include any tx type in the address filtered mempool result, fixes [#438](https://github.com/blockstack/stacks-blockchain-api/issues/438) ([d532309](https://github.com/blockstack/stacks-blockchain-api/commit/d5323093882c17761a0924c7716702273645b888))
* new api endpoint to get inbound stx and send-many transfers with memos ([875dfa3](https://github.com/blockstack/stacks-blockchain-api/commit/875dfa34caf113ab072000a1152541be59341c42))

## [0.47.5](https://github.com/blockstack/stacks-blockchain-api/compare/v0.47.4...v0.47.5) (2021-02-12)


### Bug Fixes

* add tx_fees_streamed_produced ([021082a](https://github.com/blockstack/stacks-blockchain-api/commit/021082ac358423fbf8db7a69ac103ca3949366ff))
* bug with rewards received in immediately non-canonical blocks ([2c587ac](https://github.com/blockstack/stacks-blockchain-api/commit/2c587ac968ac4a6056f9dd550e94d27e08315d8a))
* correct re-org handling for miner rewards, although something still off ([e10c121](https://github.com/blockstack/stacks-blockchain-api/commit/e10c1215b3a4525721bfc2e107b36caf68045c33))

## [0.47.4](https://github.com/blockstack/stacks-blockchain-api/compare/v0.47.3...v0.47.4) (2021-02-12)


### Bug Fixes

* custom nonce added in /payloads and /balance ([f8dbc54](https://github.com/blockstack/stacks-blockchain-api/commit/f8dbc542bbf323344f50410a473718bbf15914da))

## [0.47.3](https://github.com/blockstack/stacks-blockchain-api/compare/v0.47.2...v0.47.3) (2021-02-11)


### Bug Fixes

* removed 0x from public key in rosetta combine api ([c127017](https://github.com/blockstack/stacks-blockchain-api/commit/c127017d83e917a6f6a526389a127eed4d2b5c1f))
* used slice instead of replace ([638a170](https://github.com/blockstack/stacks-blockchain-api/commit/638a170a56efe259bdbcef9dd9970c5727282564))

## [0.47.2](https://github.com/blockstack/stacks-blockchain-api/compare/v0.47.1...v0.47.2) (2021-01-30)


### Bug Fixes

* add `?tip` query param to RPC methods ([18a0532](https://github.com/blockstack/stacks-blockchain-api/commit/18a05328942cb27f14866955f7f1ed0358e1d237))

## [0.47.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.47.0...v0.47.1) (2021-01-26)


### Bug Fixes

* chainid env var to work around bootup deadlock ([cee0547](https://github.com/blockstack/stacks-blockchain-api/commit/cee0547d0143a9b4498adb939a683faafbc9a49e))

# [0.47.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.46.0...v0.47.0) (2021-01-25)


### Bug Fixes

* ignore failed on-btc-chain transactions ([4c69b66](https://github.com/blockstack/stacks-blockchain-api/commit/4c69b661fb0b0b18a33a53b4175847c5cf4289af))
* more unit test fixes ([21df2fc](https://github.com/blockstack/stacks-blockchain-api/commit/21df2fc40cb10d40218f24b85f1eb6d058072795))
* tests ([f3048ca](https://github.com/blockstack/stacks-blockchain-api/commit/f3048ca04e888fe9547e0c6e921619d266c3e0b0))


### Features

* handling for on-btc-chain stx-stacks operations ([7c804f8](https://github.com/blockstack/stacks-blockchain-api/commit/7c804f8d6fe04a35db0e9cb4497f3865fe5c2c4d))

# [0.46.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.45.0...v0.46.0) (2021-01-25)


### Features

* env var override for /v2/pox min_amount_ustx ([be27f04](https://github.com/blockstack/stacks-blockchain-api/commit/be27f04625d2215c65256d648dc8ffa8a7f3750f))

# [0.45.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.44.0...v0.45.0) (2021-01-25)


### Features

* normalize express prometheus metrics with route parsing ([292f794](https://github.com/blockstack/stacks-blockchain-api/commit/292f794c89f803475c537cd8a10067da2c6098fb))

# [0.44.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.43.0...v0.44.0) (2021-01-20)


### Features

* filter mempool by stx address ([44f2207](https://github.com/blockstack/stacks-blockchain-api/commit/44f220765ed8ed46f6371f78d19bae0c4d49e97a))

# [0.43.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.42.2...v0.43.0) (2021-01-20)


### Features

* add tx nonce field ([22d7361](https://github.com/blockstack/stacks-blockchain-api/commit/22d7361695b21f287a7c7938d2ccdd469a2a0f5c))

## [0.42.2](https://github.com/blockstack/stacks-blockchain-api/compare/v0.42.1...v0.42.2) (2021-01-19)


### Bug Fixes

* [#402](https://github.com/blockstack/stacks-blockchain-api/issues/402) tx events not showing due to pagination issue ([61db3f8](https://github.com/blockstack/stacks-blockchain-api/commit/61db3f8ef5ada9d4ecf47ea439baf931bbfa7e9b))

## [0.42.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.42.0...v0.42.1) (2021-01-19)


### Bug Fixes

* create mock transactions for BTC -- attempt 2 ([ec82251](https://github.com/blockstack/stacks-blockchain-api/commit/ec822513c888f3a62566d4fe642d813cdea9b4e6))


### Reverts

* Revert "fix: create mock tx from event for BTC tx's" ([1ba13a0](https://github.com/blockstack/stacks-blockchain-api/commit/1ba13a0270adfe5146797a42428b5f07c2137418))

# [0.42.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.41.1...v0.42.0) (2021-01-16)


### Features

* detect chain ID during init and use in rosetta APIs ([ad4b7a0](https://github.com/blockstack/stacks-blockchain-api/commit/ad4b7a04596b24ad608b590a64306a78f190739c))

## [0.41.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.41.0...v0.41.1) (2021-01-16)


### Bug Fixes

* create mock tx from event for BTC tx's ([e5c1512](https://github.com/blockstack/stacks-blockchain-api/commit/e5c1512fbdc4ddef8ab41e24766b03c7da22b14c))

# [0.41.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.40.1...v0.41.0) (2021-01-15)


### Features

* config to specifying a different core node for the /v2 proxy ([2a0ed09](https://github.com/blockstack/stacks-blockchain-api/commit/2a0ed0977336efec42d0548d859126a62ca4c2e0))
* configure custom http agent used in v2 proxy, limit max sockets ([b5d35d9](https://github.com/blockstack/stacks-blockchain-api/commit/b5d35d9b7973c1174e7f8b5ba9cbe383992f9a6c))

## [0.40.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.40.0...v0.40.1) (2021-01-15)


### Bug Fixes

* log sql query leak detection correctly ([a4a9326](https://github.com/blockstack/stacks-blockchain-api/commit/a4a9326cd9489d98195a04ae85492d84d2c3d5dc))

# [0.40.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.39.0...v0.40.0) (2021-01-14)


### Bug Fixes

* mainnet follower mode ([c91b25d](https://github.com/blockstack/stacks-blockchain-api/commit/c91b25d6086207df3881ce6999f67c7a3d018b71))


### Features

* update to stacks-node 2.0.1 ([dc06236](https://github.com/blockstack/stacks-blockchain-api/commit/dc06236522840c2cdf531cf51f591dfd76ecc202))

# [0.39.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.38.1...v0.39.0) (2021-01-14)


### Bug Fixes

* consistent url path in openapi.yaml ([fca8ea8](https://github.com/blockstack/stacks-blockchain-api/commit/fca8ea8c5ea61150134bbc0f6c6d699b2487e6ed))
* use wss in client example code ([40624ff](https://github.com/blockstack/stacks-blockchain-api/commit/40624ff5faf13065645e552e3710efbb71c93d8e))


### Features

* update server URLs ([67b79e6](https://github.com/blockstack/stacks-blockchain-api/commit/67b79e64f759afaac2289ff82dbd7b2497435ff3)), closes [blockstack/stacks-blockchain-api#381](https://github.com/blockstack/stacks-blockchain-api/issues/381)

## [0.38.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.38.0...v0.38.1) (2021-01-05)


### Bug Fixes

* ignore source map files in sql migration ([d4e50ed](https://github.com/blockstack/stacks-blockchain-api/commit/d4e50ed74c6437c3e61cd20ec5e07462bbf33479))

# [0.38.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.37.0...v0.38.0) (2021-01-05)


### Features

* implement sql query leak detection and logging ([5c74ab1](https://github.com/blockstack/stacks-blockchain-api/commit/5c74ab1b521c77265cc32f2480c28041aa289c2a))

# [0.37.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.36.1...v0.37.0) (2020-12-30)


### Features

* add pagination for tx events [#365](https://github.com/blockstack/stacks-blockchain-api/issues/365) ([6d9c021](https://github.com/blockstack/stacks-blockchain-api/commit/6d9c02191caf1feaa1fd222793efddb696236a7c))

## [0.36.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.36.0...v0.36.1) (2020-12-28)


### Bug Fixes

* miner reward event parse error ([91d82a1](https://github.com/blockstack/stacks-blockchain-api/commit/91d82a183b275d26429fc9d89a8f37d38b884356))

# [0.36.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.35.1...v0.36.0) (2020-12-23)


### Bug Fixes

* rosetta test fixes ([425cb6f](https://github.com/blockstack/stacks-blockchain-api/commit/425cb6f133b39dc0385f5d1586fa63bab81aacbe))
* throw correct error on failure to fetch tx nonce or fee rate values ([6c92a5d](https://github.com/blockstack/stacks-blockchain-api/commit/6c92a5da0a207c79407548c6d0127780234c8cea))
* update couple more krypton to xenon configs ([8169ca7](https://github.com/blockstack/stacks-blockchain-api/commit/8169ca705ef57bb7f6e2a21aec509492ae5002f4))


### Features

* send stx faucet requests to both miner and follower, increment nonce until stack limit reached ([98eab71](https://github.com/blockstack/stacks-blockchain-api/commit/98eab7153fa30b840c8e4034e7ef201d4fdbc395))
* update dev images from krypton to xenon ([b7018b1](https://github.com/blockstack/stacks-blockchain-api/commit/b7018b1b4c861f295638c5b844846aed72c47302))

## [0.35.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.35.0...v0.35.1) (2020-12-15)


### Bug Fixes

* add temporary limit of 200 stx asset events returned for a given transaction ([d6c663c](https://github.com/blockstack/stacks-blockchain-api/commit/d6c663cba919b3be2d99107f372ec0af7dabe4c3))

# [0.35.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.34.2...v0.35.0) (2020-12-14)


### Bug Fixes

* increase event stream body POST size limit for large genesis block ([b0327fd](https://github.com/blockstack/stacks-blockchain-api/commit/b0327fd1f1e9b0aff747694f974205f654373a32))
* initial genesis ingest optimization pass, from ~30 minutes to ~30 seconds ([0c3bdba](https://github.com/blockstack/stacks-blockchain-api/commit/0c3bdba37a9a0c8df003ac7663408b281d82862d))


### Features

* abstract batch event inserts, apply to contract events ([94b754b](https://github.com/blockstack/stacks-blockchain-api/commit/94b754b80534aa00e1763fe1b6aa7a0302dfa2c8))

## [0.34.2](https://github.com/blockstack/stacks-blockchain-api/compare/v0.34.1...v0.34.2) (2020-11-30)


### Bug Fixes

* security issues with packages ([dd734de](https://github.com/blockstack/stacks-blockchain-api/commit/dd734de1540de1cfd1199b0aa3f4b0eddfa237a8))

## [0.34.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.34.0...v0.34.1) (2020-11-25)


### Bug Fixes

* update core images used in docker files, fix [#349](https://github.com/blockstack/stacks-blockchain-api/issues/349) ([7a9b9ba](https://github.com/blockstack/stacks-blockchain-api/commit/7a9b9baaa28057bc2987b33be948e67aa817cee0))

# [0.34.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.33.0...v0.34.0) (2020-11-24)


### Features

* update to latest stacks.js lib, fixes [#342](https://github.com/blockstack/stacks-blockchain-api/issues/342) ([b8e546c](https://github.com/blockstack/stacks-blockchain-api/commit/b8e546cdd301b0479144810bfd9fb50119310ad8))

# [0.33.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.32.4...v0.33.0) (2020-11-20)


### Bug Fixes

* bug with locked stx referring to STX chaintip rather than burnchain tip [#343](https://github.com/blockstack/stacks-blockchain-api/issues/343) [#344](https://github.com/blockstack/stacks-blockchain-api/issues/344) (same bug in a rosetta function) ([12cd2fa](https://github.com/blockstack/stacks-blockchain-api/commit/12cd2fa7b00b9b837bfa6db8924e55b11dfc694d))
* openapi client gen chokes on nullable string types ([d59c55b](https://github.com/blockstack/stacks-blockchain-api/commit/d59c55b2d5f3f5540021b06c7da225b12b32af78))


### Features

* add lock height and lock txid to balance endpoints [#340](https://github.com/blockstack/stacks-blockchain-api/issues/340) ([aac121d](https://github.com/blockstack/stacks-blockchain-api/commit/aac121d8c7948e40d4eb43bc21685899c783fe73))

## [0.32.4](https://github.com/blockstack/stacks-blockchain-api/compare/v0.32.3...v0.32.4) (2020-11-20)


### Bug Fixes

* bug with locked stx referring to STX chaintip rather than burnchain tip [#343](https://github.com/blockstack/stacks-blockchain-api/issues/343) [#344](https://github.com/blockstack/stacks-blockchain-api/issues/344) ([c1bf091](https://github.com/blockstack/stacks-blockchain-api/commit/c1bf0911157778a02e67cf38413ce115e3616732))

## [0.32.3](https://github.com/blockstack/stacks-blockchain-api/compare/v0.32.2...v0.32.3) (2020-11-18)


### Bug Fixes

* wrap mempool tx inserts in sql transactions, along with a few other queries ([a6cf1f1](https://github.com/blockstack/stacks-blockchain-api/commit/a6cf1f10588cf2ca49955b4a9225af315715d3bc))

## [0.32.2](https://github.com/blockstack/stacks-blockchain-api/compare/v0.32.1...v0.32.2) (2020-11-18)


### Bug Fixes

* increase logging for tx handling in db ([f1d6501](https://github.com/blockstack/stacks-blockchain-api/commit/f1d65018aca9ab9fea2710647dd862492a6c5b39))

## [0.32.2](https://github.com/blockstack/stacks-blockchain-api/compare/v0.32.1...v0.32.2) (2020-11-18)


### Bug Fixes

* increase logging for tx handling in db ([f1d6501](https://github.com/blockstack/stacks-blockchain-api/commit/f1d65018aca9ab9fea2710647dd862492a6c5b39))

## [0.32.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.32.0...v0.32.1) (2020-11-17)


### Bug Fixes

* restore mempool transactions when cycling from non-canonical back to canonical ([c84ecca](https://github.com/blockstack/stacks-blockchain-api/commit/c84ecca5aa7d880fb92ca7aaa3ae418a62e8f43b))

# [0.32.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.31.4...v0.32.0) (2020-11-17)


### Features

* add btc reward API endpoints ([7a9b18e](https://github.com/blockstack/stacks-blockchain-api/commit/7a9b18e43d3e01723fa79e91ca0c5e4034133e8a))
* API for total burn reward amount for address ([72a560f](https://github.com/blockstack/stacks-blockchain-api/commit/72a560f0f713c983c11e47fc9383eafb93186d83))
* integrate btc rewards into db ([19a1e6f](https://github.com/blockstack/stacks-blockchain-api/commit/19a1e6fe7a27ff6d7f9b99cb317014f54bc66314))

## [0.31.4](https://github.com/blockstack/stacks-blockchain-api/compare/v0.31.3...v0.31.4) (2020-11-16)


### Bug Fixes

* [#319](https://github.com/blockstack/stacks-blockchain-api/issues/319) [#330](https://github.com/blockstack/stacks-blockchain-api/issues/330) bump STX faucet to accommodate increasing min Stacking amount ([cfcf45d](https://github.com/blockstack/stacks-blockchain-api/commit/cfcf45d07fbeafefcec294c3bdeb58bf62f415b2))

## [0.31.3](https://github.com/blockstack/stacks-blockchain-api/compare/v0.31.2...v0.31.3) (2020-11-12)


### Bug Fixes

* return string for post transactions endpoint ([a132bcb](https://github.com/blockstack/stacks-blockchain-api/commit/a132bcbfd41b0af243eb1f3563a6ddac44afe9d9))
* use Blob in TransactionsApi ([8d7bdbb](https://github.com/blockstack/stacks-blockchain-api/commit/8d7bdbb153a824ef35ecd49003895c4da403ece5))
* v2/transactions format ([50b0037](https://github.com/blockstack/stacks-blockchain-api/commit/50b003740eef6c9355c3177e77b8e5b431eb6ee5))

## [0.31.2](https://github.com/blockstack/stacks-blockchain-api/compare/v0.31.1...v0.31.2) (2020-11-12)


### Bug Fixes

* [#322](https://github.com/blockstack/stacks-blockchain-api/issues/322) contract names can be less than 5 chars ([b835507](https://github.com/blockstack/stacks-blockchain-api/commit/b8355073506ba222c902ce71758cccc3692480a8))

## [0.31.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.31.0...v0.31.1) (2020-11-12)


### Bug Fixes

* attempt client gh workflow fix [#2](https://github.com/blockstack/stacks-blockchain-api/issues/2) ([5bec19f](https://github.com/blockstack/stacks-blockchain-api/commit/5bec19f7ccc8975df7db70c0c432bdd334f4d50d))
* bad cache keys breaking gh workflow (?) ([c459b2c](https://github.com/blockstack/stacks-blockchain-api/commit/c459b2c915b141148fb8b0ac9989d25317ee6d2c))

# [0.31.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.30.0...v0.31.0) (2020-11-12)


### Features

* define `matured_miner_rewards` object ([8fc8a7a](https://github.com/blockstack/stacks-blockchain-api/commit/8fc8a7a7c4bfb0d7c93ce528e3a00db4fc58f588))
* integrate miner rewards into db and account balance calcuations ([9cac60c](https://github.com/blockstack/stacks-blockchain-api/commit/9cac60cf1919f0e79ee796f947bc9408f6cbfeca))

# [0.30.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.29.5...v0.30.0) (2020-11-12)


### Bug Fixes

* bump nodejs version in github workflow ([0640790](https://github.com/blockstack/stacks-blockchain-api/commit/064079076b6ffe08cdef25aafa041c35947f453c))
* stub response for `/new_burn_block` (allows sidecar to run with latest core node) ([4a48a29](https://github.com/blockstack/stacks-blockchain-api/commit/4a48a294a2312d98a37509de1ff73b4b9f165a27))


### Features

* add locked STX events and balance info to tx and address endpoints [#282](https://github.com/blockstack/stacks-blockchain-api/issues/282) [#268](https://github.com/blockstack/stacks-blockchain-api/issues/268) ([67cb65d](https://github.com/blockstack/stacks-blockchain-api/commit/67cb65df366eaf0fbb79226318230b00472087f3))
* add STX lock events to API endpoints ([e20f4df](https://github.com/blockstack/stacks-blockchain-api/commit/e20f4dfc4d80468f7da14d71749f8f1d364a515d))
* integrate Stacking STX into database and provide through account API details, upgrade to nodejs v14 ([b61129c](https://github.com/blockstack/stacks-blockchain-api/commit/b61129c2f177054befae9255d9180c7bcfabc31d))
* integrate stx lock event handling into db ([334eb9d](https://github.com/blockstack/stacks-blockchain-api/commit/334eb9da9d6c0cb9f1d50479c90ea8bfd3a60c63))
* use core event_index from https://github.com/blockstack/stacks-blockchain/pull/2050 ([9d8db70](https://github.com/blockstack/stacks-blockchain-api/commit/9d8db70fe1ae52fb8d737d3ed5dc8f8383a36bbc))
* use STX locked_address from https://github.com/blockstack/stacks-blockchain/pull/2050 ([ac741d7](https://github.com/blockstack/stacks-blockchain-api/commit/ac741d7c5b56dd6a4676aee0135eea44f3a75d6b))

## [0.29.5](https://github.com/blockstack/stacks-blockchain-api/compare/v0.29.4...v0.29.5) (2020-11-12)


### Bug Fixes

* update v2/info documentation and client ([35afa71](https://github.com/blockstack/stacks-blockchain-api/commit/35afa71fbdf5a9b714a572480364d8fef67f8126))

## [0.29.4](https://github.com/blockstack/stacks-blockchain-api/compare/v0.29.3...v0.29.4) (2020-11-11)


### Bug Fixes

* getStxBalanceAtBlock() did not calculate fees properly ([944bc36](https://github.com/blockstack/stacks-blockchain-api/commit/944bc36e18da79060b72e6efdc85cc59b88ee408))
* handle contract call transactions with no function args ([531d9ad](https://github.com/blockstack/stacks-blockchain-api/commit/531d9adddad5b1c7e224071964e054de81714873))

## [0.29.3](https://github.com/blockstack/stacks-blockchain-api/compare/v0.29.2...v0.29.3) (2020-11-10)


### Bug Fixes

* copy *.toml from the app build section, do not depend on local repo ([c43258c](https://github.com/blockstack/stacks-blockchain-api/commit/c43258c140bcd56c1e7ad9af659ce5464c12d456))
* oops, forgot to update the test to check for rosetta 1.4.6 ([8b705c0](https://github.com/blockstack/stacks-blockchain-api/commit/8b705c074b3f0c217e6ce5864fb36f629a5d4dc7))
* remove a command from stx-rosetta.Dockerfile used for testing ([ccdde18](https://github.com/blockstack/stacks-blockchain-api/commit/ccdde18cd52cdeebbe2e4a3307f22da0057ee085))
* remove check:construction until the other PR is merged ([7cb531d](https://github.com/blockstack/stacks-blockchain-api/commit/7cb531d29bbe86abeba4bced4cd1b254040761d6))
* stx-rosetta.Dockerfile had a COPY that should not be committed ([e52ea17](https://github.com/blockstack/stacks-blockchain-api/commit/e52ea176e4b9dfdf9dbf392ca0e7907df1e3712e))
* upgrade rosetta version from 1.4.2 to 1.4.6 ([2e621be](https://github.com/blockstack/stacks-blockchain-api/commit/2e621be6ccfab118efe3a4d8fe7a86a9a807d9cb))

## [0.29.2](https://github.com/blockstack/stacks-blockchain-api/compare/v0.29.1...v0.29.2) (2020-11-05)


### Bug Fixes

* lint issue ([8af17fc](https://github.com/blockstack/stacks-blockchain-api/commit/8af17fcfda03fa638855388f10eac5a174357252))
* removed empty status ([d4cfa51](https://github.com/blockstack/stacks-blockchain-api/commit/d4cfa51b9721922645592a461d951143e9070610))

## [0.29.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.29.0...v0.29.1) (2020-10-27)


### Bug Fixes

* [#306](https://github.com/blockstack/stacks-blockchain-api/issues/306) query for min stacking STX amount from /v2/pox endpoint ([1ba0599](https://github.com/blockstack/stacks-blockchain-api/commit/1ba0599d725311b8ad3e5486bf7910673e2994b5))

# [0.29.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.28.0...v0.29.0) (2020-10-27)


### Features

* [#302](https://github.com/blockstack/stacks-blockchain-api/issues/302) add btc info to blocks, [#301](https://github.com/blockstack/stacks-blockchain-api/issues/301) pull stacks-node from dockerhub image ([9e9fd99](https://github.com/blockstack/stacks-blockchain-api/commit/9e9fd9922770cd75e366cab86fe339872cb60379))

# [0.28.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.27.0...v0.28.0) (2020-10-15)


### Bug Fixes

* adding schema for fee estimates ([6c13a55](https://github.com/blockstack/stacks-blockchain-api/commit/6c13a554cced554509531408543550e3afdf9156))


### Features

* adding client updates ([5999360](https://github.com/blockstack/stacks-blockchain-api/commit/5999360e4c05a10a37b16bd4ca932d05c4b7f8df))

# [0.27.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.26.0...v0.27.0) (2020-10-13)


### Features

* adding new pox & stacking fields ([75f7f8e](https://github.com/blockstack/stacks-blockchain-api/commit/75f7f8ef7463280452f2187780e90f256b1952cf))

# [0.26.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.25.5...v0.26.0) (2020-10-12)


### Bug Fixes

* add support for multi signature in payloads endpoint ([4b1adf2](https://github.com/blockstack/stacks-blockchain-api/commit/4b1adf260ad193d0ae844c18ba8719870dd36d96))
* fixed number of multisignature ([46af37a](https://github.com/blockstack/stacks-blockchain-api/commit/46af37aca7fcda3e1746ccbb12c591fcb22d939f))


### Features

* add implementation of rosetta construction/combine endpoint ([8d7f0dc](https://github.com/blockstack/stacks-blockchain-api/commit/8d7f0dc8996943d5568d2ad7528e930e80a084e5))
* implement rosetta construction/payloads endpoint ([55f855a](https://github.com/blockstack/stacks-blockchain-api/commit/55f855a4b0a46e73f5829cc1aa64d7504bbe439f))

## [0.25.5](https://github.com/blockstack/stacks-blockchain-api/compare/v0.25.4...v0.25.5) (2020-10-12)


### Bug Fixes

* add a return statement after setting the response ([e833b1b](https://github.com/blockstack/stacks-blockchain-api/commit/e833b1b5305c2531a67c97c948757d12f322df7d))
* update condition ([991961c](https://github.com/blockstack/stacks-blockchain-api/commit/991961c8dd351ab25d7edec1954bb5ecaa06c312))

## [0.25.4](https://github.com/blockstack/stacks-blockchain-api/compare/v0.25.3...v0.25.4) (2020-10-07)


### Bug Fixes

* [#280](https://github.com/blockstack/stacks-blockchain-api/issues/280) -- standalone docker image broken ([58d05c6](https://github.com/blockstack/stacks-blockchain-api/commit/58d05c67ee5309b744a420c6e7bb3ac2d4f0a29b))

## [0.25.3](https://github.com/blockstack/stacks-blockchain-api/compare/v0.25.2...v0.25.3) (2020-10-06)


### Bug Fixes

* fix mempool transaction issue response issue ([4bb146d](https://github.com/blockstack/stacks-blockchain-api/commit/4bb146d5450a3e77410fcac812fd2c09debdc95d))

## [0.25.2](https://github.com/blockstack/stacks-blockchain-api/compare/v0.25.1...v0.25.2) (2020-10-02)


### Bug Fixes

* faucet node override vars missing in tx submission call ([0d0b76c](https://github.com/blockstack/stacks-blockchain-api/commit/0d0b76c9128278c908d148b3e936be31b3361436))

## [0.25.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.25.0...v0.25.1) (2020-10-02)


### Bug Fixes

* rosetta submit test generates txs instead of using hardcoded ones ([e175f12](https://github.com/blockstack/stacks-blockchain-api/commit/e175f1226ab78df5679a3d14a5ed1fa1fa5322f4))

# [0.25.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.24.1...v0.25.0) (2020-10-02)


### Features

* faucet txs now stacks mempool txs with retry-nonce-incrementing up to 5 ([fb53e1e](https://github.com/blockstack/stacks-blockchain-api/commit/fb53e1eb4a2e10a14848a97c059486889e57d343))

## [0.24.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.24.0...v0.24.1) (2020-10-02)


### Bug Fixes

* **openapi:** add get contract data map entry schema ([b87f484](https://github.com/blockstack/stacks-blockchain-api/commit/b87f4844275a1e8e984ba3b1cf5f5fbc055552da))

# [0.24.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.23.0...v0.24.0) (2020-10-02)


### Bug Fixes

* update openapi.yaml to use a single tag for rosetta endpoints ([c05086f](https://github.com/blockstack/stacks-blockchain-api/commit/c05086fc8cf60e53f25155c1d67e3d16f2459a5c))


### Features

* stx faucet stacking differentiation [#247](https://github.com/blockstack/stacks-blockchain-api/issues/247) ([f37eeee](https://github.com/blockstack/stacks-blockchain-api/commit/f37eeee3858472815428437f7a2020bebe34549c))

# [0.23.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.22.1...v0.23.0) (2020-10-02)


### Features

* env var to override the node used for the faucet [#257](https://github.com/blockstack/stacks-blockchain-api/issues/257) ([e3992c6](https://github.com/blockstack/stacks-blockchain-api/commit/e3992c6a96654e0d32dac96df81393690d792440))

## [0.22.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.22.0...v0.22.1) (2020-10-01)


### Bug Fixes

* lint issues ([87aa514](https://github.com/blockstack/stacks-blockchain-api/commit/87aa514a343131ea14b17fb69cbef5a6374e5744))
* place all rosetta tests in one file ([0eda451](https://github.com/blockstack/stacks-blockchain-api/commit/0eda451ddc30138ad44f526eb5146b262a0e5b41))
* typos and add check signer in parse test ([839a409](https://github.com/blockstack/stacks-blockchain-api/commit/839a4094629af8d9db6fa30472a0e0de79924cda))
* used stacks-transaction for testing parse api ([6765cde](https://github.com/blockstack/stacks-blockchain-api/commit/6765cde716f89af0426d0996713c5422ac1a2c3e))

# [0.22.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.21.0...v0.22.0) (2020-09-25)


### Features

* add rosetta construction/hash endpoin implementation ([b9f4ff6](https://github.com/blockstack/stacks-blockchain-api/commit/b9f4ff6bb9107caf1ce450698c2ee1b8b1aa27c7))
* add rosetta construction/metadata implementation ([b60b30e](https://github.com/blockstack/stacks-blockchain-api/commit/b60b30e7fbf5f0d4ac4d72c86ffb77f613f4fe46))

# [0.21.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.20.0...v0.21.0) (2020-09-25)


### Features

* add follower-mode vscode debug config ([f07bc57](https://github.com/blockstack/stacks-blockchain-api/commit/f07bc57553a89681ab0f188d34c9354a8910ad41))

# [0.20.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.19.0...v0.20.0) (2020-09-25)


### Features

* add pox endpoint ([d4e6966](https://github.com/blockstack/stacks-blockchain-api/commit/d4e6966aa4d18409d127ab916144511b901bb192))
* adding generated client libs for pox proxy ([2a4aa5a](https://github.com/blockstack/stacks-blockchain-api/commit/2a4aa5a0843cd0090b32820fa3ede6a046a8634f))

# [0.19.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.18.1...v0.19.0) (2020-09-24)


### Features

* update client to match new openapi spec ([bba888c](https://github.com/blockstack/stacks-blockchain-api/commit/bba888ca294efacd57c6a5dd823068da2415c093))

## [0.18.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.18.0...v0.18.1) (2020-09-24)


### Bug Fixes

* support new Clarity string types [#223](https://github.com/blockstack/stacks-blockchain-api/issues/223) ([2c8669b](https://github.com/blockstack/stacks-blockchain-api/commit/2c8669b1f6692bb15c8838816cc8b107034a9da2))

# [0.18.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.17.0...v0.18.0) (2020-09-24)


### Features

* noop handler for STXLockEvent, _should_ ignore event rather than reject ([b02985c](https://github.com/blockstack/stacks-blockchain-api/commit/b02985c5f7c6afc0ed93378f512daafe18e5907e))

# [0.17.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.16.0...v0.17.0) (2020-09-24)


### Features

* cool down: from 2 days to 1 hour ([c6f4924](https://github.com/blockstack/stacks-blockchain-api/commit/c6f4924f56ecf211184e072271983632197757ca))

# [0.16.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.15.0...v0.16.0) (2020-09-22)


### Bug Fixes

* build issues with prom libs ([bb38998](https://github.com/blockstack/stacks-blockchain-api/commit/bb38998f7cb323f853b4f1707f661c14a766c19a))
* use import instead of require ([798e44a](https://github.com/blockstack/stacks-blockchain-api/commit/798e44a670634054037f06213e7fda309a2fdde5))


### Features

* add prometheus metrics endpoint ([ce9cbe9](https://github.com/blockstack/stacks-blockchain-api/commit/ce9cbe94d40a8f60de05ae9b81282fb213c70ce0))

# [0.15.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.14.4...v0.15.0) (2020-09-22)


### Features

* add functionality for rosetta construction/preprocess endpoint ([f9bcbe4](https://github.com/blockstack/stacks-blockchain-api/commit/f9bcbe4760d52b86be9c84a8ee6e226b7c3275f4))

## [0.14.4](https://github.com/blockstack/stacks-blockchain-api/compare/v0.14.3...v0.14.4) (2020-09-16)


### Bug Fixes

* derive address from specific network ([342cce9](https://github.com/blockstack/stacks-blockchain-api/commit/342cce9cde158c34a224e0f3a6914f97b84d0c6b))

## [0.14.3](https://github.com/blockstack/stacks-blockchain-api/compare/v0.14.2...v0.14.3) (2020-09-15)


### Bug Fixes

* pagination and proof params in openapi spec ([4363ffe](https://github.com/blockstack/stacks-blockchain-api/commit/4363ffe7ef503c94d47d68150393e8aa9258ce3d)), closes [#222](https://github.com/blockstack/stacks-blockchain-api/issues/222)
* string array enum ([50f16ff](https://github.com/blockstack/stacks-blockchain-api/commit/50f16ff0a2d2b9ddc10128f12bfbe80afb3e0acf))

## [0.14.2](https://github.com/blockstack/stacks-blockchain-api/compare/v0.14.1...v0.14.2) (2020-09-12)


### Bug Fixes

* **client:** add readOnlyFunctionArgs ([3258dcf](https://github.com/blockstack/stacks-blockchain-api/commit/3258dcf59b0a33fe1591d45d387537adc115d7c5))

## [0.14.1](https://github.com/blockstack/stacks-blockchain-api/compare/v0.14.0...v0.14.1) (2020-09-10)


### Bug Fixes

* [#229](https://github.com/blockstack/stacks-blockchain-api/issues/229) standalone docker image starts stacks-node twice ([26692b3](https://github.com/blockstack/stacks-blockchain-api/commit/26692b37442c27814c70a244d5c88853a73ec2e5))

# [0.14.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.13.0...v0.14.0) (2020-09-08)


### Bug Fixes

* accidentally deleted the hash hexToBuffer validator check, added ([78ac061](https://github.com/blockstack/stacks-blockchain-api/commit/78ac061ca2c5e1ce022de5ca987ff760865af1de))
* missed a line while merging in the pull request ([f0f2e8d](https://github.com/blockstack/stacks-blockchain-api/commit/f0f2e8d3b04374742b3241a0c6337d8ece1373c8))
* optional property checks in /rosetta/v1/block for RosettaPartialBlockIdentifier ([35aac8f](https://github.com/blockstack/stacks-blockchain-api/commit/35aac8f6db2894ce84cdae710061ae47b1229bd1))
* remove validation middleware stub from api/init.ts ([cb64091](https://github.com/blockstack/stacks-blockchain-api/commit/cb640917e297cfe342767dff5bc968b253376f9c))
* restore "canonical = true" check in various SQL queries ([afba1a1](https://github.com/blockstack/stacks-blockchain-api/commit/afba1a1f871b430c16e7b21bc1253e8c206bf68c))
* schema changes for rosetta block and block/transaction calls ([174c4c5](https://github.com/blockstack/stacks-blockchain-api/commit/174c4c524bbc6ec08d261f66b18c0b84664517e9))
* the blockHash parameter was incorrectly named indexBlockHash ([e568ae9](https://github.com/blockstack/stacks-blockchain-api/commit/e568ae93e2a2628f420f5f9b2b5476326597747c))
* trim trailing slashes (if any) from the url in rosettaValidateRequest() ([9c211da](https://github.com/blockstack/stacks-blockchain-api/commit/9c211dabc4742360779a0094940a179ff3409e8d))
* type, reciever -> receiver ([e40a829](https://github.com/blockstack/stacks-blockchain-api/commit/e40a82923625fb1f1f5da55eda0d99100b279407))
* use http 404 for rosetta errors of the type "Not Found" for consistency ([8929334](https://github.com/blockstack/stacks-blockchain-api/commit/8929334df33bbc492e90d107f597698c708a0eed))


### Features

* add request validation code for rosetta ([c8dfb43](https://github.com/blockstack/stacks-blockchain-api/commit/c8dfb43df5070a414f7fa92fc8c32d5bb0fb4e45))
* rosetta mempool api endpoints ([90bb40c](https://github.com/blockstack/stacks-blockchain-api/commit/90bb40cfd662d6b0150bd5cb0a0f51911ca021ca))

# [0.13.0](https://github.com/blockstack/stacks-blockchain-api/compare/v0.12.0...v0.13.0) (2020-09-03)


### Features

* option to start the self-contained image in mocknet mode ([e567024](https://github.com/blockstack/stacks-blockchain-api/commit/e567024bc10f7877b8fc8d7ac548291ecf31807b))

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
