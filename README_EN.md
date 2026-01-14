# 🎬 VideoSync - AI Video Localization Tool

<div align="center">

![VideoSync Logo](asset/logo.png) 

**One-Click Local AI Video Dubbing & Translation Tool**

[中文文档](README.md) | [English](README_EN.md)

</div>

**VideoSync** is a fully automated AI video dubbing tool designed for Windows and Linux. It orchestrates state-of-the-art open-source models into a seamless workflow for "one-click" video localization.

No cloud APIs, no subscription fees. Use your local GPU to perform **ASR (Speech Recognition) -> Text Translation -> Voice Cloning -> Audio-Video Alignment**.

---

## ✨ Features

*   **🎯 Accurate Recognition (ASR)**
    *   Powered by **WhisperX**, featuring accurate VAD (Voice Activity Detection) and Forced Alignment.
    *   Eliminates hallucinations and missing words common in traditional Whisper, with millisecond-level precision.

*   **🗣️ One-Shot Voice Cloning**
    *   Integrated with **MaskGCT** (IndexTTS), requiring no fine-tuning.
    *   Clones source voices instantly using reference audio.
    *   Perfectly preserves tone, emotion, and speech rhythm.

*   **🌏 Powerful LLM (Translation)**
    *   Built-in **Qwen 2.5-7B-Instruct** large language model.
    *   Currently supports high-quality **English <-> Chinese** translation.
    *   Produces natural, subtitle-group quality translations.

*   **⚡ Extreme Optimization**
    *   Unique sequential VRAM management: Unloads LLM during TTS generation and vice versa.
    *   Runs smoothly on consumer-grade GPUs 
*   **🖥️ Modern UI**
    *   Beautiful interface built with Electron + React.
    *   Real-time log monitoring, visual subtitle editing, and instant video preview.

---

## 📸 Screenshots

| Main Interface | 
| :---: |
| ![Main UI](asset/1.png) |
| Subtitle Editor |
| ![Subtitle Edit](asset/2.png) |

---

## 🛠️ Requirements

For optimal performance, we recommend the following hardware:

*   **OS**: Windows 10/11 (x64) or Linux (Preview)
*   **GPU**: NVIDIA GeForce RTX 3060 or better (VRAM ≥ 6GB)
*   **Driver**: NVIDIA Studio/Game Ready Driver (CUDA 11.8+)
*   **Runtime**: Python 3.10+, Node.js 16+ (Required for source execution)

---

## 🚀 Quick Start

### 1. Clone Repository
```bash
git clone https://github.com/TianDongL/VideoSyncMaster.git
cd VideoSyncMaster
```

### 2. Backend Setup
We strongly recommend using Conda to manage environments.

```bash
# Create and activate environment
conda create -n videosync python=3.11
conda activate videosync

# Install core dependencies
pip install -r backend/requirements.txt

# Install PyTorch (Check pytorch.org for your specific CUDA version)
# Example (CUDA 12.1):
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
```

### 3. Frontend Setup
```bash
cd ui
npm install
```

### 4. Download Models
Due to their large size, models are not included in the repo. Please download them and place them in the `models/` directory:

> **Download Sources**: [HuggingFace](https://huggingface.co/) or [ModelScope](https://www.modelscope.cn/).

```text
VideoSync/
  ├── models/
  │   ├── faster-whisper-large-v3-turbo-ct2/  # ASR Model
  │   ├── index-tts/                          # MaskGCT / TTS Model files
  │   │   ├── config.yaml
  │   │   ├── gpt.pth ...
  │   └── Qwen2.5-7B-Instruct/                # LLM Translation Model
```

---

## 📖 Usage

### Option 1: Run from Source (Recommended for Devs/Linux)

1.  **Start Application**:
    Run the following command in the project root. The UI will launch and automatically spawn the python backend:
    ```bash
    npm run dev
    ```

    > **Note**: Ensure your Python environment is correctly set up in `backend/` or valid in system PATH.

2.  *(Optional) Test Backend Manually*:
    To debug the backend independently:
    ```bash
    python backend/main.py --help
    ```

### Option 2: Build Installer (Windows)

To generate an `.exe` installer:

```bash
cd ui
npm run build
```
The installer will be generated in `ui/release/`.



## 🤝 Acknowledgements

This project stands on the shoulders of giants. Special thanks to:

*   [**IndexTTS**](https://github.com/index-tts/index-tts): For the voice cloning support.
*   [**WhisperX**](https://github.com/m-bain/whisperX): For precise alignment and VAD.
*   [**Qwen**](https://github.com/QwenLM/Qwen3): For powerful multilingual capabilities.

If you like this project, please give us a Star 🌟!
PRs and Issues are welcome.

---

## 📜 License

*   ✅ **Non-Commercial**: You are free to copy, modify, and distribute the code for **non-commercial purposes only**.
*   ❌ **No Commercial Use**: Use of this project or its derivatives for commercial gain is strictly prohibited without prior authorization.
*   🔄 **ShareAlike**: If you modify the code, you must distribute your contributions under the same license.

© 2024 VideoSync Team
