import { useState, useRef, useEffect } from 'react'
import { Conversation } from '@11labs/client'
import './App.css'

function App() {
  const [isConnected, setIsConnected] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [status, setStatus] = useState('disconnected')
  const [messages, setMessages] = useState([])
  const [volume, setVolume] = useState(0)
  
  const conversationRef = useRef(null)
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const messagesEndRef = useRef(null)
  const volumeAnimationRef = useRef(null)

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
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const addMessage = (role, content) => {
    setMessages(prev => [...prev, { role, content, timestamp: Date.now() }])
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
      addMessage('system', '🔄 Connecting to AI agent...')

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
          addMessage('system', '✅ Connected! Start speaking to the AI agent...')
        },
        
        onDisconnect: () => {
          console.log('❌ Disconnected from agent')
          setIsConnected(false)
          setStatus('disconnected')
          setVolume(0)
          addMessage('system', '🔌 Disconnected from agent')
        },
        
        onMessage: (message) => {
          console.log('📨 Message received:', message)
          
          // Handle different message types
          if (message.type === 'user_transcript' || message.message?.role === 'user') {
            const text = message.text || message.message?.text || message.message?.content
            if (text) {
              addMessage('user', text)
            }
          } else if (message.type === 'agent_response' || message.message?.role === 'assistant') {
            const text = message.text || message.message?.text || message.message?.content
            if (text) {
              addMessage('assistant', text)
            }
          }
        },
        
        onError: (error) => {
          console.error('❌ Conversation error:', error)
          setStatus('error')
          addMessage('system', `⚠️ Error: ${error.message || 'Unknown error occurred'}`)
        },
        
        onModeChange: (mode) => {
          console.log('🔄 Mode changed:', mode)
          const newMode = mode.mode || mode
          setStatus(newMode)
          setIsSpeaking(newMode === 'speaking')
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
      addMessage('system', '👋 Conversation ended')
    }
    
    if (volumeAnimationRef.current) {
      cancelAnimationFrame(volumeAnimationRef.current)
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
          <h1>🤖 AI Voice Agent</h1>
          <p>Real-time Conversational AI • Powered by ElevenLabs</p>
        </header>

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
                <h2>👋 Welcome to AI Voice Agent!</h2>
                <p>Click "Start Conversation" to begin talking with your support agent in real-time.</p>
                <div className="features">
                  <div className="feature">🎤 Voice Input</div>
                  <div className="feature">🔊 Voice Output</div>
                  <div className="feature">⚡ Real-time Response</div>
                </div>
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
            💡 Tip: Speak naturally. The agent will respond in real-time with voice.
          </p>
        </div>
      </div>
    </div>
  )
}

export default App
