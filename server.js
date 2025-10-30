const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS & body parsing
app.use(cors({ 
  origin: ['https://bagify-frontend.vercel.app', 'http://localhost:3000', '*'], 
  methods: ['POST', 'GET', 'OPTIONS'], 
  credentials: true 
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Health & diagnostics
app.get('/health', (_req, res) => res.json({ 
  status: 'Backend is running ✅',
  timestamp: new Date().toISOString(),
  env: process.env.NODE_ENV 
}));

app.get('/diag', (_req, res) => {
  res.json({
    project_id: process.env.GOOGLE_PROJECT_ID || null,
    has_vertex_api_key: !!(process.env.VERTEX_AI_API_KEY),
    node_env: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

// Simple API key authentication for Vertex AI
async function getAccessTokenWithApiKey() {
  try {
    const apiKey = process.env.VERTEX_AI_API_KEY;
    
    if (!apiKey) {
      throw new Error('VERTEX_AI_API_KEY environment variable not set');
    }
    
    console.log('🔑 Using Vertex AI API Key authentication...');
    return apiKey;
    
  } catch (err) {
    console.error('❌ API Key authentication failed:', err);
    throw new Error(`API Key auth failed: ${err.message}`);
  }
}

// Imagen 3 generation endpoint with API key auth
app.post('/api/imagen3/generate', async (req, res) => {
  try {
    console.log('📥 Received Imagen 3 request');
    
    const { referenceImageBase64, bagImageBase64, prompt } = req.body || {};
    if (!referenceImageBase64 || !bagImageBase64 || !prompt) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    
    console.log('🔐 Getting API key...');
    const apiKey = await getAccessTokenWithApiKey();
    
    const projectId = process.env.GOOGLE_PROJECT_ID;
    const location = 'us-central1';
    
    // Try API key authentication method
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/imagen-3.0-capability-001:predict?key=${apiKey}`;
    
    console.log('🌐 Calling Imagen 3 API with API key...');
    
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

// Error handling middleware
app.use((err, _req, res, _next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({ error: err.message });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Bagify backend running on port ${PORT}`);
});

module.exports = app;
