const express = require('express');
const cors = require('cors');
const { GoogleAuth } = require('google-auth-library');

const app = express();

// CORS & body
app.use(cors({ origin: '*', methods: ['POST', 'GET', 'OPTIONS'], credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb' }));

// ---- health & diagnostics
app.get('/health', (_req, res) => res.json({ status: 'Backend is running ✅' }));

app.get('/diag', (_req, res) => {
  res.json({
    project_id: process.env.GOOGLE_PROJECT_ID || null,
    client_email: process.env.GOOGLE_CLIENT_EMAIL || null,
    has_credentials: !!(process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_PRIVATE_KEY),
    node_env: process.env.NODE_ENV,
  });
});

// ---- Alternative authentication using GoogleAuth
async function getAccessToken() {
  try {
    // Method 1: Try using service account credentials from environment
    if (process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_CLIENT_EMAIL) {
      const credentials = {
        type: "service_account",
        project_id: process.env.GOOGLE_PROJECT_ID,
        private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
        private_key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        client_id: process.env.GOOGLE_CLIENT_ID,
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
        client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(process.env.GOOGLE_CLIENT_EMAIL)}`,
        universe_domain: "googleapis.com"
      };

      const auth = new GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });

      const client = await auth.getClient();
      const accessTokenResponse = await client.getAccessToken();
      
      if (!accessTokenResponse.token) {
        throw new Error('No access token received from GoogleAuth');
      }
      
      console.log('✅ Authentication successful with GoogleAuth');
      return accessTokenResponse.token;
    }

    throw new Error('No valid credentials found in environment variables');

  } catch (err) {
    console.error('❌ Authentication failed:', err);
    throw new Error(`Auth failed: ${err.message}`);
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
