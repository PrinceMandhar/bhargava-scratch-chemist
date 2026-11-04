import { getStore } from "@netlify/blobs";

// Gifts (code, name, quantity). Total = 20 cards.
const GIFTS = [
  ["PRM2480", "Cello Lunch Box 3pcs set", 6],
  ["PRM2743", "Cello Multipurpose Bowl set 2", 4],
  ["PRM2953", "IRON", 5],
  ["PRM2085", "Electric Kettle Vtl-5006", 5],
];
const env = (k) => globalThis.Netlify?.env?.get(k) ?? process.env[k];
const SEED = Number(env("GIFT_SEED") || 2026); // production me GIFT_SEED env var set karo

function rng(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pool = [];
GIFTS.forEach(([code, name, q]) => { for (let i = 0; i < q; i++) pool.push({ code, name }); });
{ const r = rng(SEED); for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; } }
const TOTAL = pool.length;

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const tokenOk = (t) => /^[a-z0-9]{8,24}$/.test(t || "");
const clean = (v) => String(v || "").replace(/[<>]/g, "").trim().slice(0, 80);

export default async (req) => {
  try {
    const s = getStore({ name: "scratch-gifts", consistency: "strong" });
    const rd = (k) => s.get(k, { type: "json" });
    const all = async (prefix) => {
      const { blobs } = await s.list({ prefix });
      return (await Promise.all(blobs.map((b) => rd(b.key)))).filter(Boolean);
    };
    const p = new URL(req.url).pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
    const m = req.method;

    /* ---- Customer: link details (gift tabhi dikhta hai jab scratch ho chuka ho) ---- */
    if (m === "GET" && p[0] === "link") {
      if (!tokenOk(p[1])) return json({ error: "Link sahi nahi hai." }, 404);
      const L = await rd("links/" + p[1]);
      if (!L) return json({ error: "Link nahi mila." }, 404);
      if (L.revoked) return json({ error: "Ye link cancel kar diya gaya hai." }, 410);
      const cards = await Promise.all(L.cards.map(async (n) => {
        const r = await rd("scratch/" + n);
        return r && r.linkId === p[1] ? { n, scratched: true, gift: r.gift, at: r.at } : { n, scratched: false };
      }));
      return json({ ticket: L.ticket, cards });
    }

    /* ---- Customer: scratch (server time record + gift reveal) ---- */
    if (m === "POST" && p[0] === "scratch") {
      const t = p[1], n = Number(p[2]);
      if (!tokenOk(t)) return json({ error: "Link sahi nahi hai." }, 404);
      const L = await rd("links/" + t);
      if (!L || L.revoked || !L.cards.includes(n)) return json({ error: "Card is link ka nahi hai." }, 403);
      const g = pool[n - 1];
      const rec = { card: n, linkId: t, ticket: L.ticket, doctor: L.doctor, gift: g.name, code: g.code, at: new Date().toISOString() };
      const w = await s.setJSON("scratch/" + n, rec, { onlyIfNew: true });
      const r = w.modified ? rec : await rd("scratch/" + n);
      return json({ n, gift: r.gift, at: r.at });
    }

    /* ---- Admin: overview ---- */
    if (m === "GET" && p[0] === "admin" && p[1] === "overview") {
      const links = (await all("links/")).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const sc = await all("scratch/");
      const scMap = {}; sc.forEach((x) => (scMap[x.card] = x));
      const owner = {};
      links.forEach((L) => L.cards.forEach((n) => { if (!L.revoked || scMap[n]) owner[n] = L; }));
      const cards = pool.map((g, i) => {
        const n = i + 1, L = owner[n], x = scMap[n];
        return { n, code: g.code, name: g.name, status: x ? "Scratched" : L ? "Assigned" : "Available",
          doctor: L?.doctor || "", ticket: L?.ticket || "", issuedAt: L?.createdAt || "", scratchedAt: x?.at || "" };
      });
      return json({
        total: TOTAL,
        gifts: GIFTS.map(([code, name, q]) => ({ code, name, total: q })),
        cards,
        links: links.map((L) => ({ token: L.token, ticket: L.ticket, doctor: L.doctor, cards: L.cards, createdAt: L.createdAt, revoked: !!L.revoked,
          scratched: L.cards.filter((n) => scMap[n] && scMap[n].linkId === L.token).length })),
        events: sc.sort((a, b) => b.at.localeCompare(a.at)).map(({ at, card, doctor, ticket, gift, code }) => ({ at, card, doctor, ticket, gift, code })),
      });
    }

    /* ---- Admin: issue link ---- */
    if (m === "POST" && p[0] === "admin" && p[1] === "issue") {
      const b = await req.json().catch(() => ({}));
      const doctor = clean(b.doctor), count = Math.floor(Number(b.count));
      if (!doctor) return json({ error: "Chemist ka naam likho." }, 400);
      if (!(count >= 1 && count <= TOTAL)) return json({ error: "Cards ki sankhya 1 se " + TOTAL + " ke beech ho." }, 400);
      const token = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
      const claimed = [];
      for (let n = 1; n <= TOTAL && claimed.length < count; n++) {
        const w = await s.setJSON("cards/" + n, { token }, { onlyIfNew: true });
        if (w.modified) claimed.push(n);
      }
      if (claimed.length < count) {
        await Promise.all(claimed.map((n) => s.delete("cards/" + n)));
        return json({ error: "Itne cards bache nahi hain (bache: " + claimed.length + ")." }, 409);
      }
      let num = (await s.list({ prefix: "links/" })).blobs.length + 1;
      while (!(await s.setJSON("tickets/" + num, { token }, { onlyIfNew: true })).modified) num++;
      const ticket = "BPL-" + String(num).padStart(4, "0");
      await s.setJSON("links/" + token, { token, ticket, doctor, cards: claimed, createdAt: new Date().toISOString() });
      return json({ token, ticket, cards: claimed });
    }

    /* ---- Admin: revoke (sirf unscratched cards wapas free hote hain) ---- */
    if (m === "POST" && p[0] === "admin" && p[1] === "revoke") {
      const b = await req.json().catch(() => ({}));
      const L = tokenOk(b.token) && (await rd("links/" + b.token));
      if (!L) return json({ error: "Link nahi mila." }, 404);
      for (const n of L.cards) { if (!(await rd("scratch/" + n))) await s.delete("cards/" + n); }
      await s.setJSON("links/" + L.token, { ...L, revoked: true, revokedAt: new Date().toISOString() });
      return json({ ok: true });
    }

    return json({ error: "Not found" }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: "Server error, thodi der baad try karo." }, 500);
  }
};

export const config = { path: "/api/*" };
