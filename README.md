# കുറുപ്പ് പത്രിക (Kurup Pathrika)

A crowd-sourced "missing person" gag site styled as an old Malayalam newspaper. Anyone can upload a photo (cropped square in the browser), and every sighting is published on the front page.

## Stack

- **Cloudflare Worker** — serves the static site and the API (one deploy, no separate backend)
- **Cloudflare R2** — photo storage; reporter name and location live in R2 object custom metadata (no database)
- **Vanilla JS frontend** — canvas-based square cropper (drag + zoom), no build step

## Endpoints

| Route | Method | Purpose |
|---|---|---|
| `/api/upload` | POST | multipart form: `photo` (jpeg/png/webp, ≤5 MB), `reporter`, `location` |
| `/api/photos` | GET | list all sightings, newest first |
| `/img/:key` | GET | serve a photo from R2 (immutable cache) |

## Local development

```sh
npm install
npm run dev
```

Wrangler simulates R2 locally — no Cloudflare account needed for dev.

## Deploy

1. Log in once: `npx wrangler login`
2. Create the bucket: `npx wrangler r2 bucket create kurup-photos`
3. Deploy: `npm run deploy`

The site is served at the `*.workers.dev` URL Wrangler prints (attach a custom domain in the Cloudflare dashboard if you want one).

## Notes

- Photos are cropped to 800×800 JPEG client-side before upload, so R2 only ever stores small square images.
- Uploads are anonymous and public. If it ever gets abused, add Cloudflare Turnstile to the upload form and a rate-limit rule in the dashboard.
