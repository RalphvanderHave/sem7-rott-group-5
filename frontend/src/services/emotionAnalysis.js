import { GoogleGenerativeAI } from "@google/generative-ai"

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY

// Rate limiting
let lastRequestTime = 0
const MIN_REQUEST_INTERVAL = 3000

export async function analyzeEmotionWithGemini(text) {
  if (!text || text.trim().length === 0) {
    return { emotion: 'neutral', scores: {} }
  }

  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
    console.log('⚠️ No Gemini key configured')
    return { emotion: 'neutral', scores: {} }
  }

  // Rate limiting
  const now = Date.now()
  const timeSinceLastRequest = now - lastRequestTime
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest
    await new Promise(resolve => setTimeout(resolve, waitTime))
  }
  lastRequestTime = Date.now()

  console.log('🔍 Analyzing with Gemini SDK:', text)

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
    
    // Try ONLY the working models for Cloud API keys
    const modelNames = [
      "gemini-1.5-flash-latest",
      "gemini-1.5-flash-001", 
      "gemini-1.5-pro-latest",
      "gemini-1.5-pro-001"
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

    for (const modelName of modelNames) {
      try {
        console.log(`🔍 Trying Gemini model: ${modelName}`)
        const model = genAI.getGenerativeModel({ model: modelName })
        
        const result = await model.generateContent(prompt)
        const response = result.response
        const content = response.text().trim()
        
        console.log(`✅ Working model: ${modelName}`)
        console.log('🤖 Response:', content)
        
        const jsonMatch = content.match(/\{[\s\S]*\}/)
        if (!jsonMatch) {
          throw new Error('No valid JSON in response')
        }
        
        const parsed = JSON.parse(jsonMatch[0])
        
        console.log('✅ Detected:', parsed.emotion, 'confidence:', parsed.confidence)
        console.log('💭 Reasoning:', parsed.reasoning)

        return {
          emotion: parsed.emotion,
          confidence: parsed.confidence,
          scores: { [parsed.emotion]: parsed.confidence },
          reasoning: parsed.reasoning
        }
      } catch (error) {
        console.log(`❌ Model ${modelName} failed:`, error.message)
        continue
      }
    }
    
    console.error('❌ All Gemini models failed')
    return { emotion: 'neutral', scores: {}, error: 'All models failed' }
    
  } catch (error) {
    console.error('❌ Gemini SDK error:', error)
    return { emotion: 'neutral', scores: {}, error: error.message }
  }

  // Try REST API directly
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${prompt}` }] }]
        })
      }
    )

    if (response.ok) {
      const data = await response.json()
      const content = data.candidates[0].content.parts[0].text
      // ...parse JSON...
    }
  } catch (error) {
    console.log('❌ REST API failed:', error.message)
  }
}

export async function warmUpModel() {
  console.log('✅ Using Gemini SDK')
  return true
}
