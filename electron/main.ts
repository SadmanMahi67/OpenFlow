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
  GOOGLE_REFINEMENT_MODEL,
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
    settings,
    history,
    overlayState,
    modelInfo,
    version: app.getVersion()
  };
}

function createTrayImage(): Electron.NativeImage {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect x="8" y="8" width="48" height="48" rx="16" fill="#0f1722"/>
      <path d="M22 20l10 24 10-24h6L35 50h-6L16 20z" fill="#8ce1ff"/>
    </svg>
  `;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
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
  const overlayHeight = 92;
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

async function refineWithGemini(
  rawText: string,
  style: RefinementStyle,
  settings: AppSettings
): Promise<{ refinedText: string; notice?: string }> {
  if (style === 'none') {
    return { refinedText: rawText };
  }

  if (!settings.apiKey.trim()) {
    return {
      refinedText: rawText,
      notice: 'AI refinement skipped because no Google AI Studio API key is configured.'
    };
  }

  const modelId = settings.refinementModel.trim() || GOOGLE_REFINEMENT_MODEL;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(
      settings.apiKey.trim()
    )}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [
            {
              text:
                'You are a dictation cleanup assistant. Preserve meaning, do not invent facts, and reply with only the final cleaned text.'
            }
          ]
        },
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: [
                  `Task: ${getStyleInstruction(style)}`,
                  '',
                  'Vocabulary to prefer when plausible:',
                  settings.vocabulary.length > 0
                    ? settings.vocabulary.map((item) => `- ${item}`).join('\n')
                    : '- No custom vocabulary provided',
                  '',
                  'Raw transcript:',
                  rawText
                ].join('\n')
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseJsonSchema: {
            type: 'object',
            properties: {
              refinedText: {
                type: 'string',
                description:
                  'The final cleaned text only, with no analysis, reasoning, bullets about the task, or extra metadata.'
              }
            },
            required: ['refinedText']
          }
        }
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google AI request failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  const responseText =
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('') ?? '';

  let parsedRefinedText = '';

  try {
    const parsedResponse = JSON.parse(responseText) as { refinedText?: string };
    parsedRefinedText = typeof parsedResponse.refinedText === 'string' ? parsedResponse.refinedText : '';
  } catch {
    parsedRefinedText = '';
  }

  const refinedText = normalizeText(parsedRefinedText);

  if (!refinedText) {
    throw new Error('The Google AI model returned an invalid or empty structured response.');
  }

  return { refinedText };
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
  const previousClipboard = {
    text: clipboard.readText(),
    html: clipboard.readHTML(),
    rtf: clipboard.readRTF()
  };

  clipboard.writeText(text);
  await new Promise((resolve) => setTimeout(resolve, 80));
  await sendPasteShortcut();
  await new Promise((resolve) => setTimeout(resolve, 250));
  clipboard.write({
    text: previousClipboard.text,
    html: previousClipboard.html,
    rtf: previousClipboard.rtf
  });
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
    const refinementResult = await refineWithGemini(normalizedRawText, payload.style, settings);
    refinedText = refinementResult.refinedText;
    notice = refinementResult.notice;

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

  ipcMain.handle('settings:save', async (_event, settings: AppSettings) => saveSettings(settings));

  ipcMain.handle('history:clear', async () => {
    await clearHistory();
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
