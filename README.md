# vercel-armor monorepo

`vercel-armor` is a 4-layer resilience toolkit for Vercel serverless APIs that depend on flaky external services (legacy ERPs, raw IPs, third-party APIs that occasionally choke).

This repo contains:

- **`packages/vercel-armor`** — the library. Zero runtime dependencies. Node 20+.
- **`apps/web`** — landing page + interactive load-test demo (Next.js 16).

## Quickstart

```bash
npm install
npm test              # runs Vitest against the library
npm run dev           # boots the demo on http://localhost:3000
```

The demo route at `/demo` fires 20 concurrent requests against `/api/flaky` (raw) and `/api/armored` (wrapped in `withArmor`) and shows the comparison side-by-side.

## Publishing the library

```bash
cd packages/vercel-armor
npm publish --access public
```

`prepublishOnly` runs the build + tests automatically.

## License

MIT — see [LICENSE](./LICENSE).
