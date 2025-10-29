const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
require('dotenv').config();

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

    const credentials = getCredentials();
    const accessToken = await getAccessToken(credentials);
    
    if (!accessToken) {
      throw new Error('Failed to obtain access token');
    }

    console.log('✅ Access token obtained');

    const projectId = credentials.project_id;
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

function getCredentials() {
  try {
    // Build credentials object from separate environment variables
    const credentials = {
      type: "service_account",
      project_id: process.env.GOOGLE_PROJECT_ID,
      private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
      private_key: process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : null,
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      client_id: process.env.GOOGLE_CLIENT_ID,
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
      auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
      client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(process.env.GOOGLE_CLIENT_EMAIL || '')}`,
      universe_domain: "googleapis.com"
    };

    // Validate all required fields are present
    const required = ['project_id', 'private_key_id', 'private_key', 'client_email', 'client_id'];
    for (const field of required) {
      if (!credentials[field]) {
        throw new Error(`Missing required credential field: ${field}`);
      }
    }
    
    console.log('✅ Credentials built successfully from environment variables');
    return credentials;
  } catch (error) {
    console.error('❌ Failed to build credentials:', error);
    throw error;
  }
}

async function getAccessToken(credentials) {
  try {
    const jwtClient = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });

    const token = await jwtClient.authorizeAsync();
    return token.credentials.access_token;

  } catch (error) {
    console.error('❌ Failed to get access token:', error.message);
    throw new Error(`Auth failed: ${error.message}`);
  }
}

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
});

module.exports = app;