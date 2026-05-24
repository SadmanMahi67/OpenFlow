import { useEffect, useRef, useState } from 'react';

import {
  BUILT_IN_PROMPT_FILTERS,
  DEFAULT_OVERLAY_STATE,
  DEFAULT_SETTINGS,
  GROQ_REFINEMENT_MODEL,
  OFFLINE_MODEL_OPTIONS,
  REFINEMENT_MODE_OPTIONS,
  type AppSettings,
  type BootstrapPayload,
  type HistoryEntry,
  type LocalAiInfo,
  type OverlayState,
  type PromptFilter,
  type RefinementMode,
  type RefinementStyle
} from './shared/types';

type AppStatus =
  | 'booting'
  | 'idle'
  | 'loading-model'
  | 'recording'
  | 'processing'
  | 'done'
  | 'error';

type AppTab = 'home' | 'history' | 'transcription' | 'ai' | 'prompts' | 'info' | 'settings';
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

function getStatusCopy(status: AppStatus): { title: string; detail: string; hint: string } {
  switch (status) {
    case 'booting':
      return {
        title: 'Starting up',
        detail: 'Loading your local settings and history.',
        hint: 'Preparing your workspace'
      };
    case 'loading-model':
      return {
        title: 'Preparing audio',
        detail: 'Checking the offline Whisper runtime and capture pipeline.',
        hint: 'Mic and model warm-up in progress'
      };
    case 'recording':
      return {
        title: 'Recording',
        detail: 'Capture is live. Release Ctrl + Win when you are finished speaking.',
        hint: 'Release Ctrl + Win to stop'
      };
    case 'processing':
      return {
        title: 'Processing',
        detail: 'Whisper is transcribing and the cleanup model is polishing the text.',
        hint: 'Finishing transcript and refinement'
      };
    case 'done':
      return {
        title: 'Done',
        detail: 'Latest result is ready and stored in local history.',
        hint: 'Hold Ctrl + Win to start again'
      };
    case 'error':
      return {
        title: 'Needs attention',
        detail: 'The last capture hit an error. Review the note below.',
        hint: 'Check the latest note for details'
      };
    case 'idle':
      return {
        title: 'Ready',
        detail: 'Hold Ctrl + Win anywhere on Windows to start dictating.',
        hint: 'Hold Ctrl + Win to dictate'
      };
  }
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

function getOverlayTitle(state: OverlayState): string {
  if (state.status === 'hidden' || state.status === 'idle') {
    return 'Ready';
  }

  return state.message;
}

function getOverlayHint(state: OverlayState): string {
  switch (state.status) {
    case 'recording':
      return 'Release Ctrl + Win to stop';
    case 'processing':
      return 'Whisper and AI cleanup are running';
    case 'done':
      return 'Transcript completed';
    case 'error':
      return 'Review the main app for details';
    case 'hidden':
    case 'idle':
      return 'Hold Ctrl + Win to dictate';
  }
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
  const [overlayState, setOverlayState] = useState<OverlayState>(DEFAULT_OVERLAY_STATE);

  useEffect(() => {
    void window.voskFlow.getBootstrap().then((payload) => setOverlayState(payload.overlayState));
    return window.voskFlow.onOverlayState((nextState) => setOverlayState(nextState));
  }, []);

  return (
    <main className={`overlay-shell overlay-${overlayState.status}`}>
      <div className="overlay-card">
        <div className="overlay-body">
          <div className="overlay-status-row">
            <div className="overlay-dot-wrap">
              <div className="overlay-ring" />
              <div className="overlay-dot" />
            </div>
            <span className="overlay-state-text">{getOverlayTitle(overlayState)}</span>
          </div>

          <div className="overlay-wave" aria-hidden={overlayState.status !== 'recording'}>
            {Array.from({ length: 12 }).map((_, index) => (
              <span key={index} className="overlay-wave-bar" />
            ))}
          </div>

          <div className="overlay-progress" aria-hidden={overlayState.status !== 'processing'}>
            <span className="overlay-progress-fill" />
          </div>

          <div className={`overlay-inline-message${overlayState.status === 'error' ? ' is-visible' : ''}`}>
            {overlayState.status === 'error' ? overlayState.message : ''}
          </div>
        </div>

        <div className="overlay-hint-bar">{getOverlayHint(overlayState)}</div>
      </div>
    </main>
  );
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

function InfoIcon(): JSX.Element {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function CopyIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function OpenFolderIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="M3 10h18" />
    </svg>
  );
}

function EyeIcon({ visible }: { visible: boolean }): JSX.Element {
  if (visible) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3l18 18" />
      <path d="M10.6 10.7A3 3 0 0 0 14 14" />
      <path d="M9.4 5.5A10.2 10.2 0 0 1 12 5c6 0 10 7 10 7a17.6 17.6 0 0 1-4 4.9" />
      <path d="M6.7 6.7A17.4 17.4 0 0 0 2 12s4 7 10 7a9.7 9.7 0 0 0 4-.9" />
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
  const [promptDrafts, setPromptDrafts] = useState<Record<string, PromptDraft>>({});
  const [promptErrors, setPromptErrors] = useState<Record<string, string>>({});
  const recordingRef = useRef<boolean>(false);
  const copyResetTimerRef = useRef<number | null>(null);

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

    const unsubscribe = window.voskFlow.onRecordingCommand((command) => {
      if (command === 'start') {
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

  if (overlayMode) {
    return <OverlayApp />;
  }

  const statusCopy = getStatusCopy(status);
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
            : activeTab === 'prompts'
              ? 'prompts'
              : activeTab === 'info'
                ? 'info'
              : 'settings';
  const localAiInfo: LocalAiInfo | null = bootData?.localAiInfo ?? null;
  const offlineModelDownloadState = bootData?.modelInfo.downloadState;
  const localAiStatusText = !localAiInfo
    ? 'Loading local AI status...'
    : localAiInfo.downloadState
      ? localAiInfo.downloadState.phase === 'extracting'
        ? `Extracting ${localAiInfo.downloadState.label}`
        : `Downloading ${localAiInfo.downloadState.label}`
    : localAiInfo.healthy
      ? localAiInfo.runningModelFileName &&
        localAiInfo.runningModelFileName !== localAiInfo.selectedModelValue
        ? 'Running another model'
        : 'Running and ready'
      : localAiInfo.serverRunning
        ? 'Starting up'
        : localAiInfo.runtimeInstalled && localAiInfo.modelInstalled
          ? 'Installed but stopped'
          : 'Not installed';

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

  return (
    <main className="app-shell">
      <div className="ambient-orb ambient-orb-one" />
      <div className="ambient-orb ambient-orb-two" />
      <div className="ambient-orb ambient-orb-three" />

      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <path d="M12 19v3" />
              <path d="M8 22h8" />
            </svg>
          </div>
          <div>
            <p className="brand-title">Openflow</p>
            <p className="brand-subtitle">dictate · refine · paste</p>
          </div>
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
          <span className="topbar-product">Openflow</span>
          <span className="topbar-separator">/</span>
          <span className="topbar-location">{activeTabLabel}</span>
        </header>

        <div className="workspace-scroll">
          {activeTab === 'home' ? (
            <section className="page page-home">
              <div className="page-intro">
                <h1 className="page-title">
                  <span className="page-title-primary">Open</span>
                  <span className="page-title-accent">flow</span>
                </h1>
                <p className="page-subtitle">
                  Speak with Ctrl + Win. Whisper transcribes offline, Groq or local AI cleans it up, and Openflow pastes the final result back where you were typing.
                </p>
              </div>

              <div className={`status-banner status-${status}`}>
                <div className="status-banner-main">
                  <div className="status-indicator">
                    <span className="status-indicator-dot" />
                  </div>
                  <div>
                    <p className="status-banner-title">{statusCopy.title}</p>
                    <p className="status-banner-detail">{statusCopy.detail}</p>
                  </div>
                </div>
                <div className="status-banner-hint">
                  {status === 'recording' || status === 'processing' ? statusCopy.hint : <>Hold <span className="keycap">Ctrl + Win</span> to dictate</>}
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
                      <CopyIcon />
                      <span>{copiedKey === 'home-raw' ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  <div className="transcript-body transcript-body-raw">
                    {latestRawText || 'Your next Whisper transcript will appear here.'}
                  </div>
                </article>

                <article className="transcript-card transcript-card-refined">
                  <div className="card-head">
                    <span className="card-kicker">Refined Transcript</span>
                    <button
                      className={`copy-status-button${copiedKey === 'home-refined' ? ' is-copied' : ''}`}
                      type="button"
                      onClick={() => void handleCopy('home-refined', latestRefinedText)}
                      aria-label="Copy latest refined transcript"
                    >
                      <CopyIcon />
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

                <article className="panel-card compact-panel">
                  <p className="card-kicker">Auto-paste</p>
                  <p className="panel-title">Send the refined text back automatically</p>
                  <p className="panel-description">If disabled, Openflow still stores the capture in local history.</p>
                  <div className="toggle-row ui-toggle-row">
                    <span>{settings.autoPaste ? 'Enabled' : 'Disabled'}</span>
                    <button
                      className={`toggle-switch${settings.autoPaste ? ' is-on' : ''}`}
                      type="button"
                      aria-pressed={settings.autoPaste}
                      onClick={() =>
                        void handleSettingsChange({
                          ...settings,
                          autoPaste: !settings.autoPaste
                        })
                      }
                    >
                      <span />
                    </button>
                  </div>
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
                              <CopyIcon />
                              {copiedKey === `${entry.id}-raw` ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                          <p className="history-text history-text-raw">{entry.rawText || 'No transcription text captured.'}</p>
                        </div>

                        <div className="history-column">
                          <div className="history-column-head">
                            <span className="history-label history-label-refined">Refined</span>
                            <button
                              className={`history-copy-button${copiedKey === `${entry.id}-refined` ? ' is-copied' : ''}`}
                              type="button"
                              onClick={() => void handleCopy(`${entry.id}-refined`, entry.refinedText)}
                            >
                              <CopyIcon />
                              {copiedKey === `${entry.id}-refined` ? 'Copied' : 'Copy'}
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
                    <button className="secondary-button icon-secondary-button" type="button" onClick={() => void window.voskFlow.openModelsFolder()}>
                      <OpenFolderIcon />
                      Open folder
                    </button>
                  </div>

                  <div className="local-model-picker">
                    <div>
                      <p className="settings-title">Transcription model</p>
                      <p className="settings-description">Openflow will use the selected Whisper model for every capture.</p>
                    </div>
                    <select
                      className="styled-select"
                      value={settings.offlineModel}
                      onChange={(event) =>
                        void handleSettingsChange({
                          ...settings,
                          offlineModel: event.target.value as AppSettings['offlineModel']
                        })
                      }
                    >
                      {(bootData?.modelInfo.availableModels ?? []).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                          {option.recommended ? ' (Recommended)' : ''}
                        </option>
                      ))}
                    </select>
                    <p className="settings-description local-model-summary">
                      {selectedOfflineModel.diskSize} · {selectedOfflineModel.accuracy} accuracy · {selectedOfflineModel.speed} speed · {selectedOfflineModel.memoryUsage} RAM
                    </p>
                  </div>

                  <div className="local-model-picker">
                    <div>
                      <p className="settings-title">Acceleration</p>
                      <p className="settings-description">Auto prefers the bundled Vulkan runtime when present. CPU always uses the bundled CPU runtimes.</p>
                    </div>
                    <select
                      className="styled-select"
                      value={settings.accelerationMode}
                      onChange={(event) =>
                        void handleSettingsChange({
                          ...settings,
                          accelerationMode: event.target.value as AppSettings['accelerationMode']
                        })
                      }
                    >
                      {ACCELERATION_MODE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
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
                  <select
                    className="styled-select"
                    value={settings.refinementMode}
                    onChange={(event) =>
                      void handleSettingsChange({
                        ...settings,
                        refinementMode: event.target.value as RefinementMode
                      })
                    }
                  >
                    {REFINEMENT_MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
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
                    <button className="icon-button eye-button" type="button" onClick={() => setShowApiKey((value) => !value)} aria-label="Toggle API key visibility">
                      <EyeIcon visible={showApiKey} />
                    </button>
                  </div>
                </article>

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
                    <select
                      className="styled-select"
                      value={settings.localRefinementModel}
                      onChange={(event) =>
                        void handleSettingsChange({
                          ...settings,
                          localRefinementModel: event.target.value
                        })
                      }
                      disabled={localAiBusyAction !== null}
                    >
                      {(localAiInfo?.availableModels ?? []).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                          {option.recommended ? ' (Recommended)' : ''}
                        </option>
                      ))}
                    </select>
                    <p className="settings-description local-model-summary">
                      {(localAiInfo?.modelSummary ?? 'Choose a local cleanup model.')} {' '}
                      <span className="local-model-size">{localAiInfo?.modelSize ?? ''}</span>
                    </p>
                  </div>

                  <div className="runtime-grid">
                    <div className={`runtime-card${localAiInfo?.runtimeInstalled ? ' is-ready' : ' is-missing'}`}>
                      <span className="runtime-label">Runtime</span>
                      <p className="runtime-title">{localAiInfo?.runtimeInstalled ? 'llama.cpp installed' : 'Runtime not installed'}</p>
                      <p className="runtime-copy">{localAiInfo?.runtimeInstalled ? 'Managed locally by Openflow' : 'Download once to enable local cleanup'}</p>
                      <p className="runtime-meta runtime-path">{localAiInfo?.runtimePath ?? 'Loading runtime path...'}</p>
                    </div>
                    <div className={`runtime-card${localAiInfo?.modelInstalled ? ' is-ready' : ' is-missing'}`}>
                      <span className="runtime-label">Model</span>
                      <p className="runtime-title">{localAiInfo?.modelLabel ?? 'Loading model info...'}</p>
                      <p className="runtime-copy">{localAiInfo?.modelInstalled ? 'Installed and available for cleanup' : 'Needs download before local refinement can run'}</p>
                      <p className="runtime-meta runtime-path">{localAiInfo?.modelPath ?? 'Loading model path...'}</p>
                    </div>
                  </div>

                  <div className="runtime-grid">
                    <div className={`runtime-card${localAiInfo?.healthy ? ' is-ready' : ' is-missing'}`}>
                      <span className="runtime-label">Health</span>
                      <p className="runtime-title">{localAiStatusText}</p>
                      <p className="runtime-copy">
                        {localAiInfo?.fallbackToGroqAvailable
                          ? 'If local AI is unavailable, Openflow can fall back to Groq automatically.'
                          : 'If local AI is unavailable and no Groq key is set, Openflow falls back to the raw transcript.'}
                      </p>
                      <p className="runtime-meta runtime-path">{localAiInfo?.serverUrl ?? 'Loading server URL...'}</p>
                      {localAiInfo?.runningModelFileName &&
                      localAiInfo.runningModelFileName !== localAiInfo.selectedModelValue ? (
                        <p className="runtime-meta runtime-warning">
                          Running model: {localAiInfo.runningModelFileName}. Restart local AI to switch to the newly selected model.
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
                          {localAiBusyAction === 'install-runtime' ? 'Installing runtime…' : localAiInfo?.runtimeInstalled ? 'Reinstall runtime' : 'Install runtime'}
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
                          {localAiBusyAction === 'install-model' ? 'Installing model…' : localAiInfo?.modelInstalled ? 'Reinstall model' : 'Install model'}
                        </button>
                        {localAiInfo?.healthy ? (
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
                            {localAiBusyAction === 'stop-local-ai' ? 'Stopping…' : 'Stop local AI'}
                          </button>
                        ) : (
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() =>
                              void runLocalAiAction(
                                'start-local-ai',
                                () => window.voskFlow.startLocalAi(),
                                'Local AI server is ready.'
                              )
                            }
                            disabled={
                              localAiBusyAction !== null ||
                              !localAiInfo?.runtimeInstalled ||
                              !localAiInfo?.modelInstalled
                            }
                          >
                            {localAiBusyAction === 'start-local-ai' ? 'Starting…' : 'Start local AI'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {localAiInfo?.downloadState ? (
                    <div className="download-status-card">
                      <div className="download-status-head">
                        <span className="runtime-label">Transfer</span>
                        <span className="download-status-percent">
                          {localAiInfo.downloadState.percent !== undefined
                            ? `${localAiInfo.downloadState.percent}%`
                            : localAiInfo.downloadState.phase === 'extracting'
                              ? 'Extracting'
                              : 'Downloading'}
                        </span>
                      </div>
                      <p className="runtime-title">{localAiInfo.downloadState.label}</p>
                      <p className="runtime-copy">{localAiInfo.downloadState.detail}</p>
                      <div className="download-progress-track" aria-hidden="true">
                        <span
                          className="download-progress-fill"
                          style={{
                            width:
                              localAiInfo.downloadState.percent !== undefined
                                ? `${localAiInfo.downloadState.percent}%`
                                : localAiInfo.downloadState.phase === 'extracting'
                                  ? '100%'
                                  : '18%'
                          }}
                        />
                      </div>
                    </div>
                  ) : null}

                  {localAiInfo?.lastError ? <div className="history-error">{localAiInfo.lastError}</div> : null}

                  <div className="cleanup-grid">
                    <div className="runtime-card is-missing">
                      <span className="runtime-label">Local AI runtime</span>
                      <p className="runtime-title">Remove runtime files</p>
                      <p className="runtime-copy">Deletes the downloaded llama.cpp runtime and stops the local server if it is running.</p>
                      <button
                        className="danger-button"
                        type="button"
                        onClick={() =>
                          void runCleanupAction(
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
                      <span className="runtime-label">Local AI models</span>
                      <p className="runtime-title">Remove downloaded model files</p>
                      <p className="runtime-copy">Deletes every downloaded local cleanup model and stops the local server first if needed.</p>
                      <button
                        className="danger-button"
                        type="button"
                        onClick={() =>
                          void runCleanupAction(
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
                </article>
              </div>
            </section>
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

              <div className="settings-stack">
                {promptFilters.map((filter) => (
                  <article key={filter.id} className="settings-card">
                    <div className="settings-card-head">
                      <div>
                        <p className="settings-title">{filter.builtIn ? 'Built-in filter' : 'Custom filter'}</p>
                        <p className="settings-description">
                          {filter.builtIn
                            ? 'This filter ships with Openflow, but you can still customize its prompt.'
                            : 'This is a user-created filter. You can rename it, edit the prompt, or remove it.'}
                        </p>
                      </div>
                      <div className="prompt-card-actions">
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => void savePromptFilter(filter.id)}
                          disabled={!hasPromptDraftChanges(filter)}
                        >
                          Save
                        </button>
                        <button
                          className={`secondary-button${settings.defaultStyle === filter.id ? ' is-active' : ''}`}
                          type="button"
                          onClick={() =>
                            void handleSettingsChange({
                              ...settings,
                              defaultStyle: filter.id
                            })
                          }
                        >
                          {settings.defaultStyle === filter.id ? 'Default filter' : 'Set as default'}
                        </button>
                        {!filter.builtIn ? (
                          <button
                            className="danger-button prompt-remove-button"
                            type="button"
                            onClick={() => void removePromptFilter(filter.id)}
                          >
                            Remove filter
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="prompt-editor-grid">
                      <label className="prompt-field">
                        <span className="runtime-label">Filter name</span>
                        <input
                          className="text-input"
                          type="text"
                          value={promptDrafts[filter.id]?.label ?? filter.label}
                          onChange={(event) =>
                            updatePromptDraft(filter.id, { label: event.target.value })
                          }
                        />
                      </label>

                      <label className="prompt-field prompt-field-wide">
                        <span className="runtime-label">Prompt instruction</span>
                        <textarea
                          className="prompt-textarea"
                          value={promptDrafts[filter.id]?.instruction ?? filter.instruction}
                          onChange={(event) =>
                            updatePromptDraft(filter.id, { instruction: event.target.value })
                          }
                        />
                      </label>
                    </div>

                    {promptErrors[filter.id] ? (
                      <div className="history-error prompt-error-banner">{promptErrors[filter.id]}</div>
                    ) : null}
                  </article>
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
                  <p className="settings-title">Auto-paste</p>
                  <p className="settings-description">Paste the refined output back into the active app automatically after processing.</p>
                  <div className="toggle-row ui-toggle-row">
                    <span>{settings.autoPaste ? 'Paste after refining' : 'Keep captures in history only'}</span>
                    <button
                      className={`toggle-switch${settings.autoPaste ? ' is-on' : ''}`}
                      type="button"
                      aria-pressed={settings.autoPaste}
                      onClick={() =>
                        void handleSettingsChange({
                          ...settings,
                          autoPaste: !settings.autoPaste
                        })
                      }
                    >
                      <span />
                    </button>
                  </div>
                </article>

                <article className="settings-card">
                  <p className="settings-title">Launch at Startup</p>
                  <p className="settings-description">Open Openflow automatically when you sign in to Windows.</p>
                  <div className="toggle-row ui-toggle-row">
                    <span>{settings.launchAtStartup ? 'Open at login is enabled' : 'Open at login is disabled'}</span>
                    <button
                      className={`toggle-switch${settings.launchAtStartup ? ' is-on' : ''}`}
                      type="button"
                      aria-pressed={settings.launchAtStartup}
                      onClick={() =>
                        void handleSettingsChange({
                          ...settings,
                          launchAtStartup: !settings.launchAtStartup
                        })
                      }
                    >
                      <span />
                    </button>
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

                <article className="settings-card">
                  <div className="settings-card-head">
                    <div>
                      <p className="settings-title">Cleanup</p>
                      <p className="settings-description">Reset saved app data or clear every downloaded Openflow asset in one step.</p>
                    </div>
                  </div>

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
