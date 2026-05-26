import { useEffect, useRef, useState } from 'react';

import { BackgroundCanvas } from './components/BackgroundCanvas';
import { MicButton } from './components/MicButton';
import { PetOverlay } from './components/PetOverlay';
import { PetTab } from './components/PetTab';
import { SegmentedControl } from './components/SegmentedControl';
import { ToggleSwitch } from './components/ToggleSwitch';

import {
  BUILT_IN_PROMPT_FILTERS,
  CAPTURE_SOUND_OPTIONS,
  DEFAULT_SETTINGS,
  GROQ_REFINEMENT_MODEL,
  OFFLINE_MODEL_OPTIONS,
  PASTE_SOUND_OPTIONS,
  REFINEMENT_MODE_OPTIONS,
  type AppSettings,
  type BootstrapPayload,
  type CaptureSoundId,
  type HistoryEntry,
  type PasteSoundId,
  type PromptFilter,
  type RefinementStyle
} from './shared/types';

import {
  playPop, playClick, playRising, playBlip, playTap, playWhoosh, playPulse,
  playChime, playDing, playAscend, playDescend, playSparkle, playChord, playConfirm
} from './lib/sounds';

const CAPTURE_FN_MAP: Record<string, () => void> = {
  pop: playPop,
  click: playClick,
  rising: playRising,
  blip: playBlip,
  tap: playTap,
  whoosh: playWhoosh,
  pulse: playPulse,
};

const PASTE_FN_MAP: Record<string, () => void> = {
  chime: playChime,
  ding: playDing,
  ascend: playAscend,
  descend: playDescend,
  sparkle: playSparkle,
  chord: playChord,
  confirm: playConfirm,
};

type AppStatus =
  | 'booting'
  | 'idle'
  | 'loading-model'
  | 'recording'
  | 'processing'
  | 'done'
  | 'error';

type AppTab = 'home' | 'history' | 'transcription' | 'ai' | 'prompts' | 'pet' | 'info' | 'settings';
type PromptDraft = {
  label: string;
  instruction: string;
};

const ACCELERATION_MODE_OPTIONS: Array<{
  value: AppSettings['accelerationMode'];
  label: string;
}> = [
  { value: 'auto', label: 'Auto' },
  { value: 'cpu', label: 'CPU' },
  { value: 'vulkan', label: 'GPU (Vulkan)' }
];

const SHADER_PRESETS: Record<string, {
  label: string;
  colorCount: number;
  presets: Record<string, { colors: string[]; label: string }>;
}> = {
  'flowing-gradient': {
    label: 'Flowing Gradient',
    colorCount: 4,
    presets: {
      'dark-purple': { colors: ['#050010','#150828','#2a1040','#0a0415'], label: 'Dark Purple' },
      'midnight-ocean': { colors: ['#000a15','#002030','#003850','#001025'], label: 'Midnight Ocean' },
      'ember-night': { colors: ['#0a0300','#200a02','#3a1500','#150800'], label: 'Ember Night' },
      'deep-forest': { colors: ['#000805','#002010','#003818','#001008'], label: 'Deep Forest' },
    }
  },
  'aurora': {
    label: 'Aurora',
    colorCount: 3,
    presets: {
      'aurora-default': { colors: ['#1a0830','#003818','#002440'], label: 'Aurora' },
      'aurora-fire': { colors: ['#200800','#3a2000','#2a1000'], label: 'Fire' },
      'aurora-ice': { colors: ['#002038','#003838','#003050'], label: 'Ice' },
      'aurora-neon': { colors: ['#200020','#002020','#202000'], label: 'Neon' },
    }
  },
  'plasma': {
    label: 'Plasma',
    colorCount: 2,
    presets: {
      'plasma-default': { colors: ['#2A181E','#000000'], label: 'Default' },
      'plasma-fire': { colors: ['#300800','#000000'], label: 'Fire' },
      'plasma-neon': { colors: ['#200020','#000808'], label: 'Neon' },
      'plasma-ocean': { colors: ['#001820','#000408'], label: 'Ocean' },
    }
  },
};

type TranscriberLike = {
  warmup: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<ArrayBuffer>;
};

const PROCESS_TRANSCRIPT_TIMEOUT_MS = 90000;

function isOverlayMode(): boolean {
  return window.location.hash === '#overlay';
}

function formatDate(value: string): string {
  const date = new Date(value);
  return date.toLocaleString();
}

function parseVocabularyEntries(text: string): string[] {
  return text
    .split(/[,\r\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function copyText(text: string): Promise<void> {
  if (!text.trim()) {
    return;
  }

  await window.voskFlow.copyText(text);
}

function getHistoryStyleClass(style: RefinementStyle): string {
  switch (style) {
    case 'formal':
      return 'pill-formal';
    case 'summarised':
      return 'pill-summary';
    case 'bullet-points':
      return 'pill-bullets';
    case 'email-ready':
      return 'pill-email';
    case 'none':
      return 'pill-raw';
    case 'casual':
      return 'pill-casual';
    default:
      return 'pill-casual';
  }
}

function getFilterLabel(filters: PromptFilter[], filterId: RefinementStyle): string {
  return (
    filters.find((filter) => filter.id === filterId)?.label ??
    BUILT_IN_PROMPT_FILTERS.find((filter) => filter.id === filterId)?.label ??
    filterId
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: number | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
}

function OverlayApp(): JSX.Element {
  return <PetOverlay />;
}

function HomeIcon(): JSX.Element {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7" />
      <path d="M5 10v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10" />
      <path d="M9 22v-6h6v6" />
    </svg>
  );
}

function HistoryIcon(): JSX.Element {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

function TranscriptionIcon(): JSX.Element {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <path d="M12 19v3" />
      <path d="M8 22h8" />
    </svg>
  );
}

function AiIcon(): JSX.Element {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.7 3.5L17 8.2l-3.3 1.6L12 13.3l-1.7-3.5L7 8.2l3.3-1.7L12 3Z" />
      <path d="M5 14v2a2 2 0 0 0 2 2h2" />
      <path d="M19 14v2a2 2 0 0 1-2 2h-2" />
      <path d="M9 18v3" />
      <path d="M15 18v3" />
    </svg>
  );
}

function SettingsIcon(): JSX.Element {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.2a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.2a1.7 1.7 0 0 0-1.4 1Z" />
    </svg>
  );
}

function PromptIcon(): JSX.Element {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.9 4.9L19 10l-5.1 2.1L12 17l-1.9-4.9L5 10l5.1-2.1L12 3Z" />
      <path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" />
      <path d="M5 15l.5 1.5L7 17l-1.5.5L5 19l-.5-1.5L3 17l1.5-.5L5 15Z" />
    </svg>
  );
}

function PetIcon(): JSX.Element {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L9 7l-5 1 3.5 4.5L7 18l5-2.5L17 18l-.5-5.5L20 8l-5-1L12 2Z" />
    </svg>
  );
}

function InfoIcon(): JSX.Element {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

export function App(): JSX.Element {
  const overlayMode = isOverlayMode();
  const [bootData, setBootData] = useState<BootstrapPayload | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [status, setStatus] = useState<AppStatus>('booting');
  const [activeTab, setActiveTab] = useState<AppTab>('home');
  const [note, setNote] = useState<string>('');
  const [latestRawText, setLatestRawText] = useState<string>('');
  const [latestRefinedText, setLatestRefinedText] = useState<string>('');
  const [vocabularyDraft, setVocabularyDraft] = useState<string>('');
  const [savingSettings, setSavingSettings] = useState<boolean>(false);
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [localAiBusyAction, setLocalAiBusyAction] = useState<string | null>(null);
  const [accentTheme, setAccentTheme] = useState<string>('default');
  const [backgroundStyle, setBackgroundStyle] = useState<string>('streaks');
  const [bgShaderType, setBgShaderType] = useState<string>('plasma');
  const [bgShaderColors, setBgShaderColors] = useState<string[]>(['#2A181E', '#000000']);
  const [bgShaderPreset, setBgShaderPreset] = useState<string>('plasma-default');
  const [bgCustomColors, setBgCustomColors] = useState<string[]>([]);

  // Sync accent/background/shader from settings on boot
  useEffect(() => {
    if (bootData) {
      setAccentTheme(settings.accentTheme ?? 'default');
      setBackgroundStyle(settings.backgroundStyle ?? 'streaks');
      const st = settings.bgShaderType ?? 'plasma';
      setBgShaderType(st);
      const raw = settings.bgShaderColors;
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as string[];
          setBgShaderColors(parsed);
          setBgCustomColors([]);
          const shader = SHADER_PRESETS[st];
          if (shader) {
            const match = Object.entries(shader.presets).find(([, p]) =>
              p.colors.length === parsed.length && p.colors.every((c, i) => c === parsed[i])
            );
            setBgShaderPreset(match ? match[0] : 'custom');
            if (match) setBgCustomColors([]);
            else setBgCustomColors([...parsed]);
          }
        } catch { /* ignore */ }
      }
    }
  }, [bootData]);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, PromptDraft>>({});
  const [promptErrors, setPromptErrors] = useState<Record<string, string>>({});
  const recordingRef = useRef<boolean>(false);
  const copyResetTimerRef = useRef<number | null>(null);
  const startCaptureRef = useRef<() => Promise<void>>(async () => {});
  const stopCaptureRef = useRef<() => Promise<void>>(async () => {});

  const applyBootstrap = (payload: BootstrapPayload): void => {
    setBootData(payload);
    setSettings(payload.settings);
    setHistory(payload.history);
  };

  useEffect(() => {
    if (overlayMode) {
      return;
    }

    void window.voskFlow.getBootstrap().then((payload) => {
      applyBootstrap(payload);
      setStatus('idle');
      if (!payload.modelInfo.binaryExists) {
        setNote(
          `Offline runtime missing. Reinstall or rebuild Openflow before the first transcription.`
        );
      } else if (!payload.modelInfo.exists) {
        setNote(
          `Offline model missing. Download ${payload.modelInfo.label} in Transcription before the first transcription.`
        );
      }
    });
  }, [overlayMode]);

  useEffect(() => {
    if (overlayMode || !bootData) {
      return;
    }

    let transcriberPromise: Promise<TranscriberLike> | null = null;

    const getTranscriber = async (): Promise<TranscriberLike> => {
      if (!transcriberPromise) {
        transcriberPromise = import('./lib/audioCapture').then(
          ({ AudioCapture }) => new AudioCapture()
        );
      }

      return transcriberPromise;
    };

    const startCapture = async (): Promise<void> => {
      if (recordingRef.current) {
        return;
      }

      if (!bootData.modelInfo.binaryExists) {
        setStatus('error');
        setNote('The bundled whisper.cpp runtime is missing. Reinstall or rebuild Openflow.');
        await window.voskFlow.reportCaptureError('Runtime missing');
        return;
      }

      if (!bootData.modelInfo.exists) {
        setStatus('error');
        setNote(`The selected Whisper model is missing: ${bootData.modelInfo.label}. Download it in Transcription and try again.`);
        await window.voskFlow.reportCaptureError('Model missing');
        return;
      }

      try {
        setStatus('loading-model');
        setNote('');
        const transcriber = await getTranscriber();
        await transcriber.warmup();
        setStatus('recording');
        await transcriber.start();
        recordingRef.current = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to start recording.';
        setStatus('error');
        setNote(message);
        await window.voskFlow.reportCaptureError('Mic unavailable');
      }
    };

    const stopCapture = async (): Promise<void> => {
      if (!recordingRef.current) {
        return;
      }

      try {
        setStatus('processing');
        const transcriber = await getTranscriber();
        const audioBuffer = await transcriber.stop();
        recordingRef.current = false;

        if (audioBuffer.byteLength === 0) {
          setStatus('error');
          setNote('No speech was detected in the captured audio.');
          await window.voskFlow.reportEmptyCapture();
          return;
        }

        const result = await withTimeout(
          window.voskFlow.processTranscript({
            audioBuffer,
            style: settings.defaultStyle
          }),
          PROCESS_TRANSCRIPT_TIMEOUT_MS,
          'Processing took too long. Openflow stopped waiting and you can try again.'
        );

        setLatestRawText(result.entry.rawText);
        setLatestRefinedText(result.refinedText);
        setHistory((currentHistory) => [result.entry, ...currentHistory].slice(0, 200));
        setStatus('done');
        const pasteFn = PASTE_FN_MAP[settings.soundPasteDone];
        if (pasteFn) pasteFn();
        setNote(
          result.notice ??
            (result.pasted ? 'Refined text was pasted into the active window.' : 'Processing complete.')
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to complete transcription.';
        setStatus('error');
        setNote(message);
        await window.voskFlow.reportCaptureError('Processing failed');
      }
    };

    startCaptureRef.current = startCapture;
    stopCaptureRef.current = stopCapture;

    const unsubscribe = window.voskFlow.onRecordingCommand((command) => {
      if (command === 'start') {
        const captureFn = CAPTURE_FN_MAP[settings.soundCaptureStart];
        if (captureFn) captureFn();
        void startCapture();
        return;
      }
      void stopCapture();
    });

    return () => {
      unsubscribe();
    };
  }, [bootData, overlayMode, settings.defaultStyle]);

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  // Inject accent theme CSS custom properties
  useEffect(() => {
    const THEMES: Record<string, string> = {
      default: '120,140,255',
      violet: '168,130,255',
      rose: '255,110,130',
      emerald: '60,210,140',
      amber: '251,180,60',
      sky: '56,190,255',
      mono: '200,200,200'
    };

    const accent = THEMES[accentTheme] ?? THEMES.default;
    const [r, g, b] = accent.split(',').map(Number);

    let el = document.getElementById('theme-override');
    if (!el) {
      el = document.createElement('style');
      el.id = 'theme-override';
      document.head.appendChild(el);
    }

    el.textContent = `
      :root { --acc-r: ${r}; --acc-g: ${g}; --acc-b: ${b}; --accent: rgb(${r},${g},${b}); --accent-glow: rgba(${r},${g},${b},0.14); }
      .nav-item.active { color: rgb(${r},${g},${b}) !important; background: rgba(${r},${g},${b},0.09) !important; border-color: rgba(${r},${g},${b},0.14) !important; }
      .seg-btn.on { background: rgba(${r},${g},${b},0.13) !important; color: rgb(${r},${g},${b}) !important; }
      .toggle-switch.is-on { background: rgba(${r},${g},${b},0.45) !important; border-color: rgba(${r},${g},${b},0.6) !important; }
      .model-card.active { border-color: rgba(${r},${g},${b},0.35) !important; background: rgba(${r},${g},${b},0.07) !important; }
      .prompt-row.is-default { border-color: rgba(${r},${g},${b},0.3) !important; background: rgba(${r},${g},${b},0.055) !important; }
      .download-progress-fill { background: linear-gradient(90deg, rgb(${r},${g},${b}), rgba(${r},${g},${b},0.6)) !important; }
      .history-paste-state.is-pasted { background: rgba(${r},${g},${b},0.08) !important; color: rgb(${r},${g},${b}) !important; border-color: rgba(${r},${g},${b},0.15) !important; }
      .page-title-accent { color: rgb(${r},${g},${b}) !important; }
    `;
  }, [accentTheme]);

  // Sync background style visibility
  useEffect(() => {
    const shader = document.querySelector('.bg-canvas-shader') as HTMLElement | null;
    const grid = document.querySelector('.grid-overlay') as HTMLElement | null;
    if (!shader) return;
    if (backgroundStyle === 'off') {
      shader.style.opacity = '0';
      if (grid) grid.style.opacity = '0';
    } else if (backgroundStyle === 'minimal') {
      shader.style.opacity = '0.3';
      if (grid) grid.style.opacity = '0.6';
    } else {
      shader.style.opacity = '0.7';
      if (grid) grid.style.opacity = '1';
    }
  }, [backgroundStyle]);

  if (overlayMode) {
    return <OverlayApp />;
  }

  const selectedOfflineModel =
    bootData?.modelInfo.availableModels.find((option) => option.value === settings.offlineModel) ??
    OFFLINE_MODEL_OPTIONS.find((option) => option.value === settings.offlineModel) ??
    OFFLINE_MODEL_OPTIONS[0];
  const promptFilters = settings.promptFilters.length > 0 ? settings.promptFilters : BUILT_IN_PROMPT_FILTERS;
  const activeTabLabel =
    activeTab === 'home'
      ? 'voice dictation'
      : activeTab === 'history'
        ? 'history'
        : activeTab === 'transcription'
          ? 'transcription'
          : activeTab === 'ai'
            ? 'ai refinement'
            : activeTab === 'pet'
              ? 'pet'
              : activeTab === 'prompts'
                ? 'prompts'
                : activeTab === 'info'
                  ? 'info'
              : 'settings';
  const offlineModelDownloadState = bootData?.modelInfo.downloadState;

  useEffect(() => {
    setPromptDrafts(
      Object.fromEntries(
        promptFilters.map((filter) => [
          filter.id,
          {
            label: filter.label,
            instruction: filter.instruction
          }
        ])
      )
    );
    setPromptErrors({});
  }, [promptFilters]);

  const handleSettingsChange = async (nextSettings: AppSettings): Promise<void> => {
    setSettings(nextSettings);
    setSavingSettings(true);
    try {
      const persistedSettings = await window.voskFlow.saveSettings(nextSettings);
      setSettings(persistedSettings);
      const payload = await window.voskFlow.getBootstrap();
      applyBootstrap(payload);
    } finally {
      setSavingSettings(false);
    }
  };

  const runLocalAiAction = async (
    actionKey: string,
    runner: () => Promise<BootstrapPayload>,
    successNote?: string
  ): Promise<void> => {
    setLocalAiBusyAction(actionKey);
    let refreshTimer: number | null = null;

    const refreshBootstrap = async (): Promise<void> => {
      try {
        const payload = await window.voskFlow.refreshLocalAi();
        applyBootstrap(payload);
      } catch {
        // Keep the current UI state if polling fails briefly during a long-running action.
      }
    };

    try {
      refreshTimer = window.setInterval(() => {
        void refreshBootstrap();
      }, 700);

      const payload = await runner();
      applyBootstrap(payload);
      if (successNote) {
        setNote(successNote);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Local AI action failed.';
      setNote(message);
    } finally {
      if (refreshTimer !== null) {
        window.clearInterval(refreshTimer);
      }
      void refreshBootstrap();
      setLocalAiBusyAction(null);
    }
  };

  const runCleanupAction = async (
    actionKey: string,
    runner: () => Promise<BootstrapPayload>,
    successNote: string,
    options?: { clearPreviews?: boolean }
  ): Promise<void> => {
    setLocalAiBusyAction(actionKey);

    try {
      const payload = await runner();
      applyBootstrap(payload);
      if (options?.clearPreviews) {
        setLatestRawText('');
        setLatestRefinedText('');
      }
      setNote(successNote);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cleanup action failed.';
      setNote(message);
    } finally {
      setLocalAiBusyAction(null);
    }
  };

  const persistVocabularyEntries = async (entries: string[]): Promise<void> => {
    const existingKeys = new Set<string>();
    const cleanedEntries = entries.filter((entry) => {
      const value = entry.trim();
      if (!value) {
        return false;
      }

      const key = value.toLocaleLowerCase();
      if (existingKeys.has(key)) {
        return false;
      }

      existingKeys.add(key);
      return true;
    });

    await handleSettingsChange({
      ...settings,
      vocabulary: cleanedEntries
    });
  };

  const commitVocabularyDraft = async (rawValue: string): Promise<void> => {
    const nextEntries = parseVocabularyEntries(rawValue);
    if (nextEntries.length === 0) {
      setVocabularyDraft('');
      return;
    }

    await persistVocabularyEntries([...settings.vocabulary, ...nextEntries]);
    setVocabularyDraft('');
  };

  const removeVocabularyEntry = async (entryToRemove: string): Promise<void> => {
    await persistVocabularyEntries(settings.vocabulary.filter((entry) => entry !== entryToRemove));
  };

  const updatePromptDraft = (
    filterId: string,
    changes: Partial<PromptDraft>
  ): void => {
    setPromptDrafts((currentDrafts) => ({
      ...currentDrafts,
      [filterId]: {
        label: currentDrafts[filterId]?.label ?? promptFilters.find((filter) => filter.id === filterId)?.label ?? '',
        instruction:
          currentDrafts[filterId]?.instruction ??
          promptFilters.find((filter) => filter.id === filterId)?.instruction ??
          '',
        ...changes
      }
    }));
    setPromptErrors((currentErrors) => {
      if (!currentErrors[filterId]) {
        return currentErrors;
      }

      const nextErrors = { ...currentErrors };
      delete nextErrors[filterId];
      return nextErrors;
    });
  };

  const savePromptFilter = async (filterId: string): Promise<void> => {
    const filter = promptFilters.find((item) => item.id === filterId);
    if (!filter) {
      return;
    }

    const draft = promptDrafts[filterId] ?? {
      label: filter.label,
      instruction: filter.instruction
    };
    const nextLabel = draft.label.trim();
    const nextInstruction = draft.instruction.trim();

    if (!nextLabel) {
      setPromptErrors((currentErrors) => ({
        ...currentErrors,
        [filterId]: 'Filter name is required.'
      }));
      return;
    }

    if (!nextInstruction) {
      setPromptErrors((currentErrors) => ({
        ...currentErrors,
        [filterId]: 'Prompt instruction is required.'
      }));
      return;
    }

    await handleSettingsChange({
      ...settings,
      promptFilters: promptFilters.map((item) =>
        item.id === filterId
          ? { ...item, label: nextLabel, instruction: nextInstruction }
          : item
      )
    });

    setPromptDrafts((currentDrafts) => ({
      ...currentDrafts,
      [filterId]: {
        label: nextLabel,
        instruction: nextInstruction
      }
    }));
    setPromptErrors((currentErrors) => {
      if (!currentErrors[filterId]) {
        return currentErrors;
      }

      const nextErrors = { ...currentErrors };
      delete nextErrors[filterId];
      return nextErrors;
    });
  };

  const hasPromptDraftChanges = (filter: PromptFilter): boolean => {
    const draft = promptDrafts[filter.id];
    if (!draft) {
      return false;
    }

    return draft.label !== filter.label || draft.instruction !== filter.instruction;
  };

  const addPromptFilter = async (): Promise<void> => {
    const nextFilter: PromptFilter = {
      id: `custom-${crypto.randomUUID()}`,
      label: 'New Filter',
      instruction: 'Rewrite the transcript according to this custom instruction.',
      builtIn: false
    };

    await handleSettingsChange({
      ...settings,
      promptFilters: [...promptFilters, nextFilter],
      defaultStyle: nextFilter.id
    });
    setPromptDrafts((currentDrafts) => ({
      ...currentDrafts,
      [nextFilter.id]: {
        label: nextFilter.label,
        instruction: nextFilter.instruction
      }
    }));
    setActiveTab('prompts');
  };

  const removePromptFilter = async (filterId: string): Promise<void> => {
    const nextFilters = promptFilters.filter((filter) => filter.id !== filterId);
    await handleSettingsChange({
      ...settings,
      promptFilters: nextFilters,
      defaultStyle: settings.defaultStyle === filterId ? 'casual' : settings.defaultStyle
    });
    setPromptDrafts((currentDrafts) => {
      const nextDrafts = { ...currentDrafts };
      delete nextDrafts[filterId];
      return nextDrafts;
    });
    setPromptErrors((currentErrors) => {
      const nextErrors = { ...currentErrors };
      delete nextErrors[filterId];
      return nextErrors;
    });
  };

  const clearHistoryEntries = async (): Promise<void> => {
    await window.voskFlow.clearHistory();
    setHistory([]);
  };

  const handleCopy = async (key: string, text: string): Promise<void> => {
    if (!text.trim()) {
      return;
    }

    await copyText(text);
    setCopiedKey(key);

    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
    }

    copyResetTimerRef.current = window.setTimeout(() => {
      setCopiedKey((currentKey) => (currentKey === key ? null : currentKey));
      copyResetTimerRef.current = null;
    }, 1400);
  };

  const handleMicCapture = async (): Promise<void> => {
    if (status === 'recording') {
      await stopCaptureRef.current();
    } else if (status === 'idle' || status === 'done' || status === 'error') {
      await startCaptureRef.current();
    }
  };

  const micButtonStatus = status === 'booting' || status === 'loading-model' ? 'idle' : status as 'idle' | 'recording' | 'processing' | 'done' | 'error';

  return (
    <main className="app-shell">
      <div className="ambient-orb ambient-orb-one" />
      <div className="ambient-orb ambient-orb-two" />
      <div className="ambient-orb ambient-orb-three" />

      <BackgroundCanvas shaderType={bgShaderType} shaderColors={bgShaderColors} />
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-title">Openflow</div>
          <div className="brand-subtitle">v{bootData?.version ?? '0.1.0'}</div>
        </div>

        <div className="sidebar-section">
          <p className="sidebar-label">Workspace</p>
          <button
            className={`sidebar-nav${activeTab === 'home' ? ' is-active' : ''}`}
            type="button"
            onClick={() => setActiveTab('home')}
          >
            <HomeIcon />
            <span>Home</span>
          </button>
          <button
            className={`sidebar-nav${activeTab === 'history' ? ' is-active' : ''}`}
            type="button"
            onClick={() => setActiveTab('history')}
          >
            <HistoryIcon />
            <span>History</span>
          </button>
          <button
            className={`sidebar-nav${activeTab === 'transcription' ? ' is-active' : ''}`}
            type="button"
            onClick={() => setActiveTab('transcription')}
          >
            <TranscriptionIcon />
            <span>Transcription</span>
          </button>
          <button
            className={`sidebar-nav${activeTab === 'ai' ? ' is-active' : ''}`}
            type="button"
            onClick={() => setActiveTab('ai')}
          >
            <AiIcon />
            <span>AI</span>
          </button>
          <button
            className={`sidebar-nav${activeTab === 'pet' ? ' is-active' : ''}`}
            type="button"
            onClick={() => setActiveTab('pet')}
          >
            <PetIcon />
            <span>Pet</span>
          </button>
          <button
            className={`sidebar-nav${activeTab === 'prompts' ? ' is-active' : ''}`}
            type="button"
            onClick={() => setActiveTab('prompts')}
          >
            <PromptIcon />
            <span>Prompts</span>
          </button>
          <button
            className={`sidebar-nav${activeTab === 'info' ? ' is-active' : ''}`}
            type="button"
            onClick={() => setActiveTab('info')}
          >
            <InfoIcon />
            <span>Info</span>
          </button>
          <button
            className={`sidebar-nav${activeTab === 'settings' ? ' is-active' : ''}`}
            type="button"
            onClick={() => setActiveTab('settings')}
          >
            <SettingsIcon />
            <span>Settings</span>
          </button>
        </div>

        <div className="sidebar-footer">
          <p className="version-pill">v{bootData?.version ?? '0.1.0'}</p>
        </div>
      </aside>

      <section className="workspace">
        <header className="workspace-topbar">
          <span className="topbar-location">{activeTabLabel}</span>
          <div className="flex gap6">
            <button
              className="btn-ghost"
              type="button"
              onClick={() => setActiveTab('settings')}
              style={{ background: 'none', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', padding: '4px 8px', borderRadius: 'var(--radius-3xl)', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              <svg className="ic" width="13" height="13" viewBox="0 0 24 24">
                <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          </div>
        </header>

        <div className="workspace-scroll">
          {activeTab === 'home' ? (
            <section className="page page-home">
              <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
                <MicButton status={micButtonStatus} onClick={handleMicCapture} />
                <div>
                  <span className="badge" style={{
                    color: status === 'recording' ? '#f87171' : status === 'processing' ? '#fb923c' : status === 'done' ? '#4ade80' : 'rgba(255,255,255,0.4)',
                    background: status === 'recording' ? 'rgba(239,68,68,0.09)' : status === 'processing' ? 'rgba(251,146,60,0.09)' : status === 'done' ? 'rgba(74,222,128,0.09)' : 'rgba(255,255,255,0.05)',
                    borderColor: status === 'recording' ? 'rgba(239,68,68,0.22)' : status === 'processing' ? 'rgba(251,146,60,0.22)' : status === 'done' ? 'rgba(74,222,128,0.22)' : 'rgba(255,255,255,0.08)',
                    fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em', marginBottom: 6
                  }}>
                    {status === 'recording' ? '● Recording' : status === 'processing' ? '◌ Processing' : status === 'done' ? '✓ Done' : 'Idle'}
                  </span>
                  <div style={{ fontSize: 12.5, color: 'var(--muted-foreground)', marginBottom: 5 }}>
                    {status === 'idle' ? 'Press the mic or hold Ctrl + Win to start' :
                     status === 'recording' ? 'Listening — release Ctrl + Win to stop' :
                     status === 'processing' ? 'Transcribing and refining audio…' :
                     status === 'done' ? 'Capture complete' :
                     status === 'error' ? 'Something went wrong — check the note' :
                     status === 'loading-model' ? 'Preparing audio capture…' : 'Ready'}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.18)' }}>
                    Shortcut: <kbd className="keycap">Ctrl + Win</kbd>
                  </div>
                </div>
              </div>

              <div className="transcript-grid">
                <article className="transcript-card">
                  <div className="card-head">
                    <span className="card-kicker">Raw Transcript</span>
                    <button
                      className={`copy-status-button${copiedKey === 'home-raw' ? ' is-copied' : ''}`}
                      type="button"
                      onClick={() => void handleCopy('home-raw', latestRawText)}
                      aria-label="Copy latest raw transcript"
                    >
                      <svg className="ic" width="12" height="12" viewBox="0 0 24 24">
                        <path d="M20 9H11a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V11a2 2 0 0 0-2-2z M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                      </svg>
                      <span>{copiedKey === 'home-raw' ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  <div className="transcript-body transcript-body-raw">
                    {latestRawText || 'Your next Whisper transcript will appear here.'}
                  </div>
                </article>

                <article className="transcript-card">
                  <div className="card-head">
                    <span className="card-kicker">Refined Output</span>
                    <button
                      className={`copy-status-button${copiedKey === 'home-refined' ? ' is-copied' : ''}`}
                      type="button"
                      onClick={() => void handleCopy('home-refined', latestRefinedText)}
                      aria-label="Copy latest refined transcript"
                    >
                      <svg className="ic" width="12" height="12" viewBox="0 0 24 24">
                        <path d="M20 9H11a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V11a2 2 0 0 0-2-2z M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                      </svg>
                      <span>{copiedKey === 'home-refined' ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  <div className="transcript-body transcript-body-refined">
                    {latestRefinedText || 'Your cleaned transcript will appear here after processing.'}
                  </div>
                </article>
              </div>

              {note ? <div className="note-banner">{note}</div> : null}

              <div className="section-divider">
                <span>Capture Preferences</span>
              </div>

              <div className="home-preferences-grid">
                <article className="panel-card compact-panel">
                  <p className="card-kicker">Default Refinement Style</p>
                  <p className="panel-title">How Openflow should rewrite by default</p>
                  <p className="panel-description">Used whenever you trigger a capture with no manual override.</p>
                  <SegmentedControl
                    options={promptFilters.map((f) => f.label)}
                    value={promptFilters.find((f) => f.id === settings.defaultStyle)?.label ?? 'Casual'}
                    onChange={(label) => {
                      const filter = promptFilters.find((f) => f.label === label);
                      if (filter) void handleSettingsChange({ ...settings, defaultStyle: filter.id });
                    }}
                  />
                </article>

                <article className="panel-card compact-panel">
                  <p className="card-kicker">Auto-paste</p>
                  <p className="panel-title">Send the refined text back automatically</p>
                  <p className="panel-description">If disabled, Openflow still stores the capture in local history.</p>
                  <ToggleSwitch
                    checked={settings.autoPaste}
                    onChange={(checked) => void handleSettingsChange({ ...settings, autoPaste: checked })}
                    label=""
                    description=""
                  />
                </article>
              </div>
            </section>
          ) : null}

          {activeTab === 'history' ? (
            <section className="page page-history">
              <div className="section-header">
                <div>
                  <h2 className="page-heading">History</h2>
                  <p className="page-subcopy">{history.length} capture{history.length === 1 ? '' : 's'} stored locally.</p>
                </div>
                <button className="secondary-button" type="button" onClick={() => void clearHistoryEntries()}>
                  Clear history
                </button>
              </div>

              {history.length === 0 ? (
                <div className="empty-state">
                  <p>No captures yet.</p>
                  <span>Your raw Whisper output and AI-refined text will appear here after the first dictation.</span>
                </div>
              ) : (
                <div className="history-stack">
                  {history.map((entry) => (
                    <article key={entry.id} className="history-card">
                      <div className="history-meta-bar">
                        <span className="history-time">{formatDate(entry.createdAt)}</span>
                        <span className={`history-style-pill ${getHistoryStyleClass(entry.style)}`}>
                          {getFilterLabel(promptFilters, entry.style)}
                        </span>
                        <span className={`history-paste-state${entry.pasted ? ' is-pasted' : ''}`}>
                          {entry.pasted ? 'Pasted' : 'Not pasted'}
                        </span>
                      </div>

                      <div className="history-content-grid">
                        <div className="history-column">
                          <div className="history-column-head">
                            <span className="history-label">Raw</span>
                            <button
                              className={`history-copy-button${copiedKey === `${entry.id}-raw` ? ' is-copied' : ''}`}
                              type="button"
                              onClick={() => void handleCopy(`${entry.id}-raw`, entry.rawText)}
                            >
                              <svg className="ic" width="11" height="11" viewBox="0 0 24 24">
                                <path d="M20 9H11a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V11a2 2 0 0 0-2-2z M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                              </svg>
                              {copiedKey === `${entry.id}-raw` ? 'Copied' : 'Copy raw'}
                            </button>
                          </div>
                          <p className="history-text history-text-raw">{entry.rawText || 'No transcription text captured.'}</p>
                        </div>

                        <div className="history-column">
                          <div className="history-column-head">
                            <span className="history-label">Refined</span>
                            <button
                              className={`history-copy-button${copiedKey === `${entry.id}-refined` ? ' is-copied' : ''}`}
                              type="button"
                              onClick={() => void handleCopy(`${entry.id}-refined`, entry.refinedText)}
                            >
                              <svg className="ic" width="11" height="11" viewBox="0 0 24 24">
                                <path d="M20 9H11a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V11a2 2 0 0 0-2-2z M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                              </svg>
                              {copiedKey === `${entry.id}-refined` ? 'Copied' : 'Copy refined'}
                            </button>
                          </div>
                          <p className="history-text history-text-refined">{entry.refinedText || 'No refined text stored.'}</p>
                        </div>
                      </div>

                      {entry.notice ? <div className="history-note">{entry.notice}</div> : null}
                      {entry.error ? <div className="history-error">{entry.error}</div> : null}
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {activeTab === 'transcription' ? (
            <section className="page page-transcription">
              <div className="page-intro settings-intro">
                <h2 className="page-heading">Transcription</h2>
                <p className="page-subcopy">Manage Whisper models, choose the active transcription model, and control CPU or Vulkan acceleration.</p>
              </div>

              <div className="settings-stack">
                <article className="settings-card">
                  <div className="settings-card-head">
                    <div>
                      <p className="settings-title">Offline model and runtime</p>
                      <p className="settings-description">Choose which Whisper model Openflow should use, download models on demand, and control whether transcription prefers CPU or the bundled Vulkan runtime.</p>
                    </div>
                    <button className="secondary-button" type="button" onClick={() => void window.voskFlow.openModelsFolder()}>
                      <svg className="ic" width="13" height="13" viewBox="0 0 24 24">
                        <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>
                        <path d="M3 10h18"/>
                      </svg>
                      Open folder
                    </button>
                  </div>

                  <div className="local-model-picker">
                    <div>
                      <p className="settings-title">Transcription model</p>
                      <p className="settings-description">Openflow will use the selected Whisper model for every capture.</p>
                    </div>
                    <SegmentedControl
                      options={(bootData?.modelInfo.availableModels ?? []).map((o) => o.label)}
                      value={selectedOfflineModel.label}
                      onChange={(label) => {
                        const option = (bootData?.modelInfo.availableModels ?? []).find((o) => o.label === label);
                        if (option) void handleSettingsChange({ ...settings, offlineModel: option.value as AppSettings['offlineModel'] });
                      }}
                    />
                    <p className="settings-description local-model-summary">
                      {selectedOfflineModel.diskSize} · {selectedOfflineModel.accuracy} accuracy · {selectedOfflineModel.speed} speed · {selectedOfflineModel.memoryUsage} RAM
                    </p>
                  </div>

                  <div className="local-model-picker">
                    <div>
                      <p className="settings-title">Acceleration</p>
                      <p className="settings-description">Auto prefers the bundled Vulkan runtime when present. CPU always uses the bundled CPU runtimes.</p>
                    </div>
                    <SegmentedControl
                      options={ACCELERATION_MODE_OPTIONS.map((o) => o.label)}
                      value={ACCELERATION_MODE_OPTIONS.find((o) => o.value === settings.accelerationMode)?.label ?? 'Auto'}
                      onChange={(label) => {
                        const option = ACCELERATION_MODE_OPTIONS.find((o) => o.label === label);
                        if (option) void handleSettingsChange({ ...settings, accelerationMode: option.value });
                      }}
                    />
                    <p className="settings-description local-model-summary">
                      {bootData?.modelInfo.activeBackendLabel ?? 'Unavailable'}
                      {bootData?.modelInfo.fallbackReason ? ` · ${bootData.modelInfo.fallbackReason}` : ''}
                    </p>
                  </div>

                  {offlineModelDownloadState ? (
                    <div className="download-status-card">
                      <div className="download-status-head">
                        <span className="runtime-label">Transfer</span>
                        <span className="download-status-percent">
                          {offlineModelDownloadState.percent !== undefined
                            ? `${offlineModelDownloadState.percent}%`
                            : offlineModelDownloadState.phase === 'extracting'
                              ? 'Extracting'
                              : 'Downloading'}
                        </span>
                      </div>
                      <p className="runtime-title">{offlineModelDownloadState.label}</p>
                      <p className="runtime-copy">{offlineModelDownloadState.detail}</p>
                      <div className="download-progress-track" aria-hidden="true">
                        <span
                          className="download-progress-fill"
                          style={{
                            width:
                              offlineModelDownloadState.percent !== undefined
                                ? `${offlineModelDownloadState.percent}%`
                                : offlineModelDownloadState.phase === 'extracting'
                                  ? '100%'
                                  : '18%'
                          }}
                        />
                      </div>
                    </div>
                  ) : null}

                  <div className="cleanup-grid">
                    {(bootData?.modelInfo.availableModels ?? []).map((option) => (
                      <div
                        key={option.value}
                        className={`runtime-card${option.installed ? ' is-ready' : ' is-missing'}`}
                      >
                        <span className="runtime-label">Model</span>
                        <p className="runtime-title">{option.label}</p>
                        <p className="runtime-copy">
                          {option.diskSize} · {option.accuracy} accuracy · {option.speed} speed
                        </p>
                        <p className="runtime-meta runtime-path">{option.absolutePath}</p>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() =>
                            void runLocalAiAction(
                              `download-offline-model-${option.value}`,
                              () => window.voskFlow.downloadOfflineModel(option.value),
                              `${option.label} downloaded.`
                            )
                          }
                          disabled={localAiBusyAction !== null || option.installed}
                        >
                          {localAiBusyAction === `download-offline-model-${option.value}`
                            ? 'Downloading…'
                            : option.installed
                              ? 'Installed'
                              : 'Download'}
                        </button>
                        {option.removable ? (
                          <button
                            className="danger-button prompt-remove-button"
                            type="button"
                            onClick={() =>
                              void runLocalAiAction(
                                `remove-offline-model-${option.value}`,
                                () => window.voskFlow.removeOfflineModel(option.value),
                                `${option.label} removed.`
                              )
                            }
                            disabled={localAiBusyAction !== null}
                          >
                            {localAiBusyAction === `remove-offline-model-${option.value}`
                              ? 'Removing…'
                              : 'Remove download'}
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </article>
              </div>
            </section>
          ) : null}

          {activeTab === 'ai' ? (
            <section className="page page-ai">
              <div className="page-intro settings-intro">
                <h2 className="page-heading">AI Refinement</h2>
                <p className="page-subcopy">Choose how Openflow refines transcripts, manage Groq credentials, and install or remove the local AI runtime and models.</p>
              </div>

              <div className="settings-stack">
                <article className="settings-card">
                  <p className="settings-title">Refinement mode</p>
                  <p className="settings-description">Choose whether Openflow should refine with Groq or the managed local AI runtime.</p>
                  <SegmentedControl
                    options={REFINEMENT_MODE_OPTIONS.map((o) => o.label)}
                    value={REFINEMENT_MODE_OPTIONS.find((o) => o.value === settings.refinementMode)?.label ?? 'Groq API'}
                    onChange={(label) => {
                      const option = REFINEMENT_MODE_OPTIONS.find((o) => o.label === label);
                      if (option) void handleSettingsChange({ ...settings, refinementMode: option.value as 'groq' | 'local' });
                    }}
                  />
                </article>

                <article className="settings-card">
                  <p className="settings-title">Default refinement style</p>
                  <p className="settings-description">Used whenever a capture is refined without a manual override.</p>
                  <select
                    className="styled-select"
                    value={settings.defaultStyle}
                    onChange={(event) =>
                      void handleSettingsChange({
                        ...settings,
                        defaultStyle: event.target.value
                      })
                    }
                  >
                    {promptFilters.map((filter) => (
                      <option key={filter.id} value={filter.id}>
                        {filter.label}
                      </option>
                    ))}
                  </select>
                </article>

                {settings.refinementMode === 'groq' && (
                  <article className="settings-card">
                    <div className="settings-card-head">
                      <div>
                        <p className="settings-title">Groq API key</p>
                        <p className="settings-description">Stored locally and used only for Groq cleanup requests and automatic fallback from local AI.</p>
                      </div>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => void window.voskFlow.openGroqApiKeys()}
                      >
                        Get Groq API key
                      </button>
                    </div>
                    <div className="inline-input-row">
                      <input
                        className="text-input"
                        type={showApiKey ? 'text' : 'password'}
                        placeholder="gsk_..."
                        value={settings.groqApiKey}
                        onChange={(event) =>
                          void handleSettingsChange({
                            ...settings,
                            groqApiKey: event.target.value
                          })
                        }
                      />
                      <button className="eye-button" type="button" onClick={() => setShowApiKey((value) => !value)} aria-label="Toggle API key visibility">
                        {showApiKey ? (
                          <svg className="ic" width="14" height="14" viewBox="0 0 24 24">
                            <path d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8S2 12 2 12Z"/>
                            <circle cx="12" cy="12" r="3"/>
                          </svg>
                        ) : (
                          <svg className="ic" width="14" height="14" viewBox="0 0 24 24">
                            <path d="M3 3l18 18"/>
                            <path d="M10.6 10.7A3 3 0 0 0 14 14"/>
                            <path d="M9.4 5.5A10.2 10.2 0 0 1 12 5c6 0 10 7 10 7a17.6 17.6 0 0 1-4 4.9"/>
                            <path d="M6.7 6.7A17.4 17.4 0 0 0 2 12s4 7 10 7a9.7 9.7 0 0 0 4-.9"/>
                          </svg>
                        )}
                      </button>
                    </div>
                  </article>
                )}

                {settings.refinementMode === 'groq' && (
                  <article className="settings-card">
                    <p className="settings-title">Hosted model ID</p>
                    <p className="settings-description">The Groq model Openflow uses when Groq refinement is selected or used as a fallback.</p>
                    <input
                      className="text-input"
                      type="text"
                      placeholder={GROQ_REFINEMENT_MODEL}
                      value={settings.refinementModel}
                      onChange={(event) =>
                        void handleSettingsChange({
                          ...settings,
                          refinementModel: event.target.value
                        })
                      }
                    />
                  </article>
                )}

                {settings.refinementMode === 'local' && (
                <article className="settings-card">
                  <div className="settings-card-head">
                    <div>
                      <p className="settings-title">Local AI refinement</p>
                      <p className="settings-description">Download and manage the local llama.cpp runtime and cleanup model directly inside Openflow.</p>
                    </div>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() =>
                        void runLocalAiAction(
                          'refresh-local-ai',
                          () => window.voskFlow.refreshLocalAi()
                        )
                      }
                      disabled={localAiBusyAction !== null}
                    >
                      Refresh status
                    </button>
                  </div>

                  <div className="local-model-picker">
                    <div>
                      <p className="settings-title">Local cleanup model</p>
                      <p className="settings-description">
                        Pick the model Openflow should install and run for local refinement.
                      </p>
                    </div>
                    <SegmentedControl
                      options={(bootData?.localAiInfo?.availableModels ?? []).map((o) => o.label)}
                      value={(bootData?.localAiInfo?.availableModels ?? []).find((o) => o.value === settings.localRefinementModel)?.label ?? ''}
                      onChange={(label) => {
                        const option = (bootData?.localAiInfo?.availableModels ?? []).find((o) => o.label === label);
                        if (option) void handleSettingsChange({ ...settings, localRefinementModel: option.value });
                      }}
                    />
                    <p className="settings-description local-model-summary">
                      {bootData?.localAiInfo?.modelSummary ?? 'Choose a local cleanup model.'}{' '}
                      <span className="local-model-size">{bootData?.localAiInfo?.modelSize ?? ''}</span>
                    </p>
                  </div>

                  <div className="runtime-grid">
                    <div className={`runtime-card${bootData?.localAiInfo?.runtimeInstalled ? ' is-ready' : ' is-missing'}`}>
                      <span className="runtime-label">Runtime</span>
                      <p className="runtime-title">{bootData?.localAiInfo?.runtimeInstalled ? 'llama.cpp installed' : 'Runtime not installed'}</p>
                      <p className="runtime-copy">{bootData?.localAiInfo?.runtimeInstalled ? 'Managed locally by Openflow' : 'Download once to enable local cleanup'}</p>
                      <p className="runtime-meta runtime-path">{bootData?.localAiInfo?.runtimePath ?? 'Loading runtime path...'}</p>
                    </div>
                    <div className={`runtime-card${bootData?.localAiInfo?.modelInstalled ? ' is-ready' : ' is-missing'}`}>
                      <span className="runtime-label">Model</span>
                      <p className="runtime-title">{bootData?.localAiInfo?.modelLabel ?? 'Loading model info...'}</p>
                      <p className="runtime-copy">{bootData?.localAiInfo?.modelInstalled ? 'Installed and available for cleanup' : 'Needs download before local refinement can run'}</p>
                      <p className="runtime-meta runtime-path">{bootData?.localAiInfo?.modelPath ?? 'Loading model path...'}</p>
                    </div>
                  </div>

                  <div className="runtime-grid">
                    <div className={`runtime-card${bootData?.localAiInfo?.healthy ? ' is-ready' : ' is-missing'}`}>
                      <span className="runtime-label">Health</span>
                      <p className="runtime-title">
                        {!bootData?.localAiInfo
                          ? 'Loading local AI status...'
                          : bootData.localAiInfo.downloadState
                            ? bootData.localAiInfo.downloadState.phase === 'extracting'
                              ? `Extracting ${bootData.localAiInfo.downloadState.label}`
                              : `Downloading ${bootData.localAiInfo.downloadState.label}`
                          : bootData.localAiInfo.healthy
                            ? bootData.localAiInfo.runningModelFileName &&
                              bootData.localAiInfo.runningModelFileName !== bootData.localAiInfo.selectedModelValue
                              ? 'Running another model'
                              : 'Running and ready'
                            : bootData.localAiInfo.serverRunning
                              ? 'Starting up'
                              : bootData.localAiInfo.runtimeInstalled && bootData.localAiInfo.modelInstalled
                                ? 'Installed but stopped'
                                : 'Not installed'}
                      </p>
                      <p className="runtime-copy">
                        {bootData?.localAiInfo?.fallbackToGroqAvailable
                          ? 'If local AI is unavailable, Openflow can fall back to Groq automatically.'
                          : 'If local AI is unavailable and no Groq key is set, Openflow falls back to the raw transcript.'}
                      </p>
                      <p className="runtime-meta runtime-path">{bootData?.localAiInfo?.serverUrl ?? 'Loading server URL...'}</p>
                      {bootData?.localAiInfo?.runningModelFileName &&
                      bootData.localAiInfo.runningModelFileName !== bootData.localAiInfo.selectedModelValue ? (
                        <p className="runtime-meta runtime-warning">
                          Running model: {bootData.localAiInfo.runningModelFileName}. Restart local AI to switch to the newly selected model.
                        </p>
                      ) : null}
                    </div>
                    <div className="runtime-card">
                      <span className="runtime-label">Actions</span>
                      <p className="runtime-title">Managed by Openflow</p>
                      <p className="runtime-copy">Install the runtime and model once, then start or stop the local cleanup server whenever you want.</p>
                      <div className="runtime-actions">
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() =>
                            void runLocalAiAction(
                              'install-runtime',
                              () => window.voskFlow.installLocalAiRuntime(),
                              'Local AI runtime installed.'
                            )
                          }
                          disabled={localAiBusyAction !== null}
                        >
                          {localAiBusyAction === 'install-runtime' ? 'Installing…' : 'Install runtime'}
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() =>
                            void runLocalAiAction(
                              'install-model',
                              () => window.voskFlow.installLocalAiModel(),
                              'Local AI model installed.'
                            )
                          }
                          disabled={localAiBusyAction !== null}
                        >
                          {localAiBusyAction === 'install-model' ? 'Installing…' : 'Install model'}
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() =>
                            void runLocalAiAction(
                              'start-local-ai',
                              () => window.voskFlow.startLocalAi(),
                              'Local AI server started.'
                            )
                          }
                          disabled={localAiBusyAction !== null}
                        >
                          {localAiBusyAction === 'start-local-ai' ? 'Starting…' : 'Start server'}
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() =>
                            void runLocalAiAction(
                              'stop-local-ai',
                              () => window.voskFlow.stopLocalAi(),
                              'Local AI server stopped.'
                            )
                          }
                          disabled={localAiBusyAction !== null}
                        >
                          {localAiBusyAction === 'stop-local-ai' ? 'Stopping…' : 'Stop server'}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="cleanup-grid">
                    <div className="runtime-card is-missing">
                      <span className="runtime-label">Cleanup</span>
                      <p className="runtime-title">Remove local AI runtime</p>
                      <p className="runtime-copy">Deletes the downloaded llama.cpp runtime files.</p>
                      <button
                        className="danger-button"
                        type="button"
                        onClick={() =>
                          void runLocalAiAction(
                            'cleanup-runtime',
                            () => window.voskFlow.removeLocalAiRuntime(),
                            'Local AI runtime removed.'
                          )
                        }
                        disabled={localAiBusyAction !== null}
                      >
                        {localAiBusyAction === 'cleanup-runtime' ? 'Removing runtime…' : 'Remove runtime'}
                      </button>
                    </div>
                    <div className="runtime-card is-missing">
                      <span className="runtime-label">Cleanup</span>
                      <p className="runtime-title">Remove local AI models</p>
                      <p className="runtime-copy">Deletes all downloaded local refinement models.</p>
                      <button
                        className="danger-button"
                        type="button"
                        onClick={() =>
                          void runLocalAiAction(
                            'cleanup-models',
                            () => window.voskFlow.removeLocalAiModels(),
                            'Local AI models removed.'
                          )
                        }
                        disabled={localAiBusyAction !== null}
                      >
                        {localAiBusyAction === 'cleanup-models' ? 'Removing models…' : 'Remove models'}
                      </button>
                    </div>
                  </div>

                  {bootData?.localAiInfo?.downloadState ? (
                    <div className="download-status-card">
                      <div className="download-status-head">
                        <span className="runtime-label">
                          {bootData.localAiInfo.downloadState.target === 'runtime' ? 'Runtime' : 'Model'}
                        </span>
                        <span className="download-status-percent">
                          {bootData.localAiInfo.downloadState.percent !== undefined
                            ? `${bootData.localAiInfo.downloadState.percent}%`
                            : bootData.localAiInfo.downloadState.phase === 'extracting'
                              ? 'Extracting'
                              : 'Downloading'}
                        </span>
                      </div>
                      <p className="runtime-title">{bootData.localAiInfo.downloadState.label}</p>
                      <p className="runtime-copy">{bootData.localAiInfo.downloadState.detail}</p>
                      <div className="download-progress-track" aria-hidden="true">
                        <span
                          className="download-progress-fill"
                          style={{
                            width:
                              bootData.localAiInfo.downloadState.percent !== undefined
                                ? `${bootData.localAiInfo.downloadState.percent}%`
                                : bootData.localAiInfo.downloadState.phase === 'extracting'
                                  ? '100%'
                                  : '18%'
                          }}
                        />
                      </div>
                    </div>
                  ) : null}
                </article>
                )}
              </div>
            </section>
          ) : null}

          {activeTab === 'pet' ? (
            <PetTab settings={settings} onSettingsChange={handleSettingsChange} />
          ) : null}

          {activeTab === 'prompts' ? (
            <section className="page page-prompts">
              <div className="section-header">
                <div>
                  <h2 className="page-heading">Prompts</h2>
                  <p className="page-subcopy">Edit built-in filters, tune the instructions, and create custom filters for specialized cleanup behavior.</p>
                </div>
                <button className="secondary-button" type="button" onClick={() => void addPromptFilter()}>
                  Create filter
                </button>
              </div>

              <div className="compact-card-list">
                <div className="compact-card">
                  <div className="compact-card-meta">
                    <span className="compact-card-label">Default style</span>
                  </div>
                  <SegmentedControl
                    options={promptFilters.map((f) => f.label)}
                    value={promptFilters.find((f) => f.id === settings.defaultStyle)?.label ?? 'Casual'}
                    onChange={(label) => {
                      const filter = promptFilters.find((f) => f.label === label);
                      if (filter) void handleSettingsChange({ ...settings, defaultStyle: filter.id });
                    }}
                  />
                </div>

                {promptFilters.map((filter) => (
                  <div key={filter.id} className={`compact-card${settings.defaultStyle === filter.id ? ' is-default' : ''}`}>
                    <div className="compact-card-meta">
                      <span className="compact-card-label">{filter.label}</span>
                      <span className="compact-card-badge">{filter.builtIn ? 'built-in' : 'custom'}</span>
                      <div className="compact-card-actions">
                        <button
                          className="btn-mini"
                          type="button"
                          onClick={() => void savePromptFilter(filter.id)}
                          disabled={!hasPromptDraftChanges(filter)}
                        >
                          Save
                        </button>
                        {!filter.builtIn ? (
                          <button
                            className="btn-mini btn-mini-danger"
                            type="button"
                            onClick={() => void removePromptFilter(filter.id)}
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="compact-card-grid">
                      <div className="compact-card-field">
                        <span className="compact-field-label">Name</span>
                        <input
                          className="compact-card-input"
                          type="text"
                          value={promptDrafts[filter.id]?.label ?? filter.label}
                          onChange={(event) =>
                            updatePromptDraft(filter.id, { label: event.target.value })
                          }
                        />
                      </div>

                      <div className="compact-card-field compact-card-field-wide">
                        <span className="compact-field-label">Instruction</span>
                        <textarea
                          className="compact-card-textarea"
                          value={promptDrafts[filter.id]?.instruction ?? filter.instruction}
                          onChange={(event) =>
                            updatePromptDraft(filter.id, { instruction: event.target.value })
                          }
                        />
                      </div>
                    </div>

                    {promptErrors[filter.id] ? (
                      <div className="compact-card-error">{promptErrors[filter.id]}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {activeTab === 'info' ? (
            <section className="page page-info">
              <div className="page-intro settings-intro">
                <h2 className="page-heading">Info</h2>
                <p className="page-subcopy">Technical runtime details for the active Whisper backend, bundled runtimes, and the currently selected model file.</p>
              </div>

              <div className="settings-stack">
                <article className="settings-card">
                  <div className="runtime-grid">
                    <div className={`runtime-card${bootData?.modelInfo.binaryExists && bootData?.modelInfo.exists ? ' is-ready' : ' is-missing'}`}>
                      <span className="runtime-label">Active model</span>
                      <p className="runtime-title">{selectedOfflineModel.label}</p>
                      <p className="runtime-copy">{bootData?.modelInfo.binaryExists && bootData?.modelInfo.exists ? 'Installed and ready' : 'Needs setup'}</p>
                      <p className="runtime-meta">{selectedOfflineModel.diskSize} · {selectedOfflineModel.accuracy} accuracy · {selectedOfflineModel.speed} speed</p>
                    </div>
                    <div className={`runtime-card${bootData?.modelInfo.binaryExists ? ' is-ready' : ' is-missing'}`}>
                      <span className="runtime-label">Active backend</span>
                      <p className="runtime-title">{bootData?.modelInfo.activeBackendLabel ?? 'Unavailable'}</p>
                      <p className="runtime-copy">
                        {bootData?.modelInfo.binaryExists
                          ? `Approx. ${selectedOfflineModel.memoryUsage} RAM during transcription`
                          : 'Bundled whisper.cpp runtime missing'}
                      </p>
                      <p className="runtime-meta runtime-path">{bootData?.modelInfo.binaryPath}</p>
                    </div>
                    <div className={`runtime-card${bootData?.modelInfo.vulkanRuntimeBundled ? ' is-ready' : ' is-missing'}`}>
                      <span className="runtime-label">Vulkan</span>
                      <p className="runtime-title">
                        {bootData?.modelInfo.vulkanRuntimeBundled ? 'Bundled in this build' : 'Not bundled in this build'}
                      </p>
                      <p className="runtime-copy">
                        {bootData?.modelInfo.systemVulkanAvailable
                          ? 'System Vulkan tooling detected'
                          : 'System Vulkan tooling was not detected'}
                      </p>
                      <p className="runtime-meta runtime-path">{bootData?.modelInfo.vulkanRuntimePath}</p>
                    </div>
                  </div>

                  <div className="cleanup-grid backend-grid">
                    {(bootData?.modelInfo.availableBackends ?? []).map((backend) => (
                      <div
                        key={backend.id}
                        className={`runtime-card${backend.bundled ? ' is-ready' : ' is-missing'}`}
                      >
                        <span className="runtime-label">{backend.kind === 'vulkan' ? 'GPU backend' : 'CPU backend'}</span>
                        <p className="runtime-title">{backend.label}</p>
                        <p className="runtime-copy">{backend.note ?? (backend.bundled ? 'Ready' : 'Missing')}</p>
                        <p className="runtime-meta runtime-path">{backend.binaryPath}</p>
                      </div>
                    ))}
                  </div>

                  {bootData?.modelInfo.fallbackReason ? (
                    <div className="history-error">{bootData.modelInfo.fallbackReason}</div>
                  ) : null}

                  <div className="runtime-grid">
                    <div className={`runtime-card${bootData?.modelInfo.exists ? ' is-ready' : ' is-missing'}`}>
                      <span className="runtime-label">Selected model path</span>
                      <p className="runtime-title">{selectedOfflineModel.fileName}</p>
                      <p className="runtime-copy">
                        {bootData?.modelInfo.exists ? 'Downloaded and ready' : 'Download this model before first transcription'}
                      </p>
                      <p className="runtime-meta runtime-path">{bootData?.modelInfo.absolutePath}</p>
                    </div>
                  </div>
                </article>
              </div>
            </section>
          ) : null}

          {activeTab === 'settings' ? (
            <section className="page page-settings">
              <div className="page-intro settings-intro">
                <h2 className="page-heading">Settings</h2>
                <p className="page-subcopy">Manage app-wide behavior, vocabulary, startup, and global cleanup actions.</p>
              </div>

              <div className="settings-stack">
                <article className="settings-card">
                  <p className="settings-title">Accent theme</p>
                  <p className="settings-description">Choose the accent color used for active controls and highlights.</p>
                  <div className="theme-grid">
                    {[
                      { id: 'default', label: 'Default', color: '#7878ff' },
                      { id: 'violet', label: 'Violet', color: '#a882ff' },
                      { id: 'rose', label: 'Rose', color: '#ff6e82' },
                      { id: 'emerald', label: 'Emerald', color: '#3cd28c' },
                      { id: 'amber', label: 'Amber', color: '#fbb43c' },
                      { id: 'sky', label: 'Sky', color: '#38beff' },
                      { id: 'mono', label: 'Mono', color: '#c8c8c8' }
                    ].map((theme) => (
                      <button
                        key={theme.id}
                        className={`theme-swatch${accentTheme === theme.id ? ' is-active' : ''}`}
                        type="button"
                        onClick={() => {
                          setAccentTheme(theme.id);
                          void handleSettingsChange({ ...settings, accentTheme: theme.id });
                        }}
                        aria-label={theme.label}
                      >
                        <span className="theme-swatch-box" style={{ background: theme.color }} />
                        <span className="theme-swatch-label">{theme.label}</span>
                      </button>
                    ))}
                  </div>
                </article>

                <article className="settings-card">
                  <p className="settings-title">Background</p>
                  <p className="settings-description">Choose the animated canvas background style for the app shell.</p>
                  <SegmentedControl
                    options={['On', 'Minimal', 'Off']}
                    value={backgroundStyle === 'streaks' ? 'On' : backgroundStyle === 'minimal' ? 'Minimal' : 'Off'}
                    onChange={(label) => {
                      const value = label === 'On' ? 'streaks' : label === 'Minimal' ? 'minimal' : 'off';
                      setBackgroundStyle(value);
                      void handleSettingsChange({ ...settings, backgroundStyle: value });
                    }}
                  />
                </article>

                <article className="settings-card">
                  <p className="settings-title">Background effect</p>
                  <p className="settings-description">Choose the animated shader effect and color scheme for the canvas background.</p>
                  <SegmentedControl
                    options={Object.values(SHADER_PRESETS).map((s) => s.label)}
                    value={SHADER_PRESETS[bgShaderType]?.label ?? 'Flowing Gradient'}
                    onChange={(label) => {
                      const entry = Object.entries(SHADER_PRESETS).find(([, v]) => v.label === label);
                      if (!entry) return;
                      const [typeKey] = entry;
                      const firstPreset = Object.entries(SHADER_PRESETS[typeKey].presets)[0];
                      setBgShaderType(typeKey);
                      setBgShaderPreset(firstPreset[0]);
                      const colors = firstPreset[1].colors;
                      setBgShaderColors(colors);
                      setBgCustomColors([]);
                      void handleSettingsChange({ ...settings, bgShaderType: typeKey, bgShaderColors: JSON.stringify(colors) });
                    }}
                  />
                  <div className="theme-grid" style={{ marginTop: 12 }}>
                    {Object.entries(SHADER_PRESETS[bgShaderType]?.presets ?? {}).map(([key, preset]) => (
                      <button
                        key={key}
                        className={`theme-swatch${bgShaderPreset === key ? ' is-active' : ''}`}
                        type="button"
                        onClick={() => {
                          setBgShaderPreset(key);
                          setBgShaderColors(preset.colors);
                          setBgCustomColors([]);
                          void handleSettingsChange({ ...settings, bgShaderColors: JSON.stringify(preset.colors) });
                        }}
                        aria-label={preset.label}
                      >
                        <span className="theme-swatch-box" style={{ background: preset.colors[0] }} />
                        <span className="theme-swatch-label">{preset.label}</span>
                      </button>
                    ))}
                    <button
                      className={`theme-swatch${bgShaderPreset === 'custom' ? ' is-active' : ''}`}
                      type="button"
                      onClick={() => {
                        setBgShaderPreset('custom');
                        setBgCustomColors([...bgShaderColors]);
                      }}
                      aria-label="Custom"
                    >
                      <span className="theme-swatch-box" style={{ background: 'linear-gradient(135deg, #ff0000, #00ff00, #0000ff)', border: '1px dashed var(--muted-foreground)' }} />
                      <span className="theme-swatch-label">Custom</span>
                    </button>
                  </div>
                  {bgShaderPreset === 'custom' && bgCustomColors.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      {bgCustomColors.map((color, i) => (
                        <label key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted-foreground)' }}>
                          {String.fromCharCode(65 + i)}
                          <input
                            type="color"
                            value={color}
                            onChange={(e) => {
                              const next = [...bgCustomColors];
                              next[i] = e.target.value;
                              setBgCustomColors(next);
                              setBgShaderColors(next);
                              setBgShaderPreset('custom');
                            }}
                            onBlur={() => {
                              void handleSettingsChange({ ...settings, bgShaderColors: JSON.stringify(bgShaderColors) });
                            }}
                            style={{ width: 36, height: 36, border: 'none', borderRadius: 8, background: 'none', cursor: 'pointer' }}
                          />
                        </label>
                      ))}
                    </div>
                  )}
                </article>

                <article className="settings-card">
                  <p className="settings-title">Vocabulary</p>
                  <p className="settings-description">Names, brands, and technical terms to preserve exactly when the transcript implies them.</p>
                  <div className="vocabulary-editor">
                    {settings.vocabulary.map((entry) => (
                      <span key={entry} className="vocabulary-tag">
                        {entry}
                        <button type="button" className="vocabulary-remove" aria-label={`Remove ${entry}`} onClick={() => void removeVocabularyEntry(entry)}>
                          ×
                        </button>
                      </span>
                    ))}
                    <input
                      className="vocabulary-input"
                      type="text"
                      placeholder={settings.vocabulary.length === 0 ? 'Add a term, then press Enter' : 'Add another term'}
                      value={vocabularyDraft}
                      onChange={(event) => setVocabularyDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ',') {
                          event.preventDefault();
                          void commitVocabularyDraft(vocabularyDraft);
                        }
                      }}
                      onBlur={() => void commitVocabularyDraft(vocabularyDraft)}
                      onPaste={(event) => {
                        const pastedText = event.clipboardData.getData('text');
                        if (!/[,\r\n]/.test(pastedText)) {
                          return;
                        }

                        event.preventDefault();
                        void commitVocabularyDraft(pastedText);
                      }}
                    />
                  </div>
                </article>

                <article className="settings-card">
                  <ToggleSwitch
                    checked={settings.autoPaste}
                    onChange={(checked) => void handleSettingsChange({ ...settings, autoPaste: checked })}
                    label="Auto-paste"
                    description="Paste the refined output back into the active app automatically after processing."
                  />
                </article>

                <article className="settings-card">
                  <ToggleSwitch
                    checked={settings.launchAtStartup}
                    onChange={(checked) => void handleSettingsChange({ ...settings, launchAtStartup: checked })}
                    label="Launch at Startup"
                    description="Open Openflow automatically when you sign in to Windows."
                  />
                </article>

                <article className="settings-card">
                  <p className="settings-title">Sounds</p>
                  <div className="sound-row">
                    <div className="sound-field">
                      <p className="settings-description">Capture start</p>
                      <div className="sound-controls">
                        <select
                          className="styled-select sound-select"
                          value={settings.soundCaptureStart}
                          onChange={(event) =>
                            void handleSettingsChange({
                              ...settings,
                              soundCaptureStart: event.target.value as CaptureSoundId
                            })
                          }
                        >
                          {CAPTURE_SOUND_OPTIONS.map((o) => (
                            <option key={o.id} value={o.id}>{o.label}</option>
                          ))}
                        </select>
                        <button
                          className="secondary-button sound-preview-btn"
                          type="button"
                          disabled={settings.soundCaptureStart === 'none'}
                          onClick={() => {
                            const fn = CAPTURE_FN_MAP[settings.soundCaptureStart];
                            if (fn) fn();
                          }}
                        >
                          Preview
                        </button>
                      </div>
                    </div>
                    <div className="sound-field">
                      <p className="settings-description">Paste done</p>
                      <div className="sound-controls">
                        <select
                          className="styled-select sound-select"
                          value={settings.soundPasteDone}
                          onChange={(event) =>
                            void handleSettingsChange({
                              ...settings,
                              soundPasteDone: event.target.value as PasteSoundId
                            })
                          }
                        >
                          {PASTE_SOUND_OPTIONS.map((o) => (
                            <option key={o.id} value={o.id}>{o.label}</option>
                          ))}
                        </select>
                        <button
                          className="secondary-button sound-preview-btn"
                          type="button"
                          disabled={settings.soundPasteDone === 'none'}
                          onClick={() => {
                            const fn = PASTE_FN_MAP[settings.soundPasteDone];
                            if (fn) fn();
                          }}
                        >
                          Preview
                        </button>
                      </div>
                    </div>
                  </div>
                </article>

                <article className="settings-card">
                  <p className="settings-title">Dictation hotkey</p>
                  <p className="settings-description">The current hold-to-talk shortcut used everywhere in Windows.</p>
                  <div className="hotkey-display-row">
                    <span className="hotkey-badge">Ctrl + Win</span>
                    <span className="hotkey-caption">Hold to record, release to process.</span>
                  </div>
                </article>

                <article className="settings-card danger-zone">
                  <p className="settings-title">Cleanup</p>
                  <p className="settings-description">Reset saved app data or clear every downloaded Openflow asset in one step.</p>

                  <div className="cleanup-grid">
                    <div className="runtime-card is-missing">
                      <span className="runtime-label">Settings + history</span>
                      <p className="runtime-title">Reset saved app data</p>
                      <p className="runtime-copy">Clears your capture history and restores settings to their default values.</p>
                      <button
                        className="danger-button"
                        type="button"
                        onClick={() =>
                          void runCleanupAction(
                            'cleanup-settings-history',
                            () => window.voskFlow.resetSettingsAndHistory(),
                            'Settings reset and history cleared.',
                            { clearPreviews: true }
                          )
                        }
                        disabled={localAiBusyAction !== null}
                      >
                        {localAiBusyAction === 'cleanup-settings-history' ? 'Resetting…' : 'Reset settings + history'}
                      </button>
                    </div>

                    <div className="runtime-card is-missing">
                      <span className="runtime-label">Full reset</span>
                      <p className="runtime-title">Delete all local Openflow data</p>
                      <p className="runtime-copy">Removes downloaded Whisper models, local AI runtime and models, saved settings, history, and leftover capture files.</p>
                      <button
                        className="danger-button"
                        type="button"
                        onClick={() =>
                          void runCleanupAction(
                            'cleanup-full-reset',
                            () => window.voskFlow.fullReset(),
                            'Openflow local data has been fully reset.',
                            { clearPreviews: true }
                          )
                        }
                        disabled={localAiBusyAction !== null}
                      >
                        {localAiBusyAction === 'cleanup-full-reset' ? 'Resetting everything…' : 'Full reset'}
                      </button>
                    </div>
                  </div>
                </article>

                <div className="settings-footnote">
                  {savingSettings ? 'Saving settings…' : 'Settings save locally as you edit.'}
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </section>
    </main>
  );
}
