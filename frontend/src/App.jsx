import { useState, useRef, useEffect } from 'react'
import { Conversation } from '@11labs/client'
import Avatar from './Avatar'
import { analyzeEmotionWithGemini } from './services/emotionAnalysis'
import './App.css'

function App() {
  const [isConnected, setIsConnected] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [status, setStatus] = useState('disconnected')
  const [messages, setMessages] = useState([])
  const [volume, setVolume] = useState(0)
  const [emotion, setEmotion] = useState('neutral')

  // user
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [authError, setAuthError] = useState('')
  const [isRegisterMode, setIsRegisterMode] = useState(false)

  
  const conversationRef = useRef(null)
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const messagesEndRef = useRef(null)
  const volumeAnimationRef = useRef(null)
  const emotionTimeoutRef = useRef(null)

  const API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY
  const AGENT_ID = import.meta.env.VITE_AGENT_ID
  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'https://lt-001434231557.tailb2509f.ts.net\n'


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

  const addMessage = async (role, content) => {
    console.log('📝 Adding message:', role, content)
    setMessages(prev => [...prev, { role, content, timestamp: Date.now() }])
    
    // ONLY detect emotion from USER messages using AI
    if (role === 'user') {
      console.log('🔍 Starting emotion analysis for user message...')
      
      try {
        // Always use Gemini
        const result = await analyzeEmotionWithGemini(content)
        
        console.log('🎭 AI detected emotion:', result.emotion)
        console.log('📊 Confidence:', result.confidence)
        if (result.reasoning) console.log('💭 Reasoning:', result.reasoning)
        
        // If AI returns neutral, show happy (conversation is happening)
        if (result.emotion === 'neutral') {
          console.log('✅ AI detected neutral, showing happy during conversation')
          setEmotion('happy')
        } 
        // If AI detected a clear emotion, use it
        else if (result.emotion) {
          console.log('✅ Setting avatar to:', result.emotion)
          setEmotion(result.emotion)
        } 
        // Fallback to happy if no clear result
        else {
          console.log('✅ No clear emotion, defaulting to happy')
          setEmotion('happy')
        }
      } catch (error) {
        console.error('❌ Failed to analyze emotion:', error)
        setEmotion('happy')
      }
      
      if (emotionTimeoutRef.current) {
        clearTimeout(emotionTimeoutRef.current)
        emotionTimeoutRef.current = null
      }
    }
  }

  // users
    const handleAuth = async () => {
    setAuthError('')

    if (!userId || !password) {
      setAuthError('Please fill in username and password.')
      return
    }

    const endpoint = isRegisterMode ? '/register' : '/login'

    try {
      const res = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: userId,
          password: password,
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(data.detail || 'Auth failed')
      }

      // 后端返回 { userId: "xxx" }
      setIsLoggedIn(true)
      setUserId(data.userId)
      setPassword('')
      setAuthError('')
      setMessages(prev => [
        ...prev,
        {
          role: 'system',
          content: isRegisterMode
            ? `✅ Registered and logged in as ${data.userId}`
            : `✅ Logged in as ${data.userId}`,
          timestamp: Date.now(),
        },
      ])
    } catch (err) {
      console.error('❌ Auth error:', err)
      setIsLoggedIn(false)
      setAuthError(err.message || 'Auth failed')
    }
  }

  const handleLogout = () => {
    setIsLoggedIn(false)
    setPassword('')
    setAuthError('')
    setMessages(prev => [
      ...prev,
      {
        role: 'system',
        content: '👋 Logged out',
        timestamp: Date.now(),
      },
    ])
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

      console.log('🎯 Using Agent ID:', AGENT_ID)
      console.log('🔑 API Key present:', !!API_KEY)

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

      console.log('🎤 Microphone stream obtained')

      // Start the conversation
      const conversation = await Conversation.startSession({
        agentId: AGENT_ID,
        apiKey: API_KEY,
        
        onConnect: () => {
          console.log('✅ CONNECTED')
          setIsConnected(true)
          setStatus('connected')
          setEmotion('neutral')
          addMessage('system', '✅ Connected!')
        },
        
        onDisconnect: (reason) => {
          console.log('❌ DISCONNECTED - Reason:', JSON.stringify(reason, null, 2))
          
          setIsConnected(false)
          setStatus('disconnected')
          setVolume(0)
          setEmotion('sad')
          
          // Check if it's a quota error
          if (reason?.message?.includes('quota') || reason?.message?.includes('limit')) {
            addMessage('system', '⚠️ ElevenLabs quota exceeded! Please check your usage at https://elevenlabs.io/app/usage')
            alert('❌ ElevenLabs API Quota Exceeded!\n\nYour account has reached its usage limit.\n\n✅ Solutions:\n1. Upgrade your plan at https://elevenlabs.io/app/subscription\n2. Wait for monthly reset\n3. Use a different API key')
          } else {
            addMessage('system', `🔌 Disconnected: ${reason?.message || 'Connection ended'}`)
          }
        },

        onError: (error) => {
          console.error('❌ ERROR:', error)
          console.error('Error details:', JSON.stringify(error, null, 2))
          setStatus('error')
          setEmotion('sad')
          addMessage('system', `⚠️ Error: ${error.message || 'Unknown error occurred'}`)
        },
        
        onMessage: (message) => {
          console.log('📨 Message received - Type:', message.type, 'Source:', message.source)
          console.log('Full message:', JSON.stringify(message, null, 2))
          
          let userText = null
          let agentText = null
          
          // PRIMARY METHOD: Check source field
          if (message.source === 'user' && message.message) {
            userText = message.message
            console.log('✅ USER MESSAGE FOUND:', userText)
          } else if (message.source === 'ai' && message.message) {
            agentText = message.message
            console.log('✅ AI MESSAGE FOUND:', agentText)
          }
          
          // Process user text - THIS TRIGGERS GEMINI EMOTION ANALYSIS
          if (userText) {
            console.log('👤 USER TRANSCRIPT DETECTED - Calling addMessage')
            addMessage('user', userText)
          }
          
          // Process agent text
          if (agentText) {
            console.log('🤖 AGENT RESPONSE - Calling addMessage')
            addMessage('assistant', agentText)
          }
        },
        
        onModeChange: (mode) => {
          const newMode = mode.mode || mode
          console.log('🔄 MODE:', newMode)
          setStatus(newMode)
          setIsSpeaking(newMode === 'speaking')
          
          if (newMode === 'thinking') {
            setEmotion('thinking')
          }
        }
      })

      console.log('✅ Conversation session created successfully')
      console.log('Conversation object:', conversation)
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

      console.log('✅ Audio monitoring started')

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
    console.log('🔌 User requested to end conversation')
    
    if (conversationRef.current) {
      try {
        await conversationRef.current.endSession()
        console.log('✅ Session ended successfully')
      } catch (error) {
        console.error('⚠️ Error ending session:', error)
      }
      conversationRef.current = null
      setIsConnected(false)
      setStatus('disconnected')
      setVolume(0)
      setEmotion('neutral')
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
          <div>
            <h1>🤖 Alfred</h1>
            <p>Real-time AI Agent • Powered by ElevenLabs</p>
          </div>

          <div className="auth-panel">
            {isLoggedIn ? (
                <div className="auth-logged-in">
                  <span className="auth-user">👤 {userId}</span>
                  <button className="auth-button logout" onClick={handleLogout}>
                    Logout
                  </button>
                </div>
            ) : (
                <div className="auth-form">
                  <input
                      type="text"
                      placeholder="Username"
                      value={userId}
                      onChange={(e) => setUserId(e.target.value)}
                  />
                  <input
                      type="password"
                      placeholder="Password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                  />
                  <button className="auth-button" onClick={handleAuth}>
                    {isRegisterMode ? 'Register' : 'Login'}
                  </button>
                  <button
                      className="auth-toggle"
                      type="button"
                      onClick={() => setIsRegisterMode((prev) => !prev)}
                  >
                    {isRegisterMode ? 'Have an account? Login' : 'New here? Register'}
                  </button>
                </div>
            )}
          </div>
        </header>
        {authError && (
        <div className="auth-error">
          ⚠️ {authError}
        </div>
        )}

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
                    style={{width: `${volume}%`}}
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