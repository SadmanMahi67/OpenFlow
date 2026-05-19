export const GROQ_REFINEMENT_MODEL = 'llama-3.1-8b-instant';
export const DEFAULT_WHISPER_MODEL = 'small.en';
export const WHISPER_BINARY_ARCHIVE_NAME = 'whisper-bin-x64.zip + whisper-bin-Win32.zip';
export const WHISPER_BINARY_DOWNLOAD_URL =
  'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.4/';

export type OfflineModelId = 'small.en';

export type RefinementStyle =
  | 'none'
  | 'casual'
  | 'formal'
  | 'summarised'
  | 'bullet-points'
  | 'email-ready';

export type OverlayStatus =
  | 'hidden'
  | 'idle'
  | 'recording'
  | 'processing'
  | 'done'
  | 'error';

export interface AppSettings {
  groqApiKey: string;
  refinementModel: string;
  defaultStyle: RefinementStyle;
  autoPaste: boolean;
  launchAtStartup: boolean;
  vocabulary: string[];
}

export interface HistoryEntry {
  id: string;
  createdAt: string;
  rawText: string;
  refinedText: string;
  style: RefinementStyle;
  pasted: boolean;
  error?: string;
}

export interface OverlayState {
  visible: boolean;
  status: OverlayStatus;
  message: string;
}

export interface ModelInfo {
  modelId: OfflineModelId;
  label: string;
  absolutePath: string;
  exists: boolean;
  fileName: string;
  downloadUrl: string;
  binaryPath: string;
  binaryExists: boolean;
  binaryArchiveName: string;
  binaryDownloadUrl: string;
  vadModelPath: string;
  vadExists: boolean;
}

export interface BootstrapPayload {
  settings: AppSettings;
  history: HistoryEntry[];
  overlayState: OverlayState;
  modelInfo: ModelInfo;
  version: string;
}

export interface ProcessTranscriptRequest {
  audioBuffer: ArrayBuffer;
  style: RefinementStyle;
}

export interface ProcessTranscriptResponse {
  entry: HistoryEntry;
  refinedText: string;
  pasted: boolean;
  notice?: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  groqApiKey: '',
  refinementModel: GROQ_REFINEMENT_MODEL,
  defaultStyle: 'casual',
  autoPaste: true,
  launchAtStartup: false,
  vocabulary: []
};

export const DEFAULT_OVERLAY_STATE: OverlayState = {
  visible: false,
  status: 'hidden',
  message: ''
};

export const STYLE_OPTIONS: Array<{ value: RefinementStyle; label: string }> = [
  { value: 'casual', label: 'Casual' },
  { value: 'formal', label: 'Formal' },
  { value: 'summarised', label: 'Summarised' },
  { value: 'bullet-points', label: 'Bullet Points' },
  { value: 'email-ready', label: 'Email Ready' },
  { value: 'none', label: 'None (Raw Whisper)' }
];

export const OFFLINE_MODEL_OPTIONS: Array<{
  value: OfflineModelId;
  label: string;
  fileName: string;
  downloadUrl: string;
  diskSize: string;
  memoryUsage: string;
  accuracy: string;
  speed: string;
  recommended?: boolean;
}> = [
  {
    value: 'small.en',
    label: 'Small',
    fileName: 'ggml-small.en.bin',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin?download=true',
    diskSize: '466 MB',
    memoryUsage: '~852 MB',
    accuracy: 'High',
    speed: 'Balanced',
    recommended: true
  }
];
