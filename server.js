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

const FOLDER_IDS = {
  bagLibrary: '1dToKUgXRvWCL3ao9yyOmS7kC6qfpFHJW',
  referencePhotos: '1CtLqTUbQF7Dg6Dnal4-FrfotizqsF-5j',
  productAngled: '1vd424znRgB4i3MqxWihCK9y0SdKXI83p',
  productFront: '1AiB27a190GgB0inSreGH-_S4Gbwch6sk',
  generatedCarousels: '1S0WbIlEBN94P3a1j9b0U0PfxHyGcI-7X',
  postingQueue: '1fCPlJXlK5avD7AB3l6xWbMnDToKd3ElV'
};

const FIXED_HASHTAGS = ['#luxuryhandbag', '#bagoftheday', '#designer', '#fashion'];

const BAG_HASHTAG_MAP = {
  'hermes': '#hermes #birkin',
  'lv': '#louisvuitton #speedy',
  'chanel': '#chanel #flap',
  'gucci': '#gucci',
  'birkin': '#birkin',
  'speedy': '#speedy',
  'flap': '#chanelflap'
};

let driveAuthClient = null;

async function initializeGoogleDrive() {
  try {
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

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.VITE_API_KEY || '');

// ==========================================
// HEALTH CHECK
// ==========================================

app.get('/health', (_req, res) => res.json({ 
  status: 'BAGIFY Backend running ✅',
  timestamp: new Date().toISOString(),
  google_drive_ready: !!driveAuthClient,
  openai_ready: !!process.env.OPENAI_API_KEY,
  gemini_ready: !!(process.env.GEMINI_API_KEY || process.env.VITE_API_KEY)
}));

// ==========================================
// DIAGNOSTIC: Test Gemini Response Structure
// ==========================================

app.post('/api/test-gemini', async (req, res) => {
  try {
    console.log('🔍 DIAGNOSTIC: Testing Gemini response structure...');
    
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ error: 'No Gemini API key configured' });
    }

    const genAI2 = new GoogleGenerativeAI(apiKey);
    const model = genAI2.getGenerativeModel({ model: 'gemini-2.5-flash-image' });

    // Simple test: just generate text, no images
    console.log('📝 Sending simple text request to Gemini...');
    
    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [{ text: 'Generate a simple image of a red bag' }]
      }]
    });

    console.log('🔍 Full response structure:');
    console.log('result.response keys:', Object.keys(result.response));
    console.log('candidates length:', result.response?.candidates?.length);
    
    if (result.response?.candidates?.[0]) {
      const candidate = result.response.candidates[0];
      console.log('candidate keys:', Object.keys(candidate));
      console.log('candidate.content keys:', Object.keys(candidate.content || {}));
      console.log('candidate.content.parts:', candidate.content?.parts);
      
      if (candidate.content?.parts?.[0]) {
        const part = candidate.content.parts[0];
        console.log('🔍 First part structure:');
        console.log('part keys:', Object.keys(part));
        console.log('part.inlineData:', part.inlineData);
        console.log('part.inlineData keys:', part.inlineData ? Object.keys(part.inlineData) : 'N/A');
        
        // Check for .body property (the culprit)
        if (part.body) {
          console.log('⚠️ part.body exists:', typeof part.body);
          console.log('part.body keys:', Object.keys(part.body || {}));
        }
      }
    }

    res.json({
      success: true,
      message: 'Check backend logs for detailed response structure',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Test failed:', error);
    res.status(500).json({ 
      error: error.message,
      stack: error.stack
    });
  }
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
// HELPERS
// ==========================================

function cleanupBase64(b64) {
  const cleaned = b64.replace(/^data:.*?;base64,/, "").trim();
  return cleaned.replace(/-/g, "+").replace(/_/g, "/");
}

function extractBagName(fileName) {
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
// IMAGE GENERATION - DALLE-3
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
// IMAGE GENERATION - GEMINI WITH DETAILED LOGGING
// ==========================================

async function generateWithGemini(referenceImageBase64, bagImageBase64, prompt) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_API_KEY;
  if (!apiKey) {
    throw new Error('Gemini API key not configured');
  }

  try {
    console.log('🔄 Gemini: Creating model...');
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
      console.log('✅ Added reference image to parts');
    }

    if (bagImageBase64) {
      parts.push({
        inlineData: {
          data: cleanupBase64(bagImageBase64),
          mimeType: 'image/png'
        }
      });
      console.log('✅ Added bag image to parts');
    }

    parts.push({ text: prompt });
    console.log(`✅ Added text prompt (${parts.length} total parts)`);

    console.log('🔄 Calling Gemini generateContent...');
    
    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: parts
      }]
    });

    console.log('🔍 Received response from Gemini');
    console.log('result.response keys:', Object.keys(result.response || {}));

    const candidates = result?.response?.candidates ?? [];
    console.log(`candidates count: ${candidates.length}`);
    
    if (!candidates.length) {
      throw new Error('Gemini returned no candidates');
    }

    const candidate = candidates[0];
    console.log('candidate keys:', Object.keys(candidate || {}));
    
    const contentParts = candidate?.content?.parts ?? [];
    console.log(`content.parts count: ${contentParts.length}`);
    
    if (!contentParts.length) {
      throw new Error('Gemini returned no content parts');
    }

    // Log each part to find the image
    contentParts.forEach((p, idx) => {
      console.log(`  part[${idx}] keys:`, Object.keys(p));
      if (p.inlineData) {
        console.log(`    inlineData keys:`, Object.keys(p.inlineData));
        console.log(`    mimeType: ${p.inlineData.mimeType}`);
        console.log(`    data type: ${typeof p.inlineData.data}`);
        console.log(`    data length: ${p.inlineData.data?.length || 'N/A'}`);
      }
      if (p.text) {
        console.log(`    text: ${p.text.substring(0, 50)}...`);
      }
      if (p.body) {
        console.log(`    ⚠️ FOUND part.body:`, Object.keys(p.body));
      }
    });

    // Find image part
    const imagePart = contentParts.find(p => p.inlineData?.data && p.inlineData?.mimeType);
    if (!imagePart) {
      console.log('❌ No image part found. Available parts:');
      contentParts.forEach((p, i) => console.log(`  Part ${i}:`, Object.keys(p)));
      throw new Error('Gemini response did not contain image data');
    }

    console.log('✅ Found image part');
    const mimeType = imagePart.inlineData.mimeType || 'image/png';
    const base64Data = cleanupBase64(imagePart.inlineData.data);
    const buffer = Buffer.from(base64Data, 'base64');
    const base64String = buffer.toString('base64');

    console.log(`✅ Converted to base64 (${buffer.length} bytes, ${mimeType})`);

    return base64String;

  } catch (error) {
    console.error('❌ Gemini error:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  }
}

// ==========================================
// MAIN CAROUSEL ENDPOINT
// ==========================================

app.post('/api/generate-carousel', async (req, res) => {
  try {
    console.log('🎬 Starting carousel generation...');

    if (!driveAuthClient) {
      return res.status(500).json({ success: false, error: 'Google Drive not authenticated' });
    }

    const bags = await listFilesInFolder(FOLDER_IDS.bagLibrary);
    if (bags.length === 0) {
      return res.status(400).json({ success: false, error: 'No bags found' });
    }

    const references = await listFilesInFolder(FOLDER_IDS.referencePhotos);
    if (references.length < 2) {
      return res.status(400).json({ success: false, error: 'Need at least 2 reference photos' });
    }

    const productAngledFiles = await listFilesInFolder(FOLDER_IDS.productAngled);
    const productFrontFiles = await listFilesInFolder(FOLDER_IDS.productFront);
    
    if (productAngledFiles.length === 0 || productFrontFiles.length === 0) {
      return res.status(400).json({ success: false, error: 'Missing product images' });
    }

    const selectedBag = getRandomItems(bags, 1);
    const selectedReferences = getRandomItems(references, 2);

    console.log('🎲 Selected:', {
      bag: selectedBag.name,
      ref1: selectedReferences[0].name,
      ref2: selectedReferences[1].name
    });

    const bagUrl = await getFileDownloadUrl(selectedBag.id);
    const ref1Url = await getFileDownloadUrl(selectedReferences[0].id);
    const ref2Url = await getFileDownloadUrl(selectedReferences[1].id);
    const prodAngledUrl = await getFileDownloadUrl(productAngledFiles[0].id);
    const prodFrontUrl = await getFileDownloadUrl(productFrontFiles[0].id);

    const [bagBase64, ref1Base64, ref2Base64, prodAngledBase64, prodFrontBase64] = await Promise.all([
      fetch(bagUrl).then(r => r.arrayBuffer()).then(b => Buffer.from(b).toString('base64')),
      fetch(ref1Url).then(r => r.arrayBuffer()).then(b => Buffer.from(b).toString('base64')),
      fetch(ref2Url).then(r => r.arrayBuffer()).then(b => Buffer.from(b).toString('base64')),
      fetch(prodAngledUrl).then(r => r.arrayBuffer()).then(b => Buffer.from(b).toString('base64')),
      fetch(prodFrontUrl).then(r => r.arrayBuffer()).then(b => Buffer.from(b).toString('base64'))
    ]);

    console.log('📥 All images downloaded');
    const frames = [];

    // Frame 1
    console.log('🎨 Generating Frame 1...');
    try {
      const frame1 = await generateWithDALLE3(
        ref1Base64,
        'Replace the handbag with the target luxury bag. Keep the woman identical.'
      );
      frames.push(frame1);
      console.log('✅ Frame 1 done');
    } catch (e) {
      console.warn('⚠️ Frame 1 failed, trying Gemini...');
      const frame1 = await generateWithGemini(ref1Base64, bagBase64, 'Replace handbag with target bag. Keep woman identical.');
      frames.push(frame1);
    }

    // Frame 2
    console.log('🎨 Generating Frame 2 (Gemini test)...');
    const frame2 = await generateWithGemini(
      prodAngledBase64,
      bagBase64,
      'Replace the bag with the target bag. Professional angled view.'
    );
    frames.push(frame2);
    console.log('✅ Frame 2 done');

    // Frame 3
    console.log('🎨 Generating Frame 3...');
    const frame3 = await generateWithGemini(
      prodFrontBase64,
      bagBase64,
      'Replace the bag with the target bag. Professional front view.'
    );
    frames.push(frame3);
    console.log('✅ Frame 3 done');

    // Frame 4
    console.log('🎨 Generating Frame 4...');
    try {
      const frame4 = await generateWithDALLE3(
        ref2Base64,
        'Replace the handbag with target bag. Different pose.'
      );
      frames.push(frame4);
      console.log('✅ Frame 4 done');
    } catch (e) {
      console.warn('⚠️ Frame 4 failed, trying Gemini...');
      const frame4 = await generateWithGemini(ref2Base64, bagBase64, 'Replace handbag. Different pose.');
      frames.push(frame4);
    }

    console.log('✅ All frames done');

    const carouselId = `carousel_${Date.now()}`;
    const bagName = extractBagName(selectedBag.name);
    const hashtags = generateHashtags(bagName);

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

    const metadata = {
      carousel_id: carouselId,
      target_bag: selectedBag.name,
      bag_name: bagName,
      generated_at: new Date().toISOString(),
      hashtags: hashtags,
      status: 'ready_for_posting'
    };

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
      hashtags: hashtags,
      frames_count: frames.length
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
// ERROR HANDLING & STARTUP
// ==========================================

app.use((err, _req, res, _next) => {
  console.error('❌ Unhandled error:', err.message);
  res.status(500).json({ error: err.message });
});

async function startup() {
  console.log('🚀 Starting BAGIFY Backend...');
  await initializeGoogleDrive();
  
  app.listen(PORT, () => {
    console.log(`✅ Backend running on port ${PORT}`);
  });
}

startup();

module.exports = app;
