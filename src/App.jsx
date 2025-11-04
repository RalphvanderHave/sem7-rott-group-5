import { useState, useRef, useEffect } from 'react'
import './App.css'

function App() {
  const [messages, setMessages] = useState([])
  const [isListening, setIsListening] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [transcript, setTranscript] = useState('')
  
  const audioRef = useRef(null)
  const messagesEndRef = useRef(null)
  const recognitionRef = useRef(null)

  const API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY
  const VOICE_ID = 'EXAVITQu4vr4xnSDxMaL' // Default voice (Sarah)

  useEffect(() => {
    // Initialize Speech Recognition
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
      recognitionRef.current = new SpeechRecognition()
      recognitionRef.current.continuous = false
      recognitionRef.current.interimResults = true
      recognitionRef.current.lang = 'en-US'

      recognitionRef.current.onresult = (event) => {
        const current = event.resultIndex
        const transcriptText = event.results[current][0].transcript
        setTranscript(transcriptText)
        
        if (event.results[current].isFinal) {
          handleVoiceInput(transcriptText)
        }
      }

      recognitionRef.current.onerror = (event) => {
        console.error('Speech recognition error:', event.error)
        setIsListening(false)
      }

      recognitionRef.current.onend = () => {
        setIsListening(false)
      }
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const textToSpeech = async (text) => {
    try {
      setIsSpeaking(true)
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
        {
          method: 'POST',
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': API_KEY
          },
          body: JSON.stringify({
            text: text,
            model_id: 'eleven_monolingual_v1',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              style: 0.5,
              use_speaker_boost: true
            }
          })
        }
      )

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail?.message || 'Failed to generate speech')
      }

      const audioBlob = await response.blob()
      const audioUrl = URL.createObjectURL(audioBlob)
      
      if (audioRef.current) {
        audioRef.current.src = audioUrl
        await audioRef.current.play()
      }
    } catch (error) {
      console.error('Text-to-speech error:', error)
      alert(`Voice generation failed: ${error.message}`)
      setIsSpeaking(false)
    }
  }

  const generateAIResponse = async (userInput) => {
    // Simple AI responses - you can replace this with OpenAI, Anthropic, or your preferred AI API
    const responses = [
      `I heard you say: "${userInput}". That's interesting! How can I help you with that?`,
      `Thanks for sharing "${userInput}". I'm here to assist you. What would you like to know?`,
      `Regarding "${userInput}", I'd be happy to help. Could you tell me more?`,
      `I understand you mentioned "${userInput}". Let me help you with that.`
    ]
    
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500))
    
    return responses[Math.floor(Math.random() * responses.length)]
  }

  const handleVoiceInput = async (transcriptText) => {
    if (!transcriptText.trim()) return

    setIsListening(false)
    setIsProcessing(true)
    setTranscript('')

    const userMessage = { role: 'user', content: transcriptText }
    setMessages(prev => [...prev, userMessage])

    try {
      // Generate AI response
      const aiResponseText = await generateAIResponse(transcriptText)
      const aiMessage = { role: 'assistant', content: aiResponseText }
      setMessages(prev => [...prev, aiMessage])

      // Convert AI response to speech
      await textToSpeech(aiResponseText)
    } catch (error) {
      console.error('Error processing input:', error)
      alert('Failed to process your request. Please try again.')
    } finally {
      setIsProcessing(false)
    }
  }

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert('Speech recognition is not supported in your browser. Please use Chrome, Edge, or Safari.')
      return
    }

    if (isListening) {
      recognitionRef.current.stop()
      setIsListening(false)
    } else {
      recognitionRef.current.start()
      setIsListening(true)
      setTranscript('')
    }
  }

  const handleAudioEnded = () => {
    setIsSpeaking(false)
  }

  const stopSpeaking = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      setIsSpeaking(false)
    }
  }

  return (
    <div className="app">
      <div className="container">
        <header className="header">
          <h1>🤖 AI Voice Agent</h1>
          <p>Powered by ElevenLabs</p>
        </header>

        <div className="chat-container">
          <div className="messages">
            {messages.length === 0 && (
              <div className="welcome-message">
                <h2>👋 Welcome!</h2>
                <p>Click the microphone button and start speaking to interact with the AI voice agent.</p>
              </div>
            )}
            {messages.map((msg, index) => (
              <div key={index} className={`message ${msg.role}`}>
                <div className="message-content">
                  {msg.content}
                </div>
              </div>
            ))}
            {isProcessing && (
              <div className="message assistant">
                <div className="message-content typing">
                  <span></span><span></span><span></span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="voice-controls">
            {transcript && isListening && (
              <div className="transcript-preview">
                {transcript}
              </div>
            )}
            
            <button 
              onClick={toggleListening}
              disabled={isProcessing || isSpeaking}
              className={`voice-button ${isListening ? 'listening' : ''}`}
            ></button>
            <button>
              {isListening ? '🎤 Listening...' : '🎤 Tap to Speak'}
            </button>

            {isSpeaking && (
              <button 
                onClick={stopSpeaking}
                className="stop-button"
              >
                🔇 Stop Speaking
              </button>
            )}
          </div>
        </div>

        <div className="status-bar">
          {isListening && <span className="status listening">🎤 Listening...</span>}
          {isProcessing && <span className="status processing">🤔 Processing...</span>}
          {isSpeaking && <span className="status speaking">🔊 Speaking...</span>}
          {!isListening && !isProcessing && !isSpeaking && (
            <span className="status ready">✅ Ready</span>
          )}
        </div>

        <audio 
          ref={audioRef} 
          onEnded={handleAudioEnded}
          style={{ display: 'none' }}
        />
      </div>
    </div>
  )
}

export default App
