import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  BUILT_IN_PROMPT_FILTERS,
  DEFAULT_SETTINGS,
  DEFAULT_WHISPER_MODEL,
  GROQ_REFINEMENT_MODEL,
  LOCAL_REFINEMENT_MODEL,
  LOCAL_REFINEMENT_MODEL_OPTIONS,
  OFFLINE_MODEL_OPTIONS,
  type AppSettings,
  type HistoryEntry,
  type PromptFilter
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

function cloneDefaultPromptFilters(): PromptFilter[] {
  return BUILT_IN_PROMPT_FILTERS.map((filter) => ({ ...filter }));
}

function normalizePromptFilters(
  loadedPromptFilters: unknown,
  fallbackDefaultStyle?: string
): { promptFilters: PromptFilter[]; defaultStyle: string } {
  const savedFilters = Array.isArray(loadedPromptFilters)
    ? loadedPromptFilters
        .filter((item): item is PromptFilter => typeof item === 'object' && item !== null)
        .map((item) => ({
          id: typeof item.id === 'string' ? item.id.trim() : '',
          label: typeof item.label === 'string' ? item.label.trim() : '',
          instruction: typeof item.instruction === 'string' ? item.instruction.trim() : '',
          builtIn: Boolean(item.builtIn)
        }))
        .filter((item) => item.id && item.label && item.instruction)
    : [];

  const builtInById = new Map(savedFilters.filter((item) => item.builtIn).map((item) => [item.id, item]));
  const mergedBuiltIns = BUILT_IN_PROMPT_FILTERS.map((filter) => ({
    ...filter,
    ...(builtInById.get(filter.id) ?? {})
  }));
  const customFilters = savedFilters.filter((item) => !item.builtIn);
  const promptFilters = [...mergedBuiltIns, ...customFilters];
  const requestedDefaultStyle =
    typeof fallbackDefaultStyle === 'string' && promptFilters.some((item) => item.id === fallbackDefaultStyle)
      ? fallbackDefaultStyle
      : 'casual';

  return {
    promptFilters,
    defaultStyle: requestedDefaultStyle
  };
}

export async function loadSettings(): Promise<AppSettings> {
  const loadedSettings = await readJsonFile<AppSettings>(SETTINGS_FILE_NAME, DEFAULT_SETTINGS);
  const legacyModel =
    typeof loadedSettings.refinementModel === 'string' ? loadedSettings.refinementModel.trim() : '';
  const refinementModel =
    legacyModel.length > 0 && !legacyModel.startsWith('gemini-') ? legacyModel : GROQ_REFINEMENT_MODEL;
  const localRefinementModel =
    typeof loadedSettings.localRefinementModel === 'string' ? loadedSettings.localRefinementModel.trim() : '';
  const normalizedLocalRefinementModel = LOCAL_REFINEMENT_MODEL_OPTIONS.some(
    (option) => option.value === localRefinementModel
  )
    ? localRefinementModel
    : LOCAL_REFINEMENT_MODEL;
  const offlineModel =
    typeof loadedSettings.offlineModel === 'string' ? loadedSettings.offlineModel.trim() : '';
  const normalizedOfflineModel: AppSettings['offlineModel'] = OFFLINE_MODEL_OPTIONS.some(
    (option) => option.value === offlineModel
  )
    ? (offlineModel as AppSettings['offlineModel'])
    : DEFAULT_WHISPER_MODEL;
  const normalizedPromptFilters = normalizePromptFilters(
    (loadedSettings as AppSettings).promptFilters,
    typeof loadedSettings.defaultStyle === 'string' ? loadedSettings.defaultStyle : undefined
  );

  return {
    ...DEFAULT_SETTINGS,
    ...loadedSettings,
    accelerationMode:
      loadedSettings.accelerationMode === 'cpu' || loadedSettings.accelerationMode === 'vulkan'
        ? loadedSettings.accelerationMode
        : 'auto',
    refinementMode: loadedSettings.refinementMode === 'local' ? 'local' : 'groq',
    groqApiKey: typeof loadedSettings.groqApiKey === 'string' ? loadedSettings.groqApiKey.trim() : '',
    refinementModel,
    localRefinementModel: normalizedLocalRefinementModel,
    offlineModel: normalizedOfflineModel,
    defaultStyle: normalizedPromptFilters.defaultStyle,
    promptFilters: normalizedPromptFilters.promptFilters,
    launchAtStartup: Boolean(loadedSettings.launchAtStartup),
    vocabulary: Array.isArray(loadedSettings.vocabulary)
      ? loadedSettings.vocabulary.filter((item) => typeof item === 'string' && item.trim().length > 0)
      : []
  };
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const normalizedPromptFilters = normalizePromptFilters(settings.promptFilters, settings.defaultStyle);
  const normalizedSettings: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...settings,
    accelerationMode:
      settings.accelerationMode === 'cpu' || settings.accelerationMode === 'vulkan'
        ? settings.accelerationMode
        : 'auto',
    refinementMode: settings.refinementMode === 'local' ? 'local' : 'groq',
    groqApiKey: settings.groqApiKey.trim(),
    refinementModel: settings.refinementModel.trim() || GROQ_REFINEMENT_MODEL,
    localRefinementModel: LOCAL_REFINEMENT_MODEL_OPTIONS.some(
      (option) => option.value === settings.localRefinementModel.trim()
    )
      ? settings.localRefinementModel.trim()
      : LOCAL_REFINEMENT_MODEL,
    offlineModel: OFFLINE_MODEL_OPTIONS.some((option) => option.value === settings.offlineModel)
      ? settings.offlineModel
      : DEFAULT_WHISPER_MODEL,
    defaultStyle: normalizedPromptFilters.defaultStyle,
    promptFilters: normalizedPromptFilters.promptFilters,
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

export async function resetSettings(): Promise<AppSettings> {
  const nextSettings: AppSettings = {
    ...DEFAULT_SETTINGS,
    promptFilters: cloneDefaultPromptFilters(),
    launchAtStartup: false
  };
  await writeJsonFile(SETTINGS_FILE_NAME, nextSettings);
  return nextSettings;
}
