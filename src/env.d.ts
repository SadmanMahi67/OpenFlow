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
      downloadOfflineModel: (modelId: string) => Promise<BootstrapPayload>;
      removeOfflineModel: (modelId: string) => Promise<BootstrapPayload>;
      openGroqApiKeys: () => Promise<void>;
      installLocalAiRuntime: () => Promise<BootstrapPayload>;
      installLocalAiModel: () => Promise<BootstrapPayload>;
      startLocalAi: () => Promise<BootstrapPayload>;
      stopLocalAi: () => Promise<BootstrapPayload>;
      refreshLocalAi: () => Promise<BootstrapPayload>;
      removeLocalAiRuntime: () => Promise<BootstrapPayload>;
      removeLocalAiModels: () => Promise<BootstrapPayload>;
      resetSettingsAndHistory: () => Promise<BootstrapPayload>;
      fullReset: () => Promise<BootstrapPayload>;
      showMainWindow: () => Promise<void>;
      reportCaptureError: (message: string) => Promise<void>;
      reportEmptyCapture: () => Promise<void>;
      onRecordingCommand: (listener: (command: 'start' | 'stop') => void) => () => void;
      onOverlayState: (listener: (state: OverlayState) => void) => () => void;
    };
  }
}

export {};
