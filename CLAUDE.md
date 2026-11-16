# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Firebase backend configuration for **Dungeonary** (Firebase project `project-dungeon-b317f`, the `default` alias in `.firebaserc`). The repo holds only server-side config: Firestore rules/indexes, Auth provider config, and a Cloud Functions codebase. The client app is not in this repo.

## Commands

Function scripts live in `functions/package.json`; run them from `functions/` (or with `npm --prefix functions run <script>`). They call the `firebase` CLI, which must be on PATH (otherwise use `npx firebase-tools ...`).

```bash
npm run build         # tsc: src/ -> lib/
npm run build:watch
npm run serve         # build, then start the functions emulator
npm run shell         # build, then firebase functions:shell
npm run deploy        # firebase deploy --only functions
npm run logs
```

From the repo root, for the non-function resources:

```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only auth
```

There is no lint setup and no test runner. `firebase-functions-test` is installed as a devDependency but no tests or `test` script exist yet.

## Architecture

- `firebase.json` is the source of truth for what gets deployed: Firestore (`(default)` database in `asia-southeast1`), one functions codebase (`functions/`, codebase `default`), and Auth providers (email/password and Google sign-in).
- `firestore.rules` defines the whole data model as it stands: two per-user collections, `users_profile/{userId}` and `backups/{userId}`, each readable and writable only by the signed-in user whose UID matches the document ID. A catch-all rule denies everything else, so any new collection needs an explicit `match` block before clients can touch it. The Admin SDK in functions bypasses these rules.
- `functions/src/index.ts` is the single entry point (compiled to `lib/index.js`). It is still the init template: it only calls `setGlobalOptions({ maxInstances: 10 })` and exports no functions.

## Things to know before changing functions

- `firebase.json` runs `npm run build` as a functions predeploy hook, so a TypeScript error blocks deploy. `tsconfig.json` has `strict`, `noUnusedLocals` and `noImplicitReturns` on. The template's unused `onRequest` and `logger` imports currently fail the build (TS6133); use them or remove them when adding the first function.
- firebase-functions v7 is installed: import triggers from the unversioned subpaths (`firebase-functions/https`, `firebase-functions/firestore`, `firebase-functions/logger`), which are the 2nd-gen APIs. `setGlobalOptions` does not apply to v1 functions.
- Modules are `NodeNext`; the runtime is Node 24 (`engines.node`).
- No function region is set, so functions deploy to the default `us-central1` while Firestore is in `asia-southeast1`. Set `region` in `setGlobalOptions` if they should be co-located.
- `disallowLegacyRuntimeConfig` is true: `functions.config()` is unavailable. Use params/secrets (`firebase-functions/params`) for configuration.

## Firebase reference skills

`.agents/skills/` contains vendored Firebase agent skills from `firebase/agent-skills` (pinned in `skills-lock.json`, managed by `npx skills`). They are not auto-loaded by Claude Code from that location. Read the relevant `SKILL.md` and its `references/` before working in that area, in particular `firebase-firestore` (rules, indexes, SDK usage), `firebase-security-rules-auditor` (when editing `firestore.rules`), and `firebase-auth-basics`. Do not hand-edit these files; they are hash-locked.
