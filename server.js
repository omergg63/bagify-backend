const express = require('express');
const cors = require('cors');
const FormData = require('form-data');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS & body parsing
app.use(cors({ 
  origin: '*',
  methods: ['POST', 'GET', 'OPTIONS'], 
  credentials: true 
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Initialize Gemini (for fallback)
const genAI = new GoogleGenerativeAI(process.env.VITE_API_KEY || '');

// Health check
app.get('/health', (_req, res) => res.json({ 
  status: 'BAGIFY Backend running ✅',
  timestamp: new Date().toISOString(),
  features: ['DALL-E 3', 'Gemini Fallback', 'Ready for Phase 2 Google Drive'],
  openai_ready: !!(process.env.OPENAI_API_KEY),
  gemini_ready: !!(process.env.VITE_API_KEY)
}));

app.get('/diag', (_req, res) => {
  res.json({
    has_openai_api_key: !!(process.env.OPENAI_API_KEY),
    has_gemini_api_key: !!(process.env.VITE_API_KEY),
    phase: '1 - DALLE-3 Fix',
    next_phase: '2 - Google Drive Integration',
    timestamp: new Date().toISOString()
  });
});

// ✅ PHASE 1: DALLE-3 Endpoint (Frontend Direct Call)
// Receives: base64 images from frontend
// Returns: base64 generated image or falls back to Gemini
app.post('/api/imagen3/generate', async (req, res) => {
  try {
    console.log('📥 Received image generation request');
    
    const { referenceImageBase64, bagImageBase64, prompt } = req.body || {};
    if (!referenceImageBase64 || !prompt) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing referenceImageBase64 or prompt' 
      });
    }
    
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn('⚠️ OPENAI_API_KEY not set, will use Gemini fallback');
    }

    // Try DALLE-3 first
    if (apiKey) {
      try {
        console.log('🎨 Attempting DALLE-3...');
        const dalleResult = await generateWithDALLE3(referenceImageBase64, prompt);
        console.log('✅ DALLE-3 success');
        return res.json({ success: true, image: dalleResult, method: 'DALLE-3' });
      } catch (dalleError) {
        console.warn('⚠️ DALLE-3 failed, falling back to Gemini:', dalleError.message);
      }
    }

    // Fallback to Gemini
    console.log('🎨 Using Gemini fallback...');
    const geminiResult = await generateWithGemini(referenceImageBase64, bagImageBase64, prompt);
    console.log('✅ Gemini success');
    res.json({ success: true, image: geminiResult, method: 'Gemini' });

  } catch (err) {
    console.error('❌ Generation failed:', err.message);
    res.status(500).json({ 
      success: false, 
      error: err?.message || 'Generation failed'
    });
  }
});

// ✅ DALLE-3 Implementation
async function generateWithDALLE3(referenceImageBase64, prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not set');
  }

  const form = new FormData();
  
  // Convert base64 to Buffer
  const imageBuffer = Buffer.from(referenceImageBase64, 'base64');
  form.append('image', imageBuffer, { 
    filename: 'reference.png', 
    contentType: 'image/png' 
  });
  
  form.append('prompt', prompt);
  form.append('n', '1');
  form.append('size', '1024x1024');

  const response = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      ...form.getHeaders()
    },
    body: form
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DALLE-3 API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  
  if (!data.data || !data.data[0] || !data.data[0].url) {
    throw new Error('DALLE-3 did not return image URL');
  }

  // Download the generated image
  const imageUrl = data.data[0].url;
  const imageResponse = await fetch(imageUrl);
  const imageBuffer2 = await imageResponse.arrayBuffer();
  const imageBase64 = Buffer.from(imageBuffer2).toString('base64');

  return imageBase64;
}

// ✅ Gemini Fallback Implementation
async function generateWithGemini(referenceImageBase64, bagImageBase64, prompt) {
  if (!process.env.VITE_API_KEY) {
    throw new Error('Gemini API key not configured');
  }

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-image' });

  const parts = [];

  // Add reference image
  if (referenceImageBase64) {
    parts.push({
      inlineData: {
        data: referenceImageBase64,
        mimeType: 'image/png'
      }
    });
  }

  // Add bag image if provided
  if (bagImageBase64) {
    parts.push({
      inlineData: {
        data: bagImageBase64,
        mimeType: 'image/png'
      }
    });
  }

  // Add text prompt
  parts.push({
    text: prompt
  });

  const result = await model.generateContent({
    contents: [{
      role: 'user',
      parts: parts
    }],
    generationConfig: {
      temperature: 0.7,
      topP: 0.95
    }
  });

  if (!result.response.candidates || result.response.candidates.length === 0) {
    throw new Error('Gemini did not return any response');
  }

  const content = result.response.candidates[0].content;
  if (!content.parts || content.parts.length === 0) {
    throw new Error('Gemini did not generate image');
  }

  // Find image in response
  for (const part of content.parts) {
    if (part.inlineData && part.inlineData.mimeType.startsWith('image/')) {
      return part.inlineData.data;
    }
  }

  throw new Error('Gemini response did not contain image');
}

// Error handling
app.use((err, _req, res, _next) => {
  console.error('❌ Unhandled error:', err.message);
  res.status(500).json({ error: err.message });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 BAGIFY Backend running on port ${PORT}`);
  console.log(`📋 PHASE 1: DALLE-3 Fix with Gemini Fallback`);
  console.log(`✅ OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'SET' : 'NOT SET (will use Gemini)'}`);
  console.log(`✅ GEMINI_API_KEY: ${process.env.VITE_API_KEY ? 'SET' : 'NOT SET'}`);
  console.log(`📍 Next: Phase 2 - Google Drive Integration`);
});

module.exports = app;
