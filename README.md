# Openflow

Openflow is a Windows desktop dictation app that records while the user holds `Ctrl + Win`, transcribes speech offline with Whisper running through `whisper.cpp`, optionally refines the text with a hosted Google AI model, and pastes the result back into the active window.

## Download

Most users should download Openflow from the GitHub Releases page for this repository instead of running terminal commands.

Download one of these release assets:

- `Openflow Setup 0.1.0.exe` for the installer

After downloading:

1. Install Openflow
2. Launch the app
3. Add your Google AI Studio API key in Settings if you want AI refinement
4. Focus any text field
5. Hold `Ctrl + Win`, speak, and release

## Stack

- Electron + React + TypeScript
- `whisper.cpp` Windows runtimes for offline CPU transcription, bundling both `x64` and `Win32` builds for compatibility
- Google AI Studio hosted model over HTTPS for text cleanup, defaulting to `gemini-3.1-flash-lite`
- Local JSON persistence in the Electron `userData` directory

## Features

- Global hold-to-talk hotkey: `Ctrl + Win`
- Floating click-through overlay for Recording / Processing / Done
- Offline CPU transcription with Whisper models through `whisper.cpp`
- Refinement styles: Casual, Formal, Summarised, Bullet Points, Email Ready, None
- Configurable hosted Google model ID in Settings
- Bundled Whisper `small` model for offline CPU transcription
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

2. Download the Whisper runtimes and default `small.en` model:

   ```powershell
   npm run model:download
   ```

3. Start the app:

   ```powershell
   npm run build:electron
   npm run dev
   ```

The Electron preload is compiled separately into `dist-electron`, and Vite serves the renderer during development.
The packaged app expects the `x64` Whisper runtime at `resources/whispercpp/bin/Release/whisper-cli.exe`, the compatibility fallback runtime at `resources/whispercpp/bin/Win32/Release/whisper-cli.exe`, and Whisper model files inside `resources/whispercpp/models/`.

### Packaging

Build an installer and a portable executable:

```powershell
npm run dist
```

Artifacts are emitted into `release/`.

## Notes

- Whisper model files are intentionally not committed to the repo because they are large.
- Openflow prefers the bundled `x64` Whisper runtime first and automatically falls back to the bundled `Win32` runtime if the first binary is incompatible with the current machine.
- Settings and history are stored locally inside Electron's `app.getPath("userData")` directory.
- AI refinement requires a Google AI Studio API key. If the key is missing, Openflow falls back to raw transcription text.
- The default hosted model is `gemini-3.1-flash-lite`, but you can change the model ID in Settings.
