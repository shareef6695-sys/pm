export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  try {
    const { channel, to, subject, message } = req.body || {};
    if (!channel || !to || !subject || !message) {
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }
    console.log("[notify]", { channel, to, subject, message });
    return res.status(200).json({ ok: true, delivered: false, simulated: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
