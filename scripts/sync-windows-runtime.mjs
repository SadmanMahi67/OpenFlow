import fs from 'node:fs/promises';
import path from 'node:path';

const workspaceRoot = process.cwd();
const windowsRoot = process.env.WINDIR ?? 'C:\\Windows';

const runtimeGroups = [
  {
    label: 'x64',
    sourceDirectory: path.join(windowsRoot, 'System32'),
    targetDirectory: path.join(workspaceRoot, 'resources', 'whispercpp', 'bin', 'Release'),
    fileNames: ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'vcomp140.dll', 'concrt140.dll']
  },
  {
    label: 'Win32',
    sourceDirectory: path.join(windowsRoot, 'SysWOW64'),
    targetDirectory: path.join(workspaceRoot, 'resources', 'whispercpp', 'bin', 'Win32', 'Release'),
    fileNames: ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'vcomp140.dll', 'concrt140.dll']
  },
  {
    label: 'Vulkan x64',
    sourceDirectory: path.join(windowsRoot, 'System32'),
    targetDirectory: path.join(workspaceRoot, 'resources', 'whispercpp-vulkan', 'bin', 'Release'),
    fileNames: ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'vcomp140.dll', 'concrt140.dll']
  }
];

async function ensureDirectoryExists(directoryPath) {
  await fs.mkdir(directoryPath, { recursive: true });
}

async function copyRuntimeIfPresent(sourceDirectory, targetDirectory, fileName) {
  const sourcePath = path.join(sourceDirectory, fileName);
  const targetPath = path.join(targetDirectory, fileName);

  try {
    await fs.access(sourcePath);
  } catch {
    console.warn(`[runtime-sync] Skipping ${fileName} because it was not found in ${sourceDirectory}.`);
    return false;
  }

  await fs.copyFile(sourcePath, targetPath);
  return true;
}

async function syncRuntimeGroup(runtimeGroup) {
  await ensureDirectoryExists(runtimeGroup.targetDirectory);

  const copiedFiles = [];
  for (const fileName of runtimeGroup.fileNames) {
    const copied = await copyRuntimeIfPresent(
      runtimeGroup.sourceDirectory,
      runtimeGroup.targetDirectory,
      fileName
    );

    if (copied) {
      copiedFiles.push(fileName);
    }
  }

  console.log(
    copiedFiles.length > 0
      ? `[runtime-sync] Copied ${copiedFiles.length} ${runtimeGroup.label} runtime files into ${runtimeGroup.targetDirectory}.`
      : `[runtime-sync] No ${runtimeGroup.label} runtime files were copied.`
  );
}

async function main() {
  if (process.platform !== 'win32') {
    console.log('[runtime-sync] Skipping Windows runtime sync because this is not a Windows host.');
    return;
  }

  for (const runtimeGroup of runtimeGroups) {
    await syncRuntimeGroup(runtimeGroup);
  }
}

void main();
