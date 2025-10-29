const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();

// CORS & body
app.use(cors({ origin: '*', methods: ['POST', 'GET', 'OPTIONS'], credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb' }));

// ---- health & diagnostics
app.get('/health', (_req, res) => res.json({ status: 'Backend is running ✅' }));
app.get('/diag', (_req, res) => {
  const pk = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  res.json({
    project_id: process.env.GOOGLE_PROJECT_ID || null,
    client_email: process.env.GOOGLE_CLIENT_EMAIL || null,
    has_private_key: pk.includes('BEGIN PRIVATE KEY'),
    pk_len: pk.length,
  });
});

// ---- google auth (service account -> access token)
async function getAccessToken() {
  try {
    const jwt = new google.auth.JWT({
      email: process.env.GOOGLE_CLIENT_EMAIL,
      key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const { access_token } = await jwt.authorize(); // important: authorize()
    if (!access_token) throw new Error('No access token returned');
    return access_token;
  } catch (err) {
    const msg = err?.message || String(err);
    throw new Error(`Auth failed: ${msg}`);
  }
}

// ---- Imagen 3 generate (editImage-like) via publisher model
app.post('/api/imagen3/generate', async (req, res) => {
  try {
    const { referenceImageBase64, bagImageBase64, prompt } = req.body || {};
    if (!referenceImageBase64 || !bagImageBase64 || !prompt) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    const accessToken = await getAccessToken();
    const projectId = process.env.GOOGLE_PROJECT_ID;
    const location = 'us-central1';
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/imagen-3.0-capability-001:predict`;
    const body = {
      instances: [
        {
          prompt,
          referenceImages: [
            { bytesBase64Encoded: referenceImageBase64, mimeType: 'image/jpeg' },
            { bytesBase64Encoded: bagImageBase64,        mimeType: 'image/jpeg' },
          ],
        },
      ],
      parameters: {
        sampleCount: 1,
        outputFormat: 'PNG',
      },
    };
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const errJson = await resp.json().catch(() => ({}));
      return res.status(resp.status).json({
        success: false,
        error: errJson?.error?.message || errJson || (await resp.text()),
      });
    }
    const data = await resp.json();
    const img = data?.predictions?.[0]?.bytesBase64Encoded;
    if (!img) return res.status(502).json({ success: false, error: 'Imagen 3 API did not return an image' });
    res.json({ success: true, image: img });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

// ---- error middleware
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

// ✅ on vercel, export the app (do NOT call app.listen)
module.exports = app;
