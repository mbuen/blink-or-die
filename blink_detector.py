#!/usr/bin/env python3

import cv2
import mediapipe as mp
import numpy as np
import time
import subprocess
import platform
from collections import deque
import os

# Suppress MediaPipe/TensorFlow logging for cleaner output
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'  # Suppress TensorFlow info/warnings
import logging
logging.getLogger('mediapipe').setLevel(logging.ERROR)

def show_notification(title, message):
    """Show a system dialog popup (more reliable than notifications)"""
    try:
        if platform.system() == "Darwin":  # macOS
            # Use system dialog - guaranteed to be visible
            subprocess.run([
                "osascript", "-e",
                f'display dialog "{message}" with title "{title}" buttons {{"OK"}} default button "OK" with icon caution giving up after 8'
            ], check=True)
            print("🚨 Alert dialog shown!")
            return True
        else:
            # For other platforms, just print to console
            print(f"🔔 {title}: {message}")
            return True
    except Exception as e:
        print(f"Alert failed: {e}")
        return False

def eye_aspect_ratio(eye_landmarks):
    """Calculate Eye Aspect Ratio (EAR) from eye landmarks"""
    # Vertical distances
    A = np.linalg.norm(np.array(eye_landmarks[1]) - np.array(eye_landmarks[5]))
    B = np.linalg.norm(np.array(eye_landmarks[2]) - np.array(eye_landmarks[4]))
    # Horizontal distance  
    C = np.linalg.norm(np.array(eye_landmarks[0]) - np.array(eye_landmarks[3]))
    
    return (A + B) / (2.0 * C)

def get_eye_landmarks(face_landmarks, eye_indices):
    """Extract eye landmarks from face mesh"""
    return [(int(face_landmarks.landmark[i].x * frame_width), 
             int(face_landmarks.landmark[i].y * frame_height)) for i in eye_indices]

def calculate_blink_rate(blink_timestamps, window_minutes=2, start_time=None):
    """Calculate blinks per minute for the rolling window"""
    current_time = time.time()
    cutoff_time = current_time - (window_minutes * 60)
    
    # Filter timestamps within the window
    recent_blinks = [t for t in blink_timestamps if t >= cutoff_time]
    
    # Calculate rate (blinks per minute)
    if len(recent_blinks) == 0:
        return 0.0
    
    # For proper rolling window: use actual elapsed time (up to window size)
    if start_time is not None:
        # Time since program started, capped at window size
        elapsed_time = min(current_time - start_time, window_minutes * 60)
    else:
        # Fallback: use full window if we have blinks spanning the window
        time_since_first = current_time - recent_blinks[0]
        elapsed_time = min(time_since_first, window_minutes * 60)
    
    elapsed_minutes = max(elapsed_time / 60, 1/60)  # Minimum 1 second
    
    return len(recent_blinks) / elapsed_minutes

def update_baseline_ear(baseline_buffer, left_ear, right_ear):
    """Update baseline EAR for adaptive threshold"""
    avg_ear = (left_ear + right_ear) / 2.0
    baseline_buffer.append(avg_ear)
    return np.mean(baseline_buffer) if len(baseline_buffer) > 0 else avg_ear

def check_low_blink_rate(current_rate, last_alert_time, min_rate_threshold=8, alert_cooldown=60):
    """Check if blink rate is too low and trigger alert if needed"""
    current_time = time.time()
    
    # Only alert if rate is low AND enough time has passed since last alert
    if current_rate < min_rate_threshold and (current_time - last_alert_time) > alert_cooldown:
        # Show notification popup
        success = show_notification(
            "👁️ Blink Rate Alert", 
            f"Low blink rate: {current_rate:.1f}/min\nTake a break and blink more!"
        )
        
        if success:
            print(f"⚠️  LOW BLINK RATE ALERT: {current_rate:.1f}/min - Notification sent!")
        else:
            print(f"⚠️  LOW BLINK RATE: {current_rate:.1f}/min - Consider taking a break!")
        
        return current_time  # Update alert time regardless of notification success
    
    return last_alert_time  # Return unchanged alert time

# MediaPipe setup
mp_face_mesh = mp.solutions.face_mesh
mp_drawing = mp.solutions.drawing_utils

# Eye landmark indices for MediaPipe face mesh
LEFT_EYE = [362, 385, 387, 263, 373, 380]
RIGHT_EYE = [33, 160, 158, 133, 153, 144]

# Improved blink detection parameters
BASELINE_FRAMES = 30  # Frames to establish baseline EAR
EAR_THRESHOLD_RATIO = 0.75  # Threshold as ratio of baseline (adaptive)
MIN_BLINK_FRAMES = 3  # Minimum consecutive frames for valid blink
ROLLING_WINDOW_MINUTES = 4

# Alert parameters (improved)
LOW_BLINK_THRESHOLD = 10
ALERT_COOLDOWN = 60  # Seconds between alerts
MIN_SESSION_TIME = 30  # Minimum seconds before first alert
MIN_BLINKS_FOR_ALERT = 3  # Minimum blinks needed (reduced from 5)

# Initialize variables
frame_counter = 0
blink_counter = 0
blink_timestamps = []
baseline_ear_buffer = deque(maxlen=BASELINE_FRAMES)
baseline_ear = None
consecutive_blink_frames = 0
last_alert_time = 0
start_time = time.time()  # Track program start for accurate rate calculation

# Camera setup
cap = cv2.VideoCapture(0)
if not cap.isOpened():
    print("❌ Camera not accessible. Check permissions.")
    exit()

print("🎥 Blink detector started! Press 'q' to quit.")
print("👁️  Look at the camera normally for calibration...")
print("🎯 Improved accuracy: adaptive threshold + both-eyes + duration validation")
print(f"📊 Tracking blink rate over last {ROLLING_WINDOW_MINUTES} minutes")
print(f"⚠️  Low blink rate alerts when below {LOW_BLINK_THRESHOLD}/min (after {MIN_SESSION_TIME}s)")

with mp_face_mesh.FaceMesh(
    max_num_faces=1,
    refine_landmarks=True,
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5
) as face_mesh:
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
            
        frame_height, frame_width = frame.shape[:2]
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = face_mesh.process(rgb_frame)
        
        if results.multi_face_landmarks:
            face_landmarks = results.multi_face_landmarks[0]
            
            # Get eye landmarks
            left_eye = get_eye_landmarks(face_landmarks, LEFT_EYE)
            right_eye = get_eye_landmarks(face_landmarks, RIGHT_EYE)
            
            # Calculate EAR for both eyes
            left_ear = eye_aspect_ratio(left_eye)
            right_ear = eye_aspect_ratio(right_eye)
            
            # Update baseline EAR (adaptive threshold)
            if len(baseline_ear_buffer) < BASELINE_FRAMES:
                baseline_ear = update_baseline_ear(baseline_ear_buffer, left_ear, right_ear)
                status_text = f"Calibrating... {len(baseline_ear_buffer)}/{BASELINE_FRAMES}"
            else:
                if baseline_ear is None:
                    baseline_ear = np.mean(baseline_ear_buffer)
                
                # Calculate adaptive threshold
                adaptive_threshold = baseline_ear * EAR_THRESHOLD_RATIO
                
                # Both eyes validation + minimum duration
                both_eyes_closed = (left_ear < adaptive_threshold) and (right_ear < adaptive_threshold)
                
                if both_eyes_closed:
                    consecutive_blink_frames += 1
                else:
                    # Check if we had a valid blink (minimum duration met)
                    if consecutive_blink_frames >= MIN_BLINK_FRAMES:
                        blink_counter += 1
                        current_time = time.time()
                        blink_timestamps.append(current_time)
                        
                        # Clean old timestamps (beyond window)
                        cutoff_time = current_time - (ROLLING_WINDOW_MINUTES * 60)
                        blink_timestamps = [t for t in blink_timestamps if t >= cutoff_time]
                        
                        # Calculate rolling blink rate
                        blink_rate = calculate_blink_rate(blink_timestamps, ROLLING_WINDOW_MINUTES, start_time)
                        
                        print(f"👁️  Blink #{blink_counter} | Rate: {blink_rate:.1f}/min | Duration: {consecutive_blink_frames} frames")
                    
                    consecutive_blink_frames = 0
                
                status_text = f"Threshold: {adaptive_threshold:.3f}"
            
            # Calculate current blink rate for display and alerts
            current_blink_rate = calculate_blink_rate(blink_timestamps, ROLLING_WINDOW_MINUTES, start_time)
            
            # Check for low blink rate and trigger alerts
            session_time = time.time() - start_time
            if (len(baseline_ear_buffer) >= BASELINE_FRAMES and 
                len(blink_timestamps) >= MIN_BLINKS_FOR_ALERT and 
                session_time >= MIN_SESSION_TIME):
                last_alert_time = check_low_blink_rate(current_blink_rate, last_alert_time, 
                                                     LOW_BLINK_THRESHOLD, ALERT_COOLDOWN)
            
            # Draw eye landmarks
            for landmark in left_eye + right_eye:
                cv2.circle(frame, landmark, 2, (0, 255, 0), -1)
            
            # Calculate session and window durations for display
            session_duration = time.time() - start_time
            window_duration = min(session_duration, ROLLING_WINDOW_MINUTES * 60)
            
            # Display stats with alert indication
            rate_color = (0, 0, 255) if current_blink_rate < LOW_BLINK_THRESHOLD else (255, 255, 255)
            
            cv2.putText(frame, f"L: {left_ear:.3f} R: {right_ear:.3f}", (10, 30), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
            cv2.putText(frame, status_text, (10, 60), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
            cv2.putText(frame, f"Total: {blink_counter}", (10, 90), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
            cv2.putText(frame, f"Rate: {current_blink_rate:.1f}/min", (10, 120), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, rate_color, 2)
            cv2.putText(frame, f"Session: {session_duration:.0f}s", (10, 150), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 2)
            cv2.putText(frame, f"Window: {window_duration:.0f}s", (10, 180), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 2)
            
            # Show alert status  
            if (current_blink_rate < LOW_BLINK_THRESHOLD and 
                len(blink_timestamps) >= MIN_BLINKS_FOR_ALERT and 
                session_duration >= MIN_SESSION_TIME):
                cv2.putText(frame, "⚠️ LOW RATE", (10, 210), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
        
        cv2.imshow('Blink Detector', frame)
        
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

cap.release()
cv2.destroyAllWindows()

# Final stats
final_blink_rate = calculate_blink_rate(blink_timestamps, ROLLING_WINDOW_MINUTES, start_time)
print(f"🎯 Session complete!")
print(f"📊 Total blinks: {blink_counter}")
print(f"📈 Final rate: {final_blink_rate:.1f} blinks/minute (last {ROLLING_WINDOW_MINUTES}m)")
if baseline_ear:
    print(f"🎚️  Your baseline EAR: {baseline_ear:.3f}, threshold: {baseline_ear * EAR_THRESHOLD_RATIO:.3f}")
if final_blink_rate < LOW_BLINK_THRESHOLD:
    print(f"⚠️  Final rate below {LOW_BLINK_THRESHOLD}/min - Consider more frequent breaks!") 