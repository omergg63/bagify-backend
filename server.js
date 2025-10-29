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
  const pk = reconstructPrivateKey();
  res.json({
    project_id: process.env.GOOGLE_PROJECT_ID || null,
    client_email: process.env.GOOGLE_CLIENT_EMAIL || null,
    has_private_key: pk.includes('BEGIN PRIVATE KEY'),
    pk_len: pk.length,
    pk_start: pk.substring(0, 50),
    pk_end: pk.substring(pk.length - 50),
  });
});

// ---- reconstruct private key from parts to avoid Vercel corruption
function reconstructPrivateKey() {
  // Split the private key into parts to avoid corruption
  const keyBody = process.env.GOOGLE_PRIVATE_KEY_BODY || '';
  
  if (keyBody) {
    // Reconstruct the full private key
    const fullKey = `-----BEGIN PRIVATE KEY-----\n${keyBody.replace(/(.{64})/g, '$1\n').trim()}\n-----END PRIVATE KEY-----`;
    return fullKey;
  }
  
  // Fallback to the original method
  return (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
}

// ---- google auth (service account -> access token)
async function getAccessToken() {
  try {
    const privateKey = reconstructPrivateKey();
    
    // Validate the private key format
    if (!privateKey.includes('-----BEGIN PRIVATE KEY-----') || !privateKey.includes('-----END PRIVATE KEY-----')) {
      throw new Error('Invalid private key format - missing BEGIN/END markers');
    }

    console.log('🔑 Private key length:', privateKey.length);
    console.log('🔑 Private key start:', privateKey.substring(0, 50));

    const jwt = new google.auth.JWT({
      email: process.env.GOOGLE_CLIENT_EMAIL,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    
    const { access_token } = await jwt.authorize();
    if (!access_token) throw new Error('No access token returned');
    
    console.log('✅ Access token obtained successfully');
    return access_token;
  } catch (err) {
    console.error('❌ Auth error:', err);
    const msg = err?.message || String(err);
    throw new Error(`Auth failed: ${msg}`);
  }
}

// ---- Imagen 3 generate
app.post('/api/imagen3/generate', async (req, res) => {
  try {
    console.log('📥 Received Imagen 3 request');
    
    const { referenceImageBase64, bagImageBase64, prompt } = req.body || {};
    if (!referenceImageBase64 || !bagImageBase64 || !prompt) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    
    console.log('🔐 Getting access token...');
    const accessToken = await getAccessToken();
    
    const projectId = process.env.GOOGLE_PROJECT_ID;
    const location = 'us-central1';
    
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/imagen-3.0-capability-001:predict`;
    
    console.log('🌐 Calling Imagen 3 API...');
    
    const body = {
      instances: [
        {
          prompt,
          referenceImages: [
            { bytesBase64Encoded: referenceImageBase64, mimeType: 'image/jpeg' },
            { bytesBase64Encoded: bagImageBase64, mimeType: 'image/jpeg' },
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
      headers: { 
        Authorization: `Bearer ${accessToken}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify(body),
    });
    
    console.log('📡 API response status:', resp.status);
    
    if (!resp.ok) {
      const errText = await resp.text();
      console.error('❌ API error response:', errText);
      
      let errJson;
      try {
        errJson = JSON.parse(errText);
      } catch {
        errJson = { message: errText };
      }
      
      return res.status(resp.status).json({
        success: false,
        error: errJson?.error?.message || errJson?.message || errText,
      });
    }
    
    const data = await resp.json();
    const img = data?.predictions?.[0]?.bytesBase64Encoded;
    
    if (!img) {
      console.error('❌ No image in response:', JSON.stringify(data, null, 2));
      return res.status(502).json({ 
        success: false, 
        error: 'Imagen 3 API did not return an image',
        response: data
      });
    }
    
    console.log('✅ Imagen 3 generation successful');
    res.json({ success: true, image: img });
    
  } catch (err) {
    console.error('❌ Server error:', err);
    res.status(500).json({ 
      success: false, 
      error: err?.message || String(err) 
    });
  }
});

// ---- error middleware
app.use((err, _req, res, _next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({ error: err.message });
});

// ✅ on vercel, export the app
module.exports = app;
