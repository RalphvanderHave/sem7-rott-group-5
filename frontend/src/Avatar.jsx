import { useEffect, useState } from 'react'
import './Avatar.css'

function Avatar({ emotion, isSpeaking, volume, isConnected }) {
  const [mouthFrame, setMouthFrame] = useState(0)
  const [blinkState, setBlinkState] = useState(false)

  // Animate mouth when speaking
  useEffect(() => {
    if (!isSpeaking) {
      setMouthFrame(0)
      return
    }

    const interval = setInterval(() => {
      setMouthFrame(prev => (prev + 1) % 4) // 4 frames for smoother animation
    }, 120) // Faster for more natural speech

    return () => clearInterval(interval)
  }, [isSpeaking])

  // Random blinking for more life-like avatar
  useEffect(() => {
    const blinkInterval = setInterval(() => {
      setBlinkState(true)
      setTimeout(() => setBlinkState(false), 150)
    }, 3000 + Math.random() * 2000)

    return () => clearInterval(blinkInterval)
  }, [])

  // Simple mouth animation for speaking
  const getMouthPath = () => {
    if (isSpeaking) {
      switch (mouthFrame) {
        case 0:
          return 'M52,72 Q60,82 68,72' // Wide open
        case 1:
          return 'M52,74 Q60,78 68,74' // Medium
        case 2:
          return 'M52,72 Q60,82 68,72' // Wide open again
        case 3:
          return 'M52,74 L68,74' // Closed
        default:
          return 'M52,74 Q60,76 68,74'
      }
    }

    // Static mouth based on emotion
    switch (emotion) {
      case 'happy':
        return 'M50,72 Q60,82 70,72' // Smile
      case 'sad':
        return 'M50,77 Q60,72 70,77' // Frown
      case 'angry':
        return 'M50,74 Q55,72 60,74 Q65,76 70,74' // Gritted teeth/snarl
      case 'surprised':
        return 'M54,72 Q60,80 66,72' // Small O
      case 'confused':
        return 'M50,74 Q55,76 60,74 Q65,72 70,74' // Wavy
      default:
        return 'M52,74 Q60,76 68,74' // Gentle smile
    }
  }

  const getMouthFill = () => {
    if (isSpeaking && (mouthFrame === 0 || mouthFrame === 2)) {
      return '#4a5568' // Dark fill when mouth is open
    }
    return 'none'
  }

  const getBearColor = () => {
    // Always brown, regardless of connection or emotion
    return '#8B4513' // Saddle brown
  }

  const getEmotionEmoji = () => {
    switch (emotion) {
      case 'happy': return '🐻😊'
      case 'sad': return '🐻😢'
      case 'angry': return '🐻😠'
      case 'surprised': return '🐻😲'
      case 'confused': return '🐻😕'
      default: return '🐻'
    }
  }

  const getStatusColor = () => {
    if (!isConnected) return '#6b7280'
    if (isSpeaking) return '#ef4444'
    return '#10b981'
  }

  const pulseIntensity = isConnected ? Math.min(volume / 100, 1) : 0

  return (
    <div className="avatar-container">
      <svg
        className="avatar-svg"
        viewBox="0 0 120 120"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="4" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="bearGradient">
            <stop offset="0%" stopColor="#a0522d" />
            <stop offset="50%" stopColor={getBearColor()} />
            <stop offset="100%" stopColor="#6b3410" />
          </radialGradient>
          <radialGradient id="earGradient">
            <stop offset="0%" stopColor="#a0522d" />
            <stop offset="100%" stopColor={getBearColor()} />
          </radialGradient>
          <radialGradient id="snoutGradient">
            <stop offset="0%" stopColor="#fef3c7" />
            <stop offset="100%" stopColor="#fde68a" />
          </radialGradient>
        </defs>

        {/* Left Ear with depth */}
        <ellipse
          cx="35"
          cy="30"
          rx={14 + pulseIntensity * 1}
          ry={15 + pulseIntensity * 1}
          fill="url(#earGradient)"
          filter={isSpeaking ? 'url(#glow)' : 'none'}
          className="bear-ear"
        />
        <ellipse cx="35" cy="32" rx="7" ry="8" fill="#fde68a" opacity="0.7" />

        {/* Right Ear with depth */}
        <ellipse
          cx="85"
          cy="30"
          rx={14 + pulseIntensity * 1}
          ry={15 + pulseIntensity * 1}
          fill="url(#earGradient)"
          filter={isSpeaking ? 'url(#glow)' : 'none'}
          className="bear-ear"
        />
        <ellipse cx="85" cy="32" rx="7" ry="8" fill="#fde68a" opacity="0.7" />

        {/* Head with gradient and fur texture */}
        <circle
          cx="60"
          cy="60"
          r={38 + pulseIntensity * 3}
          fill="url(#bearGradient)"
          filter={isSpeaking ? 'url(#glow)' : 'none'}
          className="avatar-head"
        />

        {/* Fur texture marks */}
        <path
          d="M30,45 Q32,43 34,45"
          stroke="#6b3410"
          strokeWidth="1.5"
          fill="none"
          opacity="0.3"
        />
        <path
          d="M86,45 Q88,43 90,45"
          stroke="#6b3410"
          strokeWidth="1.5"
          fill="none"
          opacity="0.3"
        />
        <path
          d="M25,60 Q27,58 29,60"
          stroke="#6b3410"
          strokeWidth="1.5"
          fill="none"
          opacity="0.3"
        />
        <path
          d="M91,60 Q93,58 95,60"
          stroke="#6b3410"
          strokeWidth="1.5"
          fill="none"
          opacity="0.3"
        />

        {/* Cheek fur tufts */}
        <circle cx="28" cy="58" r="8" fill={getBearColor()} opacity="0.6" />
        <circle cx="92" cy="58" r="8" fill={getBearColor()} opacity="0.6" />

        {/* Snout with gradient and shape */}
        <ellipse
          cx="60"
          cy="70"
          rx="22"
          ry="18"
          fill="url(#snoutGradient)"
          opacity="0.95"
          className="bear-snout"
        />

        {/* Snout shading for depth */}
        <ellipse
          cx="60"
          cy="75"
          rx="18"
          ry="12"
          fill="#fbbf24"
          opacity="0.3"
        />

        {/* Nose with shine */}
        <ellipse
          cx="60"
          cy="66"
          rx="7"
          ry="6"
          fill="#1f2937"
          className="bear-nose"
        />
        <ellipse cx="62" cy="64" rx="2" ry="1.5" fill="#ffffff" opacity="0.6" />

        {/* Nose bridge line */}
        <line
          x1="60"
          y1="72"
          x2="60"
          y2="76"
          stroke="#1f2937"
          strokeWidth="2"
          strokeLinecap="round"
        />

        {/* Left Eye with highlight */}
        <circle 
          cx="45" 
          cy="52" 
          r={blinkState ? "1" : "5"} 
          fill="#1f2937" 
        />
        {!blinkState && (
          <circle cx="46" cy="51" r="1.5" fill="#ffffff" opacity="0.8" />
        )}
        
        {/* Angry stripe on left eye */}
        {emotion === 'angry' && !blinkState && (
          <line 
            x1="42" 
            y1="50" 
            x2="48" 
            y2="54" 
            stroke="#dc2626" 
            strokeWidth="2"
          />
        )}

        {/* Right Eye with highlight */}
        <circle 
          cx="75" 
          cy="52" 
          r={blinkState ? "1" : "5"} 
          fill="#1f2937" 
        />
        {!blinkState && (
          <circle cx="76" cy="51" r="1.5" fill="#ffffff" opacity="0.8" />
        )}

        {/* Angry stripe on right eye */}
        {emotion === 'angry' && !blinkState && (
          <line 
            x1="72" 
            y1="54" 
            x2="78" 
            y2="50" 
            stroke="#dc2626" 
            strokeWidth="2"
          />
        )}

        {/* Angry eyebrows */}
        {emotion === 'angry' && (
          <>
            <line
              x1="38"
              y1="48"
              x2="52"
              y2="50"
              stroke="#1f2937"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <line
              x1="68"
              y1="50"
              x2="82"
              y2="48"
              stroke="#1f2937"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </>
        )}

        {/* Mouth */}
        <path
          d={getMouthPath()}
          stroke="#1f2937"
          strokeWidth="3.5"
          fill={getMouthFill()}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="avatar-mouth"
        />

        {/* Tongue when speaking and mouth open */}
        {isSpeaking && (mouthFrame === 0 || mouthFrame === 2) && (
          <ellipse
            cx="60"
            cy="77"
            rx="5"
            ry="3"
            fill="#ff6b9d"
            opacity="0.7"
          />
        )}

        {/* Emotion-specific details */}
        {emotion === 'happy' && (
          <>
            <circle cx="40" cy="58" r="5" fill="#ff9999" opacity="0.5" />
            <circle cx="80" cy="58" r="5" fill="#ff9999" opacity="0.5" />
          </>
        )}

        {emotion === 'sad' && (
          <>
            <circle cx="43" cy="56" r="2.5" fill="#60a5fa" opacity="0.7" />
            <ellipse cx="43" cy="60" rx="1.5" ry="3" fill="#60a5fa" opacity="0.6" />
            <circle cx="77" cy="56" r="2.5" fill="#60a5fa" opacity="0.7" />
            <ellipse cx="77" cy="60" rx="1.5" ry="3" fill="#60a5fa" opacity="0.6" />
          </>
        )}

        {/* Cartoon anger symbol */}
        {emotion === 'angry' && (
          <g transform="translate(90, 40)">
            <line x1="0" y1="-8" x2="0" y2="8" stroke="#dc2626" strokeWidth="3" strokeLinecap="round" />
            <line x1="-8" y1="0" x2="8" y2="0" stroke="#dc2626" strokeWidth="3" strokeLinecap="round" />
            <line x1="-6" y1="-6" x2="6" y2="6" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="6" y1="-6" x2="-6" y2="6" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" />
          </g>
        )}
      </svg>

      <div className="avatar-emotion-display">
        <span className="emotion-emoji">{getEmotionEmoji()}</span>
        <span className="emotion-text">
          {emotion.charAt(0).toUpperCase() + emotion.slice(1)}
        </span>
      </div>

      {isConnected && (
        <div className="avatar-state-indicator">
          {isSpeaking ? (
            <span className="state-badge speaking">🗣️ Speaking</span>
          ) : (
            <span className="state-badge listening">👂 Listening</span>
          )}
        </div>
      )}

      {!isConnected && (
        <div className="avatar-state-indicator">
          <span className="state-badge disconnected">⚪ Offline</span>
        </div>
      )}
    </div>
  )
}

export default Avatar
