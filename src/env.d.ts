/// <reference types="vite/client" />

import type {
  AppSettings,
  BootstrapPayload,
  OverlayState,
  ProcessTranscriptRequest,
  ProcessTranscriptResponse
} from './shared/types';

declare global {
  interface Window {
    voskFlow: {
      getBootstrap: () => Promise<BootstrapPayload>;
      saveSettings: (settings: AppSettings) => Promise<AppSettings>;
      clearHistory: () => Promise<void>;
      copyText: (text: string) => Promise<void>;
      processTranscript: (payload: ProcessTranscriptRequest) => Promise<ProcessTranscriptResponse>;
      openModelsFolder: () => Promise<void>;
      showMainWindow: () => Promise<void>;
      reportCaptureError: (message: string) => Promise<void>;
      reportEmptyCapture: () => Promise<void>;
      onRecordingCommand: (listener: (command: 'start' | 'stop') => void) => () => void;
      onOverlayState: (listener: (state: OverlayState) => void) => () => void;
    };
  }
}

export {};
