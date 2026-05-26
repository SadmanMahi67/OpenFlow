import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  net,
  protocol,
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
  BUILT_IN_PROMPT_FILTERS,
  DEFAULT_OVERLAY_STATE,
  DEFAULT_WHISPER_MODEL,
  GROQ_REFINEMENT_MODEL,
  GROQ_API_KEYS_URL,
  LOCAL_REFINEMENT_MODEL,
  LOCAL_REFINEMENT_MODEL_OPTIONS,
  LOCAL_REFINEMENT_RUNTIME_ARCHIVE_NAME,
  LOCAL_REFINEMENT_RUNTIME_DOWNLOAD_URL,
  OFFLINE_MODEL_OPTIONS,
  WHISPER_BINARY_ARCHIVE_NAME,
  WHISPER_BINARY_DOWNLOAD_URL,
  type AppSettings,
  type BootstrapPayload,
  type DownloadState,
  type HistoryEntry,
  type LocalAiDownloadState,
  type LocalAiInfo,
  type LocalRefinementModelOption,
  type ModelInfo,
  type OfflineModelId,
  type OverlayState,
  type PetAnimation,
  type PetDefinition,
  type PromptFilter,
  type ProcessTranscriptRequest,
  type ProcessTranscriptResponse,
  type RefinementStyle,
  type TranscriptionBackendId
} from '../src/shared/types';
import {
  appendHistory,
  clearHistory,
  loadHistory,
  loadSettings,
  resetSettings,
  saveSettings
} from './store';

function getPowerShellPath(): string {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

const APP_TITLE = 'Openflow';
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const GROQ_REFINEMENT_TIMEOUT_MS = 20000;
const GROQ_REFINEMENT_MAX_ATTEMPTS = 2;
const LOCAL_AI_SERVER_HOST = '127.0.0.1';
const LOCAL_AI_SERVER_PORT = 49581;
const LOCAL_AI_SERVER_URL = `http://${LOCAL_AI_SERVER_HOST}:${LOCAL_AI_SERVER_PORT}`;
const LOCAL_AI_HEALTH_TIMEOUT_MS = 45000;
const LOCAL_AI_MODEL_CONTEXT_SIZE = 2048;
const LLAMA_RUNTIME_RELEASE_API_URL =
  'https://api.github.com/repos/ggml-org/llama.cpp/releases/latest';

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let overlayHideTimer: NodeJS.Timeout | null = null;
let overlayState: OverlayState = DEFAULT_OVERLAY_STATE;
let hotkeyEngaged = false;
let hotkeyHelperProcess: ChildProcessByStdio<null, Readable, Readable> | null = null;
let localAiServerProcess: ChildProcessByStdio<null, Readable, Readable> | null = null;
let localAiServerModelPath = '';
let localAiLastError = '';
let localAiDownloadState: LocalAiDownloadState | null = null;
let offlineModelDownloadState: DownloadState | null = null;
let lastTranscriptionBackend: TranscriptionBackendId = 'none';
let lastTranscriptionFallbackReason = '';

type WhisperRuntimeCandidate = {
  id: TranscriptionBackendId;
  label: string;
  kind: 'cpu' | 'vulkan';
  binaryPath: string;
  workingDirectory: string;
};

type WhisperRuntimePlan = {
  candidates: WhisperRuntimeCandidate[];
  activeBackend: TranscriptionBackendId;
  fallbackReason?: string;
  systemVulkanAvailable: boolean;
  availableBackends: Array<{
    id: TranscriptionBackendId;
    label: string;
    kind: 'cpu' | 'vulkan';
    bundled: boolean;
    selectable: boolean;
    binaryPath: string;
    note?: string;
  }>;
  cpuRuntimeExists: boolean;
  vulkanRuntimeBundled: boolean;
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

function getWhisperVulkanBinaryPath(): string {
  return getRuntimeResourcePath('whispercpp-vulkan', 'bin', 'Release', 'whisper-cli.exe');
}

function getWhisperRuntimeCandidates(): WhisperRuntimeCandidate[] {
  return [
    {
      id: 'vulkan',
      label: 'GPU (Vulkan)',
      kind: 'vulkan',
      binaryPath: getWhisperVulkanBinaryPath(),
      workingDirectory: getRuntimeResourcePath('whispercpp-vulkan', 'bin', 'Release')
    },
    {
      id: 'cpu-x64',
      label: 'CPU x64',
      kind: 'cpu',
      binaryPath: getWhisperBinaryPath(),
      workingDirectory: getRuntimeResourcePath('whispercpp', 'bin', 'Release')
    },
    {
      id: 'cpu-win32',
      label: 'CPU Win32',
      kind: 'cpu',
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

function getBundledWhisperModelsDirectory(): string {
  return getRuntimeResourcePath('whispercpp', 'models');
}

function getUserWhisperModelsDirectory(): string {
  return path.join(app.getPath('userData'), 'whisper-models');
}

function getOfflineModelPaths(modelId: OfflineModelId): { userPath: string } {
  const modelDefinition = getOfflineModelDefinition(modelId);
  return {
    userPath: path.join(getUserWhisperModelsDirectory(), modelDefinition.fileName)
  };
}

function getVadModelPath(): string {
  return path.join(getBundledWhisperModelsDirectory(), 'ggml-silero-v6.2.0.bin');
}

function getPetsDirectory(): string {
  return path.join(app.getPath('userData'), 'pets');
}

function getBundledPetsDirectory(): string {
  return getRuntimeResourcePath('pets');
}

function getPetDir(petId: string): string {
  return path.join(getPetsDirectory(), petId);
}

function getPetGifPath(petId: string, anim: PetAnimation): string {
  return path.join(getPetDir(petId), `${petId}-${anim}.gif`);
}

const BUILT_IN_PET_ID = 'yorha-sit-2b';

const STATUS_TO_ANIMATION: Record<string, PetAnimation> = {
  idle: 'idle',
  recording: 'running',
  processing: 'waiting',
  done: 'review',
  error: 'failed'
};

function statusToAnimation(status: string): PetAnimation {
  return STATUS_TO_ANIMATION[status] ?? 'idle';
}

function getLocalAiDirectory(): string {
  return path.join(app.getPath('userData'), 'local-ai');
}

function getCapturesDirectory(): string {
  return path.join(app.getPath('userData'), 'captures');
}

function getLocalAiRuntimeDirectory(): string {
  return path.join(getLocalAiDirectory(), 'runtime');
}

function getLocalAiRuntimeArchivePath(): string {
  return path.join(getLocalAiDirectory(), LOCAL_REFINEMENT_RUNTIME_ARCHIVE_NAME);
}

function getLocalAiRuntimeBinaryPath(): string {
  return path.join(getLocalAiRuntimeDirectory(), 'llama-server.exe');
}

function getLocalAiModelsDirectory(): string {
  return path.join(getLocalAiDirectory(), 'models');
}

function getLocalRefinementModelDefinition(
  modelFileName?: string
): LocalRefinementModelOption {
  return (
    LOCAL_REFINEMENT_MODEL_OPTIONS.find(
      (option) => option.value === modelFileName || option.fileName === modelFileName
    ) ?? LOCAL_REFINEMENT_MODEL_OPTIONS[0]
  );
}

function getLocalAiModelPath(settings?: AppSettings): string {
  const modelDefinition = getLocalRefinementModelDefinition(
    settings?.localRefinementModel?.trim() || LOCAL_REFINEMENT_MODEL
  );
  return path.join(getLocalAiModelsDirectory(), modelDefinition.fileName);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function setLocalAiDownloadState(nextState: LocalAiDownloadState | null): void {
  localAiDownloadState = nextState;
}

function setOfflineModelDownloadState(nextState: DownloadState | null): void {
  offlineModelDownloadState = nextState;
}

async function resolveOfflineModelPath(modelId: OfflineModelId): Promise<{ absolutePath: string; exists: boolean }> {
  const { userPath } = getOfflineModelPaths(modelId);
  if (await fileExists(userPath)) {
    return { absolutePath: userPath, exists: true };
  }
  return { absolutePath: userPath, exists: false };
}

async function detectSystemVulkanAvailable(): Promise<boolean> {
  if (process.platform !== 'win32') {
    return false;
  }

  const windowsDirectory = process.env.WINDIR ?? 'C:\\Windows';
  return fileExists(path.join(windowsDirectory, 'System32', 'vulkaninfo.exe'));
}

async function resolveWhisperRuntimePlan(settings: AppSettings): Promise<WhisperRuntimePlan> {
  const runtimeCandidates = getWhisperRuntimeCandidates();
  const candidateStates = await Promise.all(
    runtimeCandidates.map(async (candidate) => ({
      ...candidate,
      bundled: await fileExists(candidate.binaryPath)
    }))
  );

  const systemVulkanAvailable = await detectSystemVulkanAvailable();
  const vulkanCandidate = candidateStates.find((candidate) => candidate.id === 'vulkan');
  const cpuCandidates = candidateStates.filter((candidate) => candidate.kind === 'cpu');
  const bundledCpuCandidates = cpuCandidates.filter((candidate) => candidate.bundled);
  const bundledVulkanCandidate = vulkanCandidate?.bundled ? vulkanCandidate : undefined;

  const availableBackends = candidateStates.map((candidate) => {
    const selectable =
      candidate.kind === 'vulkan' ? candidate.bundled : candidate.bundled;
    const note =
      candidate.kind === 'vulkan'
        ? candidate.bundled
          ? systemVulkanAvailable
            ? 'Bundled and ready to try on this system.'
            : 'Bundled, but Vulkan support was not detected on this system. Openflow will still try it when selected.'
          : 'Not bundled in this build yet.'
        : candidate.bundled
          ? 'Bundled CPU fallback runtime.'
          : 'Missing from this build.';

    return {
      id: candidate.id,
      label: candidate.label,
      kind: candidate.kind,
      bundled: candidate.bundled,
      selectable,
      binaryPath: candidate.binaryPath,
      note
    };
  });

  const accelerationMode = settings.accelerationMode;
  let candidates: WhisperRuntimeCandidate[] = [];
  let activeBackend: TranscriptionBackendId = 'none';
  let fallbackReason = '';

  if (accelerationMode === 'cpu') {
    candidates = bundledCpuCandidates;
    activeBackend = bundledCpuCandidates[0]?.id ?? 'none';
  } else {
    if (bundledVulkanCandidate) {
      candidates.push(bundledVulkanCandidate);
      activeBackend = 'vulkan';
    } else {
      fallbackReason =
        accelerationMode === 'vulkan'
          ? 'Vulkan runtime is not bundled in this build, so Openflow fell back to CPU transcription.'
          : 'Vulkan runtime is not bundled in this build, so Openflow is using CPU transcription.';
    }

    candidates.push(...bundledCpuCandidates);

    if (activeBackend === 'none') {
      activeBackend = bundledCpuCandidates[0]?.id ?? 'none';
    }
  }

  if (activeBackend === 'none' && bundledCpuCandidates[0]) {
    activeBackend = bundledCpuCandidates[0].id;
  }

  return {
    candidates,
    activeBackend,
    fallbackReason: fallbackReason || undefined,
    systemVulkanAvailable,
    availableBackends,
    cpuRuntimeExists: bundledCpuCandidates.length > 0,
    vulkanRuntimeBundled: Boolean(bundledVulkanCandidate)
  };
}

async function buildModelInfo(settings: AppSettings): Promise<ModelInfo> {
  const selectedModelId = settings.offlineModel;
  const modelDefinition = getOfflineModelDefinition(selectedModelId);
  const selectedModelResolution = await resolveOfflineModelPath(modelDefinition.value);
  const absolutePath = selectedModelResolution.absolutePath;
  const runtimePlan = await resolveWhisperRuntimePlan(settings);
  const vadModelPath = getVadModelPath();

  let modelExists = selectedModelResolution.exists;
  let vadExists = false;
  const resolvedActiveBackend =
    lastTranscriptionBackend !== 'none' ? lastTranscriptionBackend : runtimePlan.activeBackend;
  const activeBackendEntry =
    runtimePlan.availableBackends.find((backend) => backend.id === resolvedActiveBackend) ??
    runtimePlan.availableBackends.find((backend) => backend.id === runtimePlan.activeBackend);
  const binaryPath =
    activeBackendEntry?.binaryPath ??
    runtimePlan.availableBackends.find((backend) => backend.kind === 'cpu' && backend.bundled)?.binaryPath ??
    getWhisperBinaryPath();
  const binaryExists = runtimePlan.availableBackends.some((backend) => backend.bundled);

  try {
    await fs.access(vadModelPath);
    vadExists = true;
  } catch {
    vadExists = false;
  }

  const availableModels = await Promise.all(
    OFFLINE_MODEL_OPTIONS.map(async (option) => {
      const resolution = await resolveOfflineModelPath(option.value);
      const { userPath } = getOfflineModelPaths(option.value);
      return {
        ...option,
        installed: resolution.exists,
        removable: await fileExists(userPath),
        absolutePath: resolution.absolutePath
      };
    })
  );

  return {
    modelId: selectedModelId,
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
    vadExists,
    accelerationMode: settings.accelerationMode,
    activeBackend: resolvedActiveBackend,
    activeBackendLabel: activeBackendEntry?.label ?? 'Unavailable',
    fallbackReason: lastTranscriptionFallbackReason || runtimePlan.fallbackReason,
    downloadState: offlineModelDownloadState ?? undefined,
    vulkanRuntimePath: getWhisperVulkanBinaryPath(),
    vulkanRuntimeBundled: runtimePlan.vulkanRuntimeBundled,
    systemVulkanAvailable: runtimePlan.systemVulkanAvailable,
    vulkanSelectable: runtimePlan.vulkanRuntimeBundled,
    availableBackends: runtimePlan.availableBackends,
    availableModels
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(dir: string, result: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(fullPath, result);
    } else {
      result.push(fullPath);
    }
  }
}

async function isLocalAiHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`${LOCAL_AI_SERVER_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(1500)
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function buildLocalAiInfo(settings: AppSettings): Promise<LocalAiInfo> {
  const modelDefinition = getLocalRefinementModelDefinition(
    settings.localRefinementModel.trim() || LOCAL_REFINEMENT_MODEL
  );
  const runtimePath = getLocalAiRuntimeBinaryPath();
  const modelPath = getLocalAiModelPath(settings);
  const [runtimeInstalled, modelInstalled, healthy] = await Promise.all([
    fileExists(runtimePath),
    fileExists(modelPath),
    isLocalAiHealthy()
  ]);

  return {
    runtimePath,
    runtimeInstalled,
    modelPath,
    modelInstalled,
    modelLabel: modelDefinition.label,
    modelFileName: modelDefinition.fileName,
    modelSummary: modelDefinition.summary,
    modelSize: modelDefinition.size,
    modelDownloadUrl: modelDefinition.downloadUrl,
    runtimeArchiveName: LOCAL_REFINEMENT_RUNTIME_ARCHIVE_NAME,
    runtimeDownloadUrl: LOCAL_REFINEMENT_RUNTIME_DOWNLOAD_URL,
    serverUrl: LOCAL_AI_SERVER_URL,
    serverRunning: localAiServerProcess !== null,
    runningModelFileName: localAiServerModelPath ? path.basename(localAiServerModelPath) : undefined,
    healthy,
    fallbackToGroqAvailable: settings.groqApiKey.trim().length > 0,
    availableModels: LOCAL_REFINEMENT_MODEL_OPTIONS,
    selectedModelValue: modelDefinition.value,
    downloadState: localAiDownloadState ?? undefined,
    lastError: localAiLastError || undefined
  };
}

async function buildBootstrapPayload(): Promise<BootstrapPayload> {
  const [settings, history] = await Promise.all([loadSettings(), loadHistory()]);
  const [modelInfo, localAiInfo] = await Promise.all([buildModelInfo(settings), buildLocalAiInfo(settings)]);

  return {
    settings: {
      ...settings,
      launchAtStartup: getLaunchAtStartupStatus()
    },
    history,
    overlayState,
    modelInfo,
    localAiInfo,
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
  const overlayWidth = 240;
  const overlayHeight = 240;
  const rightInset = 22;
  const bottomInset = 22;

  overlayWindow = new BrowserWindow({
    width: overlayWidth,
    height: overlayHeight,
    x: x + width - overlayWidth - rightInset,
    y: y + height - overlayHeight - bottomInset,
    frame: false,
    transparent: true,
    resizable: true,
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

  await overlayWindow.loadURL(getRendererUrl('#overlay'));
}

function broadcastOverlayState(): void {
  overlayWindow?.webContents.send('overlay:state', overlayState);
  mainWindow?.webContents.send('overlay:state', overlayState);
  const anim = statusToAnimation(overlayState.status);
  overlayWindow?.webContents.send('pet:animation', anim);
  mainWindow?.webContents.send('pet:animation', anim);
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

function resolvePromptFilter(settings: AppSettings, style: RefinementStyle): PromptFilter {
  return (
    settings.promptFilters.find((filter) => filter.id === style) ??
    BUILT_IN_PROMPT_FILTERS.find((filter) => filter.id === style) ??
    BUILT_IN_PROMPT_FILTERS[0]
  );
}

function sanitizeRefinedText(rawOutput: string): string {
  let text = rawOutput.trim();

  text = text.replace(/^```(?:text|markdown)?\s*/i, '').replace(/\s*```$/, '').trim();
  text = text.replace(
    /^(?:here(?:'s| is)\s+(?:the\s+)?)?(?:refined|cleaned|rewritten|summarized|summarised)\s+text\s*:\s*/i,
    ''
  );
  text = text.replace(/^(?:output|result)\s*:\s*/i, '');
  text = text.replace(/^final\s*:\s*/i, '');

  return normalizeText(text);
}

function getDefaultWhisperThreadCount(): number {
  return Math.max(1, Math.min(os.cpus().length, 8));
}

async function ensureDirectory(directoryPath: string): Promise<void> {
  await fs.mkdir(directoryPath, { recursive: true });
}

async function downloadToFile(
  downloadUrl: string,
  destinationPath: string,
  progressLabel?: string,
  setProgressState?: (state: DownloadState | null) => void
): Promise<void> {
  const response = await fetch(downloadUrl);

  if (!response.ok || !response.body) {
    throw new Error(`Download failed with status ${response.status} for ${downloadUrl}`);
  }

  await ensureDirectory(path.dirname(destinationPath));
  const temporaryPath = `${destinationPath}.download`;
  const fileHandle = await fs.open(temporaryPath, 'w');
  const totalBytesHeader = response.headers.get('content-length');
  const totalBytes = totalBytesHeader ? Number(totalBytesHeader) : undefined;
  let receivedBytes = 0;

  if (progressLabel && setProgressState) {
    setProgressState({
      phase: 'downloading',
      label: progressLabel,
      detail: totalBytes
        ? `${formatBytes(receivedBytes)} of ${formatBytes(totalBytes)}`
        : `${formatBytes(receivedBytes)} downloaded`,
      receivedBytes,
      totalBytes,
      percent: totalBytes ? 0 : undefined
    });
  }

  try {
    const reader = response.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (value) {
        await fileHandle.write(value);
        receivedBytes += value.byteLength;
        if (progressLabel && setProgressState) {
          setProgressState({
            phase: 'downloading',
            label: progressLabel,
            detail: totalBytes
              ? `${formatBytes(receivedBytes)} of ${formatBytes(totalBytes)}`
              : `${formatBytes(receivedBytes)} downloaded`,
            receivedBytes,
            totalBytes,
            percent: totalBytes ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : undefined
          });
        }
      }
    }
  } finally {
    await fileHandle.close();
  }

  await fs.rename(temporaryPath, destinationPath);
}

async function resolveLatestLlamaRuntimeAsset(): Promise<{
  assetName: string;
  downloadUrl: string;
}> {
  const response = await fetch(LLAMA_RUNTIME_RELEASE_API_URL, {
    headers: {
      Accept: 'application/vnd.github+json'
    }
  });

  if (!response.ok) {
    throw new Error(`Could not fetch the latest llama.cpp release metadata (${response.status}).`);
  }

  const data = (await response.json()) as {
    assets?: Array<{
      name?: string;
      browser_download_url?: string;
    }>;
  };

  const assets = Array.isArray(data.assets) ? data.assets : [];
  const preferredAsset =
    assets.find(
      (asset) =>
        typeof asset.name === 'string' &&
        /llama-.*-bin-win-cpu-x64\.zip$/i.test(asset.name) &&
        typeof asset.browser_download_url === 'string'
    ) ??
    assets.find(
      (asset) =>
        typeof asset.name === 'string' &&
        /llama-.*-bin-win-avx2-x64\.zip$/i.test(asset.name) &&
        typeof asset.browser_download_url === 'string'
    );

  if (!preferredAsset?.name || !preferredAsset.browser_download_url) {
    throw new Error('No compatible Windows CPU llama.cpp runtime asset was found in the latest release.');
  }

  return {
    assetName: preferredAsset.name,
    downloadUrl: preferredAsset.browser_download_url
  };
}

async function expandZipArchive(archivePath: string, destinationPath: string): Promise<void> {
  await ensureDirectory(destinationPath);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      getPowerShellPath(),
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destinationPath.replace(/'/g, "''")}' -Force`
      ],
      { windowsHide: true }
    );

    let stderrOutput = '';
    child.stderr.on('data', (chunk) => {
      stderrOutput += chunk.toString();
    });

    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `Archive extraction failed with code ${code ?? 'unknown'}${stderrOutput ? `: ${stderrOutput.trim()}` : '.'}`
          )
        );
      }
    });
  });
}

async function installLocalAiRuntime(): Promise<void> {
  const runtimeBinaryPath = getLocalAiRuntimeBinaryPath();
  if (await fileExists(runtimeBinaryPath)) {
    return;
  }

  localAiLastError = '';
  const runtimeDirectory = getLocalAiRuntimeDirectory();
  const runtimeAsset = await resolveLatestLlamaRuntimeAsset();
  const archivePath = path.join(getLocalAiDirectory(), runtimeAsset.assetName);

  try {
    await ensureDirectory(getLocalAiDirectory());
    await downloadToFile(
      runtimeAsset.downloadUrl,
      archivePath,
      runtimeAsset.assetName,
      (state) =>
        setLocalAiDownloadState(
          state
            ? {
                ...state,
                target: 'runtime'
              }
            : null
        )
    );
    setLocalAiDownloadState({
      target: 'runtime',
      phase: 'extracting',
      label: 'llama.cpp runtime',
      detail: 'Extracting runtime files',
      receivedBytes: 0
    });
    await expandZipArchive(archivePath, runtimeDirectory);
  } finally {
    setLocalAiDownloadState(null);
  }
}

async function installLocalAiModel(settings: AppSettings): Promise<void> {
  const modelDefinition = getLocalRefinementModelDefinition(
    settings.localRefinementModel.trim() || LOCAL_REFINEMENT_MODEL
  );
  const modelPath = getLocalAiModelPath(settings);
  if (await fileExists(modelPath)) {
    return;
  }

  localAiLastError = '';
  try {
    await downloadToFile(
      modelDefinition.downloadUrl,
      modelPath,
      modelDefinition.label,
      (state) =>
        setLocalAiDownloadState(
          state
            ? {
                ...state,
                target: 'model'
              }
            : null
        )
    );
  } finally {
    setLocalAiDownloadState(null);
  }
}

async function downloadOfflineModel(modelId: OfflineModelId): Promise<void> {
  const modelDefinition = getOfflineModelDefinition(modelId);
  const { userPath } = getOfflineModelPaths(modelId);

  if (await fileExists(userPath)) {
    return;
  }

  await ensureDirectory(getUserWhisperModelsDirectory());
  try {
    await downloadToFile(
      modelDefinition.downloadUrl,
      userPath,
      `Whisper ${modelDefinition.label}`,
      setOfflineModelDownloadState
    );
  } finally {
    setOfflineModelDownloadState(null);
  }
}

async function removeDownloadedOfflineModel(modelId: OfflineModelId): Promise<void> {
  const { userPath } = getOfflineModelPaths(modelId);
  setOfflineModelDownloadState(null);
  await fs.rm(userPath, { force: true });
}

async function stopLocalAiServer(): Promise<void> {
  if (!localAiServerProcess) {
    localAiServerModelPath = '';
    return;
  }

  const processToStop = localAiServerProcess;
  localAiServerProcess = null;
  localAiServerModelPath = '';

  await new Promise<void>((resolve) => {
    const done = () => resolve();
    processToStop.once('exit', done);
    processToStop.kill();
    setTimeout(done, 1500);
  });
}

async function removeLocalAiRuntimeFiles(): Promise<void> {
  await stopLocalAiServer();
  localAiLastError = '';
  setLocalAiDownloadState(null);
  await fs.rm(getLocalAiRuntimeDirectory(), { recursive: true, force: true });
  await fs.rm(getLocalAiRuntimeArchivePath(), { force: true });
}

async function removeLocalAiModelFiles(): Promise<void> {
  await stopLocalAiServer();
  localAiLastError = '';
  setLocalAiDownloadState(null);
  await fs.rm(getLocalAiModelsDirectory(), { recursive: true, force: true });
}

async function resetSettingsAndHistoryData(): Promise<void> {
  syncLaunchAtStartup(false);
  await Promise.all([resetSettings(), clearHistory()]);
}

async function performFullReset(): Promise<void> {
  await stopLocalAiServer();
  localAiLastError = '';
  setLocalAiDownloadState(null);
  setOfflineModelDownloadState(null);
  syncLaunchAtStartup(false);
  await Promise.all([
    fs.rm(getLocalAiDirectory(), { recursive: true, force: true }),
    fs.rm(getUserWhisperModelsDirectory(), { recursive: true, force: true }),
    fs.rm(getCapturesDirectory(), { recursive: true, force: true }),
    clearHistory(),
    resetSettings()
  ]);
}

async function waitForLocalAiHealth(): Promise<void> {
  const deadline = Date.now() + LOCAL_AI_HEALTH_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await isLocalAiHealthy()) {
      return;
    }
    await delay(500);
  }

  throw new Error('The local AI server did not become ready in time.');
}

async function ensureLocalAiServer(settings: AppSettings): Promise<void> {
  const modelPath = getLocalAiModelPath(settings);

  if (
    (await isLocalAiHealthy()) &&
    localAiServerProcess !== null &&
    localAiServerModelPath === modelPath
  ) {
    return;
  }

  const runtimeBinaryPath = getLocalAiRuntimeBinaryPath();

  if (!(await fileExists(runtimeBinaryPath))) {
    throw new Error('The local AI runtime is not installed.');
  }

  if (!(await fileExists(modelPath))) {
    throw new Error('The local AI model is not installed.');
  }

  await stopLocalAiServer();
  localAiLastError = '';

  await new Promise<void>((resolve, reject) => {
    const args = [
      '--host',
      LOCAL_AI_SERVER_HOST,
      '--port',
      String(LOCAL_AI_SERVER_PORT),
      '--model',
      modelPath,
      '--ctx-size',
      String(LOCAL_AI_MODEL_CONTEXT_SIZE),
      '--threads',
      String(getDefaultWhisperThreadCount())
    ];

    const child = spawn(runtimeBinaryPath, args, {
      cwd: path.dirname(runtimeBinaryPath),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    localAiServerProcess = child;
    localAiServerModelPath = modelPath;
    let stderrOutput = '';

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrOutput += text;
      localAiLastError = text.trim() || localAiLastError;
    });

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString().trim();
      if (text) {
        localAiLastError = '';
      }
    });

    child.once('error', (error) => {
      localAiServerProcess = null;
      localAiServerModelPath = '';
      reject(error);
    });

    child.once('spawn', resolve);
    child.once('exit', (code) => {
      if (localAiServerProcess === child) {
        localAiServerProcess = null;
      }
      if (localAiServerModelPath === modelPath) {
        localAiServerModelPath = '';
      }
      if (code && code !== 0) {
        localAiLastError = stderrOutput.trim() || `The local AI server exited with code ${code}.`;
      }
    });
  });

  await waitForLocalAiHealth();
  localAiLastError = '';
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

    if (runtimeCandidate.kind === 'cpu') {
      args.unshift('--no-gpu');
    }

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

async function transcribeWithWhisper(
  audioBuffer: ArrayBuffer,
  settings: AppSettings
): Promise<{ rawText: string; notice?: string }> {
  const modelInfo = await buildModelInfo(settings);
  const runtimePlan = await resolveWhisperRuntimePlan(settings);
  const vadModelPath = getVadModelPath();
  const attemptErrors: string[] = [];
  let vadModelExists = false;
  let transcriptionNotice = '';

  if (!modelInfo.exists) {
    throw new Error(`The selected Whisper model is missing: ${modelInfo.fileName}`);
  }

  if (runtimePlan.candidates.length === 0) {
    throw new Error('The bundled whisper.cpp runtimes are missing. Rebuild or reinstall Openflow.');
  }

  if (runtimePlan.fallbackReason) {
    transcriptionNotice = runtimePlan.fallbackReason;
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
    let successfulRuntime: WhisperRuntimeCandidate | null = null;
    let vulkanFailureReason = '';

    for (const useVad of useVadPasses) {
      for (const runtimeCandidate of runtimePlan.candidates) {
        try {
          await runWhisperCli(
            runtimeCandidate,
            modelInfo.absolutePath,
            audioPath,
            outputBasePath,
            vadModelPath,
            useVad
          );
          successfulRuntime = runtimeCandidate;
          transcribed = true;
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown whisper.cpp execution error.';
          if (runtimeCandidate.id === 'vulkan' && !vulkanFailureReason) {
            vulkanFailureReason = message;
          }
          attemptErrors.push(message);
        }
      }

      if (transcribed) {
        break;
      }
    }

    if (!transcribed) {
      lastTranscriptionBackend = 'none';
      lastTranscriptionFallbackReason = '';
      throw new Error(attemptErrors.join(' | '));
    }

    lastTranscriptionBackend = successfulRuntime?.id ?? runtimePlan.activeBackend;

    if (successfulRuntime?.id !== 'vulkan' && runtimePlan.candidates.some((candidate) => candidate.id === 'vulkan')) {
      lastTranscriptionFallbackReason =
        vulkanFailureReason
          ? `Vulkan transcription failed, so Openflow fell back to CPU. ${vulkanFailureReason}`
          : transcriptionNotice;
    } else {
      lastTranscriptionFallbackReason = transcriptionNotice;
    }

    const transcriptPath = `${outputBasePath}.txt`;
    const rawTranscript = await fs.readFile(transcriptPath, 'utf8');
    return {
      rawText: normalizeText(rawTranscript),
      notice: lastTranscriptionFallbackReason || undefined
    };
  } finally {
    await removeTemporaryCapture(captureDirectory);
  }
}

async function refineWithGroq(
  rawText: string,
  style: RefinementStyle,
  settings: AppSettings
): Promise<{ refinedText: string; notice?: string }> {
  const promptFilter = resolvePromptFilter(settings, style);

  if (promptFilter.id === 'none') {
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
          'Return only the final cleaned text with no heading, no intro, no label, no explanation, and no quotation marks unless the transcript requires them.',
          'Custom vocabulary entries are canonical spellings for names, brands, product terms, and technical words.',
          'If a word or phrase in the raw transcript is a likely ASR misspelling, phonetic match, or near-match for a provided vocabulary entry, replace it with that exact vocabulary spelling.',
          'Preserve the exact spelling, casing, spacing, and punctuation of matched vocabulary entries.',
          'Prefer provided vocabulary over plausible alternatives when the sound or context is close.',
          'Never append, list, explain, mention, or force any vocabulary item unless the raw transcript already implies that word or phrase.',
          'Do not add extra sentences, tags, commentary, notes, sign-offs, preambles, or labels such as "Refined text:" or "Summary:".'
        ].join(' ')
      },
      {
        role: 'user',
        content: [
          `Task: ${promptFilter.instruction}`,
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

      const refinedText = sanitizeRefinedText(data.choices?.[0]?.message?.content ?? '');

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

async function refineWithLocalAi(
  rawText: string,
  style: RefinementStyle,
  settings: AppSettings
): Promise<{ refinedText: string; notice?: string }> {
  const promptFilter = resolvePromptFilter(settings, style);

  if (promptFilter.id === 'none') {
    return { refinedText: rawText };
  }

  await ensureLocalAiServer(settings);

  const spellingHints =
    settings.vocabulary.length > 0
      ? settings.vocabulary.map((item) => `- ${item}`).join('\n')
      : '- No custom vocabulary provided';
  const requestBody = JSON.stringify({
    model: settings.localRefinementModel.trim() || LOCAL_REFINEMENT_MODEL,
    temperature: 0,
    max_tokens: 220,
    stream: false,
    messages: [
      {
        role: 'system',
        content: [
          'You are a dictation cleanup assistant.',
          'Preserve the speaker meaning and do not invent facts.',
          'Return only the final cleaned text with no heading, no intro, no label, no explanation, and no quotation marks unless the transcript requires them.',
          'Custom vocabulary entries are canonical spellings for names, brands, product terms, and technical words.',
          'If a word or phrase in the raw transcript is a likely ASR misspelling, phonetic match, or near-match for a provided vocabulary entry, replace it with that exact vocabulary spelling.',
          'Preserve the exact spelling, casing, spacing, and punctuation of matched vocabulary entries.',
          'Prefer provided vocabulary over plausible alternatives when the sound or context is close.',
          'Never append, list, explain, mention, or force any vocabulary item unless the raw transcript already implies that word or phrase.',
          'Do not add extra sentences, tags, commentary, notes, sign-offs, preambles, or labels such as "Refined text:" or "Summary:".'
        ].join(' ')
      },
      {
        role: 'user',
        content: [
          `Task: ${promptFilter.instruction}`,
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

  const response = await fetch(`${LOCAL_AI_SERVER_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    signal: AbortSignal.timeout(GROQ_REFINEMENT_TIMEOUT_MS),
    body: requestBody
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `The local AI server returned ${response.status} ${response.statusText}${errorText ? `: ${errorText}` : '.'}`
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const refinedText = sanitizeRefinedText(data.choices?.[0]?.message?.content ?? '');

  if (!refinedText) {
    throw new Error('The local AI model returned an empty cleanup result.');
  }

  return { refinedText };
}

async function refineWithSelectedMode(
  rawText: string,
  style: RefinementStyle,
  settings: AppSettings
): Promise<{ refinedText: string; notice?: string }> {
  if (settings.refinementMode !== 'local') {
    return refineWithGroq(rawText, style, settings);
  }

  try {
    return await refineWithLocalAi(rawText, style, settings);
  } catch (error) {
    const localFailureReason =
      error instanceof Error ? error.message : 'The local AI refinement failed.';

    if (settings.groqApiKey.trim()) {
      const groqResult = await refineWithGroq(rawText, style, settings);
      return {
        ...groqResult,
        notice:
          groqResult.notice ??
          `Local AI refinement was unavailable, so Openflow used Groq instead. ${localFailureReason}`
      };
    }

    return {
      refinedText: rawText,
      notice: getRefinementFallbackNotice(`Local AI refinement was unavailable. ${localFailureReason}`)
    };
  }
}

async function sendPasteShortcut(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      getPowerShellPath(),
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
  const transcriptionResult = await transcribeWithWhisper(payload.audioBuffer, settings);
  const normalizedRawText = normalizeText(transcriptionResult.rawText);

  if (!normalizedRawText) {
    const emptyEntry: HistoryEntry = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      rawText: '',
      refinedText: '',
      style: payload.style,
      pasted: false,
      error: 'No speech detected.',
      notice: 'No speech detected.'
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
  let notice = transcriptionResult.notice;
  let errorMessage: string | undefined;

  try {
    const refinementResult = await refineWithSelectedMode(normalizedRawText, payload.style, settings);
    refinedText = refinementResult.refinedText;
    notice = [transcriptionResult.notice, refinementResult.notice].filter(Boolean).join(' ') || undefined;

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
    error: errorMessage,
    notice
  };

  await appendHistory(entry);
  return { entry, refinedText, pasted, notice: errorMessage ?? notice };
}

async function handleHotkeySignal(signal: string): Promise<void> {
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
    getPowerShellPath(),
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
    lastTranscriptionBackend = 'none';
    lastTranscriptionFallbackReason = '';
    const persistedSettings = await saveSettings({
      ...settings,
      launchAtStartup: getLaunchAtStartupStatus()
    });

    overlayWindow?.webContents.send('pet:selection-changed', persistedSettings.petSelection);

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
    const modelsFolder = getUserWhisperModelsDirectory();
    await fs.mkdir(modelsFolder, { recursive: true });
    await shell.openPath(modelsFolder);
  });

  ipcMain.handle('offline-model:download', async (_event, modelId: OfflineModelId) => {
    await downloadOfflineModel(modelId);
    return buildBootstrapPayload();
  });

  ipcMain.handle('offline-model:remove', async (_event, modelId: OfflineModelId) => {
    await removeDownloadedOfflineModel(modelId);
    lastTranscriptionBackend = 'none';
    lastTranscriptionFallbackReason = '';

    const settings = await loadSettings();
    if (settings.offlineModel === modelId && !(await resolveOfflineModelPath(modelId)).exists) {
      await saveSettings({
        ...settings,
        offlineModel: DEFAULT_WHISPER_MODEL
      });
    }

    return buildBootstrapPayload();
  });

  ipcMain.handle('app:open-groq-api-keys', async () => {
    await shell.openExternal(GROQ_API_KEYS_URL);
  });

  ipcMain.handle('app:open-url', async (_event, url: string) => {
    await shell.openExternal(url);
  });

  ipcMain.handle('local-ai:install-runtime', async () => {
    await installLocalAiRuntime();
    return buildBootstrapPayload();
  });

  ipcMain.handle('local-ai:install-model', async () => {
    const settings = await loadSettings();
    await installLocalAiModel(settings);
    return buildBootstrapPayload();
  });

  ipcMain.handle('local-ai:start', async () => {
    const settings = await loadSettings();
    await ensureLocalAiServer(settings);
    return buildBootstrapPayload();
  });

  ipcMain.handle('local-ai:stop', async () => {
    await stopLocalAiServer();
    return buildBootstrapPayload();
  });

  ipcMain.handle('local-ai:refresh', async () => buildBootstrapPayload());

  ipcMain.handle('cleanup:remove-local-ai-runtime', async () => {
    await removeLocalAiRuntimeFiles();
    return buildBootstrapPayload();
  });

  ipcMain.handle('cleanup:remove-local-ai-models', async () => {
    await removeLocalAiModelFiles();
    return buildBootstrapPayload();
  });

  ipcMain.handle('cleanup:reset-settings-history', async () => {
    await resetSettingsAndHistoryData();
    return buildBootstrapPayload();
  });

  ipcMain.handle('cleanup:full-reset', async () => {
    await performFullReset();
    return buildBootstrapPayload();
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

  // Pet IPC handlers
  ipcMain.handle('pet:list', async (): Promise<PetDefinition[]> => {
    const petsDir = getPetsDirectory();
    const builtInDir = getBundledPetsDirectory();
    const pets: PetDefinition[] = [];

    try {
      const entries = await fs.readdir(petsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dirPath = path.join(petsDir, entry.name);
          const files = await fs.readdir(dirPath);
          const hasGif = files.some((f) => f.endsWith('.gif'));
          if (hasGif) {
            pets.push({ id: entry.name, displayName: entry.name, builtIn: entry.name === BUILT_IN_PET_ID });
          }
        }
      }
    } catch {
      // pets directory may not exist yet
    }

    // If built-in not in user dir, list it from bundled
    if (!pets.some((p) => p.id === BUILT_IN_PET_ID)) {
      try {
        const builtInPetDir = path.join(builtInDir, BUILT_IN_PET_ID);
        const builtInEntries = await fs.readdir(builtInPetDir);
        const hasBuiltInGif = builtInEntries.some((f) => f.endsWith('.gif'));
        if (hasBuiltInGif) {
          pets.unshift({ id: BUILT_IN_PET_ID, displayName: 'YoRHa Sit 2B', builtIn: true });
        }
      } catch {
        // bundled pet directory may not exist
      }
    }

    return pets;
  });

  ipcMain.handle('pet:import-zip', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: 'Import Pet from ZIP',
      filters: [{ name: 'ZIP Files', extensions: ['zip'] }],
      properties: ['openFile']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const zipPath = result.filePaths[0];
    const tempDir = path.join(app.getPath('userData'), 'temp-pet-extract');
    await ensureDirectory(tempDir);
    await expandZipArchive(zipPath, tempDir);

    // Auto-detect pet ID from common GIF filename prefix
    const extractedFiles: string[] = [];
    try {
      await collectFiles(tempDir, extractedFiles);
    } catch {
      await fs.rm(tempDir, { recursive: true, force: true });
      return null;
    }

    const gifFiles = extractedFiles.filter((f) => f.toLowerCase().endsWith('.gif'));
    if (gifFiles.length === 0) {
      await fs.rm(tempDir, { recursive: true, force: true });
      return null;
    }

    // Find longest common prefix among filenames (without extension)
    const baseNames = gifFiles.map((f) => path.basename(f, '.gif'));
    const csv = baseNames.join(',');
    // Find the longest common prefix that ends with '-'
    let prefix = '';
    for (let i = 0; i < csv.length; i++) {
      const ch = csv[0]?.[i];
      if (!ch || !baseNames.every((n) => n[i] === ch)) break;
      prefix += ch;
    }
    // Trim trailing non-alphanumeric (keep hyphen)
    let petId = prefix.replace(/[^a-zA-Z0-9_-]+$/, '').replace(/-+$/, '') || path.basename(zipPath, '.zip').replace(/[^a-zA-Z0-9_-]/g, '-');

    // Ensure unique pet ID
    let finalPetId = petId;
    let counter = 1;
    while (await fileExists(getPetDir(finalPetId))) {
      finalPetId = `${petId}-${counter}`;
      counter++;
    }

    const destDir = getPetDir(finalPetId);
    await ensureDirectory(destDir);

    for (const file of gifFiles) {
      const fileName = path.basename(file);
      const destFile = path.join(destDir, fileName);
      await fs.copyFile(file, destFile);
    }

    await fs.rm(tempDir, { recursive: true, force: true });
    return finalPetId;
  });

  ipcMain.handle('pet:remove', async (_event, petId: string) => {
    if (petId === BUILT_IN_PET_ID) return;
    const petDir = getPetDir(petId);
    await fs.rm(petDir, { recursive: true, force: true });
  });

  ipcMain.handle('pet:get-gif-url', async (_event, petId: string, anim: PetAnimation): Promise<string> => {
    return `pet://${petId}/${anim}.gif`;
  });

  ipcMain.handle('pet:set-bounds', async (_event, bounds: { x: number; y: number; width: number; height: number }) => {
    if (overlayWindow) {
      overlayWindow.setBounds(bounds);
    }
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
    localAiServerProcess?.kill();
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });

  protocol.handle('pet', async (request) => {
    // pet://{petId}/{animation}.gif → %APPDATA%/Openflow/pets/{petId}/{petId}-{animation}.gif
    const urlPath = request.url.replace('pet://', '');
    const parts = urlPath.split('/');
    if (parts.length !== 2) {
      return new Response(null, { status: 404 });
    }
    const [petId, animWithExt] = parts;
    const anim = path.basename(animWithExt, '.gif') as PetAnimation;
    let filePath = getPetGifPath(petId, anim);

    // Try exact match first, then search directory for any .gif
    if (!(await fileExists(filePath))) {
      const petDir = getPetDir(petId);
      try {
        const files = await fs.readdir(petDir);
        const match = files.find((f) => f.endsWith('.gif') && f.toLowerCase().includes(anim.toLowerCase()));
        if (match) {
          filePath = path.join(petDir, match);
        } else {
          return new Response(null, { status: 404 });
        }
      } catch {
        return new Response(null, { status: 404 });
      }
    }

    return net.fetch(pathToFileURL(filePath).toString());
  });

  // Copy bundled pet on first launch
  await copyBundledPet();

  registerIpcHandlers();
  await createMainWindow();
  await createOverlayWindow();
  createTray();
  try {
    await setupGlobalHotkey();
  } catch (err) {
    console.error('Failed to start global hotkey listener, hotkey will not work:', err);
  }

  app.on('activate', () => showMainWindow());
}

async function copyBundledPet(): Promise<void> {
  const bundledDir = getBundledPetsDirectory();
  const userPetsDir = getPetsDirectory();
  const destDir = path.join(userPetsDir, BUILT_IN_PET_ID);

  if (await fileExists(destDir)) return;

  try {
    const bundledPetDir = path.join(bundledDir, BUILT_IN_PET_ID);
    const bundledGifs = await fs.readdir(bundledPetDir);
    const gifFiles = bundledGifs.filter((f) => f.endsWith('.gif'));
    if (gifFiles.length === 0) return;

    await ensureDirectory(destDir);
    for (const file of gifFiles) {
      await fs.copyFile(path.join(bundledPetDir, file), path.join(destDir, file));
    }
  } catch {
    // Bundled pet directory may not exist
  }
}

app.whenReady().then(() => {
  void bootstrap();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
