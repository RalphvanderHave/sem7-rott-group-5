import { GoogleGenerativeAI } from "@google/generative-ai"

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY

// Rate limiting to avoid quota issues
let lastRequestTime = 0
const MIN_REQUEST_INTERVAL = 3000 // 3 seconds between requests

export async function analyzeEmotionWithGemini(text) {
  if (!text || text.trim().length === 0) {
    return { emotion: 'neutral', scores: {} }
  }

  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
    console.log('⚠️ No Gemini key configured, skipping analysis.')
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

  console.log('🔍 Analyzing with Gemini SDK:', text)

  try {
    // 1. Initialize the SDK with your API key
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
    
    // 2. Try different models by attempting generateContent call
    const modelNames = [
      "gemini-pro", 
      "gemini-1.0-pro", 
      "gemini-1.5-flash",
      "gemini-1.5-pro",
      "gemini-flash",
      "text-bison-001"
    ]
    
    const prompt = `Analyseer de emotie in de volgende tekst (Nederlands of Engels).

Geef het antwoord in dit JSON formaat (zonder extra tekst):
{"emotion": "happy|sad|angry|surprised|neutral", "confidence": 0.0-1.0, "reasoning": "korte uitleg"}

Emoties:
- happy: blij, vrolijk, positief, enthousiast, goed gevoel
- sad: verdrietig, teleurgesteld, down, slecht gevoel, somber
- angry: boos, gefrustreerd, geïrriteerd, kwaad
- surprised: verbaasd, verrast, wow
- neutral: neutraal, informatief, geen duidelijke emotie

Tekst: "${text}"`

    let lastError = null
    
    for (const modelName of modelNames) {
      try {
        console.log(`🔍 Trying model: ${modelName}`)
        const model = genAI.getGenerativeModel({ model: modelName })
        
        // Test the model by actually calling generateContent
        const result = await model.generateContent(prompt)
        const response = result.response
        const content = response.text().trim()
        
        console.log(`✅ Working model found: ${modelName}`)
        console.log('🤖 Gemini SDK Response:', content)
        
        // Extract and parse the JSON response
        const jsonMatch = content.match(/\{[\s\S]*\}/)
        if (!jsonMatch) {
          throw new Error('No valid JSON found in Gemini response')
        }
        
        const parsed = JSON.parse(jsonMatch[0])
        
        console.log('✅ Gemini Detected:', parsed.emotion, 'confidence:', parsed.confidence)
        console.log('💭 Reasoning:', parsed.reasoning)

        return {
          emotion: parsed.emotion,
          confidence: parsed.confidence,
          scores: { [parsed.emotion]: parsed.confidence },
          reasoning: parsed.reasoning
        }
      } catch (error) {
        console.log(`❌ Model ${modelName} failed: ${error.message}`)
        lastError = error
        continue // Try next model
      }
    }
    
    // If all models failed, throw the last error
    throw lastError || new Error('All Gemini models failed')
    
  } catch (error) {
    console.error('❌ Gemini SDK error:', error)
    // Return neutral if the API fails, so the app doesn't crash
    return { emotion: 'neutral', scores: {}, error: error.message }
  }
}
