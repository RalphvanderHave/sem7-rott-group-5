import { useState, useRef, useEffect } from 'react'
import { Conversation } from '@11labs/client'
import Avatar from './Avatar'
import { analyzeEmotionWithGemini } from './services/emotionAnalysis'
import './App.css'

const STORAGE_KEY = 'alfred_username'

function App() {
  const [isConnected, setIsConnected] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)   // ✅ speaking state
  const [status, setStatus] = useState('disconnected')
  const [messages, setMessages] = useState([])
  const [volume, setVolume] = useState(0)
  const [emotion, setEmotion] = useState('neutral')

  // user auth
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [authError, setAuthError] = useState('')
  const [isRegisterMode, setIsRegisterMode] = useState(false)

  // 🧪 Test mode state
  const [showTestPanel, setShowTestPanel] = useState(false)
  const [testIsSpeaking, setTestIsSpeaking] = useState(false)
  const [testVolume, setTestVolume] = useState(0)

  // clear memory dialog
  const [showClearDialog, setShowClearDialog] = useState(false)
  const [clearUsername, setClearUsername] = useState('')
  const [clearPassword, setClearPassword] = useState('')
  const [clearError, setClearError] = useState('')
  const [isClearing, setIsClearing] = useState(false)

  const conversationRef = useRef(null)
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const messagesEndRef = useRef(null)
  const volumeAnimationRef = useRef(null)
  const emotionTimeoutRef = useRef(null)

  const API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY
  const AGENT_ID = import.meta.env.VITE_AGENT_ID
  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL
  const AUTH_TOKEN = import.meta.env.VITE_AUTH_TOKEN

  // cleanup on unmount
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

  // Automatically read the username from localStorage and log in.
  useEffect(() => {
    const storedUsername = localStorage.getItem(STORAGE_KEY)
    if (storedUsername) {
      setUsername(storedUsername)
      setIsLoggedIn(true)
      setMessages(prev => [
        ...prev,
        {
          role: 'system',
          content: `🔓 Automatisch ingelogd als ${storedUsername}`,
          timestamp: Date.now(),
        },
      ])
    }
  }, [])

  // auto scroll chat to bottom
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

  // 🔐 login / register
  const handleAuth = async () => {
    setAuthError('')

    if (!username || !password) {
      setAuthError('Please fill in username and password.')
      return
    }

    const endpoint = isRegisterMode ? '/register' : '/login'

    try {
      const res = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) throw new Error(data.detail || 'Auth failed')

      // The backend currently returns userId, which is uniformly mapped to username.
      const returnedName = (data.username || data.userId || username).toLowerCase()

      // ✅ Persistently save username
      localStorage.setItem(STORAGE_KEY, returnedName)

      setIsLoggedIn(true)
      setUsername(returnedName)
      setPassword('')
      setAuthError('')

      setMessages(prev => [
        ...prev,
        {
          role: 'system',
          content: isRegisterMode
            ? `✅ Geregistreerd en ingelogd als ${returnedName}`
            : `✅ Ingelogd als ${returnedName}`,
          timestamp: Date.now(),
        },
      ])
    } catch (err) {
      console.error('❌ Auth error:', err)
      setIsLoggedIn(false)
      setAuthError(err.message || 'Authenticatie mislukt')
    }
  }

  const handleLogout = () => {
    localStorage.removeItem(STORAGE_KEY)
    setIsLoggedIn(false)
    setPassword('')
    setAuthError('')
    setIsSpeaking(false)   // ✅ Make sure to turn off the speaking state when logging out.
    setMessages(prev => [
      ...prev,
      {
        role: 'system',
        content: '👋 Uitgelogd',
        timestamp: Date.now(),
      },
    ])
  }

  // Open the "Clear Memory" dialog box
  const openClearDialog = () => {
    setClearUsername(username || '')
    setClearPassword('')
    setClearError('')
    setShowClearDialog(true)
  }

  // Confirm memory clearing
  const handleConfirmClear = async () => {
    setClearError('')

    if (!clearUsername || !clearPassword) {
      setClearError('Vul gebruikersnaam en wachtwoord in.')
      return
    }

    if (!AUTH_TOKEN) {
      setClearError('AUTH_TOKEN is niet geconfigureerd aan de frontend.')
      return
    }

    setIsClearing(true)

    try {
      // 1) First, use /login to verify username + password.
      const loginRes = await fetch(`${BACKEND_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: clearUsername,
          password: clearPassword,
        }),
      })

      const loginData = await loginRes.json().catch(() => ({}))
      if (!loginRes.ok) {
        throw new Error(loginData.detail || 'Login failed')
      }

      const lowerName = (clearUsername || '').trim().toLowerCase()

      // 2) After the password is correct, call /mem0/clear.
      const clearRes = await fetch(`${BACKEND_URL}/mem0/clear`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
        },
        body: JSON.stringify({ userId: lowerName }),
      })

      const clearData = await clearRes.json().catch(() => ({}))
      if (!clearRes.ok) {
        throw new Error(clearData.detail || 'Failed to clear memory')
      }

      setShowClearDialog(false)
      setClearPassword('')
      setClearError('')

      addMessage(
        'system',
        `🧹 Alle herinneringen voor ${lowerName} zijn gewist.`,
      )
    } catch (err) {
      console.error('❌ Clear memory error:', err)
      setClearError(err.message || 'Onbekende fout bij geheugen wissen.')
    } finally {
      setIsClearing(false)
    }
  }

  // ⭐ start conversation
  const startConversation = async () => {
    // 🔒 block if user is not logged in
    if (!isLoggedIn) {
      setMessages(prev => [
        ...prev,
        {
          role: 'system',
          content:
            '🔒 Je moet eerst inloggen voordat je met Alfred kunt praten.',
          timestamp: Date.now(),
        },
      ])
      return
    }

    try {
      if (!API_KEY || !AGENT_ID) {
        throw new Error(
          'Missing API key or Agent ID. Please check your .env file.',
        )
      }

      if (AGENT_ID === 'paste_your_agent_id_here') {
        throw new Error(
          'Please replace VITE_AGENT_ID in .env with your actual Agent ID from ElevenLabs',
        )
      }

      setStatus('connecting')
      setIsSpeaking(false)     // ✅ Reset speaking before starting the connection
      addMessage('system', '🔄 Connecting to AI agent Alfred...')

      console.log('🎯 Using Agent ID:', AGENT_ID)
      console.log('🔑 API Key present:', !!API_KEY)

      // audio context for volume monitoring
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext ||
          window.webkitAudioContext)()
        analyserRef.current = audioContextRef.current.createAnalyser()
        analyserRef.current.fftSize = 256
      }

      // microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      console.log('🎤 Microphone stream obtained')

      // start ElevenLabs conversation
      const conversation = await Conversation.startSession({
        agentId: AGENT_ID,
        apiKey: API_KEY,
        //connectionType: 'webrtc',

        // 🔑 Pass the username as a dynamic variable to ElevenLabs
        dynamicVariables: {
          username: username || 'guest',
        },

        onConnect: () => {
          console.log('✅ CONNECTED')
          setIsConnected(true)
          setStatus('connected')
          setEmotion('neutral')
          setIsSpeaking(false)
          addMessage('system', '✅ Connected!')
        },

        onDisconnect: reason => {
          console.log(
            '❌ DISCONNECTED - Reason:',
            JSON.stringify(reason, null, 2),
          )

          setIsConnected(false)
          setStatus('disconnected')
          setVolume(0)
          setEmotion('sad')
          setIsSpeaking(false)   // ✅ Turn off speaking when disconnecting

          if (
            reason?.message?.includes('quota') ||
            reason?.message?.includes('limit')
          ) {
            addMessage(
              'system',
              '⚠️ ElevenLabs quota exceeded! Please check your usage at https://elevenlabs.io/app/usage',
            )
            alert(
              '❌ ElevenLabs API Quota Exceeded!\n\nYour account has reached its usage limit.\n\n✅ Solutions:\n1. Upgrade your plan at https://elevenlabs.io/app/subscription\n2. Wait for monthly reset\n3. Use a different API key',
            )
          } else {
            addMessage(
              'system',
              `🔌 Disconnected: ${reason?.message || 'Connection ended'}`,
            )
          }
        },

        onError: error => {
          console.error('❌ ERROR:', error)
          console.error('Error details:', JSON.stringify(error, null, 2))
          setStatus('error')
          setEmotion('sad')
          setIsSpeaking(false)
          addMessage(
            'system',
            `⚠️ Error: ${error.message || 'Unknown error occurred'}`,
          )
        },

        // ⬇️⬇️ Key: Switch between speaking, listening, and thinking modes according to the mode.
        onModeChange: mode => {
          // mode 'speaking' | 'listening' | 'thinking'
          console.log('🎛 Mode changed:', mode)
          setStatus(mode)
          setIsSpeaking(mode === 'speaking')
        },

        onMessage: event => {
          if (event?.source === 'user' && event.message) {
            addMessage('user', event.message)
          }
          if (event?.source === 'ai' && event.message) {
            addMessage('assistant', event.message)
          }
        },
      })

      console.log('✅ Conversation session created successfully')
      console.log('Conversation object:', conversation)
      conversationRef.current = conversation

      // volume monitoring
      const source = audioContextRef.current.createMediaStreamSource(stream)
      source.connect(analyserRef.current)

      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)
      const updateVolume = () => {
        if (analyserRef.current && isConnected) {
          analyserRef.current.getByteFrequencyData(dataArray)
          const average =
            dataArray.reduce((a, b) => a + b, 0) / dataArray.length
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
      setIsSpeaking(false)

      let errorMessage = error.message
      if (error.message.includes('API key')) {
        errorMessage = 'Invalid API key. Please check your .env file.'
      } else if (error.message.includes('Agent')) {
        errorMessage =
          'Invalid Agent ID. Please get your Agent ID from ElevenLabs dashboard.'
      } else if (error.name === 'NotAllowedError') {
        errorMessage =
          'Microphone permission denied. Please allow microphone access.'
      }

      addMessage('system', `⚠️ ${errorMessage}`)
      alert(
        `Failed to start conversation:\n\n${errorMessage}\n\nSteps:\n1. Get your Agent ID from https://elevenlabs.io/app/conversational-ai\n2. Update VITE_AGENT_ID in .env file\n3. Restart the dev server`,
      )
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
      setIsSpeaking(false)    // ✅ Turn off speaking when you actively end the session.
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

  // 🧪 Test functions
  const cycleEmotion = () => {
    const emotions = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'confused']
    const currentIndex = emotions.indexOf(emotion)
    const nextEmotion = emotions[(currentIndex + 1) % emotions.length]
    setEmotion(nextEmotion)
    addMessage('system', `🎭 Test: Emotion changed to ${nextEmotion}`)
  }

  const toggleTestSpeaking = () => {
    setTestIsSpeaking(!testIsSpeaking)
    setIsSpeaking(!testIsSpeaking)
    if (!testIsSpeaking) {
      // Simulate volume when speaking
      const volumeInterval = setInterval(() => {
        setTestVolume(Math.random() * 100)
      }, 100)
      setTimeout(() => {
        clearInterval(volumeInterval)
        setTestVolume(0)
        setTestIsSpeaking(false)
        setIsSpeaking(false)
      }, 3000)
    }
  }

  const testAllEmotions = async () => {
    const emotions = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'confused']
    for (const emo of emotions) {
      setEmotion(emo)
      addMessage('system', `🎭 Testing: ${emo}`)
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
    setEmotion('neutral')
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
                <span className="auth-user">👤 {username}</span>
                <button
                  className="auth-button logout"
                  onClick={handleLogout}
                >
                  Logout
                </button>
                <button
                  className="auth-button danger"
                  onClick={openClearDialog}
                >
                  🧹 Geheugen wissen
                </button>
              </div>
            ) : (
              <div className="auth-form">
                <input
                  type="text"
                  placeholder="Username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
                <button className="auth-button" onClick={handleAuth}>
                  {isRegisterMode ? 'Registreren' : 'Inloggen'}
                </button>
                <button
                  className="auth-toggle"
                  onClick={() => setIsRegisterMode(p => !p)}
                >
                  {isRegisterMode
                    ? 'Heb je al een account? Inloggen'
                    : 'Nieuw hier? Registreren'}
                </button>
              </div>
            )}
          </div>
        </header>

        {authError && <div className="auth-error">⚠️ {authError}</div>}

        {/* Clear memory dialog box */}
        {showClearDialog && (
          <div className="clear-dialog">
            <h3>🧹 Herinneringen wissen</h3>
            <p>Bevestig met gebruikersnaam en wachtwoord.</p>
            <input
              type="text"
              placeholder="Username"
              value={clearUsername}
              onChange={e => setClearUsername(e.target.value)}
            />
            <input
              type="password"
              placeholder="Password"
              value={clearPassword}
              onChange={e => setClearPassword(e.target.value)}
            />
            {clearError && (
              <div className="auth-error" style={{ marginTop: '8px' }}>
                ⚠️ {clearError}
              </div>
            )}
            <div className="clear-dialog-actions">
              <button
                className="auth-button danger"
                onClick={handleConfirmClear}
                disabled={isClearing}
              >
                {isClearing ? 'Wissen...' : 'Bevestigen'}
              </button>
              <button
                className="auth-button"
                onClick={() => setShowClearDialog(false)}
                disabled={isClearing}
              >
                Annuleren
              </button>
            </div>
          </div>
        )}

        {/* 🧪 Test Panel */}
        <div className="test-panel-toggle">
          <button 
            className="test-toggle-btn"
            onClick={() => setShowTestPanel(!showTestPanel)}
          >
            {showTestPanel ? '🔬 Hide Tests' : '🔬 Show Tests'}
          </button>
        </div>

        {showTestPanel && (
          <div className="test-panel">
            <h3>🧪 Avatar Test Controls</h3>
            <div className="test-controls">
              <button onClick={cycleEmotion} className="test-btn">
                🎭 Cycle Emotion
              </button>
              <button onClick={toggleTestSpeaking} className="test-btn">
                {testIsSpeaking ? '🔇 Stop Speaking' : '🗣️ Test Speaking'}
              </button>
              <button onClick={testAllEmotions} className="test-btn">
                🎬 Test All Emotions
              </button>
              <button 
                onClick={() => {
                  setEmotion('happy')
                  addMessage('user', 'I love this!')
                }} 
                className="test-btn"
              >
                😊 Happy Test
              </button>
              <button 
                onClick={() => {
                  setEmotion('sad')
                  addMessage('user', 'I am feeling down...')
                }} 
                className="test-btn"
              >
                😢 Sad Test
              </button>
              <button 
                onClick={() => {
                  setEmotion('angry')
                  addMessage('user', 'This is frustrating!')
                }} 
                className="test-btn"
              >
                😠 Angry Test
              </button>
              <button 
                onClick={() => {
                  setEmotion('surprised')
                  addMessage('user', 'Wow! Really?')
                }} 
                className="test-btn"
              >
                😲 Surprised Test
              </button>
              <button 
                onClick={() => {
                  setEmotion('confused')
                  addMessage('user', 'I don\'t understand...')
                }} 
                className="test-btn"
              >
                😕 Confused Test
              </button>
            </div>
            <div className="test-info">
              <p>Current Emotion: <strong>{emotion}</strong></p>
              <p>Is Speaking: <strong>{isSpeaking ? 'Yes' : 'No'}</strong></p>
              <p>Volume: <strong>{Math.round(testIsSpeaking ? testVolume : volume)}</strong></p>
              <p>Connected: <strong>{isConnected ? 'Yes' : 'No'}</strong></p>
            </div>
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
                <p>
                  Klik &quot;Start Conversation&quot; om het gesprek in
                  real-time te beginnen.
                </p>
              </div>
            )}
            {messages.map((msg, index) => (
              <div key={index} className={`message ${msg.role}`}>
                <div className="message-content">{msg.content}</div>
              </div>
            ))}
            {status === 'thinking' && (
              <div className="message assistant">
                <div className="message-content typing">
                  <span></span>
                  <span></span>
                  <span></span>
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
                disabled={status === 'connecting' || !isLoggedIn}
              >
                {!isLoggedIn
                  ? '🔒 Log eerst in om te starten'
                  : status === 'connecting'
                  ? '⏳ Verbinden...'
                  : '🎙️ Start gesprek'}
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
                    {status === 'listening'
                      ? '🎤 Speak now...'
                      : status === 'speaking'
                      ? '🔊 Agent is speaking...'
                      : status === 'thinking'
                      ? '🤔 Processing your message...'
                      : '💬 Ready for conversation'}
                  </p>
                </div>
                <button onClick={endConversation} className="main-button end">
                  🔴 End Conversation
                </button>
                {!isConnected && !isLoggedIn && (
                  <p className="hint" style={{ marginTop: '10px' }}>
                    ℹ️ Log in om een gesprek met Alfred te starten.
                  </p>
                )}
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
