import { useState, useRef, useEffect } from 'react'
import { Conversation } from '@11labs/client'
import Avatar from './Avatar'
import { analyzeEmotionWithGemini } from './services/emotionAnalysis'
import './App.css'

// 🔑 从 .env 读取 ElevenLabs 配置（Vite 环境变量必须以 VITE_ 开头）
const AGENT_ID = import.meta.env.VITE_ELEVENLABS_AGENT_ID
const API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY

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
  const [isRegisterMode, setIsRegisterMode] = useState(false)
  const [authError, setAuthError] = useState('')

  // Refs for audio processing
  const conversationRef = useRef(null)
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const dataArrayRef = useRef(null)
  const volumeIntervalRef = useRef(null)

  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

  // Helper function: add messages to chat log
  const addMessage = (role, content) => {
    const timestamp = Date.now()
    setMessages((prev) => [...prev, { role, content, timestamp }])
  }

  // Authentication handler
  const handleAuth = async () => {
    setAuthError('')
    if (!userId || !password) {
      setAuthError('Gebruikersnaam en wachtwoord zijn verplicht.')
      return
    }

    try {
      const endpoint = isRegisterMode ? '/register' : '/login'
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

      // The backend returns { userId: "xxx" }
      setIsLoggedIn(true)
      setUserId(data.userId)
      setPassword('')
      setAuthError('')
      setMessages((prev) => [
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
      console.error('Auth error:', err)
      setAuthError(err.message || 'Onbekende fout bij inloggen/registreren.')
    }
  }

  // Monitor volume for visual feedback
  const startVolumeMonitoring = () => {
    if (!analyserRef.current || !audioContextRef.current) return

    if (!dataArrayRef.current) {
      dataArrayRef.current = new Uint8Array(analyserRef.current.frequencyBinCount)
    }

    if (volumeIntervalRef.current) {
      clearInterval(volumeIntervalRef.current)
    }

    volumeIntervalRef.current = setInterval(() => {
      analyserRef.current.getByteTimeDomainData(dataArrayRef.current)

      let sum = 0
      for (let i = 0; i < dataArrayRef.current.length; i++) {
        const value = dataArrayRef.current[i] - 128
        sum += value * value
      }
      const rms = Math.sqrt(sum / dataArrayRef.current.length)
      const normalized = Math.min(1, rms / 50)

      setVolume(normalized)
    }, 100)
  }

  const stopVolumeMonitoring = () => {
    if (volumeIntervalRef.current) {
      clearInterval(volumeIntervalRef.current)
      volumeIntervalRef.current = null
    }
    setVolume(0)
  }

  // Analyze emotion based on text message
  const handleEmotionAnalysis = async (text, role) => {
    try {
      const resultEmotion = await analyzeEmotionWithGemini(text, role)
      setEmotion(resultEmotion)
    } catch (error) {
      console.error('Emotion analysis failed, keeping previous emotion:', error)
    }
  }

  // Start conversation with ElevenLabs
  const startConversation = async () => {
    // 🔒 Block if user is not logged in
    if (!isLoggedIn) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'system',
          content: '🔒 Je moet eerst inloggen voordat je met Alfred kunt praten.',
          timestamp: Date.now(),
        },
      ])
      return
    }

    try {
      if (!API_KEY || !AGENT_ID) {
        throw new Error('Missing API key or Agent ID. Please check your .env file.')
      }

      if (AGENT_ID === 'paste_your_agent_id_here') {
        throw new Error(
          'Please replace VITE_ELEVENLABS_AGENT_ID in .env with your actual Agent ID from ElevenLabs',
        )
      }

      setStatus('connecting')
      addMessage('system', '🔄 Connecting to AI agent Alfred...')

      console.log('🎯 Using Agent ID:', AGENT_ID)
      console.log('🔑 API Key present:', !!API_KEY)
      console.log('👤 Sending userId to ElevenLabs:', userId)

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
          autoGainControl: true,
        },
      })

      console.log('🎤 Microphone stream obtained')

      // Start the conversation
      const conversation = await Conversation.startSession({
        agentId: AGENT_ID,
        apiKey: API_KEY,

        // 🔑 IMPORTANT: tell ElevenLabs who this user is
        // this will be forwarded to your mem0 tool as username=userId
        userId: userId || 'guest',

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
          setIsSpeaking(false)
          setStatus('disconnected')
          stopVolumeMonitoring()

          if (reason?.code === 4003 || reason?.message?.includes('quota')) {
            addMessage(
              'system',
              '⚠️ ElevenLabs API quota is op. Controleer je abonnement of API key.',
            )
            alert(
              '❌ ElevenLabs API Quota Exceeded!\n\nJe API-abonnement is op.\n\n1. Controleer je abonnement\n2. Wacht op maandelijkse reset\n3. Gebruik een andere API key',
            )
          } else {
            addMessage(
              'system',
              `🔌 Disconnected: ${reason?.message || 'Connection ended'}`,
            )
          }
        },

        onError: (error) => {
          console.error('❌ ERROR:', error)
          console.error('Error details:', JSON.stringify(error, null, 2))
          setStatus('error')
          setIsConnected(false)
          setIsSpeaking(false)
          stopVolumeMonitoring()

          const message =
            error?.message ||
            error?.toString() ||
            'Onbekende fout bij verbinden met ElevenLabs.'

          addMessage('system', `❌ Error: ${message}`)

          if (message.toLowerCase().includes('api key')) {
            alert(
              '❌ ElevenLabs API Key fout.\n\nControleer of VITE_ELEVENLABS_API_KEY correct is ingesteld in .env en dat je frontend opnieuw is gestart.',
            )
          } else {
            alert(`❌ Fehler bij verbinden met ElevenLabs:\n\n${message}`)
          }
        },

        onMessage: async (event) => {
          console.log('📩 MESSAGE EVENT:', event)

          if (event?.type === 'input_transcription') {
            const text = event.transcript || ''
            addMessage('user', text)
            handleEmotionAnalysis(text, 'user')
          }

          if (event?.type === 'agent_response') {
            const text = event.output[0]?.content[0]?.transcript || ''
            if (text) {
              addMessage('assistant', text)
              handleEmotionAnalysis(text, 'assistant')
            }
          }
        },

        onAudioStart: () => {
          console.log('🔊 Audio started (AI is speaking)')
          setIsSpeaking(true)
        },

        onAudioEnd: () => {
          console.log('🔇 Audio ended')
          setIsSpeaking(false)
        },

        // Microphone stream
        micStream: stream,
      })

      console.log('✅ Conversation session started')
      conversationRef.current = conversation

      // Connect microphone to analyser
      if (audioContextRef.current && analyserRef.current) {
        const source = audioContextRef.current.createMediaStreamSource(stream)
        source.connect(analyserRef.current)
        startVolumeMonitoring()
      }

      // Start conversation interaction
      await conversation.start()
    } catch (error) {
      console.error('❌ Failed to start conversation:', error)
      setStatus('error')
      setIsConnected(false)
      setIsSpeaking(false)
      stopVolumeMonitoring()

      const friendlyMessage =
        error?.message || 'Kon geen verbinding maken met ElevenLabs. Controleer je instellingen.'
      addMessage('system', `❌ ${friendlyMessage}`)
    }
  }

  const stopConversation = async () => {
    try {
      if (conversationRef.current) {
        await conversationRef.current.endSession()
        conversationRef.current = null
      }

      if (audioContextRef.current) {
        audioContextRef.current.close()
        audioContextRef.current = null
        analyserRef.current = null
        dataArrayRef.current = null
      }

      stopVolumeMonitoring()
      setStatus('disconnected')
      setIsConnected(false)
      setIsSpeaking(false)
      addMessage('system', '🔌 Conversation stopped.')
    } catch (error) {
      console.error('❌ Error stopping conversation:', error)
      addMessage('system', '⚠️ Fout bij stoppen van gesprek.')
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopConversation()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const statusLabel = () => {
    switch (status) {
      case 'connecting':
        return 'Verbinding maken...'
      case 'connected':
        return 'Verbonden'
      case 'error':
        return 'Fout'
      case 'disconnected':
      default:
        return 'Niet verbonden'
    }
  }

  return (
    <div className="app-container">
      <div className="left-panel">
        <div className="auth-card">
          <h2>🔐 Login / Registratie</h2>
          <div className="auth-toggle">
            <button
              className={!isRegisterMode ? 'active' : ''}
              onClick={() => setIsRegisterMode(false)}
            >
              Inloggen
            </button>
            <button
              className={isRegisterMode ? 'active' : ''}
              onClick={() => setIsRegisterMode(true)}
            >
              Registreren
            </button>
          </div>

          <div className="auth-form">
            <label>Gebruikersnaam</label>
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value.toLowerCase())}
              placeholder="bijv. jiawei"
            />

            <label>Wachtwoord</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />

            {authError && <div className="error-text">{authError}</div>}

            <button className="auth-button" onClick={handleAuth}>
              {isRegisterMode ? 'Registreren + Inloggen' : 'Inloggen'}
            </button>

            {isLoggedIn && (
              <p className="logged-in-text">
                ✅ Ingelogd als: <strong>{userId}</strong>
              </p>
            )}
          </div>
        </div>

        <div className="chat-card">
          <h2>💬 Gesprekslog</h2>
          <div className="status-badge">Status: {statusLabel()}</div>
          <div className="chat-log">
            {messages.map((msg, idx) => (
              <div key={idx} className={`chat-message ${msg.role}`}>
                <span className="role-label">
                  {msg.role === 'user'
                    ? '👤 Jij'
                    : msg.role === 'assistant'
                      ? '🤖 Alfred'
                      : 'ℹ️ Systeem'}
                </span>
                <p>{msg.content}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="right-panel">
        <div className="avatar-card">
          <h2>🧠 Alfred (AI Companion)</h2>
          <Avatar emotion={emotion} isSpeaking={isSpeaking} volume={volume} isConnected={isConnected} />

          <div className="controls">
            <button
              className={`control-button start ${isConnected ? 'disabled' : ''}`}
              onClick={startConversation}
              disabled={isConnected || !isLoggedIn}
            >
              🎙️ Start gesprek
            </button>
            <button
              className={`control-button stop ${!isConnected ? 'disabled' : ''}`}
              onClick={stopConversation}
              disabled={!isConnected}
            >
              ⏹️ Stop gesprek
            </button>
          </div>

          <div className="volume-meter">
            <span>🔊 Volume:</span>
            <div className="volume-bar">
              <div className="volume-fill" style={{ width: `${volume * 100}%` }} />
            </div>
          </div>

          <div className="emotion-display">
            <span>🧩 Huidige emotie:</span>
            <strong>{emotion}</strong>
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
