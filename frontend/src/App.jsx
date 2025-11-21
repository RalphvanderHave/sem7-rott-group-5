import { useState, useRef, useEffect } from 'react'
import { Conversation } from '@11labs/client'
import Avatar from './Avatar'
import { analyzeEmotionWithGemini } from './services/emotionAnalysis'
import './App.css'

// ✅ 从 .env 读取 ElevenLabs 配置
const API_KEY = import.meta.env.VITE_API_KEY
const AGENT_ID = import.meta.env.VITE_AGENT_ID

function App() {
  const [isConnected, setIsConnected] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [status, setStatus] = useState('disconnected')
  const [messages, setMessages] = useState([])
  const [volume, setVolume] = useState(0)
  const [emotion, setEmotion] = useState('neutral')

  // user
  const [username, setUsername] = useState('')
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

  // backend
  const BACKEND_URL =
    import.meta.env.VITE_BACKEND_URL || 'https://lt-001434231557.tailb2509f.ts.net'

  const addMessage = async (role, content) => {
    console.log('📝 Adding message:', role, content)
    setMessages((prev) => [...prev, { role, content, timestamp: Date.now() }])

    if (role === 'user') {
      try {
        const result = await analyzeEmotionWithGemini(content)
        if (result.emotion === 'neutral') setEmotion('happy')
        else setEmotion(result.emotion || 'happy')
      } catch (error) {
        setEmotion('happy')
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

      // 后端目前返回 userId，把它统一映射到 username
      const returnedName = (data.username || data.userId || username).toLowerCase()

      setIsLoggedIn(true)
      setUsername(returnedName)
      setPassword('')
      setAuthError('')

      setMessages((prev) => [
        ...prev,
        {
          role: 'system',
          content: isRegisterMode
            ? `✅ Registered and logged in as ${returnedName}`
            : `✅ Logged in as ${returnedName}`,
          timestamp: Date.now(),
        },
      ])
    } catch (err) {
      console.error('❌ Auth error:', err)
      setAuthError(err.message)
    }
  }

  // ⭐ start conversation
  const startConversation = async () => {
    if (!isLoggedIn) {
      addMessage(
        'system',
        '🔒 Je moet eerst inloggen voordat je met Alfred kunt praten.',
      )
      return
    }

    try {
      if (!API_KEY || !AGENT_ID) {
        throw new Error('Missing API key or Agent ID. Please check .env file.')
      }

      setStatus('connecting')
      addMessage('system', '🔄 Connecting to AI agent Alfred...')

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      const conversation = await Conversation.startSession({
        agentId: AGENT_ID,
        apiKey: API_KEY,

        // 🔑 把用户名作为 dynamic variable 传给 ElevenLabs
        // 这样 conversation_initiation_client_data 会包含 { type, username: "xxx" }
        dynamicVariables: {
          username: username || 'guest',
        },

        onConnect: () => {
          setIsConnected(true)
          setStatus('connected')
          addMessage('system', '✅ Connected!')
        },

        onDisconnect: () => {
          setIsConnected(false)
          setStatus('disconnected')
          setEmotion('sad')
        },

        onMessage: (event) => {
          if (event?.source === 'user' && event.message) {
            addMessage('user', event.message)
          }
          if (event?.source === 'ai' && event.message) {
            addMessage('assistant', event.message)
          }
        },
      })

      conversationRef.current = conversation
    } catch (error) {
      console.error('❌ Failed to start conversation:', error)
      setStatus('error')
      addMessage('system', `⚠️ ${error.message}`)
    }
  }

  const endConversation = async () => {
    if (conversationRef.current) await conversationRef.current.endSession()
    setIsConnected(false)
    setStatus('disconnected')
    addMessage('system', '👋 Conversation ended')
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
                  onClick={() => setIsLoggedIn(false)}
                >
                  Logout
                </button>
              </div>
            ) : (
              <div className="auth-form">
                <input
                  type="text"
                  placeholder="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
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
                  onClick={() => setIsRegisterMode((p) => !p)}
                >
                  {isRegisterMode ? 'Have an account? Login' : 'New here? Register'}
                </button>
              </div>
            )}
          </div>
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
          <div className={`status-badge ${statusInfo.class}`}>{statusInfo.text}</div>
          {isConnected && (
            <div className="volume-indicator">
              <div className="volume-bar" style={{ width: `${volume}%` }} />
            </div>
          )}
        </div>

        <div className="chat-container">
          <div className="messages">
            {messages.map((msg, idx) => (
              <div key={idx} className={`message ${msg.role}`}>
                <div className="message-content">{msg.content}</div>
              </div>
            ))}
          </div>

          <div className="controls">
            {!isConnected ? (
              <button
                onClick={startConversation}
                className="main-button start"
                disabled={status === 'connecting' || !isLoggedIn}
              >
                🎙️ Start gesprek
              </button>
            ) : (
              <button onClick={endConversation} className="main-button end">
                🔴 End Conversation
              </button>
            )}
          </div>
        </div>

        <div className="footer">
          <p className="info-text">
            Tip: Spreek natuurlijk. De agent zal in realtime reageren.
          </p>
        </div>
      </div>
    </div>
  )
}

export default App
