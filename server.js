const express = require('express');
const cors = require('cors');
require('dotenv').config();
const fs = require('fs');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['POST', 'GET', 'OPTIONS'],
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'Backend is running ✅' });
});

// Imagen 3 generation endpoint
app.post('/api/imagen3/generate', async (req, res) => {
  try {
    const { referenceImageBase64, bagImageBase64, prompt } = req.body;

    if (!referenceImageBase64 || !bagImageBase64 || !prompt) {
      return res.status(400).json({ 
        error: 'Missing required fields' 
      });
    }

    console.log('📥 Received Imagen 3 request');

    const accessToken = await getAccessToken();
    
    if (!accessToken) {
      throw new Error('Failed to obtain access token');
    }

    console.log('✅ Access token obtained');

    const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    const location = 'us-central1';
    
    const response = await fetch(
      `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/imagegeneration@006:editImage`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instances: [
            {
              prompt: prompt,
              image: {
                bytesBase64Encoded: referenceImageBase64,
                mimeType: 'image/jpeg'
              },
              editImage: {
                bytesBase64Encoded: bagImageBase64,
                mimeType: 'image/jpeg'
              }
            }
          ],
          parameters: {
            sampleCount: 1,
            outputFormat: 'PNG'
          }
        })
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      console.error('❌ Imagen 3 API error:', errorData);
      throw new Error(`Imagen 3 API error: ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    
    if (!data.predictions || !data.predictions[0] || !data.predictions[0].bytesBase64Encoded) {
      throw new Error('Imagen 3 API did not return an image');
    }

    console.log('✅ Imagen 3 generation successful');

    res.json({
      success: true,
      image: data.predictions[0].bytesBase64Encoded
    });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ 
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

async function getAccessToken() {
  try {
    let credentials;
    
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    } 
    else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      const credContent = fs.readFileSync(credPath, 'utf-8');
      credentials = JSON.parse(credContent);
    }
    else {
      throw new Error('No Google Cloud credentials found');
    }

    const jwt = createJWT(credentials);
    
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      })
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      throw new Error(`Failed to get access token: ${JSON.stringify(errorData)}`);
    }

    const tokenData = await tokenResponse.json();
    return tokenData.access_token;

  } catch (error) {
    console.error('❌ Error getting access token:', error);
    throw error;
  }
}

function createJWT(serviceAccount) {
  const crypto = require('crypto');

  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const headerEncoded = base64url(JSON.stringify(header));
  const payloadEncoded = base64url(JSON.stringify(payload));
  const message = `${headerEncoded}.${payloadEncoded}`;

  const signature = crypto.createSign('sha256').update(message).sign(serviceAccount.private_key);
  const signatureEncoded = base64url(signature);

  return `${message}.${signatureEncoded}`;
}

function base64url(str) {
  const bytes = typeof str === 'string' ? Buffer.from(str, 'utf-8') : str;
  return bytes
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
  console.log(`✅ Health check: http://localhost:${PORT}/health`);
  console.log(`✅ Imagen 3 endpoint: POST http://localhost:${PORT}/api/imagen3/generate`);
});