# Changelog

## [2.0.1](https://github.com/ChmaraX/forensix/compare/v2.0.0...v2.0.1) (2026-10-28)


### Bug Fixes

* **core:** let one of many simultaneous commands take the Case lock ([#233](https://github.com/ChmaraX/forensix/issues/233)) ([b507c4a](https://github.com/ChmaraX/forensix/commit/b507c4ae5f29b1333e2345c74f16eb826e90c7a3))

## [2.0.0](https://github.com/ChmaraX/forensix/compare/v2.0.0-alpha.1...v2.0.0) (2026-10-26)


### Miscellaneous Chores

* release 2.0.0 as the first stable v2 ([#225](https://github.com/ChmaraX/forensix/issues/225)) ([1be5f18](https://github.com/ChmaraX/forensix/commit/1be5f182b83905c435abe6b48708232cc5534c09))

## [2.0.0-alpha.1](https://github.com/ChmaraX/forensix/compare/v2.0.0-alpha.0...v2.0.0-alpha.1) (2026-10-26)


### Features

* **#167:** build ingest walking skeleton ([712ae2b](https://github.com/ChmaraX/forensix/commit/712ae2bdd966c075aa94267fbb465d944fb79811))
* **#168:** parse History into Findings ([d89d3b0](https://github.com/ChmaraX/forensix/commit/d89d3b09e4e423b2ef6a8672f62f32635c57f37f))
* **#168:** parse History through the Finding pipeline ([22d464d](https://github.com/ChmaraX/forensix/commit/22d464d808937604698af8817f08dc47f8e9c4f1))
* **#169:** export canonical JSONL and lossy CSV Extracts ([#193](https://github.com/ChmaraX/forensix/issues/193)) ([14c0caa](https://github.com/ChmaraX/forensix/commit/14c0caa016fa5240c26fca0cd5371378716e1884))
* **#170:** generate a self-contained HTML Report from an Extract ([#196](https://github.com/ChmaraX/forensix/issues/196)) ([fcf2984](https://github.com/ChmaraX/forensix/commit/fcf298424aa73ec86e3bbc0d17df7b48325c75fb))
* **#172:** Analysis Run identity and artifact supersede semantics ([#192](https://github.com/ChmaraX/forensix/issues/192)) ([1ed2cbf](https://github.com/ChmaraX/forensix/commit/1ed2cbfe8822e38d0f2ee402fe5fceaf76484771))
* **#173:** ingest all supported Source kinds ([#191](https://github.com/ChmaraX/forensix/issues/191)) ([a50d9e7](https://github.com/ChmaraX/forensix/commit/a50d9e7311ab98fe470bea8d29f9f1e02664dbba))
* **#174:** Parse Cookies as forensic Findings ([#195](https://github.com/ChmaraX/forensix/issues/195)) ([16ad539](https://github.com/ChmaraX/forensix/commit/16ad539e4f3038cf4720f80a55246f383264dcd9))
* **#177:** Parse Login Data credential metadata ([#194](https://github.com/ChmaraX/forensix/issues/194)) ([67493ad](https://github.com/ChmaraX/forensix/commit/67493ad6e32e41e138d730871cd7d0d59409ef5b))
* **#183:** decrypt supported OSCrypt values offline by explicit opt-in ([#198](https://github.com/ChmaraX/forensix/issues/198)) ([d52ee3d](https://github.com/ChmaraX/forensix/commit/d52ee3dba0a174fd5b87fb4bc9d73d83afa9e583))
* **#187:** capture authorized sealed key material ([a345b36](https://github.com/ChmaraX/forensix/commit/a345b36f5a925ccc0a463254400684ddf20c50fb))
* **bookmarks:** parse Bookmarks and backup Bookmarks as Findings ([#205](https://github.com/ChmaraX/forensix/issues/205)) ([292a69e](https://github.com/ChmaraX/forensix/commit/292a69e4a9fee5c787c51e7814fa11c14a28c945))
* **cache:** detect and extract blockfile, Simple, and SQL cache backends ([#207](https://github.com/ChmaraX/forensix/issues/207)) ([2503bad](https://github.com/ChmaraX/forensix/commit/2503bad00fb4e4f4fe41754a5cc550d2b3abbdf2))
* **candidates:** rank identity and behavior Candidates from Findings ([#206](https://github.com/ChmaraX/forensix/issues/206)) ([dd4ba58](https://github.com/ChmaraX/forensix/commit/dd4ba585d991d17140e83ad5b8cfbb57fcf3bfbc))
* **client:** Fluid Functionalism dashboard rework ([#166](https://github.com/ChmaraX/forensix/issues/166)) ([3032052](https://github.com/ChmaraX/forensix/commit/30320524ea8017baabb262763a2c47ec3f14e417))
* **collector:** add walking skeleton for [#186](https://github.com/ChmaraX/forensix/issues/186) ([0cb7184](https://github.com/ChmaraX/forensix/commit/0cb718495a6b3d3bf66dff31dfe6f7f1072c055e))
* **collector:** capture sealed key material ([#187](https://github.com/ChmaraX/forensix/issues/187)) ([c50ff40](https://github.com/ChmaraX/forensix/commit/c50ff40d42605a1048412f0cb025906132fe9d0b))
* **core,cli:** derived Timeline and Sites queries with CLI commands ([#214](https://github.com/ChmaraX/forensix/issues/214)) ([c7ef2dc](https://github.com/ChmaraX/forensix/commit/c7ef2dcdf89c774246396f74b816c007c4c77d29))
* **downloads:** parse Downloads with decoded forensic meaning ([#204](https://github.com/ChmaraX/forensix/issues/204)) ([4c98455](https://github.com/ChmaraX/forensix/commit/4c984558a5ae739a7323ee2069180a3b2362182c))
* **favicons:** parse Favicons and page associations as Findings ([#203](https://github.com/ChmaraX/forensix/issues/203)) ([883774d](https://github.com/ChmaraX/forensix/commit/883774da19114dc455c85051e5446441a307b56a))
* make ForensiX agent-ready and ship the agent skill ([#216](https://github.com/ChmaraX/forensix/issues/216)) ([998c3c8](https://github.com/ChmaraX/forensix/commit/998c3c8a73996cff1e17efecc631fc9a3a441951))
* **metadata:** parse Preferences and profile metadata as Findings ([#202](https://github.com/ChmaraX/forensix/issues/202)) ([038817a](https://github.com/ChmaraX/forensix/commit/038817a72aeb10e501e5d042c80a738dd10f3bb6))
* **server:** expose metadata, downloads, bookmarks, and autofill routes ([#213](https://github.com/ChmaraX/forensix/issues/213)) ([dda1b4b](https://github.com/ChmaraX/forensix/commit/dda1b4bd78581a2a75f5d3950b2d10007d23bd46))
* **top-sites:** parse Top Sites as forensic Findings ([#201](https://github.com/ChmaraX/forensix/issues/201)) ([cb8b09c](https://github.com/ChmaraX/forensix/commit/cb8b09cf64597599495820be69da17075311597e))
* **topics:** classify browsing topics locally as ranked Candidates ([#208](https://github.com/ChmaraX/forensix/issues/208)) ([41b43db](https://github.com/ChmaraX/forensix/commit/41b43dba24184bf5590f584029f8b8e18633e607))
* **verify:** ship offline verification, CI gates, and reproducible releases ([#209](https://github.com/ChmaraX/forensix/issues/209)) ([9994456](https://github.com/ChmaraX/forensix/commit/9994456b589f2aa338b438ab82d1055b42420541))
* **web-data:** parse Web Data autofill form and address evidence ([#200](https://github.com/ChmaraX/forensix/issues/200)) ([56e267c](https://github.com/ChmaraX/forensix/commit/56e267c5910c09664f3d30f72e781cc090d1041f))


### Bug Fixes

* **#167,#186:** align Collector with canonical contracts ([9a716c5](https://github.com/ChmaraX/forensix/commit/9a716c5608510bc56edc01b20ce9981dabe14a4e))
* address the v2 code review findings ([#217](https://github.com/ChmaraX/forensix/issues/217)) ([7502732](https://github.com/ChmaraX/forensix/commit/7502732e02d59787f6a2c72d3b34676b4b2d25cc))
* apply the principles review of v2 ([#218](https://github.com/ChmaraX/forensix/issues/218)) ([900a0f2](https://github.com/ChmaraX/forensix/commit/900a0f278cc775acace1f748a5ccce013e832470))
* **collector:** address [#186](https://github.com/ChmaraX/forensix/issues/186) review findings ([9b12764](https://github.com/ChmaraX/forensix/commit/9b1276467fcc84a14c1d27a487bd7088544c6865))


### Documentation

* correct facts and simplify Markdown with Simplified Technical English ([#211](https://github.com/ChmaraX/forensix/issues/211)) ([b3a746d](https://github.com/ChmaraX/forensix/commit/b3a746dc3f6cddf559bdd411b59ff68cc6742c7a))
* short README with logo, badges and screenshots; move reference to docs/reference.md ([94721ce](https://github.com/ChmaraX/forensix/commit/94721ce9f668eaac4b5faa93a65c77abe53b8cdb))
* strip internal ticket refs from comments and document entry points ([#210](https://github.com/ChmaraX/forensix/issues/210)) ([1740db9](https://github.com/ChmaraX/forensix/commit/1740db90100e48db6b805c640cc127266a982018))
