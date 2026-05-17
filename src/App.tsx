import { useEffect, useRef, useState } from 'react';

import {
  DEFAULT_OVERLAY_STATE,
  DEFAULT_SETTINGS,
  GOOGLE_REFINEMENT_MODEL,
  OFFLINE_MODEL_OPTIONS,
  STYLE_OPTIONS,
  type AppSettings,
  type BootstrapPayload,
  type HistoryEntry,
  type OverlayState,
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

type AppTab = 'home' | 'history' | 'settings';

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
  }
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

function SettingsIcon(): JSX.Element {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.2a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.2a1.7 1.7 0 0 0-1.4 1Z" />
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
  const recordingRef = useRef<boolean>(false);
  const copyResetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (overlayMode) {
      return;
    }

    void window.voskFlow.getBootstrap().then((payload) => {
      setBootData(payload);
      setSettings(payload.settings);
      setHistory(payload.history);
      setStatus('idle');
      if (!payload.modelInfo.binaryExists) {
        setNote(
          `Offline runtime missing. Download ${payload.modelInfo.binaryArchiveName} before the first transcription.`
        );
      } else if (!payload.modelInfo.exists) {
        setNote(
          `Offline model missing. Download ${payload.modelInfo.fileName} before the first transcription.`
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
        setNote('The Whisper small model is missing. Open the models folder and place the model file there.');
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
  const selectedOfflineModel = OFFLINE_MODEL_OPTIONS[0];

  const handleSettingsChange = async (nextSettings: AppSettings): Promise<void> => {
    setSettings(nextSettings);
    setSavingSettings(true);
    try {
      const persistedSettings = await window.voskFlow.saveSettings(nextSettings);
      setSettings(persistedSettings);
      const payload = await window.voskFlow.getBootstrap();
      setBootData(payload);
    } finally {
      setSavingSettings(false);
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
          <span className="topbar-location">
            {activeTab === 'home' ? 'voice dictation' : activeTab}
          </span>
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
                  Speak with Ctrl + Win. Whisper transcribes offline, Google AI cleans it up, and Openflow pastes the final result back where you were typing.
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
                        defaultStyle: event.target.value as RefinementStyle
                      })
                    }
                  >
                    {STYLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
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
                          {STYLE_OPTIONS.find((option) => option.value === entry.style)?.label ?? entry.style}
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

                      {entry.error ? <div className="history-error">{entry.error}</div> : null}
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {activeTab === 'settings' ? (
            <section className="page page-settings">
              <div className="page-intro settings-intro">
                <h2 className="page-heading">Settings</h2>
                <p className="page-subcopy">Configure the Google cleanup model, startup behavior, vocabulary, and the bundled Whisper runtime.</p>
              </div>

              <div className="settings-stack">
                <article className="settings-card">
                  <p className="settings-title">Google AI Studio API key</p>
                  <p className="settings-description">Stored locally and used only for the hosted cleanup request.</p>
                  <div className="inline-input-row">
                    <input
                      className="text-input"
                      type={showApiKey ? 'text' : 'password'}
                      placeholder="AIza..."
                      value={settings.apiKey}
                      onChange={(event) =>
                        void handleSettingsChange({
                          ...settings,
                          apiKey: event.target.value
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
                  <p className="settings-description">The hosted Google model Openflow uses for transcript refinement.</p>
                  <input
                    className="text-input"
                    type="text"
                    placeholder={GOOGLE_REFINEMENT_MODEL}
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
                      <p className="settings-title">Offline model and runtime</p>
                      <p className="settings-description">Bundled Whisper small model and the current runtime installation path.</p>
                    </div>
                    <button className="secondary-button icon-secondary-button" type="button" onClick={() => void window.voskFlow.openModelsFolder()}>
                      <OpenFolderIcon />
                      Open folder
                    </button>
                  </div>

                  <div className="runtime-grid">
                    <div className={`runtime-card${bootData?.modelInfo.binaryExists && bootData?.modelInfo.exists ? ' is-ready' : ' is-missing'}`}>
                      <span className="runtime-label">Model</span>
                      <p className="runtime-title">{selectedOfflineModel.label}</p>
                      <p className="runtime-copy">{bootData?.modelInfo.binaryExists && bootData?.modelInfo.exists ? 'Installed and ready' : 'Needs setup'}</p>
                      <p className="runtime-meta">{selectedOfflineModel.diskSize} · {selectedOfflineModel.accuracy} accuracy · {selectedOfflineModel.speed} speed</p>
                    </div>
                    <div className={`runtime-card${bootData?.modelInfo.binaryExists ? ' is-ready' : ' is-missing'}`}>
                      <span className="runtime-label">Runtime</span>
                      <p className="runtime-title">{bootData?.modelInfo.binaryExists ? 'whisper.cpp ready' : 'whisper.cpp missing'}</p>
                      <p className="runtime-copy">Approx. {selectedOfflineModel.memoryUsage} RAM during transcription</p>
                      <p className="runtime-meta runtime-path">{bootData?.modelInfo.absolutePath}</p>
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
