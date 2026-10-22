<div align="center">

<img src="docs/assets/cover.png" alt="openGym — Plan. Train. Progress." width="1200">

**A personal training space, from your weekly plan to your last set.**

[English](README.md) · [简体中文](README.zh-CN.md)

[Features](#a-complete-training-loop) · [Deployment options](#choose-your-deployment) · [Quick start](#quick-start) · [Documentation](#find-your-way)

</div>

openGym brings routines, guided workouts, training history and body-weight tracking into one focused interface. Plan a week or follow a rotation, record each set, and look back at the work you have done.

This repository is a fork of [DuarteSantos8/openGym](https://github.com/DuarteSantos8/openGym). It preserves the upstream self-hosted application and native sources, and adds a **ChatGPT Sites adaptation** with platform sign-in, account-scoped records, D1 storage and R2 media storage.

## A complete training loop

| Plan your training | Record the session | Review your progress |
|---|---|---|
| Fixed weekly schedules or a repeating rotation. Editable starter plans. Equipment profiles and custom exercises. | Guided sets with previous weights, rest timers and optional RIR/RPE. Supersets, warm-ups, drop sets, timed movements and cardio. | Workout history, personal records, estimated 1RM, activity heatmaps and muscle maps. Body weight, measurements and progress photos. |

- **Flexible routines.** Start with Push/Pull/Legs, Upper/Lower, Full Body or 5×5; adjust exercises, sets, reps and progression rules as your routine develops.
- **A practical workout screen.** Use cards, a list or a compact view. Log per-side work, check plate loading, repeat a previous session, and correct saved workouts later.
- **Records you can take with you.** Export JSON backups or a backup with media, import supported training histories, and exchange routine files with a friend. Plan sharing carries routines rather than personal workout or weight history.
- **A familiar interface.** Dark, light and system themes, accent choices, configurable workout controls, and multiple interface languages, including Simplified and Traditional Chinese.

## Choose your deployment

The two web deployments share the training workflow and use different account and storage systems.

| | Self-hosted web / PWA | ChatGPT Sites |
|---|---|---|
| **Access** | Your server; passkeys and optional password sign-in | ChatGPT sign-in; access managed through Sites |
| **Saved records** | JSON documents and uploads on the server | Per-user documents in D1; uploaded media in R2 |
| **Synchronization** | Revision-based sync and field-level merging | The same revision and merge approach, adapted to D1 |
| **Offline use** | Service-worker caching in the upstream PWA | An open page keeps local edits for later sync; reopening offline is unsupported |
| **Timer alerts** | In-page alerts; background Web Push when configured | In-page alerts while the page stays open; a one-time rest-timer notice explains this |
| **Additional services** | Optional AI coach, admin dashboard and native-app pairing | Those upstream services are disabled in this flavor |
| **Setup** | [Self-hosting guide](docs/SELF_HOSTING.md) | [Sites setup and development](sites/opengym/README.md) |

**The account boundary matters.** Each person using the Sites version signs in with their own ChatGPT account and receives a separate training profile. A publicly accessible Site still requires ChatGPT sign-in to open training records. The deployment's administrators retain access to its underlying storage.

**An ongoing session stays on its current device.** Plans, completed workouts, body weight and preferences sync with the account. An unfinished workout is kept locally, so it can resume on that device.

**Native sources are retained.** The upstream Capacitor application can keep records locally on a phone and connect to a compatible self-hosted server. Its native reminders and pairing are separate from the Sites deployment. See the [mobile guide](docs/MOBILE.md) and [upstream releases](https://github.com/DuarteSantos8/openGym/releases).

## Quick start

### Self-host with Docker

With Docker and Compose installed, run these commands from the repository root:

```powershell
Copy-Item .env.example .env
docker compose pull
docker compose up -d
```

Open [localhost:8080](http://localhost:8080). The Compose configuration pulls the **upstream openGym images**. Phone access with passkeys requires an HTTPS deployment; the [self-hosting guide](docs/SELF_HOSTING.md) covers domains, proxies, accounts and backups.

To build the self-hosted application from this checkout:

```sh
docker compose up -d --build
```

### Deploy with ChatGPT Sites

Use the dedicated [Sites guide](sites/opengym/README.md) for Node.js requirements, media preparation, D1 migrations, local development and deployment configuration. The Sites application lives in `sites/opengym/` and uses the platform's sign-in and access controls.

The hosted flavor provides its corresponding source download from the About screen. Exercise media has separate license terms and is excluded from that source-code ZIP.

## Find your way

```text
openGym/
├── frontend/             Upstream React/Vite app and Android/iOS sources
├── api/                  Upstream Node API, accounts and JSON storage
├── web/                  Docker web image and nginx configuration
├── catalogue/            Exercise data, translations and licensed media
├── sites/opengym/        ChatGPT Sites application and deployment tooling
│   ├── gym-client/       Adapted workout interface
│   ├── lib/              Hosted API, synchronization and page responses
│   ├── db/ + drizzle/    D1 schema and migrations
│   └── tests/            Hosted API tests
└── docs/                 Self-hosting, mobile, imports and upstream guides
```

| Read more | |
|---|---|
| [Sites adaptation](sites/opengym/README.md) | Capabilities, setup, storage and hosted limitations |
| [Self-hosting](docs/SELF_HOSTING.md) | Run and maintain the original server deployment |
| [Mobile](docs/MOBILE.md) | Upstream Android, iOS and PWA guidance |
| [Data imports](docs/DATA_IMPORTS.md) | Supported sources and import formats |
| [Original project README](docs/UPSTREAM_README.md) | The upstream introduction, preserved for reference |
| [Contributing](CONTRIBUTING.md) | The upstream contribution process and project conventions |

## Attribution and license

openGym was created by Duarte Santos. This fork retains the upstream application's authorship and licenses; the Sites integration is an adaptation of that application.

The application source is licensed under **[AGPL-3.0-or-later](LICENSE)**. The exercise images and animations are covered by separate terms: a non-commercial openGym fork may retain the unmodified 180 px assets with their notice. See **[NOTICE.md](NOTICE.md)** for the full exercise-media terms and other third-party attribution.
