# openGym · Sites edition

[Back to the project](../../README.md) · [中文介绍](../../README.zh-CN.md) · [License](LICENSE)

A ChatGPT Sites adaptation of [openGym](https://github.com/DuarteSantos8/openGym), retaining the planner, guided workouts, exercise library, history, body-weight charts, measurements, and import/export tools.

## Identity and storage

Sites verifies the signed-in ChatGPT identity. Each API operation uses that verified user ID. Completed workouts, plans, weight, and preferences live in D1; uploaded media uses an account-specific R2 prefix. Browser caches use the same account scope. An unfinished workout remains on the current device.

A public Site can show its sign-in page to anyone; training APIs still require a verified account. A restricted Site additionally uses the platform's access list. Site editors can inspect the underlying hosted database, so reserve editor access for trusted administrators.

## Included and supported

- Same-account synchronization across browsers, with revisions and field stamps for concurrent edits.
- Custom exercise media with content-hash checks and per-account quotas.
- Rest timers and in-page alerts while the page stays open.
- Statistics, history, settings, library, and other secondary screens loaded on demand.
- A one-time rest-timer notice, remembered per account and browser after acknowledgement.
- A source-code download at `/source.zip`, excluding deployment identity, credentials, runtime records, and exercise media.

There is no service worker or offline page support. Background push, native-device pairing, local passkeys, the server AI coach, and the upstream admin dashboard are disabled. Keep the page open for rest-timer sounds and alerts.

## Local development

Use Node.js 24 LTS and npm. Clone the complete repository so the licensed catalogue media is available:

```sh
git clone https://github.com/Jul11us/openGym.git
cd openGym/sites/opengym
npm run install:ci
npm run build
```

The build prepares the client, stages unmodified media from `../../catalogue/media` into an ignored directory, and generates the source download. A second copy of the media is not committed.

Apply both committed migrations to the local D1 database:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_curious_demogoblin.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_volatile_scalphunter.sql
npm run dev
```

Open the loopback address printed by the server. The synthetic development identity is accepted only on loopback. Hosted production receives verified identity from Sites. The application does not implement the platform's reserved authentication routes.

After changing `gym-client`, run `node scripts/build-client.mjs` before using the server preview.

## Verification

```sh
# Repository root
node scripts/check-public-release.mjs

# sites/opengym; API tests use an in-memory database
node --experimental-strip-types --test tests/*.test.mjs

# sites/opengym/gym-client
npm test
```

The Hosted edition workflow checks public files, API behavior, client tests, and production builds without a live account or private production database.

## Deployment

`.openai/hosting.json` is a portable template containing only the `DB` and `BUCKET` binding names. It contains no existing Site's project ID or account details. Use your own Site and the Sites source workflow to build, synchronize source, package, save, and deploy the exact revision. Choose the audience in the platform's sharing controls.

The source ZIP filters hosting configuration to binding names even if a local deployment later adds an identifier. Do not commit credentials, local databases, training exports, screenshots of personal records, or populated production configuration.

When using the source ZIP outside this repository, obtain the unmodified 180 px openGym exercise media under its existing terms and place `still/`, `clip/`, and `NOTICE.md` in `gym-client/public/exercise-media/`. Do not hotlink a running instance.

## Source map

| Directory | Purpose |
| --- | --- |
| `gym-client/` | React interface adapted for Sites identity and storage |
| `lib/` | Hosted API, synchronization, and page responses |
| `db/`, `drizzle/` | D1 schema and committed migrations |
| `scripts/` | Builds, media preparation, and filtered source ZIP |
| `tests/` | API and source-export checks |

## License and attribution

openGym Copyright (C) 2026 Duarte Santos. Application source is AGPL-3.0-or-later; see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md). Exercise media has separate terms, including the provision for noncommercial openGym forks retaining the unmodified media and notice. The vendored Sites build integration retains its MIT license in `build/sites-vite-plugin.LICENSE`.
