const express = require('express');
const cors = require('cors');
const FormData = require('form-data');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
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

// ==========================================
// GOOGLE DRIVE SETUP
// ==========================================

// Folder IDs (from your Google Drive)
const FOLDER_IDS = {
  bagLibrary: '1dToKUgXRvWCL3ao9yyOmS7kC6qfpFHJW',
  referencePhotos: '1CtLqTUbQF7Dg6Dnal4-FrfotizqsF-5j',
  productAngled: '1vd424znRgB4i3MqxWihCK9y0SdKXI83p',
  productFront: '1AiB27a190GgB0inSreGH-_S4Gbwch6sk',
  generatedCarousels: '1S0WbIlEBN94P3a1j9b0U0PfxHyGcI-7X',
  postingQueue: '1fCPlJXlK5avD7AB3l6xWbMnDToKd3ElV'
};

// Fixed hashtags (used for all posts)
const FIXED_HASHTAGS = ['#luxuryhandbag', '#bagoftheday', '#designer', '#fashion'];

// Bag name to hashtag mapping
const BAG_HASHTAG_MAP = {
  'hermes': '#hermes #birkin',
  'lv': '#louisvuitton #speedy',
  'chanel': '#chanel #flap',
  'gucci': '#gucci',
  'birkin': '#birkin',
  'speedy': '#speedy',
  'flap': '#chanelflap'
};

// Initialize Google Drive
let driveAuthClient = null;

async function initializeGoogleDrive() {
  try {
    // Get service account credentials from environment variable
    const keyData = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    
    if (!keyData) {
      console.warn('⚠️ GOOGLE_SERVICE_ACCOUNT_KEY not set in environment');
      return null;
    }

    const credentials = JSON.parse(keyData);
    
    const auth = new google.auth.GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/drive']
    });

    driveAuthClient = google.drive({ version: 'v3', auth });
    console.log('✅ Google Drive authenticated');
    return driveAuthClient;

  } catch (error) {
    console.error('❌ Google Drive auth failed:', error.message);
    return null;
  }
}

// Initialize Gemini for fallback
const genAI = new GoogleGenerativeAI(process.env.VITE_API_KEY || '');

// ==========================================
// HEALTH CHECK
// ==========================================

app.get('/health', (_req, res) => res.json({ 
  status: 'BAGIFY Backend running ✅',
  timestamp: new Date().toISOString(),
  phase: 'Complete - Google Drive + DALLE-3 (selfies) + Gemini (products)',
  google_drive_ready: !!driveAuthClient,
  openai_ready: !!process.env.OPENAI_API_KEY,
  gemini_ready: !!process.env.VITE_API_KEY
}));

app.get('/diag', (_req, res) => {
  res.json({
    google_drive_authenticated: !!driveAuthClient,
    has_openai_api_key: !!process.env.OPENAI_API_KEY,
    has_gemini_api_key: !!process.env.VITE_API_KEY,
    folder_ids: FOLDER_IDS,
    frame_strategy: {
      frame1_mirror_selfie: 'DALLE-3 primary (professional quality)',
      frame2_product_angled: 'Gemini only (image-to-image perfect)',
      frame3_product_front: 'Gemini only (image-to-image perfect)',
      frame4_mirror_selfie: 'DALLE-3 primary (professional quality)'
    },
    timestamp: new Date().toISOString()
  });
});

// ==========================================
// GOOGLE DRIVE FILE OPERATIONS
// ==========================================

async function listFilesInFolder(folderId) {
  if (!driveAuthClient) {
    throw new Error('Google Drive not authenticated');
  }

  try {
    const response = await driveAuthClient.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      spaces: 'drive',
      fields: 'files(id, name, mimeType)',
      pageSize: 100
    });

    return response.data.files || [];
  } catch (error) {
    console.error('❌ Error listing files:', error.message);
    throw error;
  }
}

async function getFileDownloadUrl(fileId) {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

async function uploadFileToFolder(fileName, fileBuffer, mimeType, folderId) {
  if (!driveAuthClient) {
    throw new Error('Google Drive not authenticated');
  }

  try {
    const fileMetadata = {
      name: fileName,
      parents: [folderId]
    };

    const media = {
      mimeType: mimeType,
      body: fileBuffer
    };

    const response = await driveAuthClient.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id'
    });

    console.log(`✅ Uploaded: ${fileName}`);
    return response.data.id;

  } catch (error) {
    console.error('❌ Upload failed:', error.message);
    throw error;
  }
}

// ==========================================
// CAROUSEL GENERATION LOGIC
// ==========================================

function extractBagName(fileName) {
  // Extract bag name from file name
  // Examples: "Hermes-Birkin.jpg" -> "hermes", "LV-Speedy.jpg" -> "lv"
  const name = fileName.split('-')[0].toLowerCase();
  return name;
}

function generateHashtags(bagName) {
  const bagHashtag = BAG_HASHTAG_MAP[bagName] || '';
  const allHashtags = [...FIXED_HASHTAGS];
  
  if (bagHashtag) {
    allHashtags.push(bagHashtag);
  }
  
  return allHashtags.join(' ');
}

function getRandomItems(array, count) {
  const shuffled = [...array].sort(() => 0.5 - Math.random());
  return count === 1 ? shuffled[0] : shuffled.slice(0, count);
}

// ==========================================
// IMAGE GENERATION - DALLE-3 (Mirror Selfies Only)
// ==========================================

async function generateWithDALLE3(referenceImageBase64, prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not set');
  }

  const form = new FormData();
  
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

  const imageUrl = data.data[0].url;
  const imageResponse = await fetch(imageUrl);
  const imageBuffer2 = await imageResponse.arrayBuffer();
  const imageBase64 = Buffer.from(imageBuffer2).toString('base64');

  return imageBase64;
}

// ==========================================
// CLEANUP BASE64 HELPER (GPT fix)
// ==========================================

function cleanupBase64(b64) {
  // Remove data URL prefix if present
  const cleaned = b64.replace(/^data:.*?;base64,/, "").trim();
  // Normalize web-safe base64
  return cleaned.replace(/-/g, "+").replace(/_/g, "/");
}

// ==========================================
// IMAGE GENERATION - GEMINI (Product Photos + Fallback)
// FIXED: Extract base64 → convert to Buffer (GPT recommendation)
// ==========================================

async function generateWithGemini(referenceImageBase64, bagImageBase64, prompt) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_API_KEY;
  if (!apiKey) {
    throw new Error('Gemini API key not configured (GEMINI_API_KEY or VITE_API_KEY)');
  }

  try {
    const genAI2 = new GoogleGenerativeAI(apiKey);
    const model = genAI2.getGenerativeModel({ model: 'gemini-2.5-flash-image' });

    const parts = [];

    if (referenceImageBase64) {
      parts.push({
        inlineData: {
          data: cleanupBase64(referenceImageBase64),
          mimeType: 'image/png'
        }
      });
    }

    if (bagImageBase64) {
      parts.push({
        inlineData: {
          data: cleanupBase64(bagImageBase64),
          mimeType: 'image/png'
        }
      });
    }

    parts.push({
      text: prompt
    });

    console.log(`🔄 Calling Gemini API with ${parts.length} parts...`);

    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: parts
      }]
    });

    const candidates = result?.response?.candidates ?? [];
    if (!candidates.length) {
      throw new Error('Gemini returned no candidates');
    }

    const contentParts = candidates[0]?.content?.parts ?? [];
    if (!contentParts.length) {
      throw new Error('Gemini returned no content parts');
    }

    // ✅ FIXED per GPT: Find image part and convert to Buffer
    const imagePart = contentParts.find(p => p.inlineData?.data && p.inlineData?.mimeType);
    if (!imagePart) {
      throw new Error('Gemini response did not contain image data');
    }

    const mimeType = imagePart.inlineData.mimeType || 'image/png';
    const base64Data = cleanupBase64(imagePart.inlineData.data);
    const buffer = Buffer.from(base64Data, 'base64');
    const base64String = buffer.toString('base64');

    console.log(`✅ Gemini returned image (${mimeType}, ${buffer.length} bytes)`);

    // Return as base64 string for consistency
    return base64String;

  } catch (error) {
    console.error('❌ Gemini error details:', error);
    throw new Error(`Gemini failed: ${error.message}`);
  }
}

// ==========================================
// MAIN CAROUSEL GENERATION ENDPOINT
// ==========================================

app.post('/api/generate-carousel', async (req, res) => {
  try {
    console.log('🎬 Starting carousel generation...');

    if (!driveAuthClient) {
      return res.status(500).json({ success: false, error: 'Google Drive not authenticated' });
    }

    // Get all available bags
    const bags = await listFilesInFolder(FOLDER_IDS.bagLibrary);
    if (bags.length === 0) {
      return res.status(400).json({ success: false, error: 'No bags found in bag-library' });
    }

    // Get all reference photos (selfies)
    const references = await listFilesInFolder(FOLDER_IDS.referencePhotos);
    if (references.length < 2) {
      return res.status(400).json({ success: false, error: 'Need at least 2 reference photos' });
    }

    // Get product images
    const productAngledFiles = await listFilesInFolder(FOLDER_IDS.productAngled);
    const productFrontFiles = await listFilesInFolder(FOLDER_IDS.productFront);
    
    if (productAngledFiles.length === 0 || productFrontFiles.length === 0) {
      return res.status(400).json({ success: false, error: 'Missing product images' });
    }

    // Random selections
    const selectedBag = getRandomItems(bags, 1);
    const selectedReferences = getRandomItems(references, 2);
    const selectedProductAngled = productAngledFiles[0];
    const selectedProductFront = productFrontFiles[0];

    console.log('🎲 Selected:', {
      bag: selectedBag.name,
      ref1: selectedReferences[0].name,
      ref2: selectedReferences[1].name
    });

    // Download images as base64
    const bagUrl = await getFileDownloadUrl(selectedBag.id);
    const ref1Url = await getFileDownloadUrl(selectedReferences[0].id);
    const ref2Url = await getFileDownloadUrl(selectedReferences[1].id);
    const prodAngledUrl = await getFileDownloadUrl(selectedProductAngled.id);
    const prodFrontUrl = await getFileDownloadUrl(selectedProductFront.id);

    // Fetch images
    const [bagBase64, ref1Base64, ref2Base64, prodAngledBase64, prodFrontBase64] = await Promise.all([
      fetch(bagUrl).then(r => r.arrayBuffer()).then(b => Buffer.from(b).toString('base64')),
      fetch(ref1Url).then(r => r.arrayBuffer()).then(b => Buffer.from(b).toString('base64')),
      fetch(ref2Url).then(r => r.arrayBuffer()).then(b => Buffer.from(b).toString('base64')),
      fetch(prodAngledUrl).then(r => r.arrayBuffer()).then(b => Buffer.from(b).toString('base64')),
      fetch(prodFrontUrl).then(r => r.arrayBuffer()).then(b => Buffer.from(b).toString('base64'))
    ]);

    console.log('📥 All images downloaded');

    // Generate frames with CORRECT strategy
    const frames = [];

    // ✅ Frame 1: Mirror selfie 1 + DALLE-3 (professional quality)
    console.log('🎨 Generating Frame 1 (Mirror selfie - DALLE-3)...');
    try {
      const frame1 = await generateWithDALLE3(
        ref1Base64,
        'Replace the handbag in this mirror selfie with the target luxury bag. Keep the woman identical, maintain pose and background exactly.'
      );
      frames.push(frame1);
      console.log('✅ Frame 1 done (DALLE-3)');
    } catch (e) {
      console.warn('⚠️ Frame 1 DALLE-3 failed, falling back to Gemini:', e.message);
      const frame1 = await generateWithGemini(ref1Base64, bagBase64, 'Replace the handbag with the target bag. Keep the woman identical.');
      frames.push(frame1);
      console.log('✅ Frame 1 done (Gemini fallback)');
    }

    // ✅ Frame 2: Product angled + GEMINI ONLY (image-to-image, perfect for this)
    console.log('🎨 Generating Frame 2 (Product angled - Gemini)...');
    try {
      const frame2 = await generateWithGemini(
        prodAngledBase64,
        bagBase64,
        'Replace the bag with the target bag. Maintain professional angled view and lighting.'
      );
      frames.push(frame2);
      console.log('✅ Frame 2 done (Gemini)');
    } catch (e) {
      console.error('❌ Frame 2 failed:', e.message);
      throw new Error(`Frame 2 generation failed: ${e.message}`);
    }

    // ✅ Frame 3: Product front + GEMINI ONLY (image-to-image, perfect for this)
    console.log('🎨 Generating Frame 3 (Product front - Gemini)...');
    try {
      const frame3 = await generateWithGemini(
        prodFrontBase64,
        bagBase64,
        'Replace the bag with the target bag. Maintain professional front view and lighting.'
      );
      frames.push(frame3);
      console.log('✅ Frame 3 done (Gemini)');
    } catch (e) {
      console.error('❌ Frame 3 failed:', e.message);
      throw new Error(`Frame 3 generation failed: ${e.message}`);
    }

    // ✅ Frame 4: Mirror selfie 2 + DALLE-3 (professional quality, different pose)
    console.log('🎨 Generating Frame 4 (Mirror selfie - DALLE-3)...');
    try {
      const frame4 = await generateWithDALLE3(
        ref2Base64,
        'Replace the handbag in this mirror selfie with the target luxury bag. Keep the woman identical but use different pose.'
      );
      frames.push(frame4);
      console.log('✅ Frame 4 done (DALLE-3)');
    } catch (e) {
      console.warn('⚠️ Frame 4 DALLE-3 failed, falling back to Gemini:', e.message);
      const frame4 = await generateWithGemini(ref2Base64, bagBase64, 'Replace the handbag with target bag. Different pose. Keep woman identical.');
      frames.push(frame4);
      console.log('✅ Frame 4 done (Gemini fallback)');
    }

    console.log('✅ All frames generated');

    // Create carousel ID
    const carouselId = `carousel_${Date.now()}`;
    const bagName = extractBagName(selectedBag.name);
    const hashtags = generateHashtags(bagName);

    // Upload frames to generated-carousels
    console.log('📤 Uploading to Google Drive...');
    const frameIds = [];
    for (let i = 0; i < frames.length; i++) {
      const frameBuffer = Buffer.from(frames[i], 'base64');
      const frameId = await uploadFileToFolder(
        `${carouselId}_frame${i + 1}.png`,
        frameBuffer,
        'image/png',
        FOLDER_IDS.generatedCarousels
      );
      frameIds.push(frameId);
    }

    // Create metadata JSON
    const metadata = {
      carousel_id: carouselId,
      target_bag: selectedBag.name,
      bag_name: bagName,
      generated_at: new Date().toISOString(),
      hashtags: hashtags,
      reference_photos: [selectedReferences[0].name, selectedReferences[1].name],
      status: 'ready_for_posting',
      frames: frameIds,
      frame_strategy: {
        frame1: 'DALLE-3',
        frame2: 'Gemini',
        frame3: 'Gemini',
        frame4: 'DALLE-3'
      }
    };

    // Upload metadata
    const metadataBuffer = Buffer.from(JSON.stringify(metadata, null, 2));
    await uploadFileToFolder(
      `${carouselId}_metadata.json`,
      metadataBuffer,
      'application/json',
      FOLDER_IDS.generatedCarousels
    );

    console.log('✅ Carousel complete:', carouselId);

    res.json({
      success: true,
      carousel_id: carouselId,
      target_bag: selectedBag.name,
      bag_name: bagName,
      hashtags: hashtags,
      frames_count: frames.length,
      metadata: metadata
    });

  } catch (error) {
    console.error('❌ Generation failed:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==========================================
// GET AVAILABLE BAGS
// ==========================================

app.get('/api/get-bags', async (req, res) => {
  try {
    if (!driveAuthClient) {
      return res.status(500).json({ success: false, error: 'Google Drive not authenticated' });
    }

    const bags = await listFilesInFolder(FOLDER_IDS.bagLibrary);
    res.json({ success: true, bags: bags });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// MANUAL IMAGE GENERATION (Frontend Direct)
// ==========================================

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

// ==========================================
// POST CAROUSEL TO QUEUE
// ==========================================

app.post('/api/post-carousel', async (req, res) => {
  try {
    console.log('📤 Posting carousel to queue...');

    if (!driveAuthClient) {
      return res.status(500).json({ success: false, error: 'Google Drive not authenticated' });
    }

    const { carouselId } = req.body;
    if (!carouselId) {
      return res.status(400).json({ success: false, error: 'Missing carouselId' });
    }

    // Get carousel metadata from generated-carousels
    const files = await listFilesInFolder(FOLDER_IDS.generatedCarousels);
    const metadataFile = files.find(f => f.name === `${carouselId}_metadata.json`);
    
    if (!metadataFile) {
      return res.status(404).json({ success: false, error: 'Carousel not found' });
    }

    // Copy carousel to posting-queue
    const frameFiles = files.filter(f => f.name.startsWith(carouselId) && f.name.includes('frame'));
    
    for (const frameFile of frameFiles) {
      const response = await driveAuthClient.files.copy({
        fileId: frameFile.id,
        requestBody: {
          parents: [FOLDER_IDS.postingQueue]
        }
      });
      console.log(`✅ Copied frame: ${frameFile.name}`);
    }

    // Copy metadata
    await driveAuthClient.files.copy({
      fileId: metadataFile.id,
      requestBody: {
        parents: [FOLDER_IDS.postingQueue]
      }
    });

    console.log(`✅ Carousel ${carouselId} posted to queue`);

    res.json({
      success: true,
      carousel_id: carouselId,
      status: 'posted_to_queue'
    });

  } catch (error) {
    console.error('❌ Post failed:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// ERROR HANDLING & STARTUP
// ==========================================

app.use((err, _req, res, _next) => {
  console.error('❌ Unhandled error:', err.message);
  res.status(500).json({ error: err.message });
});

// Initialize on startup
async function startup() {
  console.log('🚀 Starting BAGIFY Backend...');
  await initializeGoogleDrive();
  
  app.listen(PORT, () => {
    console.log(`✅ Backend running on port ${PORT}`);
    console.log(`✅ Frame Strategy:`);
    console.log(`   Frame 1 (Mirror selfie): DALLE-3 → Gemini fallback`);
    console.log(`   Frame 2 (Product angled): Gemini only`);
    console.log(`   Frame 3 (Product front): Gemini only`);
    console.log(`   Frame 4 (Mirror selfie): DALLE-3 → Gemini fallback`);
    console.log(`📁 Google Drive integration active`);
  });
}

startup();

module.exports = app;
