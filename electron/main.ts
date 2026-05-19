import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  clipboard,
  ipcMain,
  nativeImage,
  screen,
  session,
  shell
} from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';

import {
  DEFAULT_OVERLAY_STATE,
  DEFAULT_WHISPER_MODEL,
  GROQ_REFINEMENT_MODEL,
  OFFLINE_MODEL_OPTIONS,
  WHISPER_BINARY_ARCHIVE_NAME,
  WHISPER_BINARY_DOWNLOAD_URL,
  type AppSettings,
  type BootstrapPayload,
  type HistoryEntry,
  type ModelInfo,
  type OfflineModelId,
  type OverlayState,
  type ProcessTranscriptRequest,
  type ProcessTranscriptResponse,
  type RefinementStyle
} from '../src/shared/types';
import { appendHistory, clearHistory, loadHistory, loadSettings, saveSettings } from './store';

const APP_TITLE = 'Openflow';
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const GROQ_REFINEMENT_TIMEOUT_MS = 20000;
const GROQ_REFINEMENT_MAX_ATTEMPTS = 2;

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let overlayHideTimer: NodeJS.Timeout | null = null;
let overlayState: OverlayState = DEFAULT_OVERLAY_STATE;
let hotkeyEngaged = false;
let hotkeyHelperProcess: ChildProcessByStdio<null, Readable, Readable> | null = null;

type WhisperRuntimeCandidate = {
  id: 'x64' | 'win32';
  label: string;
  binaryPath: string;
  workingDirectory: string;
};

function getRuntimeResourcePath(...pathSegments: string[]): string {
  const baseDirectory = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return path.join(baseDirectory, 'resources', ...pathSegments);
}

function getAppIconPath(): string {
  return getRuntimeResourcePath('icons', 'openflow.ico');
}

function getTrayIconPath(): string {
  return getRuntimeResourcePath('icons', 'openflow.png');
}

function getLaunchAtStartupStatus(): boolean {
  if (process.platform !== 'win32') {
    return false;
  }

  return app.getLoginItemSettings().openAtLogin;
}

function syncLaunchAtStartup(enabled: boolean): void {
  if (process.platform !== 'win32') {
    return;
  }

  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath
  });
}

function getRendererUrl(hash = ''): string {
  if (DEV_SERVER_URL) {
    return `${DEV_SERVER_URL}${hash}`;
  }
  return pathToFileURL(path.join(app.getAppPath(), 'dist', 'index.html')).toString() + hash;
}

function getWhisperBinaryPath(): string {
  return getRuntimeResourcePath('whispercpp', 'bin', 'Release', 'whisper-cli.exe');
}

function getWhisperWin32BinaryPath(): string {
  return getRuntimeResourcePath('whispercpp', 'bin', 'Win32', 'Release', 'whisper-cli.exe');
}

function getWhisperRuntimeCandidates(): WhisperRuntimeCandidate[] {
  return [
    {
      id: 'x64',
      label: 'x64',
      binaryPath: getWhisperBinaryPath(),
      workingDirectory: getRuntimeResourcePath('whispercpp', 'bin', 'Release')
    },
    {
      id: 'win32',
      label: 'Win32',
      binaryPath: getWhisperWin32BinaryPath(),
      workingDirectory: getRuntimeResourcePath('whispercpp', 'bin', 'Win32', 'Release')
    }
  ];
}

function getHotkeyHelperPath(): string {
  return getRuntimeResourcePath('bin', 'global-hotkey-listener.ps1');
}

function getOfflineModelDefinition(modelId: OfflineModelId) {
  return OFFLINE_MODEL_OPTIONS.find((option) => option.value === modelId) ?? OFFLINE_MODEL_OPTIONS.find((option) => option.value === DEFAULT_WHISPER_MODEL)!;
}

function getOfflineModelPath(modelId: OfflineModelId): string {
  return getRuntimeResourcePath('whispercpp', 'models', getOfflineModelDefinition(modelId).fileName);
}

function getVadModelPath(): string {
  return getRuntimeResourcePath('whispercpp', 'models', 'ggml-silero-v6.2.0.bin');
}

async function buildModelInfo(): Promise<ModelInfo> {
  const modelDefinition = getOfflineModelDefinition(DEFAULT_WHISPER_MODEL);
  const absolutePath = getOfflineModelPath(modelDefinition.value);
  const runtimeCandidates = getWhisperRuntimeCandidates();
  const vadModelPath = getVadModelPath();

  let modelExists = false;
  let binaryExists = false;
  let vadExists = false;
  let binaryPath = runtimeCandidates[0].binaryPath;

  try {
    await fs.access(absolutePath);
    modelExists = true;
  } catch {
    modelExists = false;
  }

  for (const runtimeCandidate of runtimeCandidates) {
    try {
      await fs.access(runtimeCandidate.binaryPath);
      binaryExists = true;
      binaryPath = runtimeCandidate.binaryPath;
      break;
    } catch {
      continue;
    }
  }

  try {
    await fs.access(vadModelPath);
    vadExists = true;
  } catch {
    vadExists = false;
  }

  return {
    modelId: modelDefinition.value,
    label: modelDefinition.label,
    absolutePath,
    exists: modelExists,
    fileName: modelDefinition.fileName,
    downloadUrl: modelDefinition.downloadUrl,
    binaryPath,
    binaryExists,
    binaryArchiveName: WHISPER_BINARY_ARCHIVE_NAME,
    binaryDownloadUrl: WHISPER_BINARY_DOWNLOAD_URL,
    vadModelPath,
    vadExists
  };
}

async function buildBootstrapPayload(): Promise<BootstrapPayload> {
  const [settings, history] = await Promise.all([loadSettings(), loadHistory()]);
  const modelInfo = await buildModelInfo();

  return {
    settings: {
      ...settings,
      launchAtStartup: getLaunchAtStartupStatus()
    },
    history,
    overlayState,
    modelInfo,
    version: app.getVersion()
  };
}

function createTrayImage(): Electron.NativeImage {
  const trayImage = nativeImage.createFromPath(getTrayIconPath());
  if (!trayImage.isEmpty()) {
    return trayImage;
  }

  return nativeImage.createFromPath(getAppIconPath());
}

function updateTrayMenu(): void {
  if (!tray) {
    return;
  }
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Openflow',
      click: () => showMainWindow()
    },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setToolTip(APP_TITLE);
  tray.setContextMenu(contextMenu);
}

function createTray(): void {
  tray = new Tray(createTrayImage().resize({ width: 18, height: 18 }));
  tray.on('click', () => showMainWindow());
  updateTrayMenu();
}

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    title: APP_TITLE,
    width: 1120,
    height: 820,
    minWidth: 920,
    minHeight: 700,
    backgroundColor: '#071018',
    icon: getAppIconPath(),
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'dist-electron', 'electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  await mainWindow.loadURL(getRendererUrl());
}

async function createOverlayWindow(): Promise<void> {
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.workArea;
  const overlayWidth = 280;
  const overlayHeight = 112;
  const rightInset = 22;
  const bottomInset = 22;

  overlayWindow = new BrowserWindow({
    width: overlayWidth,
    height: overlayHeight,
    x: x + width - overlayWidth - rightInset,
    y: y + height - overlayHeight - bottomInset,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    show: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(app.getAppPath(), 'dist-electron', 'electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  await overlayWindow.loadURL(getRendererUrl('#overlay'));
}

function broadcastOverlayState(): void {
  overlayWindow?.webContents.send('overlay:state', overlayState);
  mainWindow?.webContents.send('overlay:state', overlayState);
}

function setOverlayState(state: OverlayState, hideAfterMs?: number): void {
  overlayState = state;
  if (overlayHideTimer) {
    clearTimeout(overlayHideTimer);
    overlayHideTimer = null;
  }

  if (state.visible) {
    overlayWindow?.showInactive();
  } else {
    overlayWindow?.hide();
  }

  broadcastOverlayState();

  if (hideAfterMs && hideAfterMs > 0) {
    overlayHideTimer = setTimeout(() => {
      setOverlayState(DEFAULT_OVERLAY_STATE);
    }, hideAfterMs);
  }
}

function showMainWindow(): void {
  if (!mainWindow) {
    return;
  }
  mainWindow.show();
  mainWindow.focus();
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function getRefinementFallbackNotice(reason: string): string {
  return `AI refinement was skipped, so Openflow used the raw transcript. ${reason}`;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function isTimeoutLikeError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}

function getStyleInstruction(style: RefinementStyle): string {
  switch (style) {
    case 'casual':
      return 'Refine this into polished but natural casual writing.';
    case 'formal':
      return 'Refine this into clear professional formal writing.';
    case 'summarised':
      return 'Condense this into a concise summary while preserving the speaker intent.';
    case 'bullet-points':
      return 'Rewrite this as clean bullet points using short, readable lines.';
    case 'email-ready':
      return 'Turn this into an email-ready message with a polished tone and complete sentences.';
    case 'none':
      return 'Return the raw transcript unchanged.';
  }
}

function getDefaultWhisperThreadCount(): number {
  return Math.max(1, Math.min(os.cpus().length, 8));
}

async function writeTemporaryCapture(audioBuffer: ArrayBuffer): Promise<{
  captureDirectory: string;
  audioPath: string;
  outputBasePath: string;
}> {
  const captureDirectory = path.join(app.getPath('userData'), 'captures', crypto.randomUUID());
  const audioPath = path.join(captureDirectory, 'capture.wav');
  const outputBasePath = path.join(captureDirectory, 'transcript');

  await fs.mkdir(captureDirectory, { recursive: true });
  await fs.writeFile(audioPath, Buffer.from(new Uint8Array(audioBuffer)));

  return { captureDirectory, audioPath, outputBasePath };
}

async function removeTemporaryCapture(captureDirectory: string): Promise<void> {
  await fs.rm(captureDirectory, { recursive: true, force: true });
}

async function runWhisperCli(
  runtimeCandidate: WhisperRuntimeCandidate,
  modelPath: string,
  audioPath: string,
  outputBasePath: string,
  vadModelPath: string,
  useVad: boolean
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const args = [
      '--no-gpu',
      '--no-timestamps',
      '--no-prints',
      '--no-flash-attn',
      '--threads',
      String(getDefaultWhisperThreadCount()),
      '--language',
      'en',
      '--model',
      modelPath,
      '--output-txt',
      '--output-file',
      outputBasePath,
      '--file',
      audioPath
    ];

    if (useVad) {
      args.push('--vad', '--vad-model', vadModelPath);
    }

    const child = spawn(runtimeCandidate.binaryPath, args, {
      cwd: runtimeCandidate.workingDirectory,
      windowsHide: true
    });

    let stderrOutput = '';

    child.stderr.on('data', (chunk) => {
      stderrOutput += chunk.toString();
    });

    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const contextLabel = `${runtimeCandidate.label}${useVad ? ' with VAD' : ' without VAD'}`;
      reject(
        new Error(
          `whisper.cpp (${contextLabel}) exited with code ${code ?? 'unknown'}${stderrOutput ? `: ${stderrOutput.trim()}` : '.'}`
        )
      );
    });
  });
}

async function transcribeWithWhisper(audioBuffer: ArrayBuffer): Promise<string> {
  const modelInfo = await buildModelInfo();
  const vadModelPath = getVadModelPath();
  const runtimeCandidates = getWhisperRuntimeCandidates();
  const availableRuntimeCandidates: WhisperRuntimeCandidate[] = [];
  const attemptErrors: string[] = [];
  let vadModelExists = false;

  if (!modelInfo.exists) {
    throw new Error(`The selected Whisper model is missing: ${modelInfo.fileName}`);
  }

  for (const runtimeCandidate of runtimeCandidates) {
    try {
      await fs.access(runtimeCandidate.binaryPath);
      availableRuntimeCandidates.push(runtimeCandidate);
    } catch {
      continue;
    }
  }

  if (availableRuntimeCandidates.length === 0) {
    throw new Error('The bundled whisper.cpp runtimes are missing. Rebuild or reinstall Openflow.');
  }

  try {
    await fs.access(vadModelPath);
    vadModelExists = true;
  } catch {
    vadModelExists = false;
  }

  const { captureDirectory, audioPath, outputBasePath } = await writeTemporaryCapture(audioBuffer);

  try {
    const useVadPasses = vadModelExists ? [true, false] : [false];
    let transcribed = false;

    for (const useVad of useVadPasses) {
      for (const runtimeCandidate of availableRuntimeCandidates) {
        try {
          await runWhisperCli(
            runtimeCandidate,
            modelInfo.absolutePath,
            audioPath,
            outputBasePath,
            vadModelPath,
            useVad
          );
          transcribed = true;
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown whisper.cpp execution error.';
          attemptErrors.push(message);
        }
      }

      if (transcribed) {
        break;
      }
    }

    if (!transcribed) {
      throw new Error(attemptErrors.join(' | '));
    }

    const transcriptPath = `${outputBasePath}.txt`;
    const rawTranscript = await fs.readFile(transcriptPath, 'utf8');
    return normalizeText(rawTranscript);
  } finally {
    await removeTemporaryCapture(captureDirectory);
  }
}

async function refineWithGroq(
  rawText: string,
  style: RefinementStyle,
  settings: AppSettings
): Promise<{ refinedText: string; notice?: string }> {
  if (style === 'none') {
    return { refinedText: rawText };
  }

  if (!settings.groqApiKey.trim()) {
    return {
      refinedText: rawText,
      notice: 'AI refinement skipped because no Groq API key is configured.'
    };
  }

  const modelId = settings.refinementModel.trim() || GROQ_REFINEMENT_MODEL;
  const spellingHints =
    settings.vocabulary.length > 0
      ? settings.vocabulary.map((item) => `- ${item}`).join('\n')
      : '- No custom vocabulary provided';
  const requestUrl = 'https://api.groq.com/openai/v1/chat/completions';
  const requestBody = JSON.stringify({
    model: modelId,
    temperature: 0,
    max_completion_tokens: 220,
    messages: [
      {
        role: 'system',
        content: [
          'You are a dictation cleanup assistant.',
          'Preserve the speaker meaning and do not invent facts.',
          'Return only the cleaned final text.',
          'Custom vocabulary entries are canonical spellings for names, brands, product terms, and technical words.',
          'If a word or phrase in the raw transcript is a likely ASR misspelling, phonetic match, or near-match for a provided vocabulary entry, replace it with that exact vocabulary spelling.',
          'Preserve the exact spelling, casing, spacing, and punctuation of matched vocabulary entries.',
          'Prefer provided vocabulary over plausible alternatives when the sound or context is close.',
          'Never append, list, explain, mention, or force any vocabulary item unless the raw transcript already implies that word or phrase.',
          'Do not add extra sentences, tags, commentary, notes, or sign-offs.'
        ].join(' ')
      },
      {
        role: 'user',
        content: [
          `Task: ${getStyleInstruction(style)}`,
          '',
          'Vocabulary entries to preserve exactly when the raw transcript appears to refer to them:',
          spellingHints,
          '',
          'Use the vocabulary list to correct likely ASR mistakes and phonetic near-matches.',
          'Do not add any vocabulary term unless it is actually implied by the raw transcript.',
          '',
          'Raw transcript:',
          rawText
        ].join('\n')
      }
    ]
  });
  let lastFailureReason = 'The Groq model request failed.';

  for (let attempt = 1; attempt <= GROQ_REFINEMENT_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.groqApiKey.trim()}`
        },
        signal: AbortSignal.timeout(GROQ_REFINEMENT_TIMEOUT_MS),
        body: requestBody
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `Groq refinement failed on attempt ${attempt}: ${response.status} ${response.statusText} - ${errorText}`
        );

        lastFailureReason =
          response.status === 429
            ? 'The Groq model is rate limited right now.'
            : 'The Groq model did not return a usable response.';

        if (attempt < GROQ_REFINEMENT_MAX_ATTEMPTS && isRetryableHttpStatus(response.status)) {
          await delay(600 * attempt);
          continue;
        }

        return {
          refinedText: rawText,
          notice: getRefinementFallbackNotice(lastFailureReason)
        };
      }

      const data = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string;
          };
        }>;
      };

      const refinedText = normalizeText(data.choices?.[0]?.message?.content ?? '');

      if (!refinedText) {
        console.error('The Groq model returned an invalid or empty cleanup response.');
        return {
          refinedText: rawText,
          notice: getRefinementFallbackNotice('The Groq model returned an empty cleanup result.')
        };
      }

      return { refinedText };
    } catch (error) {
      const isTimeout = isTimeoutLikeError(error);
      console.error(`Groq refinement failed on attempt ${attempt}:`, error);
      lastFailureReason = isTimeout ? 'The Groq model timed out.' : 'The Groq model request failed.';

      if (attempt < GROQ_REFINEMENT_MAX_ATTEMPTS) {
        await delay(600 * attempt);
        continue;
      }

      return {
        refinedText: rawText,
        notice: getRefinementFallbackNotice(lastFailureReason)
      };
    }
  }

  return {
    refinedText: rawText,
    notice: getRefinementFallbackNotice(lastFailureReason)
  };
}

async function sendPasteShortcut(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')"
      ],
      { windowsHide: true }
    );

    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Paste shortcut process exited with code ${code ?? 'unknown'}.`));
      }
    });
  });
}

async function pasteText(text: string): Promise<void> {
  clipboard.writeText(text);
  await new Promise((resolve) => setTimeout(resolve, 80));
  await sendPasteShortcut();
  await new Promise((resolve) => setTimeout(resolve, 250));
}

async function processTranscript(
  payload: ProcessTranscriptRequest
): Promise<ProcessTranscriptResponse> {
  const settings = await loadSettings();
  const normalizedRawText = normalizeText(await transcribeWithWhisper(payload.audioBuffer));

  if (!normalizedRawText) {
    const emptyEntry: HistoryEntry = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      rawText: '',
      refinedText: '',
      style: payload.style,
      pasted: false,
      error: 'No speech detected.'
    };
    await appendHistory(emptyEntry);
    setOverlayState(
      {
        visible: true,
        status: 'error',
        message: 'No speech detected'
      },
      1800
    );
    return {
      entry: emptyEntry,
      refinedText: '',
      pasted: false,
      notice: 'No speech detected.'
    };
  }

  let refinedText = normalizedRawText;
  let pasted = false;
  let notice: string | undefined;
  let errorMessage: string | undefined;

  try {
    const refinementResult = await refineWithGroq(normalizedRawText, payload.style, settings);
    refinedText = refinementResult.refinedText;
    notice = refinementResult.notice;

    if (refinedText) {
      clipboard.writeText(refinedText);
    }

    if (settings.autoPaste && refinedText) {
      await pasteText(refinedText);
      pasted = true;
    }

    setOverlayState(
      {
        visible: true,
        status: 'done',
        message: pasted ? 'Done and pasted' : 'Done'
      },
      1400
    );
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Unknown processing error.';
    refinedText = normalizedRawText;
    setOverlayState(
      {
        visible: true,
        status: 'error',
        message: 'Refinement failed'
      },
      2200
    );
  }

  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    rawText: normalizedRawText,
    refinedText,
    style: payload.style,
    pasted,
    error: errorMessage
  };

  await appendHistory(entry);
  return { entry, refinedText, pasted, notice: errorMessage ?? notice };
}

function handleHotkeySignal(signal: string): void {
  if (signal === 'START' && !hotkeyEngaged) {
    hotkeyEngaged = true;
    setOverlayState({
      visible: true,
      status: 'recording',
      message: 'Recording'
    });
    mainWindow?.webContents.send('recording:command', 'start');
    return;
  }

  if (signal === 'STOP' && hotkeyEngaged) {
    hotkeyEngaged = false;
    setOverlayState({
      visible: true,
      status: 'processing',
      message: 'Processing'
    });
    mainWindow?.webContents.send('recording:command', 'stop');
  }
}

async function setupGlobalHotkey(): Promise<void> {
  const helperPath = getHotkeyHelperPath();
  const helperProcess = spawn(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helperPath],
    {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
  hotkeyHelperProcess = helperProcess;

  let stdoutBuffer = '';

  helperProcess.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? '';

    for (const line of lines) {
      handleHotkeySignal(line.trim());
    }
  });

  helperProcess.stderr.on('data', (chunk) => {
    console.error(`[hotkey-helper] ${chunk.toString().trim()}`);
  });

  helperProcess.on('exit', (code) => {
    hotkeyHelperProcess = null;
    if (!isQuitting && code !== 0) {
      setOverlayState(
        {
          visible: true,
          status: 'error',
          message: 'Hotkey helper stopped'
        },
        2400
      );
    }
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle('app:get-bootstrap', async () => buildBootstrapPayload());

  ipcMain.handle('settings:save', async (_event, settings: AppSettings) => {
    syncLaunchAtStartup(settings.launchAtStartup);
    const persistedSettings = await saveSettings({
      ...settings,
      launchAtStartup: getLaunchAtStartupStatus()
    });

    return {
      ...persistedSettings,
      launchAtStartup: getLaunchAtStartupStatus()
    };
  });

  ipcMain.handle('history:clear', async () => {
    await clearHistory();
  });

  ipcMain.handle('clipboard:write-text', async (_event, text: string) => {
    clipboard.writeText(text);
  });

  ipcMain.handle('transcript:process', async (_event, payload: ProcessTranscriptRequest) =>
    processTranscript(payload)
  );

  ipcMain.handle('app:open-models-folder', async () => {
    const modelsFolder = getRuntimeResourcePath('whispercpp', 'models');
    await fs.mkdir(modelsFolder, { recursive: true });
    await shell.openPath(modelsFolder);
  });

  ipcMain.handle('app:show-main-window', async () => {
    showMainWindow();
  });

  ipcMain.handle('capture:error', async (_event, message: string) => {
    setOverlayState(
      {
        visible: true,
        status: 'error',
        message
      },
      2200
    );
  });

  ipcMain.handle('capture:empty', async () => {
    setOverlayState(
      {
        visible: true,
        status: 'error',
        message: 'No speech detected'
      },
      1800
    );
  });
}

async function bootstrap(): Promise<void> {
  const instanceLockAcquired = app.requestSingleInstanceLock();
  if (!instanceLockAcquired) {
    app.quit();
    return;
  }

  app.on('second-instance', () => showMainWindow());

  app.on('before-quit', () => {
    isQuitting = true;
    hotkeyHelperProcess?.kill();
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });

  registerIpcHandlers();
  await createMainWindow();
  await createOverlayWindow();
  createTray();
  await setupGlobalHotkey();

  app.on('activate', () => showMainWindow());
}

app.whenReady().then(() => {
  void bootstrap();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
