import { useEffect, useState } from 'react'
import './Avatar.css'

const Avatar = ({ emotion, isSpeaking, volume, isConnected }) => {
  const [mouthOpen, setMouthOpen] = useState(false)

  console.log('🎨 Avatar RE-RENDERING with emotion:', emotion, 'isSpeaking:', isSpeaking)

  useEffect(() => {
    console.log('🔔 Avatar emotion changed to:', emotion)
  }, [emotion])

  useEffect(() => {
    if (isSpeaking) {
      const interval = setInterval(() => {
        setMouthOpen(prev => !prev)
      }, 200)
      return () => clearInterval(interval)
    } else {
      setMouthOpen(false)
    }
  }, [isSpeaking])

  const getEyeExpression = () => {
    switch (emotion) {
      case 'happy':
        return { leftEye: '😊', rightEye: '😊', eyeClass: 'eyes-happy' }
      case 'sad':
        return { leftEye: '😢', rightEye: '😢', eyeClass: 'eyes-sad' }
      case 'thinking':
        return { leftEye: '🤔', rightEye: '🤔', eyeClass: 'eyes-thinking' }
      case 'surprised':
        return { leftEye: '😮', rightEye: '😮', eyeClass: 'eyes-surprised' }
      case 'listening':
        return { leftEye: '👂', rightEye: '👂', eyeClass: 'eyes-listening' }
      case 'talking':
        return { leftEye: '😊', rightEye: '😊', eyeClass: 'eyes-talking' }
      default:
        return { leftEye: '●', rightEye: '●', eyeClass: 'eyes-neutral' }
    }
  }

  const getMouthShape = () => {
    if (!isConnected) return 'M 40 50 Q 50 50 60 50'
    
    switch (emotion) {
      case 'happy':
        return mouthOpen && isSpeaking 
          ? 'M 40 45 Q 50 55 60 45' 
          : 'M 40 45 Q 50 50 60 45'
      case 'sad':
        return 'M 40 55 Q 50 50 60 55'
      case 'surprised':
        return 'M 45 52 Q 50 58 55 52'
      case 'thinking':
        return 'M 40 50 Q 45 52 50 50 Q 55 48 60 50'
      default:
        return mouthOpen && isSpeaking 
          ? 'M 40 48 Q 50 55 60 48' 
          : 'M 40 50 Q 50 52 60 50'
    }
  }

  const eyeExpression = getEyeExpression()
  const avatarScale = 1 + (volume / 400)

  return (
    <div className={`avatar-container ${isConnected ? 'connected' : ''}`}>
      <div 
        className={`avatar ${emotion} ${isSpeaking ? 'speaking' : ''}`}
        style={{ transform: `scale(${avatarScale})` }}
      >
        <svg viewBox="0 0 100 100" className="avatar-svg">
          {/* Head/Circle */}
          <circle 
            cx="50" 
            cy="50" 
            r="45" 
            className="avatar-head"
          />
          
          {/* Eyes */}
          <g className={`eyes ${eyeExpression.eyeClass}`}>
            <circle cx="35" cy="40" r="5" fill="white" className="eye-white" />
            <circle cx="65" cy="40" r="5" fill="white" className="eye-white" />
            <circle cx="35" cy="40" r="3" fill="#333" className="pupil left-pupil" />
            <circle cx="65" cy="40" r="3" fill="#333" className="pupil right-pupil" />
          </g>

          {/* Eyebrows */}
          {emotion === 'sad' && (
            <>
              <path d="M 28 32 Q 35 30 42 32" stroke="#333" strokeWidth="2" fill="none" className="eyebrow" />
              <path d="M 58 32 Q 65 30 72 32" stroke="#333" strokeWidth="2" fill="none" className="eyebrow" />
            </>
          )}
          {emotion === 'surprised' && (
            <>
              <path d="M 28 30 Q 35 28 42 30" stroke="#333" strokeWidth="2" fill="none" className="eyebrow" />
              <path d="M 58 30 Q 65 28 72 30" stroke="#333" strokeWidth="2" fill="none" className="eyebrow" />
            </>
          )}
          {emotion === 'thinking' && (
            <>
              <path d="M 28 33 Q 35 31 42 33" stroke="#333" strokeWidth="2" fill="none" className="eyebrow" />
              <path d="M 58 30 Q 65 28 72 30" stroke="#333" strokeWidth="2" fill="none" className="eyebrow" />
            </>
          )}

          {/* Mouth */}
          <path 
            d={getMouthShape()} 
            stroke="#333" 
            strokeWidth="2.5" 
            fill={mouthOpen && isSpeaking ? '#ff6b6b' : 'none'}
            className="mouth"
          />

          {/* Blush for happy emotion */}
          {emotion === 'happy' && (
            <>
              <circle cx="25" cy="55" r="5" fill="#ffb6c1" opacity="0.6" />
              <circle cx="75" cy="55" r="5" fill="#ffb6c1" opacity="0.6" />
            </>
          )}

          {/* Sound waves when speaking */}
          {isSpeaking && (
            <>
              <path 
                d="M 85 50 Q 88 45 91 50 Q 88 55 85 50" 
                stroke="#667eea" 
                strokeWidth="1.5" 
                fill="none"
                className="sound-wave wave-1"
              />
              <path 
                d="M 90 50 Q 94 43 98 50 Q 94 57 90 50" 
                stroke="#667eea" 
                strokeWidth="1.5" 
                fill="none"
                className="sound-wave wave-2"
              />
            </>
          )}
        </svg>
      </div>
      
      <div className="emotion-label" style={{ 
        background: emotion === 'happy' ? '#d3f9d8' : 
                    emotion === 'sad' ? '#e7f5ff' : 
                    emotion === 'thinking' ? '#fff3bf' : 
                    emotion === 'surprised' ? '#ffe3e3' : 
                    emotion === 'listening' ? '#f3e5ff' : 
                    emotion === 'talking' ? '#e3f2fd' : 
                    'white',
        color: emotion === 'happy' ? '#2b8a3e' : 
               emotion === 'sad' ? '#1971c2' : 
               emotion === 'thinking' ? '#e67700' : 
               emotion === 'surprised' ? '#c92a2a' : 
               emotion === 'listening' ? '#7950f2' : 
               emotion === 'talking' ? '#667eea' : 
               '#495057'
      }}>
        {emotion === 'neutral' && '😐 Neutral'}
        {emotion === 'happy' && '😊 Happy'}
        {emotion === 'sad' && '😢 Sad'}
        {emotion === 'thinking' && '🤔 Thinking'}
        {emotion === 'surprised' && '😮 Surprised'}
        {emotion === 'listening' && '👂 Listening'}
        {emotion === 'talking' && '🗣️ Talking'}
      </div>
    </div>
  )
}

export default Avatar
