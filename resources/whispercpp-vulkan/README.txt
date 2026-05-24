This directory contains the custom-built Windows x64 Vulkan whisper.cpp runtime
used by Openflow when the transcription acceleration mode is set to Auto or GPU (Vulkan).

Expected binary path:
resources/whispercpp-vulkan/bin/Release/whisper-cli.exe

Rebuild the runtime with:
npm run runtime:vulkan
