const HUGGINGFACE_API_KEY = import.meta.env.VITE_HUGGINGFACE_API_KEY

// Multilingual emotion detection model (automatically handles Dutch + English)
const EMOTION_MODEL = "j-hartmann/emotion-english-distilroberta-base"

// NEW API ENDPOINT
const HUGGINGFACE_API_URL = `https://router.huggingface.co/hf-inference/models/${EMOTION_MODEL}`

// Retry configuration
const MAX_RETRIES = 3
const RETRY_DELAY = 3000 // 3 seconds

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Function to warm up the model (call this when starting conversation)
export async function warmUpModel() {
  console.log('🔥 Warming up emotion detection model...')
  
  try {
    const response = await fetch(HUGGINGFACE_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: "Hello", // Simple text to wake up the model
      }),
    })

    if (response.ok) {
      await response.json()
      console.log('✅ Model warmed up and ready!')
      return true
    } else {
      console.log('⚠️ Model warm-up initiated, may take a moment...')
      return false
    }
  } catch (error) {
    console.log('⚠️ Model warm-up error (this is okay):', error.message)
    return false
  }
}

export async function analyzeEmotionWithAI(text) {
  if (!text || text.trim().length === 0) {
    console.log('⚠️ Empty text, returning neutral')
    return { emotion: 'neutral', scores: {} }
  }

  console.log('🔍 Analyzing emotion with AI for text:', text)
  console.log('🔑 API Key present:', !!HUGGINGFACE_API_KEY)

  try {
    console.log('📡 Calling Hugging Face API...')
    const startTime = Date.now()
    
    const response = await fetch(HUGGINGFACE_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: text,
      }),
    })

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
    console.log(`📡 API Response: ${response.status} (${elapsed}s)`)

    if (!response.ok) {
      const errorText = await response.text()
      console.error('❌ API Error Response:', errorText)
      
      // Try to parse as JSON
      try {
        const errorJson = JSON.parse(errorText)
        console.error('❌ Parsed Error:', errorJson)
      } catch (e) {
        console.error('❌ Raw Error:', errorText)
      }
      
      throw new Error(`API error: ${response.status}`)
    }

    const result = await response.json()
    console.log('🤖 AI Emotion Analysis RAW:', JSON.stringify(result, null, 2))
    console.log('🤖 Result type:', typeof result)
    console.log('🤖 Is array:', Array.isArray(result))

    // Handle response format: [[{ label: "joy", score: 0.9 }, ...]]
    let emotions = []
    
    if (Array.isArray(result)) {
      console.log('✅ Result is array, length:', result.length)
      
      if (result[0] && Array.isArray(result[0])) {
        emotions = result[0]
        console.log('✅ Found nested array with', emotions.length, 'emotions')
      } else if (result[0] && typeof result[0] === 'object') {
        emotions = result
        console.log('✅ Found direct array with', emotions.length, 'emotions')
      }
    }

    if (emotions.length === 0) {
      console.error('❌ No emotions found in response')
      console.error('❌ Full result:', result)
      return { emotion: 'neutral', scores: {}, error: 'No emotions found' }
    }

    // Map AI emotion labels to our avatar emotions
    const emotionMap = {
      'joy': 'happy',
      'happiness': 'happy',
      'sadness': 'sad',
      'anger': 'sad',
      'fear': 'sad',
      'surprise': 'surprised',
      'disgust': 'sad',
      'neutral': 'neutral'
    }

    // Find highest scoring emotion
    let highestScore = 0
    let detectedEmotion = 'neutral'
    const scores = {}

    emotions.forEach(({ label, score }) => {
      const normalizedLabel = label.toLowerCase()
      scores[normalizedLabel] = score
      
      console.log(`  - ${label}: ${score.toFixed(3)}`)
      
      if (score > highestScore) {
        highestScore = score
        detectedEmotion = emotionMap[normalizedLabel] || 'neutral'
      }
    })

    console.log('✨ Emotion Scores:', scores)
    console.log('🎭 Detected Emotion:', detectedEmotion, 'with score:', highestScore)

    return {
      emotion: detectedEmotion,
      scores: scores,
      confidence: highestScore
    }

  } catch (error) {
    console.error('❌ Emotion analysis error:', error.message)
    console.error('❌ Full error:', error)
    return { emotion: 'neutral', scores: {}, error: error.message }
  }
}
