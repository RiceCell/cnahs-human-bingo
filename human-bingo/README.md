# CNAHS Human Bingo

Local setup:

1. Copy `.env.local.example` to `.env.local` and fill in:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `VERCEL_TOKEN` (or log in with `vercel login`)
2. Install dependencies:
   - `npm install`
3. Start the app locally:
   - `npm run dev`

The Vue app runs on `http://127.0.0.1:4173` and proxies `/api/*` to the Vercel API at `http://127.0.0.1:3000`.

Note: `VERCEL_OIDC_TOKEN` is not enough for local `vercel dev` in this setup; use a valid Vercel token or run `vercel login` first.

This template should help get you started developing with Vue 3 and TypeScript in Vite. The template uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

Learn more about the recommended Project Setup and IDE Support in the [Vue Docs TypeScript Guide](https://vuejs.org/guide/typescript/overview.html#project-setup).
