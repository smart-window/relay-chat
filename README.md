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
- Vercel-compatible deployment

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

## Deploy to Vercel

1. Import this GitHub repository into a Vercel Hobby project.
2. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` as environment variables.
3. Deploy with the standard Next.js preset.
4. Add the Vercel production URL to Supabase Authentication → URL Configuration as the Site URL and an allowed redirect URL.

## Current scope

Relay is an MVP centered on direct conversations. Browser calls work peer-to-peer when the network permits it. A production-scale launch should add a TURN service for restrictive networks, push notifications, abuse controls, moderation, and optional end-to-end message encryption.
