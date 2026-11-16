# ReV judge guide

An independent, frontend-only explanation of ReV. It contains no backend, API calls, credentials, live data, or analytics. It is not a working substitute for the ReV app. The portfolio-inspired diagram is explanatory; its controls change the local page content only.

## Local preview

Requires Node.js 22+ and pnpm. From this directory:

```
pnpm build
pnpm dev
```

Open http://localhost:4173/. The preview server serves the built `dist` directory and binds to loopback. `PORT` can select a different port; rebuild after editing source files.

## Vercel

Create a separate Vercel project with `judge-guide` as its root directory. The included `vercel.json` runs `pnpm build` and publishes `dist`. No environment variables or backend functions are required for the guide. Deploying it is a separate manual action; no production guide URL is assumed here.

## Linking from ReV

Set `NEXT_PUBLIC_JUDGE_GUIDE_URL` to the actual absolute HTTP(S) guide URL when building the main Next.js application. This is public, build-time configuration, not a secret. Rebuild/redeploy ReV after changing it; Next.js embeds public variables into the browser bundle. If unset during `next dev`, the link defaults to http://localhost:4173/. If unset in a production build, or invalid in any environment, the button is visibly unavailable rather than navigating to a made-up address. Both `target="_blank"` and `rel="noopener noreferrer"` are set on the active link. The development server above must be running for the local fallback to work.

## Content notes

The demo uses a prepared snapshot and draft, not a live model inference. Citation matching checks that quoted text appears in a source; it does not prove the interpretation. Model providers can be local or remote. Sync is optional and depends on configuration and consent. Source links point at the repository's `main` branch and may evolve independently of this guide.

The included Rubik variable font is distributed under the SIL Open Font License 1.1; see `assets/OFL.txt`.
