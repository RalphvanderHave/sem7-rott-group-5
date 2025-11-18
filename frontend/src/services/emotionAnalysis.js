import { GoogleGenerativeAI } from "@google/generative-ai"

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY
const HUGGINGFACE_API_KEY = import.meta.env.VITE_HUGGINGFACE_API_KEY

// Rate limiting to avoid quota issues
let lastRequestTime = 0
const MIN_REQUEST_INTERVAL = 3000 // 3 seconds between requests

// Hugging Face emotion analysis for Dutch
async function analyzeEmotionWithHuggingFace(text) {
  console.log('🔍 Analyzing with Hugging Face RobBERT:', text)
  
  if (!HUGGINGFACE_API_KEY || HUGGINGFACE_API_KEY === 'your_huggingface_key_here') {
    console.log('⚠️ No Hugging Face key configured')
    throw new Error('No Hugging Face API key')
  }
  
  try {
    // Use the correct Inference API endpoint
    const response = await fetch(
      "https://router.huggingface.co/hf-inference/models/j-hartmann/emotion-english-distilroberta-base",
      {
        headers: {
          "Authorization": `Bearer ${HUGGINGFACE_API_KEY}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        body: JSON.stringify({ 
          inputs: text,
          options: {
            wait_for_model: true
          }
        }),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error('❌ Hugging Face API error:', response.status, errorText)
      throw new Error(`Hugging Face API error: ${response.status}`)
    }

    const result = await response.json()
    console.log('🤖 Hugging Face Response:', result)
    
    // Check if model is loading
    if (result.error && result.error.includes('loading')) {
      console.log('⏳ Model is loading, waiting...')
      throw new Error('Model is loading, please try again')
    }
    
    // Model returns array with array of emotions
    if (result && Array.isArray(result) && result[0] && Array.isArray(result[0])) {
      // Get all emotions and find the highest scoring one
      const emotions = result[0]
      const topEmotion = emotions.reduce((max, curr) => 
        curr.score > max.score ? curr : max
      )
      
      // Map emotion labels to our emotion set
      const emotionMapping = {
        'joy': 'happy',
        'happiness': 'happy',
        'sadness': 'sad',
        'anger': 'angry',
        'fear': 'sad',
        'surprise': 'surprised',
        'neutral': 'neutral',
        'disgust': 'angry'
      }
      
      const label = topEmotion.label?.toLowerCase() || 'neutral'
      const mappedEmotion = emotionMapping[label] || 'neutral'
      
      console.log('✅ HuggingFace Detected:', mappedEmotion, 'confidence:', topEmotion.score)
      
      return {
        emotion: mappedEmotion,
        confidence: topEmotion.score,
        scores: { [mappedEmotion]: topEmotion.score },
        reasoning: `Detected '${topEmotion.label}' (${(topEmotion.score * 100).toFixed(1)}%)`
      }
    }
    
    throw new Error('Invalid response format from Hugging Face')
    
  } catch (error) {
    console.error('❌ Hugging Face error:', error)
    throw error
  }
}

export async function analyzeEmotionWithGemini(text) {
  if (!text || text.trim().length === 0) {
    return { emotion: 'neutral', scores: {} }
  }

  // Rate limiting
  const now = Date.now()
  const timeSinceLastRequest = now - lastRequestTime
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest
    console.log(`⏳ Rate limiting: waiting ${waitTime}ms`)
    await new Promise(resolve => setTimeout(resolve, waitTime))
  }
  lastRequestTime = Date.now()

  /* TEMPORARILY COMMENTED OUT - GEMINI
  // Try Gemini first if API key is available
  if (GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key_here') {
    console.log('🔍 Analyzing with Gemini SDK:', text)
    // ... Gemini code ...
  }
  */

  // Use Hugging Face RobBERT for Dutch emotion analysis
  console.log('⚠️ Using Hugging Face (Gemini temporarily disabled)')
  try {
    return await analyzeEmotionWithHuggingFace(text)
  } catch (error) {
    console.error('❌ Hugging Face failed:', error)
    // Final fallback to neutral
    return { 
      emotion: 'neutral', 
      scores: {}, 
      error: error.message,
      reasoning: 'Emotion analysis unavailable, defaulting to neutral'
    }
  }
}

export async function warmUpModel() {
  console.log('✅ Using Hugging Face RobBERT for Dutch emotion detection')
  return true
}
