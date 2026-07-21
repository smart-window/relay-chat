# Relay

Relay is a full-stack chat platform for text, image, and audio messages plus browser-to-browser voice and video calls.

## Features

- Account sign-in with ChatGPT identity and a customizable Relay profile
- Searchable people directory and one-to-one conversations
- Persistent real-time-style messaging with text, private images, and audio
- In-browser voice-note recording
- WebRTC voice and video calling with private call signaling
- Responsive desktop and mobile experience
- Cloudflare D1 for app data and R2 for private media

## Local development

Relay uses the Vinext runtime and requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

The local landing page works without identity headers. Signed-in product flows are provided by the Sites deployment through Sign in with ChatGPT.

## Checks

```bash
npx tsc --noEmit
npm run lint
npm run build
```

## Architecture

The web application is built with Next.js-compatible React through Vinext and targets Cloudflare Workers. Structured data and WebRTC signaling live in D1; media bytes live in R2 and are served only after a server-side conversation membership check. Calls use WebRTC with STUN discovery and DTLS-SRTP media encryption.

## Deployment

The `.openai/hosting.json` manifest declares the logical D1 and R2 bindings used by OpenAI Sites. The checked-in Drizzle migration creates the production schema.

## Current scope

Relay is an MVP centered on direct conversations. Group chat, push notifications, message moderation, TURN relay infrastructure, and end-to-end message encryption are natural next steps for a larger public launch.
