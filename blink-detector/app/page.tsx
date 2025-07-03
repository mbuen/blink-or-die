'use client'

import { useRef, useEffect, useState } from 'react'

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
const DEFAULT_LOW_BLINK_THRESHOLD = 10
const ALERT_COOLDOWN = 5  // seconds
const MIN_SESSION_TIME = 0  // seconds
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
  const faceMeshRef = useRef<any>(null)
  
  // EXACT PORT: Python global variables converted to state
  const [blinkCount, setBlinkCount] = useState(0)
  const [blinkTimestamps, setBlinkTimestamps] = useState<number[]>([])
  const [baselineEARBuffer, setBaselineEARBuffer] = useState<number[]>([])
  const [baselineEAR, setBaselineEAR] = useState<number | null>(null)
  const [lastAlertTime, setLastAlertTime] = useState(0)
  const [startTime, setStartTime] = useState(Date.now())
  
  // Configurable alert threshold
  const [lowBlinkThreshold, setLowBlinkThreshold] = useState(DEFAULT_LOW_BLINK_THRESHOLD)
  
  // Use refs for values that need to be current in callbacks but shouldn't trigger re-renders
  const consecutiveBlinkFramesRef = useRef(0)
  const blinkTimestampsRef = useRef<number[]>([])
  const baselineEARRef = useRef<number | null>(null)
  const baselineEARBufferRef = useRef<number[]>([])
  
  // ENHANCED: Use ref for immediate alert cooldown tracking (prevents endless alerts)
  const lastAlertTimeRef = useRef(0)
  const isAlertActiveRef = useRef(false) // Prevent multiple simultaneous alerts
  const startTimeRef = useRef(startTime) // For immediate access in callbacks
  
  // Use ref for onResults function so MediaPipe always calls the latest version
  const onResultsRef = useRef<((results: any) => void) | null>(null)
  

  
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
    let cleanupProcessing: (() => void) | null = null
    
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
          // console.log('📊 MediaPipe results received:', results.multiFaceLandmarks ? 'Face detected' : 'No face')
          if (onResultsRef.current) {
            onResultsRef.current(results)
          }
        })
        
        faceMeshRef.current = faceMesh
        console.log('✅ MediaPipe initialized')
        setStatusText('MediaPipe ready. Requesting camera...')
        
        await startCamera()
        
        // Start video processing and get cleanup function
        cleanupProcessing = processVideo() || (() => {})
        
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
      console.log('🔄 Cleaning up MediaPipe and processing...')
      
      // Stop video processing first
      if (cleanupProcessing) {
        cleanupProcessing()
      }
      
      // Close MediaPipe
      if (faceMesh) {
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
  
  // ENHANCED: Tab visibility monitoring for debugging background processing
  useEffect(() => {
    let visibilityLogInterval: NodeJS.Timeout | null = null
    let lastProcessingTime = Date.now()
    let processingFrameCount = 0
    
    const handleVisibilityChange = () => {
      const now = Date.now()
      const isHidden = document.hidden
      
      console.log(`🔄 TAB VISIBILITY CHANGED: ${isHidden ? 'HIDDEN' : 'VISIBLE'} at ${new Date(now).toLocaleTimeString()}`)
      
      if (isHidden) {
        console.log('⚠️ Tab is now hidden - starting background monitoring...')
        
        // Start periodic logging to see if processing continues
        visibilityLogInterval = setInterval(() => {
          const video = videoRef.current
          const timeSinceLastProcessing = Date.now() - lastProcessingTime
          
          console.log(`🕐 BACKGROUND CHECK: ${new Date().toLocaleTimeString()}`)
          console.log(`  📹 Video state: readyState=${video?.readyState}, paused=${video?.paused}, ended=${video?.ended}`)
          console.log(`  🎬 Last processing: ${timeSinceLastProcessing}ms ago`)
          console.log(`  📊 Processing frames since hidden: ${processingFrameCount}`)
          console.log(`  📱 Document hidden: ${document.hidden}`)
          
          processingFrameCount = 0 // Reset counter
        }, 2000) // Check every 2 seconds
        
      } else {
        console.log('✅ Tab is now visible - stopping background monitoring')
        if (visibilityLogInterval) {
          clearInterval(visibilityLogInterval)
          visibilityLogInterval = null
        }
      }
    }
    
    // Monitor processing activity
    const trackProcessing = () => {
      lastProcessingTime = Date.now()
      if (document.hidden) {
        processingFrameCount++
      }
    }
    
    // Expose tracking function globally so processVideo can call it
    (window as any).trackProcessing = trackProcessing
    
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    // Initial log
    console.log(`🔍 VISIBILITY MONITORING STARTED: Tab is ${document.hidden ? 'HIDDEN' : 'VISIBLE'}`)
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (visibilityLogInterval) {
        clearInterval(visibilityLogInterval)
      }
      delete (window as any).trackProcessing
    }
  }, [])
  
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
          // console.log('🎥 Video metadata loaded, starting playback...')
          videoRef.current?.play().then(() => {
            // console.log('▶️ Video playback started')
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
      let lastLogTime = Date.now()
      let processingInterval: NodeJS.Timeout | null = null
      
      const process = async () => {
        try {
          // Track processing activity for visibility monitoring
          if ((window as any).trackProcessing) {
            (window as any).trackProcessing()
          }
          
          const now = Date.now()
          const isHidden = document.hidden
          
          // Enhanced logging every 30 frames OR every 5 seconds when hidden
          const shouldLog = (frameCount % 30 === 0) || (isHidden && now - lastLogTime > 5000)
          
          if (shouldLog) {
            console.log(`🎥 PROCESSING LOOP: Frame ${frameCount}, Hidden=${isHidden}, Video=${video.readyState}/${video.paused}/${video.ended}`)
            if (isHidden) {
              console.log(`  🔍 Background processing active: ${now - lastLogTime}ms since last log`)
              lastLogTime = now
            }
          }
          
          if (video.readyState === 4 && !video.paused && !video.ended) {
            frameCount++
            
            // ENHANCED: Track video frame freshness when hidden
            if (isHidden) {
              const videoCurrentTime = video.currentTime
              const videoTimeKey = `lastVideoTime_${video.src || 'default'}`
              const lastVideoTime = (window as any)[videoTimeKey] || 0
              
              if (frameCount % 10 === 0) {
                const videoFreshness = videoCurrentTime - lastVideoTime
                console.log(`  📹 VIDEO FRAME CHECK: currentTime=${videoCurrentTime.toFixed(3)}s, freshness=${videoFreshness.toFixed(3)}s`)
                console.log(`  📤 Sending frame ${frameCount} to MediaPipe while hidden`)
                
                // Track MediaPipe processing time
                const mediaPipeStart = Date.now()
                try {
                  await faceMesh.send({ image: video })
                  const mediaPipeTime = Date.now() - mediaPipeStart
                  console.log(`  ⚡ MediaPipe processing time: ${mediaPipeTime}ms`)
                } catch (mediaPipeError) {
                  console.error(`  💥 MediaPipe send failed:`, mediaPipeError)
                  // Continue processing even if MediaPipe fails
                }
              } else {
                try {
                  await faceMesh.send({ image: video })
                } catch (mediaPipeError) {
                  console.error(`  💥 MediaPipe send failed (frame ${frameCount}):`, mediaPipeError)
                  // Continue processing even if MediaPipe fails
                }
              }
              
              (window as any)[videoTimeKey] = videoCurrentTime
            } else {
              try {
                await faceMesh.send({ image: video })
              } catch (mediaPipeError) {
                console.error(`💥 MediaPipe send failed (visible mode):`, mediaPipeError)
                // Continue processing even if MediaPipe fails
              }
            }
          } else {
            if (isHidden && shouldLog) {
              console.log(`  ⚠️ Video not ready while hidden: readyState=${video.readyState}, paused=${video.paused}, ended=${video.ended}`)
            }
          }
        } catch (error) {
          console.error('❌ Error processing video frame:', error)
          if (document.hidden) {
            console.error('  🔍 Error occurred while tab was hidden')
          }
        }
      }
      
      // ENHANCED: Use setInterval instead of requestAnimationFrame for background processing
      const startProcessing = () => {
        if (processingInterval) {
          clearInterval(processingInterval)
        }
        
        // Consistent frame rate regardless of visibility
        const targetInterval = 1000 / 30 // 33ms for 30fps
        
        let lastFrameTime = Date.now()
        let actualIntervals: number[] = []
        let isProcessing = false // Prevent concurrent MediaPipe calls
        
        console.log(`🎬 Starting video processing with setInterval (${targetInterval}ms)...`)
        
        // Use setInterval instead of recursive setTimeout
        processingInterval = setInterval(async () => {
          // Skip if previous processing is still running
          if (isProcessing) {
            if (document.hidden && frameCount % 30 === 0) {
              console.log(`⚠️ Skipping frame - MediaPipe still processing previous frame`)
            }
            return
          }
          
          isProcessing = true
          
          try {
            const now = Date.now()
            const actualInterval = now - lastFrameTime
            lastFrameTime = now
            
            // Track actual intervals when hidden to detect throttling
            if (document.hidden) {
              actualIntervals.push(actualInterval)
              if (actualIntervals.length > 10) actualIntervals.shift() // Keep last 10
              
              // Log throttling detection every 20 frames when hidden
              if (actualIntervals.length >= 5 && frameCount % 20 === 0) {
                const avgInterval = actualIntervals.reduce((a, b) => a + b, 0) / actualIntervals.length
                console.log(`⏱️ SETINTERVAL CHECK: Target=${targetInterval}ms, Actual=${avgInterval.toFixed(1)}ms (${(1000/avgInterval).toFixed(1)}fps)`)
              }
            }
            
            await process()
          } catch (error) {
            console.error('❌ Error in setInterval processing:', error)
          } finally {
            isProcessing = false
          }
        }, targetInterval)
      }
      
      // Monitor visibility changes (maintaining consistent performance)
      const handleVisibilityChange = () => {
        const isHidden = document.hidden
        console.log(`🔄 PROCESSING: Visibility changed to ${isHidden ? 'HIDDEN' : 'VISIBLE'} - restarting setInterval`)
        
        // Restart setInterval to ensure consistency
        startProcessing()
      }
      
      document.addEventListener('visibilitychange', handleVisibilityChange)
      startProcessing()
      
      // Cleanup function
      return () => {
        if (processingInterval) {
          clearInterval(processingInterval)
        }
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
    } else {
      console.warn('⚠️ Video or FaceMesh not ready for processing')
      // Return empty cleanup function
      return () => {}
    }
  }

  // EXACT PORT: Main detection logic from Python's main loop
  const onResults = (results: any) => {
    const isHidden = document.hidden
    const now = Date.now()
    
    // ENHANCED: Track MediaPipe result frequency when hidden
    if (isHidden) {
      const resultsTimeKey = 'lastResultsTime'
      const lastResultsTime = (window as any)[resultsTimeKey] || 0
      const timeSinceLastResult = now - lastResultsTime
      
      // Log every result when hidden (for the first 20), then sample
      const resultCount = ((window as any).hiddenResultCount || 0) + 1
      ;(window as any).hiddenResultCount = resultCount
      
      if (resultCount <= 20 || resultCount % 10 === 0) {
        console.log(`📊 MEDIAPIPE RESULT #${resultCount} while hidden: ${results.multiFaceLandmarks ? 'Face detected' : 'No face'}, ${timeSinceLastResult}ms since last`)
      }
      
      (window as any)[resultsTimeKey] = now
    } else {
      // Reset counter when visible
      ;(window as any).hiddenResultCount = 0
    }
    
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      setStatusText('No face detected')
      return
    }
    
    const faceLandmarks = results.multiFaceLandmarks[0]
    const frameWidth = videoRef.current?.videoWidth || 640
    const frameHeight = videoRef.current?.videoHeight || 480
  
    
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
      
      // Log calibration progress when hidden
      if (isHidden) {
        console.log(`📏 CALIBRATION while hidden: ${newBuffer.length}/${BASELINE_FRAMES}`)
      }
    } else {
      // EXACT PORT: Main detection logic from Python
      if (baselineEARRef.current === null) return
      
      const adaptiveThreshold = baselineEARRef.current * EAR_THRESHOLD_RATIO
      setStatusText(`Threshold: ${adaptiveThreshold.toFixed(3)}`)
      
      // EXACT PORT: Both eyes validation + minimum duration from Python
      const bothEyesClosed = (leftEARValue < adaptiveThreshold) && (rightEARValue < adaptiveThreshold)
      
      if (bothEyesClosed) {
        consecutiveBlinkFramesRef.current += 1
        
        // Log blink detection when hidden
        if (isHidden && consecutiveBlinkFramesRef.current === 1) {
          console.log(`👁️ BLINK START detected while hidden: frames=${consecutiveBlinkFramesRef.current}`)
        }
      } else {
        // Check if we had a valid blink
        if (consecutiveBlinkFramesRef.current >= MIN_BLINK_FRAMES) {
          const currentTime = Date.now()
          
          setBlinkCount(prev => {
            const newCount = prev + 1
            console.log(`👁️ Blink #${newCount} | Duration: ${consecutiveBlinkFramesRef.current} frames${isHidden ? ' (WHILE HIDDEN)' : ''}`)
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
      
      const isLow = currentRate < lowBlinkThreshold
      setIsLowRate(isLow && sessionTime >= MIN_SESSION_TIME && blinkTimestampsRef.current.length >= MIN_BLINKS_FOR_ALERT)
      
      // Debug logging every 5 seconds to show threshold is active
      if (Math.floor(sessionTime) % 5 === 0 && Math.floor(sessionTime * 10) % 50 === 0) {
        console.log(`🔍 Detection: Rate=${currentRate.toFixed(1)}/min, Threshold=${lowBlinkThreshold}/min, IsLow=${isLow}${isHidden ? ' (HIDDEN)' : ''}`)
      }
      
      // ENHANCED: Fixed cooldown mechanism (prevents endless alerts)
      const currentTime = Date.now()
      const timeSinceLastAlert = currentTime - lastAlertTimeRef.current
      const canAlert = !isAlertActiveRef.current && timeSinceLastAlert > (ALERT_COOLDOWN * 1000)
      
      // Debug: Log alert conditions every time they're checked
      // if (sessionTime >= MIN_SESSION_TIME && blinkTimestampsRef.current.length >= MIN_BLINKS_FOR_ALERT) {
      //   console.log(`🔍 Alert Check: Rate=${currentRate.toFixed(1)}, Threshold=${lowBlinkThreshold}, IsLow=${isLow}, CanAlert=${canAlert}, TimeSinceAlert=${timeSinceLastAlert}ms`)
      //   console.log(`💡 Direct threshold access: ${lowBlinkThreshold} (should match slider)`)
      // }
      
      if (isLow && 
          sessionTime >= MIN_SESSION_TIME && 
          blinkTimestampsRef.current.length >= MIN_BLINKS_FOR_ALERT &&
          canAlert) {
        
        // Set alert as active immediately to prevent multiple triggers
        isAlertActiveRef.current = true
        lastAlertTimeRef.current = currentTime
        setLastAlertTime(currentTime)
        
        console.log(`⚠️ LOW BLINK RATE ALERT FIRED: Rate=${currentRate.toFixed(1)}/min vs Threshold=${lowBlinkThreshold}/min${isHidden ? ' (WHILE HIDDEN)' : ''}`)
        
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
  }
  
  // Store the current onResults function in the ref
  onResultsRef.current = onResults
  // console.log(`🔄 onResults ref updated with threshold: ${lowBlinkThreshold}`)

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
          👁️ Blink or Die
        </h1>
        
                {/* Video Section - Full Width Centered */}
        <div className="flex justify-center mb-8">
          <div className="relative max-w-4xl w-full">
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
              {/* <div>L: {leftEAR.toFixed(3)} R: {rightEAR.toFixed(3)}</div> */}
              {/* <div>{statusText}</div> */}
              <div>Total: {blinkCount}</div>
              <div className={isLowRate ? 'text-red-400' : ''}>
                Rate: {blinkRate.toFixed(1)}/min
              </div>
              {/* <div className="text-gray-400">Session: {sessionDuration.toFixed(0)}s</div> */}
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
        </div>
        
        {/* Control Panel - Below Video */}
        <div className="max-w-2xl mx-auto">
          <div className="bg-gray-800 p-6 rounded-lg">
            <h2 className="text-xl font-semibold mb-4">⚙️ Target Blink Rate</h2>
            
            {/* Configurable Alert Threshold */}
            <div className="mb-6">
              <label className="block text-sm font-medium mb-3">
                🚨 Alert Threshold: <span className="text-lg font-mono text-yellow-400">{lowBlinkThreshold}</span> blinks/min
              </label>
              <input
                type="range"
                min="5"
                max="25"
                step="1"
                value={lowBlinkThreshold}
                onChange={(e) => {
                  const newValue = Number(e.target.value)
                  console.log(`🎚️ Slider changed: ${lowBlinkThreshold} → ${newValue} (onResults ref will be updated on next render)`)
                  setLowBlinkThreshold(newValue)
                }}
                className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer slider"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>5-8/min<br/>(Focused Tasks)</span>
                <span>15-20/min<br/>(Normal Rate)</span>
                <span>25/min</span>
              </div>
            </div>
            
            {/* Debug Controls */}
            <div className="mt-4 pt-4 border-t border-gray-600">
              <h3 className="text-sm font-semibold mb-2">🛠️ Debug Controls</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button 
                  onClick={resetCalibration}
                  className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm font-medium transition-colors"
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
                  className="bg-yellow-600 hover:bg-yellow-700 px-4 py-2 rounded text-sm font-medium transition-colors"
                >
                  🔔 Test Notifications
                </button>
                <button 
                  onClick={resetBlinkTracking}
                  className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded text-sm font-medium transition-colors"
                >
                  🔄 Reset Session
                </button>
              </div>
              <div className="text-xs text-gray-400 mt-2 text-center">
                Calibration: {baselineEARBufferRef.current.length}/{BASELINE_FRAMES}
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
