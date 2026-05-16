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

type TranscriberLike = {
  warmup: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<ArrayBuffer>;
};

function isOverlayMode(): boolean {
  return window.location.hash === '#overlay';
}

function formatDate(value: string): string {
  const date = new Date(value);
  return date.toLocaleString();
}

function getStatusCopy(status: AppStatus): { title: string; detail: string } {
  switch (status) {
    case 'booting':
      return { title: 'Starting up', detail: 'Loading your local settings and history.' };
    case 'loading-model':
      return { title: 'Preparing audio', detail: 'Checking the offline Whisper runtime and capture pipeline.' };
    case 'recording':
      return { title: 'Recording', detail: 'Keep holding Ctrl + Win while you speak.' };
    case 'processing':
      return { title: 'Processing', detail: 'Finishing the transcript and applying your style.' };
    case 'done':
      return { title: 'Done', detail: 'Latest result is ready and stored in history.' };
    case 'error':
      return { title: 'Needs attention', detail: 'The last capture hit an error. See the note below.' };
    case 'idle':
      return { title: 'Ready', detail: 'Hold Ctrl + Win anywhere on Windows to start dictating.' };
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

  await navigator.clipboard.writeText(text);
}

function OverlayApp(): JSX.Element {
  const [overlayState, setOverlayState] = useState<OverlayState>(DEFAULT_OVERLAY_STATE);

  useEffect(() => {
    void window.voskFlow.getBootstrap().then((payload) => setOverlayState(payload.overlayState));
    return window.voskFlow.onOverlayState((nextState) => setOverlayState(nextState));
  }, []);

  return (
    <main className={`overlay-shell overlay-${overlayState.status}`}>
      <div className="overlay-pill">
        <span className="overlay-dot" />
        <div>
          <p className="overlay-status">{overlayState.status === 'hidden' ? 'Ready' : overlayState.message}</p>
          <p className="overlay-caption">Openflow</p>
        </div>
      </div>
    </main>
  );
}

export function App(): JSX.Element {
  const overlayMode = isOverlayMode();
  const [bootData, setBootData] = useState<BootstrapPayload | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [status, setStatus] = useState<AppStatus>('booting');
  const [note, setNote] = useState<string>('');
  const [latestRawText, setLatestRawText] = useState<string>('');
  const [latestRefinedText, setLatestRefinedText] = useState<string>('');
  const [vocabularyDraft, setVocabularyDraft] = useState<string>('');
  const [savingSettings, setSavingSettings] = useState<boolean>(false);
  const recordingRef = useRef<boolean>(false);

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

        const result = await window.voskFlow.processTranscript({
          audioBuffer,
          style: settings.defaultStyle
        });

        setLatestRawText(result.entry.rawText);
        setLatestRefinedText(result.refinedText);
        setHistory((currentHistory) => [result.entry, ...currentHistory].slice(0, 200));
        setStatus('done');
        setNote(result.notice ?? (result.pasted ? 'Refined text was pasted into the active window.' : 'Processing complete.'));
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
    await persistVocabularyEntries(
      settings.vocabulary.filter((entry) => entry !== entryToRemove)
    );
  };

  const clearHistoryEntries = async (): Promise<void> => {
    await window.voskFlow.clearHistory();
    setHistory([]);
  };

  return (
    <main className="app-shell">
      <section className="hero-card">
        <div className="hero-copy">
          <p className="eyebrow">Windows Voice Dictation</p>
          <h1>Openflow</h1>
          <p className="hero-text">
            Hold <kbd>Ctrl</kbd> + <kbd>Win</kbd>, speak anywhere on Windows, release, and Openflow
            will transcribe, refine, and paste the result back into your active app.
          </p>
        </div>
        <div className={`status-card status-${status}`}>
          <span className="status-pulse" />
          <div>
            <p className="status-title">{statusCopy.title}</p>
            <p className="status-detail">{statusCopy.detail}</p>
          </div>
        </div>
      </section>

      <section className="grid-layout">
        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Settings</p>
              <h2>Refinement and paste</h2>
            </div>
            <button className="ghost-button" type="button" onClick={() => void window.voskFlow.showMainWindow()}>
              Keep open
            </button>
          </div>

          <label className="field">
            <span>Google AI Studio API key</span>
            <input
              type="password"
              placeholder="AIza..."
              value={settings.apiKey}
              onChange={(event) =>
                void handleSettingsChange({
                  ...settings,
                  apiKey: event.target.value
                })
              }
            />
          </label>

          <label className="field">
            <span>Hosted model ID</span>
            <input
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
          </label>

          <div className="info-card">
            <p className="panel-kicker">Default model</p>
            <p className="info-primary">{GOOGLE_REFINEMENT_MODEL}</p>
            <p className="info-secondary">You can replace it with any valid Google AI Studio hosted model ID.</p>
          </div>

          <div className="info-card">
            <p className="panel-kicker">Whisper model</p>
            <p className="info-primary">{selectedOfflineModel.label}</p>
            <p className="info-secondary">
              {selectedOfflineModel.diskSize} · {selectedOfflineModel.accuracy} accuracy · {selectedOfflineModel.speed} speed
            </p>
          </div>

          <label className="field">
            <span>Default refinement style</span>
            <select
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
          </label>

          <label className="toggle-row">
            <div>
              <span>Auto-paste after refinement</span>
              <p>When disabled, Openflow still stores the result in local history.</p>
            </div>
            <input
              type="checkbox"
              checked={settings.autoPaste}
              onChange={(event) =>
                void handleSettingsChange({
                  ...settings,
                  autoPaste: event.target.checked
                })
              }
            />
          </label>

          <div className="field">
            <span>Vocabulary</span>
            <div className="tag-input-shell">
              <div className="tag-list">
                {settings.vocabulary.map((entry) => (
                  <span key={entry} className="tag-chip">
                    <span className="tag-chip-label">{entry}</span>
                    <button
                      className="tag-chip-remove"
                      type="button"
                      aria-label={`Remove ${entry}`}
                      onClick={() => void removeVocabularyEntry(entry)}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  className="tag-draft-input"
                  type="text"
                  placeholder={settings.vocabulary.length === 0 ? 'Type a word, then press Enter' : 'Add another word'}
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
            </div>
            <p className="hint-text">Press Enter to turn each word into a tag. You can also paste comma-separated names.</p>
          </div>

          <p className="hint-text">{savingSettings ? 'Saving settings…' : 'Settings are saved locally as you edit.'}</p>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Offline Model</p>
              <h2>Whisper setup</h2>
            </div>
            <button className="ghost-button" type="button" onClick={() => void window.voskFlow.openModelsFolder()}>
              Open folder
            </button>
          </div>

          <div className={`model-card ${bootData?.modelInfo.exists ? 'is-ready' : 'is-missing'}`}>
            <p className="model-state">
              {bootData?.modelInfo.binaryExists && bootData?.modelInfo.exists ? 'Installed' : 'Needs setup'}
            </p>
            <p className="model-name">{selectedOfflineModel.label}</p>
            <p className="model-path">{bootData?.modelInfo.absolutePath}</p>
          </div>

          <div className="info-card">
            <p className="panel-kicker">Runtime</p>
            <p className="info-primary">{bootData?.modelInfo.binaryExists ? 'whisper.cpp ready' : 'whisper.cpp missing'}</p>
            <p className="info-secondary">
              {selectedOfflineModel.diskSize}
              {' '}
              disk,
              {' '}
              {selectedOfflineModel.memoryUsage}
              {' '}
              RAM
            </p>
          </div>

          <div className="preview-block">
            <p className="panel-kicker">Latest raw transcript</p>
            <div className="preview-surface">{latestRawText || 'Your next capture will show up here.'}</div>
          </div>

          <div className="preview-block">
            <p className="panel-kicker">Latest refined text</p>
            <div className="preview-surface">{latestRefinedText || 'Refined output will appear here after processing.'}</div>
          </div>

          {note ? <p className="note-banner">{note}</p> : null}
        </article>
      </section>

      <section className="panel history-panel">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">History</p>
            <h2>Recent captures</h2>
          </div>
          <button className="ghost-button" type="button" onClick={() => void clearHistoryEntries()}>
            Clear history
          </button>
        </div>

        <div className="history-list">
          {history.length === 0 ? (
            <div className="empty-state">
              <p>No captures yet.</p>
              <span>Your raw Whisper text and AI-refined text will be stored locally here.</span>
            </div>
          ) : (
            history.map((entry) => (
              <article key={entry.id} className="history-item">
                <div className="history-meta">
                  <span>{formatDate(entry.createdAt)}</span>
                  <span>
                    {STYLE_OPTIONS.find((option) => option.value === entry.style)?.label ?? entry.style}
                  </span>
                  <span>{entry.pasted ? 'Pasted' : 'Not pasted'}</span>
                </div>
                <div className="history-columns">
                  <div>
                    <div className="history-section-head">
                      <p className="history-label">Raw</p>
                      <button className="copy-button" type="button" onClick={() => void copyText(entry.rawText)} aria-label="Copy raw text">
                        Copy
                      </button>
                    </div>
                    <p>{entry.rawText || 'No transcription text captured.'}</p>
                  </div>
                  <div>
                    <div className="history-section-head">
                      <p className="history-label">Refined</p>
                      <button className="copy-button" type="button" onClick={() => void copyText(entry.refinedText)} aria-label="Copy refined text">
                        Copy
                      </button>
                    </div>
                    <p>{entry.refinedText || 'No refined text stored.'}</p>
                  </div>
                </div>
                {entry.error ? <p className="history-error">{entry.error}</p> : null}
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
