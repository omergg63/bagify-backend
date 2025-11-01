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
  status: 'BAGIFY Automation Backend is running ✅',
  timestamp: new Date().toISOString(),
  features: ['DALL-E 3', 'Automation', 'Random Selection'],
  env: process.env.NODE_ENV 
}));

app.get('/diag', (_req, res) => {
  res.json({
    has_openai_api_key: !!(process.env.OPENAI_API_KEY),
    api_provider: 'OpenAI DALL-E 3',
    automation_ready: true,
    node_env: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

// 🚀 NEW: Automation endpoint for Make.com
app.post('/api/generate-carousel-auto', async (req, res) => {
  try {
    console.log('🤖 Automated carousel generation started');
    
    const { 
      referencePhotos = [],    // Array of 2 mirror selfie URLs
      productAngled,           // Single angled template URL
      productFront,            // Single front template URL  
      targetBag               // Single target bag URL
    } = req.body;

    // Validate inputs
    if (!referencePhotos || referencePhotos.length !== 2) {
      return res.status(400).json({ 
        success: false, 
        error: 'Need exactly 2 reference photos' 
      });
    }

    if (!productAngled || !productFront || !targetBag) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing product templates or target bag' 
      });
    }

    console.log('📸 Generating 4-frame carousel...');

    // Generate all 4 frames
    const results = await Promise.all([
      generateFrame1(referencePhotos[0], targetBag),  // Mirror selfie 1 with target bag
      generateFrame2(productAngled, targetBag),       // Angled product with target bag  
      generateFrame3(productFront, targetBag),        // Front product with target bag
      generateFrame4(referencePhotos[1], targetBag)   // Mirror selfie 2 with target bag
    ]);

    console.log('✅ All frames generated successfully');

    res.json({
      success: true,
      carousel: {
        frame1: results[0],
        frame2: results[1], 
        frame3: results[2],
        frame4: results[3]
      },
      metadata: {
        generated_at: new Date().toISOString(),
        target_bag: targetBag,
        reference_photos: referencePhotos.length
      }
    });

  } catch (error) {
    console.error('❌ Automation error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Frame generation functions
async function generateFrame1(referencePhoto, targetBag) {
  return await generateWithDALLE3({
    referenceImageUrl: referencePhoto,
    targetBagUrl: targetBag,
    prompt: "Mirror selfie with luxury handbag replacement. Keep the woman identical, replace only the handbag with the target bag. Maintain pose, lighting, and background exactly."
  });
}

async function generateFrame2(productAngled, targetBag) {
  return await generateWithDALLE3({
    referenceImageUrl: productAngled,
    targetBagUrl: targetBag,
    prompt: "Product shot of luxury handbag from angled side view. Replace the bag with target bag while maintaining professional lighting and white background."
  });
}

async function generateFrame3(productFront, targetBag) {
  return await generateWithDALLE3({
    referenceImageUrl: productFront, 
    targetBagUrl: targetBag,
    prompt: "Product shot of luxury handbag from front view. Replace the bag with target bag while maintaining professional lighting and white background."
  });
}

async function generateFrame4(referencePhoto, targetBag) {
  return await generateWithDALLE3({
    referenceImageUrl: referencePhoto,
    targetBagUrl: targetBag,
    prompt: "Mirror selfie with luxury handbag replacement. Keep the woman identical, replace only the handbag with the target bag. Maintain pose, lighting, and background exactly. Use different pose if possible."
  });
}

// Enhanced DALL-E 3 generation function
async function generateWithDALLE3({ referenceImageUrl, targetBagUrl, prompt }) {
  try {
    console.log('🎨 Generating with DALL-E 3...');
    
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable not set');
    }

    // Download reference image and convert to base64
    const refResponse = await fetch(referenceImageUrl);
    const refBuffer = await refResponse.arrayBuffer();
    const refBase64 = Buffer.from(refBuffer).toString('base64');

    // Enhanced prompt with target bag details
    const dallePrompt = `${prompt}

Replace with the target luxury handbag while preserving all other elements. Ensure natural lighting integration and realistic bag placement.`;

    const response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: (() => {
        const formData = new FormData();
        
        const imageBuffer = Buffer.from(refBase64, 'base64');
        const imageBlob = new Blob([imageBuffer], { type: 'image/png' });
        formData.append('image', imageBlob, 'reference.png');
        
        formData.append('prompt', dallePrompt);
        formData.append('n', '1');
        formData.append('size', '1024x1024');
        
        return formData;
      })(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DALL-E 3 API error: ${errorText}`);
    }

    const data = await response.json();
    
    if (!data.data || !data.data[0] || !data.data[0].url) {
      throw new Error('DALL-E 3 did not return a valid image URL');
    }

    // Download generated image and convert to base64
    const imageUrl = data.data[0].url;
    const imageResponse = await fetch(imageUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    const imageBase64 = Buffer.from(imageBuffer).toString('base64');

    return {
      success: true,
      image: imageBase64,
      generated_at: new Date().toISOString()
    };

  } catch (error) {
    console.error('❌ DALL-E 3 generation error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// 🚀 NEW: Random selection endpoint for Make.com
app.post('/api/random-selection', async (req, res) => {
  try {
    const { 
      referencePhotosUrls = [],   // Array of all reference photo URLs
      bagLibraryUrls = [],        // Array of all bag URLs
      productAngledUrl,           // Single angled template URL
      productFrontUrl             // Single front template URL
    } = req.body;

    // Random selection logic
    const selectedReferencePhotos = selectRandomPhotos(referencePhotosUrls, 2);
    const selectedTargetBag = selectRandomPhotos(bagLibraryUrls, 1)[0];

    res.json({
      success: true,
      selection: {
        referencePhotos: selectedReferencePhotos,
        productAngled: productAngledUrl,
        productFront: productFrontUrl,
        targetBag: selectedTargetBag
      }
    });

  } catch (error) {
    console.error('❌ Random selection error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Helper function for random selection
function selectRandomPhotos(urlArray, count) {
  const shuffled = urlArray.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

// EXISTING: Original DALL-E 3 endpoint (for manual use)
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
    
    const dallePrompt = `${prompt}

Replace the woman's handbag with the target bag from the reference image. Keep the woman identical (face, body, pose, hair) and preserve the background scene exactly. The new bag must match the target bag's color, style, and details precisely. Make the replacement look natural with proper lighting integration.`;

    console.log('🌐 Calling DALL-E 3 API...');
    
    const response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: (() => {
        const formData = new FormData();
        
        const imageBuffer = Buffer.from(referenceImageBase64, 'base64');
        const imageBlob = new Blob([imageBuffer], { type: 'image/png' });
        formData.append('image', imageBlob, 'reference.png');
        
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
  console.log(`🚀 BAGIFY Automation Backend running on port ${PORT}`);
  console.log(`✅ Features: DALL-E 3, Automation, Random Selection`);
});

module.exports = app;
