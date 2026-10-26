// Class answers for the BYD quiz, stored in Upstash Redis over its REST API (no dependencies).
// POST {cid, q, i}  records one device's answer to one question (re-answering overwrites).
// GET               returns {counts: {q: [n0, n1, n2]}, devices}.
// DELETE            clears everything (needs ?key= matching RESET_KEY when that env var is set).

const QUESTIONS = { s1: 3, m1: 3, u1: 3, f1: 3, z1: 3 }; // question id -> number of options
const PREFIX = "byd:";

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(commands) {
  const r = await fetch(URL_ + "/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error("redis " + r.status);
  return (await r.json()).map((x) => x.result);
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!URL_ || !TOKEN) return res.status(503).json({ error: "storage not configured" });
  try {
    if (req.method === "POST") {
      const { cid, q, i } = req.body || {};
      if (typeof cid !== "string" || !/^[a-z0-9]{8,40}$/.test(cid) || !(q in QUESTIONS) ||
          !Number.isInteger(i) || i < 0 || i >= QUESTIONS[q]) {
        return res.status(400).json({ error: "bad answer" });
      }
      await redis([["HSET", PREFIX + q, cid, String(i)], ["SADD", PREFIX + "devices", cid]]);
      return res.status(204).end();
    }
    if (req.method === "GET") {
      const ids = Object.keys(QUESTIONS);
      const out = await redis([...ids.map((q) => ["HVALS", PREFIX + q]), ["SCARD", PREFIX + "devices"]]);
      const counts = {};
      ids.forEach((q, k) => {
        counts[q] = Array(QUESTIONS[q]).fill(0);
        for (const v of out[k] || []) if (counts[q][+v] !== undefined) counts[q][+v]++;
      });
      return res.status(200).json({ counts, devices: out[ids.length] || 0 });
    }
    if (req.method === "DELETE") {
      const key = process.env.RESET_KEY;
      if (key && req.query.key !== key) return res.status(403).json({ error: "wrong key" });
      await redis([["DEL", ...Object.keys(QUESTIONS).map((q) => PREFIX + q), PREFIX + "devices"]]);
      return res.status(204).end();
    }
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).end();
  } catch (e) {
    return res.status(502).json({ error: "storage unavailable" });
  }
};
