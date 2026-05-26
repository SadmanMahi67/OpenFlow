# Openflow

Openflow is a Windows desktop dictation app that records while the user holds `Ctrl + Win`, transcribes speech offline with Whisper running through `whisper.cpp`, optionally refines the text with a hosted Groq model, and pastes the result back into the active window.

[![Watch the demo](https://img.youtube.com/vi/STxLHoK06Vg/maxresdefault.jpg)](https://www.youtube.com/watch?v=STxLHoK06Vg)

## System Requirements

Openflow is built for Windows only.

- Windows 10 or Windows 11
- 64-bit `x64` PC
- A microphone for recording
- Enough free disk space for the app plus whichever Whisper model you download inside Openflow
- Internet access for optional Groq refinement

## Download

Most users should download Openflow from the GitHub Releases page for this repository instead of running terminal commands.

Download one of these release assets:

- `Openflow Setup 2.0.0.exe` for the installer

After downloading:

1. Install Openflow
2. Launch the app
3. Add your Groq API key in Settings if you want AI refinement
4. Focus any text field
5. Hold `Ctrl + Win`, speak, and release

## Stack

- Electron + React + TypeScript
- `whisper.cpp` Windows runtimes for offline transcription, bundling CPU fallbacks and an optional Vulkan build
- Groq hosted model over HTTPS for text cleanup, defaulting to `llama-3.1-8b-instant`
- Local JSON persistence in the Electron `userData` directory

## Features

- Global hold-to-talk hotkey: `Ctrl + Win`
- Pixel pet companion overlay showing AI status through animated GIFs (idle, running, waiting, jumping, waving)
- Import custom pets from ZIP files or browse pets at codex-pets.net
- Configurable sound feedback — 7 synthesized capture start sounds and 7 paste done sounds, previewable in Settings
- Animated shader background effects (Flowing Gradient, Aurora, Plasma) with preset color schemes and custom color picker
- Offline CPU transcription with Whisper models through `whisper.cpp`
- Downloadable Whisper model management inside the app
- Optional Vulkan acceleration path when a Vulkan runtime is bundled in the build
- Offline local AI refinement with llama.cpp (supports Llama 3.2 3B, Gemma 3 4B, Qwen 2.5 3B)
- Refinement styles: Casual, Formal, Summarised, Bullet Points, Email Ready, None
- Custom Prompt Filters — create and apply custom filters to fine-tune transcriptions
- Configurable hosted Groq model ID in Settings
- Local transcription history storing raw and refined text
- Vocabulary list for names, brands, and domain terms
- Auto-paste into the active Windows application via clipboard + `Ctrl+V`

## Build From Source

If you want to run or package Openflow yourself, use the steps below.

### Development

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Download the Whisper CPU runtimes:

   ```powershell
   npm run model:download
   ```

3. Optional: build the bundled Vulkan runtime:

   ```powershell
   npm run runtime:vulkan
   ```

4. Start the app:

   ```powershell
   npm run build:electron
   npm run dev
   ```

The Electron preload is compiled separately into `dist-electron`, and Vite serves the renderer during development.
The packaged app expects the `x64` Whisper runtime at `resources/whispercpp/bin/Release/whisper-cli.exe`, the compatibility fallback runtime at `resources/whispercpp/bin/Win32/Release/whisper-cli.exe`, the optional Vulkan runtime at `resources/whispercpp-vulkan/bin/Release/whisper-cli.exe`, and any downloaded Whisper model files inside the app's user-data `whisper-models/` directory.

### Packaging

Build an installer and a portable executable:

```powershell
npm run dist
```

Artifacts are emitted into `release/`.

## Notes

- Whisper model files are not bundled with the app package. Users download the models they want from inside Openflow.
- Openflow uses the selected acceleration mode. CPU falls back from the bundled `x64` runtime to the bundled `Win32` runtime if needed, and Auto can prefer a bundled Vulkan runtime when one is present.
- The Vulkan runtime can be built from source with `npm run runtime:vulkan`. Openflow bundles it from `resources/whispercpp-vulkan/` when present.
- Settings and history are stored locally inside Electron's `app.getPath("userData")` directory.
- AI refinement can use a hosted Groq model (default `llama-3.1-8b-instant`) or a local llama.cpp model for completely offline use. Configure the model ID in Settings.
- Sound feedback is synthesized in real time using the Web Audio API — no audio files are bundled or downloaded.
