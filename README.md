# Blink or Die

Real-time blink detection using your webcam with **low blink rate alerts**.

## Setup

Install `uv` if you don't have it:
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Create virtual environment and install dependencies:
```bash
uv venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
uv pip install -r requirements.txt
```

## Run

```bash
python blink_detector.py
```

Press `q` to quit.

## Features

- **Real-time blink detection** with adaptive accuracy improvements
- **Rolling 2-minute blink rate** calculation and display
- **Low blink rate alerts** - Get notified when below 8 blinks/min
- **Visual feedback** - Eye landmarks, rates, and warning indicators
- **Personalized thresholds** - Adaptive calibration for your eye shape

## What it does

- Captures live video from your webcam (no storage)
- Detects face landmarks using MediaPipe
- Calculates Eye Aspect Ratio (EAR) to detect blinks accurately
- Shows real-time blink count and rolling rate
- **Sends notification popups** when blink rate is too low (eye strain warning)

**Note**: On macOS, you'll be prompted for camera permissions on first run. 