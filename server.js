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
  status: 'Backend is running with DALL-E 3 ✅',
  timestamp: new Date().toISOString(),
  env: process.env.NODE_ENV 
}));

app.get('/diag', (_req, res) => {
  res.json({
    has_openai_api_key: !!(process.env.OPENAI_API_KEY),
    api_provider: 'OpenAI DALL-E 3',
    node_env: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

// DALL-E 3 image generation with precise bag replacement
app.post('/api/imagen3/generate', async (req, res) => {
  try {
    console.log('📥 Received DALL-E 3 request for bag replacement');
    
    const { referenceImageBase64, bagImageBase64, prompt } = req.body || {};
    if (!referenceImageBase64 || !bagImageBase64 || !prompt) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    
    console.log('🔐 Using OpenAI DALL-E 3...');
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable not set');
    }
    
    // Enhanced prompt for DALL-E 3 bag replacement
    const dallePrompt = `${prompt}

CRITICAL INSTRUCTIONS FOR BAG REPLACEMENT:
- The woman must remain identical (same face, body, pose, hair)
- The background scene must remain identical 
- REPLACE her current handbag with the specific target bag shown in the reference
- The new bag must match the target bag exactly (color, style, hardware, proportions)
- Make the bag replacement look natural and well-integrated
- Maintain the original lighting and scene composition
- Keep all other elements unchanged

Focus on creating a seamless, realistic bag replacement while preserving everything else about the image.`;

    console.log('🌐 Calling DALL-E 3 API...');
    
    const response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: (() => {
        const formData = new FormData();
        
        // Convert base64 to blob for the image to edit
        const imageBuffer = Buffer.from(referenceImageBase64, 'base64');
        const imageBlob = new Blob([imageBuffer], { type: 'image/png' });
        formData.append('image', imageBlob, 'reference.png');
        
        // Add the prompt
        formData.append('prompt', dallePrompt);
        formData.append('n', '1');
        formData.append('size', '1024x1024');
        
        return formData;
      })(),
    });
    
    console.log('📡 DALL-E 3 response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ DALL-E 3 API error:', errorText);
      
      return res.status(response.status).json({
        success: false,
        error: `DALL-E 3 API error: ${errorText}`,
      });
    }
    
    const data = await response.json();
    
    if (!data.data || !data.data[0] || !data.data[0].url) {
      console.error('❌ No image URL in DALL-E 3 response:', JSON.stringify(data, null, 2));
      return res.status(502).json({ 
        success: false, 
        error: 'DALL-E 3 did not return a valid image URL',
        response: data
      });
    }
    
    // Download the image and convert to base64
    const imageUrl = data.data[0].url;
    console.log('📥 Downloading generated image...');
    
    const imageResponse = await fetch(imageUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    const imageBase64 = Buffer.from(imageBuffer).toString('base64');
    
    console.log('✅ DALL-E 3 generation successful');
    res.json({ success: true, image: imageBase64 });
    
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
  console.log(`🚀 Bagify backend running with DALL-E 3 on port ${PORT}`);
});

module.exports = app;
