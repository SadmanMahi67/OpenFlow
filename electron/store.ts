import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_SETTINGS,
  GROQ_REFINEMENT_MODEL,
  type AppSettings,
  type HistoryEntry
} from '../src/shared/types';

const SETTINGS_FILE_NAME = 'settings.json';
const HISTORY_FILE_NAME = 'history.json';
const MAX_HISTORY_ITEMS = 200;

function getDataPath(fileName: string): string {
  return path.join(app.getPath('userData'), fileName);
}

async function readJsonFile<T>(fileName: string, fallback: T): Promise<T> {
  try {
    const filePath = getDataPath(fileName);
    const fileContents = await fs.readFile(filePath, 'utf8');
    return JSON.parse(fileContents) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(fileName: string, value: unknown): Promise<void> {
  const filePath = getDataPath(fileName);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

export async function loadSettings(): Promise<AppSettings> {
  const loadedSettings = await readJsonFile<AppSettings>(SETTINGS_FILE_NAME, DEFAULT_SETTINGS);
  const legacyModel =
    typeof loadedSettings.refinementModel === 'string' ? loadedSettings.refinementModel.trim() : '';
  const refinementModel =
    legacyModel.length > 0 && !legacyModel.startsWith('gemini-') ? legacyModel : GROQ_REFINEMENT_MODEL;

  return {
    ...DEFAULT_SETTINGS,
    ...loadedSettings,
    groqApiKey: typeof loadedSettings.groqApiKey === 'string' ? loadedSettings.groqApiKey.trim() : '',
    refinementModel,
    launchAtStartup: Boolean(loadedSettings.launchAtStartup),
    vocabulary: Array.isArray(loadedSettings.vocabulary)
      ? loadedSettings.vocabulary.filter((item) => typeof item === 'string' && item.trim().length > 0)
      : []
  };
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const normalizedSettings: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...settings,
    groqApiKey: settings.groqApiKey.trim(),
    refinementModel: settings.refinementModel.trim() || GROQ_REFINEMENT_MODEL,
    launchAtStartup: Boolean(settings.launchAtStartup),
    vocabulary: settings.vocabulary
      .map((item) => item.trim())
      .filter(Boolean)
  };
  await writeJsonFile(SETTINGS_FILE_NAME, normalizedSettings);
  return normalizedSettings;
}

export async function loadHistory(): Promise<HistoryEntry[]> {
  const history = await readJsonFile<HistoryEntry[]>(HISTORY_FILE_NAME, []);
  return Array.isArray(history) ? history : [];
}

export async function appendHistory(entry: HistoryEntry): Promise<HistoryEntry[]> {
  const existingHistory = await loadHistory();
  const nextHistory = [entry, ...existingHistory].slice(0, MAX_HISTORY_ITEMS);
  await writeJsonFile(HISTORY_FILE_NAME, nextHistory);
  return nextHistory;
}

export async function clearHistory(): Promise<void> {
  await writeJsonFile(HISTORY_FILE_NAME, []);
}
