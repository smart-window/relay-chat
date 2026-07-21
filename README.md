# Relay

Relay is a full-stack chat platform for text, image, and audio messages plus browser-to-browser voice and video calls.

## Features

- Free email/password accounts powered by Supabase Auth
- Searchable people directory and one-to-one conversations
- Realtime text messaging with private image and audio transfer
- In-browser voice-note recording
- WebRTC voice and video calls with private call signaling
- Responsive desktop and mobile interface
- Row-level security on conversations, messages, calls, and media

## Stack

- Next.js 16 and React 19
- Supabase Auth, Postgres, Realtime, and private Storage
- WebRTC with public STUN discovery
- Free static hosting on GitHub Pages

## Local development

Copy `.env.example` to `.env.local` and add your Supabase project URL and publishable key, then run:

```bash
npm install
npm run dev
```

Run `supabase/migrations/001_relay.sql` in a new Supabase project's SQL Editor before creating accounts. Existing installations should apply later numbered migrations in order.

## Checks

```bash
npm run lint
npx tsc --noEmit
npm run build
```

## Deploy to GitHub Pages

The included Actions workflow exports the Next.js frontend and publishes it to GitHub Pages whenever `main` changes. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` as repository Actions secrets, enable GitHub Pages with GitHub Actions as the source, and set `https://smart-window.github.io/relay-chat/` as the Supabase Auth Site URL and an allowed redirect URL.

## Desktop applications

Relay is packaged with Tauri for macOS and Windows. The desktop apps use the same Supabase project as the website, so accounts and conversations stay synchronized.

```bash
npm run desktop:dev
npm run desktop:build
```

The `Build Relay desktop apps` GitHub Actions workflow builds Apple Silicon and Intel macOS DMGs plus Windows installers, then publishes them to a GitHub Release. The community builds use macOS ad-hoc signing and an unsigned Windows installer; production distribution without security warnings requires paid Apple Developer and Windows code-signing certificates.

## Current scope

Relay is an MVP centered on direct conversations. Browser calls work peer-to-peer when the network permits it. A production-scale launch should add a TURN service for restrictive networks, push notifications, abuse controls, moderation, and optional end-to-end message encryption.
