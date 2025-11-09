import { useState, useRef, useEffect } from 'react'
import { Conversation } from '@11labs/client'
import Avatar from './Avatar'
import './App.css'

function App() {
  const [isConnected, setIsConnected] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [status, setStatus] = useState('disconnected')
  const [messages, setMessages] = useState([])
  const [volume, setVolume] = useState(0)
  const [emotion, setEmotion] = useState('neutral')
  
  const conversationRef = useRef(null)
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const messagesEndRef = useRef(null)
  const volumeAnimationRef = useRef(null)
  const emotionTimeoutRef = useRef(null)

  const API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY
  const AGENT_ID = import.meta.env.VITE_AGENT_ID

  useEffect(() => {
    return () => {
      if (conversationRef.current) {
        conversationRef.current.endSession()
      }
      if (audioContextRef.current) {
        audioContextRef.current.close()
      }
      if (volumeAnimationRef.current) {
        cancelAnimationFrame(volumeAnimationRef.current)
      }
      if (emotionTimeoutRef.current) {
        clearTimeout(emotionTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const detectEmotion = (text) => {
    if (!text) return 'talking'
    
    const textLower = text.toLowerCase()
    console.log('🔍 Detecting emotion for text:', textLower)
    
    // Happy emotions - English + Dutch
    const happyWords = [
      // English
      'happy', 'great', 'awesome', 'excellent', 'wonderful', 'fantastic', 'love', 'excited', 
      'perfect', 'amazing', 'glad', 'pleasure', 'help', 'sure', 'absolutely', 'yes', 'definitely',
      'good', 'nice', 'cool', 'yay', 'thank', 'thanks',
      // Dutch
      'blij', 'gelukkig', 'geweldig', 'fantastisch', 'mooi', 'prachtig', 'super', 'top', 
      'gewoon', 'leuk', 'fijn', 'lekker', 'ja', 'zeker', 'graag', 'dankjewel', 'bedankt',
      'goed', 'prima', 'uitstekend', 'perfect', 'heerlijk', 'zalig', 'tof', 'gaaf',
      '😊', '😄', '🎉', '👍'
    ]
    if (happyWords.some(word => textLower.includes(word))) {
      console.log('✅ Detected HAPPY emotion')
      return 'happy'
    }
    
    // Sad emotions - English + Dutch
    const sadWords = [
      // English
      'sad', 'sorry', 'unfortunately', 'disappointed', 'bad', 'terrible', 'awful', 'unhappy', 
      'upset', 'apologize', 'regret', 'frustrated', 'angry', 'mad', 'hate', 'no',
      // Dutch
      'verdrietig', 'triest', 'droevig', 'spijt', 'helaas', 'jammer', 'teleurgesteld', 
      'boos', 'kwaad', 'gefrustreerd', 'slecht', 'vreselijk', 'verschrikkelijk', 
      'ongelukkig', 'rot', 'ellendig', 'naar', 'nee', 'niet', 'sorry',
      'niet lekker', 'lekker in vel', 'lekker voelen', 'ongemakkelijk', 'onprettig',
      '😢', '😞', '😔', '😠'
    ]
    if (sadWords.some(word => textLower.includes(word))) {
      console.log('😢 Detected SAD emotion')
      return 'sad'
    }
    
    // Surprised emotions - English + Dutch
    const surprisedWords = [
      // English
      'wow', 'really', 'surprise', 'incredible', 'unbelievable', 'oh my', 'amazing', 
      'no way', 'omg', 'seriously', 'what',
      // Dutch
      'wauw', 'wow', 'echt', 'serieus', 'echt waar', 'ongelofelijk', 'verbazingwekkend',
      'niet te geloven', 'oh', 'wat', 'hoe kan dat', 'onmogelijk', 'jeetje', 'gossie',
      '😮', '😲', '!'
    ]
    if (surprisedWords.some(word => textLower.includes(word))) {
      console.log('😮 Detected SURPRISED emotion')
      return 'surprised'
    }
    
    // Thinking/confused emotions - English + Dutch
    const thinkingWords = [
      // English
      'hmm', 'let me', 'think', 'consider', 'understand', 'wondering', 'moment', 
      'see', 'well', 'maybe', 'perhaps', 'how', 'why', 'what', 'where', 'when',
      // Dutch
      'hmm', 'even', 'denken', 'nadenken', 'laat me', 'laat mij', 'begrijpen', 
      'snappen', 'vraag', 'vraagje', 'hoe', 'waarom', 'wat', 'waar', 'wanneer',
      'misschien', 'wellicht', 'kijken', 'eens', 'eventjes', 'moment', 'momentje',
      '🤔', '?'
    ]
    if (thinkingWords.some(word => textLower.includes(word))) {
      console.log('🤔 Detected THINKING emotion')
      return 'thinking'
    }
    
    console.log('💬 Default TALKING emotion')
    return 'talking'
  }

  const addMessage = (role, content) => {
    console.log('📝 Adding message:', role, content)
    setMessages(prev => [...prev, { role, content, timestamp: Date.now() }])
    
    // ONLY detect emotion from USER messages (what the user says)
    if (role === 'user') {
      const detectedEmotion = detectEmotion(content)
      console.log('🎭 USER said something - Setting avatar emotion to:', detectedEmotion, 'for text:', content)
      console.log('🔄 Previous emotion was:', emotion)
      
      // FORCE update the emotion state
      setEmotion(detectedEmotion)
      
      // Verify the update happened
      setTimeout(() => {
        console.log('✅ Emotion should now be:', detectedEmotion)
      }, 100)
      
      // Clear any existing timeout
      if (emotionTimeoutRef.current) {
        clearTimeout(emotionTimeoutRef.current)
        emotionTimeoutRef.current = null
      }
      
      console.log('✨ Emotion locked at:', detectedEmotion, '- will persist until next user message')
    }
  }

  const startConversation = async () => {
    try {
      if (!API_KEY || !AGENT_ID) {
        throw new Error('Missing API key or Agent ID. Please check your .env file.')
      }

      if (AGENT_ID === 'paste_your_agent_id_here') {
        throw new Error('Please replace VITE_AGENT_ID in .env with your actual Agent ID from ElevenLabs')
      }

      setStatus('connecting')
      addMessage('system', '🔄 Connecting to AI agent Alfred...')

      // Initialize audio context for volume monitoring
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)()
        analyserRef.current = audioContextRef.current.createAnalyser()
        analyserRef.current.fftSize = 256
      }

      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      })

      // Start the conversation
      const conversation = await Conversation.startSession({
        agentId: AGENT_ID,
        apiKey: API_KEY,
        
        onConnect: () => {
          console.log('✅ Connected to agent')
          setIsConnected(true)
          setStatus('connected')
          setEmotion('happy')
          addMessage('system', '✅ Connected! Start speaking to the AI agent Alfred...')
          
          // Return to neutral after connection
          setTimeout(() => {
            setEmotion('neutral')
          }, 2000)
        },
        
        onDisconnect: () => {
          console.log('❌ Disconnected from agent')
          setIsConnected(false)
          setStatus('disconnected')
          setVolume(0)
          setEmotion('neutral')
          addMessage('system', '🔌 Disconnected from agent')
        },
        
        onMessage: (message) => {
          console.log('📨 RAW Message received:', JSON.stringify(message, null, 2))
          
          let userText = null
          let agentText = null
          
          // PRIMARY METHOD: Check source field (this is what ElevenLabs is using!)
          if (message.source === 'user' && message.message) {
            userText = message.message
            console.log('✅ USER MESSAGE FOUND via source field')
          } else if (message.source === 'ai' && message.message) {
            agentText = message.message
            console.log('✅ AI MESSAGE FOUND via source field')
          }
          
          // Fallback Method 1: Direct type check
          if (!userText && message.type === 'user_transcript') {
            userText = message.text || message.transcript
          }
          
          // Fallback Method 2: Check message.message object
          if (!userText && !agentText && message.message) {
            if (message.message.role === 'user') {
              userText = message.message.text || message.message.content || message.message.transcript
            } else if (message.message.role === 'assistant' || message.message.role === 'agent') {
              agentText = message.message.text || message.message.content
            }
          }
          
          // Fallback Method 3: Check for transcript field directly
          if (!userText && message.transcript && message.source === 'user') {
            userText = message.transcript
          }
          
          // Fallback Method 4: Audio transcript
          if (!userText && message.type === 'audio' && message.source === 'user') {
            userText = message.transcript || message.text
          }
          
          // Fallback Method 5: Conversation message type
          if (!userText && !agentText && message.type === 'message') {
            if (message.source === 'user' || message.role === 'user') {
              userText = message.text || message.content || message.transcript
            }
          }
          
          // Process user text
          if (userText) {
            console.log('👤 USER TRANSCRIPT DETECTED:', userText)
            addMessage('user', userText)
          }
          
          // Process agent text
          if (agentText) {
            console.log('🤖 AGENT RESPONSE:', agentText)
            addMessage('assistant', agentText)
          }
          
          // If nothing was captured, log it
          if (!userText && !agentText) {
            console.log('⚠️ Message not captured - source:', message.source, '| type:', message.type)
          }
        },
        
        onError: (error) => {
          console.error('❌ Conversation error:', error)
          setStatus('error')
          setEmotion('sad')
          addMessage('system', `⚠️ Error: ${error.message || 'Unknown error occurred'}`)
        },
        
        onModeChange: (mode) => {
          console.log('🔄 Mode changed:', JSON.stringify(mode, null, 2))
          const newMode = mode.mode || mode
          setStatus(newMode)
          const wasSpeaking = isSpeaking
          setIsSpeaking(newMode === 'speaking')
          
          console.log('🎤 Mode:', newMode, '| isSpeaking:', newMode === 'speaking', '| Current emotion:', emotion)
          
          // NEVER override user emotions from mode changes
          // Log but don't change emotion
          console.log('✨ Emotion locked at:', emotion, '- waiting for next user message')
        }
      })

      conversationRef.current = conversation

      // Set up volume monitoring
      const source = audioContextRef.current.createMediaStreamSource(stream)
      source.connect(analyserRef.current)

      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)
      const updateVolume = () => {
        if (analyserRef.current && isConnected) {
          analyserRef.current.getByteFrequencyData(dataArray)
          const average = dataArray.reduce((a, b) => a + b) / dataArray.length
          setVolume(Math.min(100, (average / 255) * 200))
          volumeAnimationRef.current = requestAnimationFrame(updateVolume)
        }
      }
      updateVolume()

    } catch (error) {
      console.error('❌ Failed to start conversation:', error)
      setStatus('error')
      setIsConnected(false)
      setEmotion('sad')
      
      let errorMessage = error.message
      if (error.message.includes('API key')) {
        errorMessage = 'Invalid API key. Please check your .env file.'
      } else if (error.message.includes('Agent')) {
        errorMessage = 'Invalid Agent ID. Please get your Agent ID from ElevenLabs dashboard.'
      } else if (error.name === 'NotAllowedError') {
        errorMessage = 'Microphone permission denied. Please allow microphone access.'
      }
      
      addMessage('system', `⚠️ ${errorMessage}`)
      alert(`Failed to start conversation:\n\n${errorMessage}\n\nSteps:\n1. Get your Agent ID from https://elevenlabs.io/app/conversational-ai\n2. Update VITE_AGENT_ID in .env file\n3. Restart the dev server`)
    }
  }

  const endConversation = async () => {
    if (conversationRef.current) {
      try {
        await conversationRef.current.endSession()
      } catch (error) {
        console.error('Error ending session:', error)
      }
      conversationRef.current = null
      setIsConnected(false)
      setStatus('disconnected')
      setVolume(0)
      setEmotion('neutral') // Reset to neutral when conversation ends
      addMessage('system', '👋 Conversation ended')
    }
    
    if (volumeAnimationRef.current) {
      cancelAnimationFrame(volumeAnimationRef.current)
    }
    
    if (emotionTimeoutRef.current) {
      clearTimeout(emotionTimeoutRef.current)
      emotionTimeoutRef.current = null
    }
  }

  const getStatusDisplay = () => {
    switch (status) {
      case 'connecting':
        return { text: '⏳ Connecting...', class: 'connecting' }
      case 'connected':
        return { text: '🟢 Connected - Ready to talk', class: 'connected' }
      case 'listening':
        return { text: '👂 Listening...', class: 'listening' }
      case 'thinking':
        return { text: '🤔 Processing...', class: 'thinking' }
      case 'speaking':
        return { text: '🗣️ Agent speaking...', class: 'speaking' }
      case 'error':
        return { text: '⚠️ Error occurred', class: 'error' }
      default:
        return { text: '⚪ Disconnected', class: 'disconnected' }
    }
  }

  const statusInfo = getStatusDisplay()

  return (
    <div className="app">
      <div className="container">
        <header className="header">
          <h1>🤖 Alfred</h1>
          <p>Real-time AI Agent • Powered by ElevenLabs</p>
        </header>

        <div className="avatar-section">
          <Avatar 
            emotion={emotion} 
            isSpeaking={isSpeaking}
            volume={volume}
            isConnected={isConnected}
          />
        </div>

        <div className="status-indicator">
          <div className={`status-badge ${statusInfo.class}`}>
            {statusInfo.text}
          </div>
          {isConnected && (
            <div className="volume-indicator">
              <div 
                className="volume-bar" 
                style={{ width: `${volume}%` }}
              />
            </div>
          )}
        </div>

        <div className="chat-container">
          <div className="messages">
            {messages.length === 0 && (
              <div className="welcome-message">
                <h2>👋 Welcome bij Alfred the AI assistent!</h2>
                <p>Klik "Start Conversation" om het gesprek in real-time te beginnen.</p>
              </div>
            )}
            {messages.map((msg, index) => (
              <div key={index} className={`message ${msg.role}`}>
                <div className="message-content">
                  {msg.content}
                </div>
              </div>
            ))}
            {status === 'thinking' && (
              <div className="message assistant">
                <div className="message-content typing">
                  <span></span><span></span><span></span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="controls">
            {!isConnected ? (
              <button 
                onClick={startConversation}
                className="main-button start"
                disabled={status === 'connecting'}
              >
                {status === 'connecting' ? '⏳ Connecting...' : '🎙️ Start Conversation'}
              </button>
            ) : (
              <div className="active-controls">
                <div className="conversation-status">
                  {isSpeaking && (
                    <div className="speaking-animation">
                      <div className="wave"></div>
                      <div className="wave"></div>
                      <div className="wave"></div>
                    </div>
                  )}
                  <p className="hint">
                    {status === 'listening' ? '🎤 Speak now...' : 
                     status === 'speaking' ? '🔊 Agent is speaking...' :
                     status === 'thinking' ? '🤔 Processing your message...' :
                     '💬 Ready for conversation'}
                  </p>
                </div>
                <button 
                  onClick={endConversation}
                  className="main-button end"
                >
                  🔴 End Conversation
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="footer">
          <p className="info-text">
            Tip: Spreek natuurlijk. De agent zal in realtime met stem reageren.
          </p>
        </div>
      </div>
    </div>
  )
}

export default App
