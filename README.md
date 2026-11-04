# Bhargava Scratch Cards (v2)

Netlify static site + Netlify Function + Netlify Blobs (server-side data, no database to set up).

- `public/gift.html` - customer page: `/gift?t=<token>` (gift tabhi dikhta hai jab scratch ho; PRM code customer ko kabhi nahi jata)
- `public/index.html` - admin page: site ka root `/` (login nahi hai)
- `netlify/functions/api.mjs` - API: ticket issue, scratch record (date/time), overview, cancel link

## Deploy (GitHub se - zaroori)
1. Repo private rakho, push karo, Netlify me "Import from Git". Build command khali, publish `public` (netlify.toml me set hai).
2. Site configuration -> Environment variables: `GIFT_SEED` = koi apna number (deploy ke baad mat badalna).
3. Manual drag-drop se functions nahi chalte, isliye GitHub deploy hi use karo.

Local: `npm i -g netlify-cli && npm i && netlify dev`
