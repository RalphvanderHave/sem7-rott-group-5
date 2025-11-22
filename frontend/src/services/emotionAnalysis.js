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

  console.log('🔍 Analyzing with Gemini REST API:', text)

  // Use the working models from your API key (newest first)
  const modelNames = [
    'gemini-2.5-flash',           // Stable Gemini 2.5 Flash
    'gemini-2.0-flash',           // Stable Gemini 2.0 Flash
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
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`
      
      console.log(`🔍 Trying model: ${modelName}`)
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: prompt
            }]
          }]
        })
      })

      if (response.ok) {
        const data = await response.json()
        console.log(`✅ Working model found: ${modelName}`)
        
        const content = data.candidates[0].content.parts[0].text.trim()
        console.log('🤖 Gemini Response:', content)
        
        const jsonMatch = content.match(/\{[\s\S]*\}/)
        if (!jsonMatch) {
          console.log('⚠️ No JSON in response, trying next model...')
          continue
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
      } else {
        console.log(`❌ Model ${modelName} failed: ${response.status}`)
      }
    } catch (error) {
      console.log(`❌ Model ${modelName} error:`, error.message)
    }
  }
  
  // All models failed
  console.error('❌ All Gemini models failed - returning neutral')
  return { emotion: 'neutral', scores: {}, error: 'All Gemini models unavailable' }
}

export async function warmUpModel() {
  console.log('✅ Using Gemini 2.5/2.0 Flash for emotion detection')
  return true
}
