export const GROQ_REFINEMENT_MODEL = 'llama-3.1-8b-instant';
export const LOCAL_REFINEMENT_MODEL = 'Llama-3.2-3B-Instruct-Q4_K_M.gguf';
export const LOCAL_REFINEMENT_MODEL_LABEL = 'Llama 3.2 3B Instruct Q4_K_M';
export const LOCAL_REFINEMENT_MODEL_DOWNLOAD_URL =
  'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf?download=true';
export const LOCAL_REFINEMENT_RUNTIME_RELEASE = 'b9060';
export const LOCAL_REFINEMENT_RUNTIME_ARCHIVE_NAME = 'latest win-cpu-x64 / win-avx2-x64 asset';
export const LOCAL_REFINEMENT_RUNTIME_DOWNLOAD_URL =
  'https://github.com/ggml-org/llama.cpp/releases/latest';
export const GROQ_API_KEYS_URL = 'https://console.groq.com/keys';
export const DEFAULT_WHISPER_MODEL = 'small.en';
export const WHISPER_BINARY_ARCHIVE_NAME = 'whisper-bin-x64.zip + whisper-bin-Win32.zip';
export const WHISPER_BINARY_DOWNLOAD_URL =
  'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.4/';

export type OfflineModelId =
  | 'small.en'
  | 'medium.en'
  | 'large-v3-turbo-q5_0'
  | 'large-v3-turbo'
  | 'large-v3'
  | 'large-v3-q5_0'
  | 'large-v3-turbo-q8_0';
export type AccelerationMode = 'auto' | 'cpu' | 'vulkan';
export type TranscriptionBackendId = 'vulkan' | 'cpu-x64' | 'cpu-win32' | 'none';
export type RefinementMode = 'groq' | 'local';
export type LocalAiDownloadTarget = 'runtime' | 'model';
export type LocalAiDownloadPhase = 'downloading' | 'extracting';

export const WHISPER_SUPPORTED_LANGUAGES: { code: string; name: string }[] = [
  { code: 'af', name: 'Afrikaans' }, { code: 'am', name: 'Amharic' }, { code: 'ar', name: 'Arabic' },
  { code: 'as', name: 'Assamese' }, { code: 'az', name: 'Azerbaijani' }, { code: 'ba', name: 'Bashkir' },
  { code: 'be', name: 'Belarusian' }, { code: 'bg', name: 'Bulgarian' }, { code: 'bn', name: 'Bengali' },
  { code: 'bo', name: 'Tibetan' }, { code: 'br', name: 'Breton' }, { code: 'bs', name: 'Bosnian' },
  { code: 'ca', name: 'Catalan' }, { code: 'cs', name: 'Czech' }, { code: 'cy', name: 'Welsh' },
  { code: 'da', name: 'Danish' }, { code: 'de', name: 'German' }, { code: 'el', name: 'Greek' },
  { code: 'en', name: 'English' }, { code: 'es', name: 'Spanish' }, { code: 'et', name: 'Estonian' },
  { code: 'eu', name: 'Basque' }, { code: 'fa', name: 'Persian' }, { code: 'fi', name: 'Finnish' },
  { code: 'fo', name: 'Faroese' }, { code: 'fr', name: 'French' }, { code: 'gl', name: 'Galician' },
  { code: 'gu', name: 'Gujarati' }, { code: 'ha', name: 'Hausa' }, { code: 'he', name: 'Hebrew' },
  { code: 'hi', name: 'Hindi' }, { code: 'hr', name: 'Croatian' }, { code: 'ht', name: 'Haitian Creole' },
  { code: 'hu', name: 'Hungarian' }, { code: 'hy', name: 'Armenian' }, { code: 'id', name: 'Indonesian' },
  { code: 'is', name: 'Icelandic' }, { code: 'it', name: 'Italian' }, { code: 'ja', name: 'Japanese' },
  { code: 'jw', name: 'Javanese' }, { code: 'ka', name: 'Georgian' }, { code: 'kk', name: 'Kazakh' },
  { code: 'km', name: 'Khmer' }, { code: 'kn', name: 'Kannada' }, { code: 'ko', name: 'Korean' },
  { code: 'ku', name: 'Kurdish' }, { code: 'ky', name: 'Kyrgyz' }, { code: 'la', name: 'Latin' },
  { code: 'lb', name: 'Luxembourgish' }, { code: 'lo', name: 'Lao' }, { code: 'lt', name: 'Lithuanian' },
  { code: 'lv', name: 'Latvian' }, { code: 'mg', name: 'Malagasy' }, { code: 'mk', name: 'Macedonian' },
  { code: 'ml', name: 'Malayalam' }, { code: 'mn', name: 'Mongolian' }, { code: 'mr', name: 'Marathi' },
  { code: 'ms', name: 'Malay' }, { code: 'mt', name: 'Maltese' }, { code: 'my', name: 'Myanmar' },
  { code: 'ne', name: 'Nepali' }, { code: 'nl', name: 'Dutch' }, { code: 'nn', name: 'Norwegian Nynorsk' },
  { code: 'no', name: 'Norwegian' }, { code: 'oc', name: 'Occitan' }, { code: 'pa', name: 'Punjabi' },
  { code: 'pl', name: 'Polish' }, { code: 'ps', name: 'Pashto' }, { code: 'pt', name: 'Portuguese' },
  { code: 'ro', name: 'Romanian' }, { code: 'ru', name: 'Russian' }, { code: 'sa', name: 'Sanskrit' },
  { code: 'sd', name: 'Sindhi' }, { code: 'si', name: 'Sinhala' }, { code: 'sk', name: 'Slovak' },
  { code: 'sl', name: 'Slovenian' }, { code: 'sn', name: 'Shona' }, { code: 'so', name: 'Somali' },
  { code: 'sq', name: 'Albanian' }, { code: 'sr', name: 'Serbian' }, { code: 'su', name: 'Sundanese' },
  { code: 'sv', name: 'Swedish' }, { code: 'sw', name: 'Swahili' }, { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' }, { code: 'tg', name: 'Tajik' }, { code: 'th', name: 'Thai' },
  { code: 'tk', name: 'Turkmen' }, { code: 'tl', name: 'Tagalog' }, { code: 'tr', name: 'Turkish' },
  { code: 'tt', name: 'Tatar' }, { code: 'uk', name: 'Ukrainian' }, { code: 'ur', name: 'Urdu' },
  { code: 'uz', name: 'Uzbek' }, { code: 'vi', name: 'Vietnamese' }, { code: 'yi', name: 'Yiddish' },
  { code: 'yo', name: 'Yoruba' }, { code: 'zh', name: 'Chinese' },
];

export type BuiltInRefinementStyle =
  | 'none'
  | 'casual'
  | 'formal'
  | 'summarised'
  | 'bullet-points'
  | 'email-ready';
export type RefinementStyle = string;

export type OverlayStatus =
  | 'hidden'
  | 'idle'
  | 'recording'
  | 'processing'
  | 'done'
  | 'error';

export type PetAnimation = 'idle' | 'running' | 'running-left' | 'running-right' | 'waiting' | 'jumping' | 'review' | 'failed' | 'waving';

export interface PetDefinition {
  id: string;
  displayName: string;
  builtIn?: boolean;
}

export type CaptureSoundId = 'none' | 'pop' | 'click' | 'rising' | 'blip' | 'tap' | 'whoosh' | 'pulse';
export type PasteSoundId = 'none' | 'chime' | 'ding' | 'ascend' | 'descend' | 'sparkle' | 'chord' | 'confirm';

export const CAPTURE_SOUND_OPTIONS: { id: CaptureSoundId; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'pop', label: 'Pop' },
  { id: 'click', label: 'Click' },
  { id: 'rising', label: 'Rising' },
  { id: 'blip', label: 'Blip' },
  { id: 'tap', label: 'Tap' },
  { id: 'whoosh', label: 'Whoosh' },
  { id: 'pulse', label: 'Pulse' },
];

export const PASTE_SOUND_OPTIONS: { id: PasteSoundId; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'chime', label: 'Chime' },
  { id: 'ding', label: 'Ding' },
  { id: 'ascend', label: 'Ascend' },
  { id: 'descend', label: 'Descend' },
  { id: 'sparkle', label: 'Sparkle' },
  { id: 'chord', label: 'Chord' },
  { id: 'confirm', label: 'Confirm' },
];

export interface AppSettings {
  refinementMode: RefinementMode;
  groqApiKey: string;
  refinementModel: string;
  localRefinementModel: string;
  offlineModel: OfflineModelId;
  accelerationMode: AccelerationMode;
  defaultStyle: RefinementStyle;
  promptFilters: PromptFilter[];
  autoPaste: boolean;
  launchAtStartup: boolean;
  vocabulary: string[];
  accentTheme: string;
  backgroundStyle: string;
  bgShaderType: string;
  bgShaderColors: string;
  petSelection: string;
  soundCaptureStart: CaptureSoundId;
  soundPasteDone: PasteSoundId;
}

export interface HistoryEntry {
  id: string;
  createdAt: string;
  rawText: string;
  refinedText: string;
  style: RefinementStyle;
  pasted: boolean;
  error?: string;
  notice?: string;
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
  accelerationMode: AccelerationMode;
  activeBackend: TranscriptionBackendId;
  activeBackendLabel: string;
  fallbackReason?: string;
  downloadState?: DownloadState;
  vulkanRuntimePath: string;
  vulkanRuntimeBundled: boolean;
  systemVulkanAvailable: boolean;
  vulkanSelectable: boolean;
  availableBackends: Array<{
    id: TranscriptionBackendId;
    label: string;
    kind: 'cpu' | 'vulkan';
    bundled: boolean;
    selectable: boolean;
    binaryPath: string;
    note?: string;
  }>;
  availableModels: Array<{
    value: OfflineModelId;
    label: string;
    fileName: string;
    downloadUrl: string;
    diskSize: string;
    memoryUsage: string;
    accuracy: string;
    speed: string;
    recommended?: boolean;
    installed: boolean;
    removable: boolean;
    absolutePath: string;
  }>;
}

export interface LocalRefinementModelOption {
  value: string;
  label: string;
  fileName: string;
  downloadUrl: string;
  summary: string;
  size: string;
  recommended?: boolean;
}

export interface PromptFilter {
  id: RefinementStyle;
  label: string;
  instruction: string;
  builtIn?: boolean;
}

export interface DownloadState {
  phase: LocalAiDownloadPhase;
  label: string;
  detail: string;
  receivedBytes: number;
  totalBytes?: number;
  percent?: number;
}

export interface LocalAiDownloadState extends DownloadState {
  target: LocalAiDownloadTarget;
}

export interface LocalAiInfo {
  runtimePath: string;
  runtimeInstalled: boolean;
  modelPath: string;
  modelInstalled: boolean;
  modelLabel: string;
  modelFileName: string;
  modelSummary: string;
  modelSize: string;
  modelDownloadUrl: string;
  runtimeArchiveName: string;
  runtimeDownloadUrl: string;
  serverUrl: string;
  serverRunning: boolean;
  runningModelFileName?: string;
  healthy: boolean;
  fallbackToGroqAvailable: boolean;
  availableModels: LocalRefinementModelOption[];
  selectedModelValue: string;
  downloadState?: LocalAiDownloadState;
  lastError?: string;
}

export interface BootstrapPayload {
  settings: AppSettings;
  history: HistoryEntry[];
  overlayState: OverlayState;
  modelInfo: ModelInfo;
  localAiInfo: LocalAiInfo;
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
  refinementMode: 'groq',
  groqApiKey: '',
  refinementModel: GROQ_REFINEMENT_MODEL,
  localRefinementModel: LOCAL_REFINEMENT_MODEL,
  offlineModel: DEFAULT_WHISPER_MODEL,
  accelerationMode: 'auto',
  defaultStyle: 'casual',
  promptFilters: [],
  autoPaste: true,
  launchAtStartup: false,
  vocabulary: [],
  accentTheme: 'default',
  backgroundStyle: 'streaks',
  bgShaderType: 'plasma',
  bgShaderColors: JSON.stringify(['#2A181E', '#000000']),
  petSelection: 'yorha-sit-2b',
  soundCaptureStart: 'pop',
  soundPasteDone: 'chime'
};

export const LOCAL_REFINEMENT_MODEL_OPTIONS: LocalRefinementModelOption[] = [
  {
    value: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    label: 'Llama 3.2 3B Instruct',
    fileName: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf?download=true',
    summary: 'Fastest local cleanup option with good overall instruction following.',
    size: 'Approx. 2.0 GB',
    recommended: true
  },
  {
    value: 'google_gemma-3-4b-it-Q4_K_M.gguf',
    label: 'Gemma 3 4B IT',
    fileName: 'google_gemma-3-4b-it-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/google_gemma-3-4b-it-GGUF/resolve/main/google_gemma-3-4b-it-Q4_K_M.gguf?download=true',
    summary: 'Stronger wording cleanup and better handling for tricky named terms.',
    size: 'Approx. 3.0 GB'
  },
  {
    value: 'Qwen2.5-3B-Instruct-Q4_K_M.gguf',
    label: 'Qwen 2.5 3B Instruct',
    fileName: 'Qwen2.5-3B-Instruct-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf?download=true',
    summary: 'Balanced formatting and cleanup with crisp structured rewrites.',
    size: 'Approx. 2.1 GB'
  }
];

export const REFINEMENT_MODE_OPTIONS: Array<{ value: RefinementMode; label: string }> = [
  { value: 'groq', label: 'Groq API' },
  { value: 'local', label: 'Local AI' }
];

export const DEFAULT_OVERLAY_STATE: OverlayState = {
  visible: false,
  status: 'hidden',
  message: ''
};

export const BUILT_IN_PROMPT_FILTERS: PromptFilter[] = [
  {
    id: 'casual',
    label: 'Casual',
    instruction:
      'Rewrite the transcript into polished but natural casual writing. Fix punctuation, spelling, and obvious speech-to-text mistakes while preserving meaning.',
    builtIn: true
  },
  {
    id: 'formal',
    label: 'Formal',
    instruction:
      'Rewrite the transcript into clear professional formal writing. Keep the meaning intact and improve grammar, spelling, and structure.',
    builtIn: true
  },
  {
    id: 'summarised',
    label: 'Summarised',
    instruction:
      'Summarize the transcript into a shorter version that keeps the key meaning and intent. Remove repetition and filler.',
    builtIn: true
  },
  {
    id: 'bullet-points',
    label: 'Bullet Points',
    instruction:
      'Rewrite the transcript as concise bullet points. Keep only the content that is present in the transcript.',
    builtIn: true
  },
  {
    id: 'email-ready',
    label: 'Email Ready',
    instruction:
      'Rewrite the transcript into an email-ready message with a polished tone, complete sentences, and clear flow. Do not add greetings or sign-offs unless they are implied.',
    builtIn: true
  },
  {
    id: 'none',
    label: 'None (Raw Whisper)',
    instruction: 'Return the raw transcript unchanged.',
    builtIn: true
  }
];

export const STYLE_OPTIONS: Array<{ value: RefinementStyle; label: string }> =
  BUILT_IN_PROMPT_FILTERS.map((filter) => ({
    value: filter.id,
    label: filter.label
  }));

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
  },
  {
    value: 'medium.en',
    label: 'Medium',
    fileName: 'ggml-medium.en.bin',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin?download=true',
    diskSize: '1.5 GB',
    memoryUsage: '~2.5 GB',
    accuracy: 'Higher',
    speed: 'Slower'
  },
  {
    value: 'large-v3-turbo-q5_0',
    label: 'Large Turbo Q5',
    fileName: 'ggml-large-v3-turbo-q5_0.bin',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin?download=true',
    diskSize: '547 MB',
    memoryUsage: '~1.6 GB',
    accuracy: 'Very high',
    speed: 'Balanced'
  },
  {
    value: 'large-v3-turbo',
    label: 'Large Turbo',
    fileName: 'ggml-large-v3-turbo.bin',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin?download=true',
    diskSize: '1.5 GB',
    memoryUsage: '~3.0 GB',
    accuracy: 'Very high',
    speed: 'Slowest'
  },
  {
    value: 'large-v3',
    label: 'Large v3',
    fileName: 'ggml-large-v3.bin',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin?download=true',
    diskSize: '2.9 GB',
    memoryUsage: '~6.3 GB',
    accuracy: 'Highest',
    speed: 'Slowest'
  },
  {
    value: 'large-v3-q5_0',
    label: 'Large v3 Q5',
    fileName: 'ggml-large-v3-q5_0.bin',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-q5_0.bin?download=true',
    diskSize: '1.1 GB',
    memoryUsage: '~2.5 GB',
    accuracy: 'Highest',
    speed: 'Slower'
  },
  {
    value: 'large-v3-turbo-q8_0',
    label: 'Large Turbo Q8',
    fileName: 'ggml-large-v3-turbo-q8_0.bin',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q8_0.bin?download=true',
    diskSize: '~800 MB',
    memoryUsage: '~2.0 GB',
    accuracy: 'Very high',
    speed: 'Balanced'
  }
];
