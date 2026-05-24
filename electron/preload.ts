import { contextBridge, ipcRenderer } from 'electron';

import type {
  AppSettings,
  BootstrapPayload,
  OverlayState,
  ProcessTranscriptRequest,
  ProcessTranscriptResponse
} from '../src/shared/types';

const api = {
  getBootstrap: () => ipcRenderer.invoke('app:get-bootstrap') as Promise<BootstrapPayload>,
  saveSettings: (settings: AppSettings) =>
    ipcRenderer.invoke('settings:save', settings) as Promise<AppSettings>,
  clearHistory: () => ipcRenderer.invoke('history:clear') as Promise<void>,
  copyText: (text: string) => ipcRenderer.invoke('clipboard:write-text', text) as Promise<void>,
  processTranscript: (payload: ProcessTranscriptRequest) =>
    ipcRenderer.invoke('transcript:process', payload) as Promise<ProcessTranscriptResponse>,
  openModelsFolder: () => ipcRenderer.invoke('app:open-models-folder') as Promise<void>,
  downloadOfflineModel: (modelId: string) =>
    ipcRenderer.invoke('offline-model:download', modelId) as Promise<BootstrapPayload>,
  removeOfflineModel: (modelId: string) =>
    ipcRenderer.invoke('offline-model:remove', modelId) as Promise<BootstrapPayload>,
  openGroqApiKeys: () => ipcRenderer.invoke('app:open-groq-api-keys') as Promise<void>,
  installLocalAiRuntime: () => ipcRenderer.invoke('local-ai:install-runtime') as Promise<BootstrapPayload>,
  installLocalAiModel: () => ipcRenderer.invoke('local-ai:install-model') as Promise<BootstrapPayload>,
  startLocalAi: () => ipcRenderer.invoke('local-ai:start') as Promise<BootstrapPayload>,
  stopLocalAi: () => ipcRenderer.invoke('local-ai:stop') as Promise<BootstrapPayload>,
  refreshLocalAi: () => ipcRenderer.invoke('local-ai:refresh') as Promise<BootstrapPayload>,
  removeLocalAiRuntime: () => ipcRenderer.invoke('cleanup:remove-local-ai-runtime') as Promise<BootstrapPayload>,
  removeLocalAiModels: () => ipcRenderer.invoke('cleanup:remove-local-ai-models') as Promise<BootstrapPayload>,
  resetSettingsAndHistory: () => ipcRenderer.invoke('cleanup:reset-settings-history') as Promise<BootstrapPayload>,
  fullReset: () => ipcRenderer.invoke('cleanup:full-reset') as Promise<BootstrapPayload>,
  showMainWindow: () => ipcRenderer.invoke('app:show-main-window') as Promise<void>,
  reportCaptureError: (message: string) =>
    ipcRenderer.invoke('capture:error', message) as Promise<void>,
  reportEmptyCapture: () => ipcRenderer.invoke('capture:empty') as Promise<void>,
  onRecordingCommand: (listener: (command: 'start' | 'stop') => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, command: 'start' | 'stop') =>
      listener(command);
    ipcRenderer.on('recording:command', wrappedListener);
    return () => ipcRenderer.removeListener('recording:command', wrappedListener);
  },
  onOverlayState: (listener: (state: OverlayState) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: OverlayState) =>
      listener(state);
    ipcRenderer.on('overlay:state', wrappedListener);
    return () => ipcRenderer.removeListener('overlay:state', wrappedListener);
  }
};

contextBridge.exposeInMainWorld('voskFlow', api);
