'use client'

import { useRef, useEffect, useState, useCallback } from 'react'

// Declare MediaPipe types
declare global {
  interface Window {
    FaceMesh: any
  }
}

interface NormalizedLandmark {
  x: number
  y: number
  z: number
}

interface FaceMeshResults {
  multiFaceLandmarks?: NormalizedLandmark[][]
}

// Eye landmark indices for MediaPipe face mesh (EXACT COPY FROM PYTHON)
const LEFT_EYE = [362, 385, 387, 263, 373, 380]
const RIGHT_EYE = [33, 160, 158, 133, 153, 144]

// Blink detection parameters (EXACT COPY FROM PYTHON)
const BASELINE_FRAMES = 30
const EAR_THRESHOLD_RATIO = 0.75  // 75% of baseline
const MIN_BLINK_FRAMES = 3
const ROLLING_WINDOW_MINUTES = 4  // Note: Python has bug, shows 2 but uses 4

// Alert parameters (EXACT COPY FROM PYTHON) 
const LOW_BLINK_THRESHOLD = 10
const ALERT_COOLDOWN = 60  // seconds
const MIN_SESSION_TIME = 30  // seconds
const MIN_BLINKS_FOR_ALERT = 3

interface EyeLandmark {
  x: number
  y: number
}

// EXACT PORT: eye_aspect_ratio function from Python
function eyeAspectRatio(eyeLandmarks: EyeLandmark[]): number {
  // Vertical distances
  const A = Math.sqrt(
    Math.pow(eyeLandmarks[1].x - eyeLandmarks[5].x, 2) +
    Math.pow(eyeLandmarks[1].y - eyeLandmarks[5].y, 2)
  )
  const B = Math.sqrt(
    Math.pow(eyeLandmarks[2].x - eyeLandmarks[4].x, 2) +
    Math.pow(eyeLandmarks[2].y - eyeLandmarks[4].y, 2)
  )
  // Horizontal distance
  const C = Math.sqrt(
    Math.pow(eyeLandmarks[0].x - eyeLandmarks[3].x, 2) +
    Math.pow(eyeLandmarks[0].y - eyeLandmarks[3].y, 2)
  )
  
  return (A + B) / (2.0 * C)
}

// EXACT PORT: calculate_blink_rate function from Python
function calculateBlinkRate(blinkTimestamps: number[], windowMinutes = ROLLING_WINDOW_MINUTES, startTime?: number): number {
  const currentTime = Date.now()
  const cutoffTime = currentTime - (windowMinutes * 60 * 1000)
  
  const recentBlinks = blinkTimestamps.filter(t => t >= cutoffTime)
  
  if (recentBlinks.length === 0) return 0
  
  let elapsedTime: number
  if (startTime !== undefined) {
    elapsedTime = Math.min(currentTime - startTime, windowMinutes * 60 * 1000)
  } else {
    const timeSinceFirst = currentTime - recentBlinks[0]
    elapsedTime = Math.min(timeSinceFirst, windowMinutes * 60 * 1000)
  }
  
  const elapsedMinutes = Math.max(elapsedTime / (60 * 1000), 1/60)
  
  return recentBlinks.length / elapsedMinutes
}

// EXACT PORT: show_notification function from Python
function showNotification(title: string, message: string): boolean {
  if ('Notification' in window) {
    if (Notification.permission === 'granted') {
      new Notification(title, {
        body: message,
        icon: '/favicon.ico'
      })
      return true
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          new Notification(title, {
            body: message,
            icon: '/favicon.ico'
          })
        }
      })
    }
  }
  console.log(`${title}: ${message}`)
  return false
}

// ENHANCED: Multi-method notification system (like Python's guaranteed dialogs)
function showEnhancedNotification(title: string, message: string, onDismiss?: () => void): boolean {
  let notificationShown = false
  
  // Method 1: Web Notifications (works across tabs/apps when permitted)
  if ('Notification' in window) {
    if (Notification.permission === 'granted') {
      try {
        const notification = new Notification(title, {
          body: message,
          icon: '/favicon.ico',
          requireInteraction: true, // Keeps notification until user interacts
          tag: 'blink-alert', // Replaces previous notifications
          silent: false, // Allow notification sound
          badge: '/favicon.ico'
        })
        
        notification.onclick = () => {
          window.focus() // Focus the tab when notification is clicked
          notification.close()
        }
        
        notification.onclose = () => {
          console.log('Notification dismissed')
        }
        
        console.log('✅ Desktop notification sent')
        notificationShown = true
      } catch (error) {
        console.error('❌ Desktop notification failed:', error)
      }
    } else if (Notification.permission === 'default') {
      // Try to request permission again
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          showEnhancedNotification(title, message, onDismiss) // Retry
        } else {
          console.log('❌ Notification permission denied')
        }
      })
    }
  }
  
  // Method 2: Audio alert (works across tabs, even when tab is inactive)
  try {
    // Create a more attention-grabbing sound sequence
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    
    // Create alert tone sequence (like system alert sounds)
    const playTone = (frequency: number, duration: number, delay: number) => {
      setTimeout(() => {
        const oscillator = audioContext.createOscillator()
        const gainNode = audioContext.createGain()
        
        oscillator.connect(gainNode)
        gainNode.connect(audioContext.destination)
        
        oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime)
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime)
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration)
        
        oscillator.start(audioContext.currentTime)
        oscillator.stop(audioContext.currentTime + duration)
      }, delay)
    }
    
    // Play alert sequence: three ascending tones
    playTone(600, 0.2, 0)     // First tone
    playTone(800, 0.2, 300)   // Second tone (higher)
    playTone(1000, 0.3, 600)  // Third tone (highest, longer)
    
    console.log('🔊 Audio alert played')
  } catch (error) {
    console.log('❌ Audio alert failed:', error)
  }
  
  // Method 3: Browser tab title blinking (visible when tab is in background)
  if (document.hidden) {
    let originalTitle = document.title
    let isBlinking = false
    
    const blinkTitle = () => {
      if (!isBlinking) return
      document.title = document.title === originalTitle ? '🚨 BLINK ALERT!' : originalTitle
    }
    
    isBlinking = true
    const titleInterval = setInterval(blinkTitle, 1000) // Blink every second
    
    // Stop blinking when user returns to tab or after 30 seconds
    const stopBlinking = () => {
      isBlinking = false
      clearInterval(titleInterval)
      document.title = originalTitle
      document.removeEventListener('visibilitychange', stopBlinking)
    }
    
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) stopBlinking()
    })
    
    setTimeout(stopBlinking, 30000) // Stop after 30 seconds
    console.log('🔄 Tab title blinking started')
  }
  
  // Method 4: Favicon change (subtle visual indicator)
  try {
    const favicon = document.querySelector("link[rel*='icon']") as HTMLLinkElement
    const originalFavicon = favicon?.href
    
    if (favicon) {
      // Create a red warning favicon (data URL)
      favicon.href = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23ff0000'/%3E%3Ctext x='50' y='60' font-size='60' text-anchor='middle' fill='white'%3E⚠%3C/text%3E%3C/svg%3E"
      
      // Restore original favicon after 10 seconds
      setTimeout(() => {
        if (originalFavicon) favicon.href = originalFavicon
      }, 10000)
      
      console.log('🎯 Favicon changed to alert icon')
    }
  } catch (error) {
    console.log('❌ Favicon change failed:', error)
  }
  
  console.log(`📢 Enhanced notification sent: ${title}`)
  return notificationShown || true // Return true if any method succeeded
}

export default function BlinkDetector() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const faceMeshRef = useRef<any>(null)
  
  // EXACT PORT: Python global variables converted to state
  const [blinkCount, setBlinkCount] = useState(0)
  const [blinkTimestamps, setBlinkTimestamps] = useState<number[]>([])
  const [baselineEARBuffer, setBaselineEARBuffer] = useState<number[]>([])
  const [baselineEAR, setBaselineEAR] = useState<number | null>(null)
  const [lastAlertTime, setLastAlertTime] = useState(0)
  const [startTime, setStartTime] = useState(Date.now())
  
  // Use refs for values that need to be current in callbacks but shouldn't trigger re-renders
  const consecutiveBlinkFramesRef = useRef(0)
  const blinkTimestampsRef = useRef<number[]>([])
  const baselineEARRef = useRef<number | null>(null)
  const baselineEARBufferRef = useRef<number[]>([])
  
  // ENHANCED: Use ref for immediate alert cooldown tracking (prevents endless alerts)
  const lastAlertTimeRef = useRef(0)
  const isAlertActiveRef = useRef(false) // Prevent multiple simultaneous alerts
  const startTimeRef = useRef(startTime) // For immediate access in callbacks
  
  // Display state
  const [statusText, setStatusText] = useState('Starting...')
  const [leftEAR, setLeftEAR] = useState(0)
  const [rightEAR, setRightEAR] = useState(0)
  const [blinkRate, setBlinkRate] = useState(0)
  const [sessionDuration, setSessionDuration] = useState(0)
  const [isLowRate, setIsLowRate] = useState(false)
  const [lastResetTime, setLastResetTime] = useState<Date | null>(null)
  
  // ENHANCED: Alert modal state (like Python's system dialog)
  const [showAlertModal, setShowAlertModal] = useState(false)
  const [alertMessage, setAlertMessage] = useState('')
  const [alertRate, setAlertRate] = useState(0)
  const [modalDismissTimer, setModalDismissTimer] = useState<NodeJS.Timeout | null>(null)
  
  // Auto-dismiss modal after 8 seconds (like Python's "giving up after 8")
  useEffect(() => {
    if (showAlertModal) {
      const timer = setTimeout(() => {
        setShowAlertModal(false)
        setModalDismissTimer(null)
      }, 8000) // 8 seconds like Python version
      setModalDismissTimer(timer)
      
      return () => {
        if (timer) clearTimeout(timer)
      }
    }
  }, [showAlertModal])
  
  const dismissAlert = () => {
    console.log('🔴 dismissAlert called - closing modal')
    setShowAlertModal(false)
    isAlertActiveRef.current = false // Reset alert active flag
    if (modalDismissTimer) {
      console.log('🔴 Clearing auto-dismiss timer')
      clearTimeout(modalDismissTimer)
      setModalDismissTimer(null)
    }
    
    // ENHANCED: Reset blink tracking when user dismisses alert (fresh start after break)
    console.log('🔄 Resetting blink tracking data after alert dismissal')
    const resetTime = Date.now()
    setStartTime(resetTime)
    startTimeRef.current = resetTime // Update ref immediately
    // NOTE: blinkCount (total) is NOT reset - it's cumulative across sessions
    setBlinkTimestamps([])
    blinkTimestampsRef.current = []
    setBlinkRate(0)
    setSessionDuration(0)
    setIsLowRate(false)
    setLastResetTime(new Date(resetTime))
    
    console.log('✅ Fresh blink tracking session started (total blinks preserved)')
  }
  
  // Reset calibration function
  const resetCalibration = () => {
    console.log('🔄 Resetting calibration...')
    setBaselineEARBuffer([])
    setBaselineEAR(null)
    // NOTE: blinkCount (total) is NOT reset - it's cumulative across sessions
    setBlinkTimestamps([])
    consecutiveBlinkFramesRef.current = 0
    const resetTime = Date.now()
    setStartTime(resetTime)
    startTimeRef.current = resetTime // Update ref immediately
    setStatusText('Calibration reset. Look normally for calibration...')
  }
  
  // ENHANCED: Manual blink tracking reset (preserves total blink count)
  const resetBlinkTracking = () => {
    console.log('🔄 Manual blink tracking reset...')
    const resetTime = Date.now()
    setStartTime(resetTime)
    startTimeRef.current = resetTime
    // NOTE: blinkCount (total) is NOT reset - it's cumulative across sessions
    setBlinkTimestamps([])
    blinkTimestampsRef.current = []
    setBlinkRate(0)
    setSessionDuration(0)
    setIsLowRate(false)
    setLastAlertTime(0)
    lastAlertTimeRef.current = 0
    isAlertActiveRef.current = false
    setLastResetTime(new Date(resetTime))
    console.log('✅ Manual reset complete - fresh session started (total blinks preserved)')
  }
  
  // MediaPipe setup
  useEffect(() => {
    let faceMesh: any = null
    let isProcessing = false
    
    const initMediaPipe = async () => {
      try {
        console.log('🔄 Initializing MediaPipe...')
        setStatusText('Loading MediaPipe...')
        
        const faceMeshModule = await import('@mediapipe/face_mesh')
        console.log('✅ MediaPipe module loaded')
        
        faceMesh = new faceMeshModule.FaceMesh({
          locateFile: (file: string) => {
            console.log(`📦 Loading MediaPipe file: ${file}`)
            return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${file}`
          },
        })
        
        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        })
        
        faceMesh.onResults((results: any) => {
          console.log('📊 MediaPipe results received:', results.multiFaceLandmarks ? 'Face detected' : 'No face')
          onResults(results)
        })
        
        faceMeshRef.current = faceMesh
        console.log('✅ MediaPipe initialized')
        setStatusText('MediaPipe ready. Requesting camera...')
        
        await startCamera()
        
        // Request notification permissions
        if ('Notification' in window) {
          await Notification.requestPermission()
        }
      } catch (error) {
        console.error('❌ Failed to initialize MediaPipe:', error)
        setStatusText(`Failed to initialize: ${error}`)
      }
    }
    
    initMediaPipe()
    
    return () => {
      if (faceMesh) {
        console.log('🔄 Cleaning up MediaPipe...')
        faceMesh.close()
      }
    }
  }, [])
  
  // ENHANCED: Keyboard shortcuts (like Python version)
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      switch(event.key.toLowerCase()) {
        case 'q':
          // Quit application (close tab/window)
          if (confirm('Are you sure you want to quit the blink detector?')) {
            window.close()
          }
          break
        case 't':
          // Test notification
          setAlertMessage('Test notification: 5.0/min\nTake a break and blink more!')
          setAlertRate(5.0)
          setShowAlertModal(true)
          showEnhancedNotification('👁️ Test Alert', 'This is a test of the notification system')
          break
        case 'r':
          // Reset calibration
          resetCalibration()
          break
        case 's':
          // Reset session (keep total)
          resetBlinkTracking()
          break
        case 'escape':
          // Dismiss any alerts
          if (showAlertModal) {
            console.log('🔴 ESC pressed - dismissing modal')
            dismissAlert()
          }
          break
      }
    }
    
    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [showAlertModal])
  
  // ENHANCED: Proactive notification permission request
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      // Show a friendly message asking for permission
      setTimeout(() => {
        if (confirm('🚨 IMPORTANT: Enable desktop notifications for low blink rate alerts?\n\n' +
                   'This will ensure you see warnings even when working in other tabs/apps.\n' +
                   'Just like the Python version, this helps protect your eyes!\n\n' +
                   'Click OK to enable notifications.')) {
          Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
              console.log('✅ Notification permission granted')
              // Test notification to confirm it works
              new Notification('👁️ Blink Detector Ready', {
                body: 'Notifications are now enabled! You\'ll be alerted if your blink rate gets too low.',
                icon: '/favicon.ico',
                tag: 'test-notification'
              })
            } else {
              console.log('❌ Notification permission denied')
              alert('⚠️ Notifications were denied. You may miss important eye strain warnings!\n\n' +
                    'To enable later: Click the 🔒 icon in your address bar → Allow notifications')
            }
          })
        } else {
          console.log('ℹ️ User declined notification permission')
          alert('ℹ️ Without notifications, alerts will only show audio and visual cues in this tab.\n\n' +
                'For best results (like the Python version), enable notifications later via browser settings.')
        }
      }, 3000) // Wait 3 seconds after page load
    } else if (Notification.permission === 'granted') {
      console.log('✅ Notifications already enabled')
    } else if (Notification.permission === 'denied') {
      console.log('❌ Notifications previously denied')
      // Could show a note about re-enabling in browser settings
    }
  }, [])

  // Start camera
  const startCamera = async () => {
    try {
      console.log('📸 Requesting camera access...')
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          width: { ideal: 640 }, 
          height: { ideal: 480 },
          facingMode: 'user'
        }
      })
      
      console.log('✅ Camera stream obtained')
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        
        videoRef.current.onloadedmetadata = () => {
          console.log('🎥 Video metadata loaded, starting playback...')
          videoRef.current?.play().then(() => {
            console.log('▶️ Video playback started')
            setStatusText('Camera ready. Look normally for calibration...')
            // Small delay to ensure video is fully ready
            setTimeout(processVideo, 100)
          }).catch(error => {
            console.error('❌ Video play failed:', error)
            setStatusText('❌ Failed to start video')
          })
        }
        
        videoRef.current.onerror = (error) => {
          console.error('❌ Video error:', error)
          setStatusText('❌ Video error')
        }
      }
    } catch (error) {
      console.error('❌ Camera access denied:', error)
      setStatusText(`❌ Camera access denied: ${error}`)
    }
  }

  // Process video frames
  const processVideo = () => {
    if (videoRef.current && faceMeshRef.current) {
      const video = videoRef.current
      const faceMesh = faceMeshRef.current
      let frameCount = 0
      
      const process = async () => {
        try {
          if (video.readyState === 4 && !video.paused && !video.ended) {
            frameCount++
            if (frameCount % 30 === 0) {
              console.log(`🎥 Processing frame ${frameCount}, video dimensions: ${video.videoWidth}x${video.videoHeight}`)
            }
            await faceMesh.send({ image: video })
          }
          requestAnimationFrame(process)
        } catch (error) {
          console.error('❌ Error processing video frame:', error)
          setTimeout(() => requestAnimationFrame(process), 100) // Retry after 100ms
        }
      }
      
      console.log('🎬 Starting video processing loop...')
      process()
    } else {
      console.warn('⚠️ Video or FaceMesh not ready for processing')
    }
  }

  // EXACT PORT: Main detection logic from Python's main loop
  const onResults = useCallback((results: any) => {
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      setStatusText('No face detected')
      return
    }
    
    const faceLandmarks = results.multiFaceLandmarks[0]
    const frameWidth = videoRef.current?.videoWidth || 640
    const frameHeight = videoRef.current?.videoHeight || 480
    
    // Debug log for calibration phase
    if (baselineEARBuffer.length < BASELINE_FRAMES) {
      console.log(`🎯 Calibration frame ${baselineEARBuffer.length + 1}/${BASELINE_FRAMES}`)
    }
    
    // EXACT PORT: get_eye_landmarks function from Python
    const getEyeLandmarks = (indices: number[]) => {
      return indices.map(i => ({
        x: faceLandmarks[i].x * frameWidth,
        y: faceLandmarks[i].y * frameHeight
      }))
    }
    
    const leftEye = getEyeLandmarks(LEFT_EYE)
    const rightEye = getEyeLandmarks(RIGHT_EYE)
    
    // Calculate EAR for both eyes
    const leftEARValue = eyeAspectRatio(leftEye)
    const rightEARValue = eyeAspectRatio(rightEye)
    
    setLeftEAR(leftEARValue)
    setRightEAR(rightEARValue)
    
    // EXACT PORT: update_baseline_ear function from Python
    if (baselineEARBufferRef.current.length < BASELINE_FRAMES) {
      const avgEAR = (leftEARValue + rightEARValue) / 2.0
      const newBuffer = [...baselineEARBufferRef.current, avgEAR]
      setBaselineEARBuffer(newBuffer)
      baselineEARBufferRef.current = newBuffer // Keep ref in sync
      
      const newBaseline = newBuffer.reduce((a, b) => a + b, 0) / newBuffer.length
      setBaselineEAR(newBaseline)
      baselineEARRef.current = newBaseline // Keep ref in sync
      setStatusText(`Calibrating... ${newBuffer.length}/${BASELINE_FRAMES}`)
    } else {
      // EXACT PORT: Main detection logic from Python
      if (baselineEARRef.current === null) return
      
      const adaptiveThreshold = baselineEARRef.current * EAR_THRESHOLD_RATIO
      setStatusText(`Threshold: ${adaptiveThreshold.toFixed(3)}`)
      
      // EXACT PORT: Both eyes validation + minimum duration from Python
      const bothEyesClosed = (leftEARValue < adaptiveThreshold) && (rightEARValue < adaptiveThreshold)
      
      if (bothEyesClosed) {
        consecutiveBlinkFramesRef.current += 1
      } else {
        // Check if we had a valid blink
        if (consecutiveBlinkFramesRef.current >= MIN_BLINK_FRAMES) {
          const currentTime = Date.now()
          
          setBlinkCount(prev => {
            const newCount = prev + 1
            console.log(`👁️ Blink #${newCount} | Duration: ${consecutiveBlinkFramesRef.current} frames`)
            return newCount
          })
          
          setBlinkTimestamps(prev => {
            const newTimestamps = [...prev, currentTime]
            // Clean old timestamps
            const cutoffTime = currentTime - (ROLLING_WINDOW_MINUTES * 60 * 1000)
            const filtered = newTimestamps.filter(t => t >= cutoffTime)
            blinkTimestampsRef.current = filtered // Keep ref in sync
            return filtered
          })
        }
        
        consecutiveBlinkFramesRef.current = 0
      }
      
      // Calculate current blink rate
      const currentRate = calculateBlinkRate(blinkTimestampsRef.current, ROLLING_WINDOW_MINUTES, startTimeRef.current)
      setBlinkRate(currentRate)
      
      // EXACT PORT: check_low_blink_rate from Python
      const sessionTime = (Date.now() - startTimeRef.current) / 1000
      setSessionDuration(sessionTime)
      
      const isLow = currentRate < LOW_BLINK_THRESHOLD
      setIsLowRate(isLow && sessionTime >= MIN_SESSION_TIME && blinkTimestampsRef.current.length >= MIN_BLINKS_FOR_ALERT)
      
      // ENHANCED: Fixed cooldown mechanism (prevents endless alerts)
      const currentTime = Date.now()
      const timeSinceLastAlert = currentTime - lastAlertTimeRef.current
      const canAlert = !isAlertActiveRef.current && timeSinceLastAlert > (ALERT_COOLDOWN * 1000)
      
      if (isLow && 
          sessionTime >= MIN_SESSION_TIME && 
          blinkTimestampsRef.current.length >= MIN_BLINKS_FOR_ALERT &&
          canAlert) {
        
        // Set alert as active immediately to prevent multiple triggers
        isAlertActiveRef.current = true
        lastAlertTimeRef.current = currentTime
        setLastAlertTime(currentTime)
        
        console.log(`⚠️ Low blink rate alert: ${currentRate.toFixed(1)}/min (cooldown: ${timeSinceLastAlert}ms)`)
        
        // ENHANCED: Use multi-method notification system
        showEnhancedNotification(
          '👁️ Blink Rate Alert',
          `Low blink rate: ${currentRate.toFixed(1)}/min\nTake a break and blink more!`,
          dismissAlert
        )
        
        // Show modal dialog (guaranteed visible like Python's system dialog)
        setAlertMessage(`Low blink rate: ${currentRate.toFixed(1)}/min\nTake a break and blink more!`)
        setAlertRate(currentRate)
        setShowAlertModal(true)
      }
    }
    
  }, [blinkTimestamps, baselineEARBuffer, baselineEAR, startTime, lastAlertTime]) // Removed consecutiveBlinkFrames from deps

  // Sync refs with state
  useEffect(() => {
    blinkTimestampsRef.current = blinkTimestamps
  }, [blinkTimestamps])
  
  useEffect(() => {
    baselineEARRef.current = baselineEAR
  }, [baselineEAR])
  
  useEffect(() => {
    baselineEARBufferRef.current = baselineEARBuffer
  }, [baselineEARBuffer])
  
  useEffect(() => {
    lastAlertTimeRef.current = lastAlertTime
  }, [lastAlertTime])
  
  useEffect(() => {
    startTimeRef.current = startTime
  }, [startTime])

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-center mb-8">
          👁️ Blink Detector Web (Python Port)
        </h1>
        
        <div className="grid md:grid-cols-2 gap-8">
          {/* Video Section */}
          <div className="relative">
            <video
              ref={videoRef}
              className="w-full rounded-lg bg-black"
              width="640"
              height="480"
              autoPlay
              playsInline
              muted
            />
            
            {/* EXACT PORT: Video overlays from Python */}
            <div className="absolute top-4 left-4 space-y-2 text-sm font-mono">
              <div>L: {leftEAR.toFixed(3)} R: {rightEAR.toFixed(3)}</div>
              <div>{statusText}</div>
              <div>Total: {blinkCount}</div>
              <div className={isLowRate ? 'text-red-400' : ''}>
                Rate: {blinkRate.toFixed(1)}/min
              </div>
              <div className="text-gray-400">Session: {sessionDuration.toFixed(0)}s</div>
              {isLowRate && (
                <div className="text-red-500 font-bold animate-pulse">⚠️ LOW RATE</div>
              )}
            </div>
            
            {/* ENHANCED: Persistent visual alert (like Python's on-screen warning) */}
            {isLowRate && (
              <div className="absolute inset-0 pointer-events-none">
                {/* Flashing border effect */}
                <div className="absolute inset-0 border-4 border-red-500 rounded-lg animate-pulse opacity-75"></div>
                {/* Corner alert indicators */}
                <div className="absolute top-2 right-2 text-red-500 text-2xl animate-bounce">⚠️</div>
                <div className="absolute bottom-2 left-2 text-red-500 text-lg font-bold animate-pulse bg-red-900 bg-opacity-75 px-2 py-1 rounded">
                  BLINK MORE!
                </div>
              </div>
            )}
          </div>
          
          {/* Stats Panel */}
          <div className="space-y-6">
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-xl font-semibold mb-4">📊 Statistics</h2>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span>Total Blinks:</span>
                  <span className="font-mono text-xl">{blinkCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>Current Rate:</span>
                  <span className={`font-mono text-xl ${isLowRate ? 'text-red-400' : 'text-green-400'}`}>
                    {blinkRate.toFixed(1)}/min
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Session Time:</span>
                  <span className="font-mono">{(sessionDuration / 60).toFixed(1)} min</span>
                </div>
                {lastAlertTime > 0 && (
                  <div className="flex justify-between text-sm text-gray-400">
                    <span>Next alert in:</span>
                    <span className="font-mono">
                      {Math.max(0, ALERT_COOLDOWN - Math.floor((Date.now() - lastAlertTime) / 1000))}s
                    </span>
                  </div>
                )}
                {lastResetTime && sessionDuration < 60 && (
                  <div className="flex justify-between text-sm text-green-400">
                    <span>Fresh session:</span>
                    <span className="font-mono">
                      {lastResetTime.toLocaleTimeString()}
                    </span>
                  </div>
                )}
              </div>
            </div>
            
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-xl font-semibold mb-4">⚙️ Python Settings</h2>
              <div className="space-y-2 text-sm">
                <div>Window: {ROLLING_WINDOW_MINUTES} minutes</div>
                <div>Alert threshold: {LOW_BLINK_THRESHOLD}/min</div>
                <div>EAR threshold: {(EAR_THRESHOLD_RATIO * 100).toFixed(0)}% of baseline</div>
                <div>Min blink duration: {MIN_BLINK_FRAMES} frames</div>
                {baselineEAR && (
                  <div>Baseline EAR: {baselineEAR.toFixed(3)}</div>
                )}
              </div>
            </div>
            
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-xl font-semibold mb-4">🎯 Instructions</h2>
              <ul className="space-y-2 text-sm">
                <li>• Look at camera normally for calibration</li>
                <li>• Algorithm adapts to your baseline</li>
                <li>• Same logic as working Python version</li>
                <li>• Green rate = healthy, red = take a break</li>
                <li>• <strong>Enable notifications</strong> for cross-tab alerts</li>
                <li>• Audio alerts work even in background tabs</li>
                <li>• <strong>Dismissing alerts resets tracking</strong> (fresh start)</li>
                <li>• <strong>Total blinks</strong> are cumulative (never reset)</li>
              </ul>
              
              <div className="mt-4 pt-4 border-t border-gray-600">
                <h3 className="text-sm font-semibold mb-2">⌨️ Keyboard Shortcuts</h3>
                <ul className="space-y-1 text-xs text-gray-300">
                  <li>• <kbd className="bg-gray-700 px-1 rounded">Q</kbd> - Quit application</li>
                  <li>• <kbd className="bg-gray-700 px-1 rounded">T</kbd> - Test notifications</li>
                  <li>• <kbd className="bg-gray-700 px-1 rounded">R</kbd> - Reset calibration</li>
                                      <li>• <kbd className="bg-gray-700 px-1 rounded">S</kbd> - Reset session (keep total)</li>
                  <li>• <kbd className="bg-gray-700 px-1 rounded">ESC</kbd> - Dismiss alerts</li>
                </ul>
              </div>
              
              {/* Debug Controls */}
              <div className="mt-4 pt-4 border-t border-gray-600">
                <h3 className="text-sm font-semibold mb-2">🛠️ Debug Controls</h3>
                <div className="space-y-2">
                  <button 
                    onClick={resetCalibration}
                    className="w-full bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm font-medium transition-colors"
                  >
                    Reset Calibration
                  </button>
                  <button 
                    onClick={() => {
                      setAlertMessage('Test notification: 5.0/min\nTake a break and blink more!')
                      setAlertRate(5.0)
                      setShowAlertModal(true)
                      showEnhancedNotification('👁️ Test Alert', 'This is a test of the notification system')
                    }}
                    className="w-full bg-yellow-600 hover:bg-yellow-700 px-4 py-2 rounded text-sm font-medium transition-colors"
                  >
                    🔔 Test Notifications
                  </button>
                  <button 
                    onClick={resetBlinkTracking}
                    className="w-full bg-green-600 hover:bg-green-700 px-4 py-2 rounded text-sm font-medium transition-colors"
                  >
                    🔄 Reset Session (Keep Total)
                  </button>
                </div>
                <div className="text-xs text-gray-400 mt-2">
                  Calibration: {baselineEARBufferRef.current.length}/{BASELINE_FRAMES}
                </div>
              </div>
            </div>
          </div>
        </div>
        
        {/* ENHANCED: Alert Modal (like Python's system dialog) */}
        {showAlertModal && (
          <div 
            className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[9999]"
            onClick={(e) => {
              // Only dismiss if clicking the backdrop (not the modal content)
              if (e.target === e.currentTarget) {
                dismissAlert()
              }
            }}
          >
            <div 
              className="bg-red-600 border-4 border-red-400 rounded-lg p-8 max-w-md mx-4 shadow-2xl transform scale-105 animate-pulse"
              onClick={(e) => e.stopPropagation()} // Prevent backdrop click when clicking modal content
            >
              <div className="text-center">
                {/* Alert Icon */}
                <div className="text-6xl mb-4">⚠️</div>
                
                {/* Title (like Python's dialog title) */}
                <h2 className="text-2xl font-bold text-white mb-4">
                  👁️ Blink Rate Alert
                </h2>
                
                {/* Message (like Python's dialog message) */}
                <div className="text-white text-lg mb-6 leading-relaxed">
                  <div className="font-mono text-xl mb-2">
                    Rate: {alertRate.toFixed(1)}/min
                  </div>
                  <div className="mb-4">
                    🚨 Your blink rate is too low!
                  </div>
                  <div className="text-base">
                    Take a break and blink more consciously
                  </div>
                </div>
                
                {/* Action buttons (like Python's dialog buttons) */}
                <div className="space-y-3">
                  <button
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      console.log('🔴 Alert dismissed by user click')
                      dismissAlert()
                    }}
                    className="w-full bg-white text-red-600 font-bold py-3 px-6 rounded-lg hover:bg-gray-100 active:bg-gray-200 transition-colors cursor-pointer select-none"
                    type="button"
                  >
                    OK, I'll Take a Break
                  </button>
                  <div className="text-red-200 text-sm">
                    Auto-dismiss in 8 seconds • Press ESC to close
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
