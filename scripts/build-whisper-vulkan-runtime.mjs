import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const workspaceRoot = process.cwd();
const tempRoot = 'C:\\tmp';
const whisperSourceRoot = path.join(tempRoot, 'whispercpp-vulkan-src');
const whisperBuildRoot = path.join(whisperSourceRoot, 'build-vulkan');
const vulkanSdkRoot =
  process.env.VULKAN_SDK && process.env.VULKAN_SDK.trim()
    ? process.env.VULKAN_SDK.trim()
    : path.join(tempRoot, 'VulkanSDK', '1.4.350.0');
const vcvarsPath =
  'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat';
const cmakePath =
  'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin\\cmake.exe';
const outputDirectory = path.join(workspaceRoot, 'resources', 'whispercpp-vulkan', 'bin', 'Release');
const runtimeFiles = [
  'whisper-cli.exe',
  'whisper.dll',
  'ggml.dll',
  'ggml-base.dll',
  'ggml-cpu.dll',
  'ggml-vulkan.dll'
];

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
      windowsHide: false,
      ...options
    });

    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code ?? 'unknown'}`));
      }
    });
  });
}

async function ensurePrerequisites() {
  const missing = [];

  if (!(await fileExists(vcvarsPath))) {
    missing.push(`Visual Studio Build Tools vcvars64.bat not found at ${vcvarsPath}`);
  }

  if (!(await fileExists(cmakePath))) {
    missing.push(`CMake not found at ${cmakePath}`);
  }

  if (!(await fileExists(path.join(vulkanSdkRoot, 'Lib', 'vulkan-1.lib')))) {
    missing.push(`Vulkan SDK not found at ${vulkanSdkRoot}`);
  }

  if (missing.length > 0) {
    throw new Error(missing.join('\n'));
  }
}

async function ensureSourceTree() {
  if (await fileExists(path.join(whisperSourceRoot, '.git'))) {
    return;
  }

  await runCommand('git', [
    'clone',
    '--depth',
    '1',
    '--branch',
    'v1.8.4',
    'https://github.com/ggml-org/whisper.cpp.git',
    whisperSourceRoot
  ]);
}

async function buildRuntime() {
  const scriptPath = path.join(tempRoot, 'build-whisper-vulkan-runtime.cmd');
  const scriptContents = [
    '@echo off',
    `call "${vcvarsPath}"`,
    `set VULKAN_SDK=${vulkanSdkRoot}`,
    'set PATH=%VULKAN_SDK%\\Bin;%PATH%',
    `"${cmakePath}" -S "${whisperSourceRoot}" -B "${whisperBuildRoot}" -DGGML_VULKAN=1`,
    `"${cmakePath}" --build "${whisperBuildRoot}" --config Release --target whisper-cli -j 8`
  ].join('\r\n');

  await fs.writeFile(scriptPath, scriptContents, 'utf8');
  await runCommand('cmd.exe', ['/d', '/c', scriptPath]);
}

async function copyRuntime() {
  await fs.mkdir(outputDirectory, { recursive: true });

  for (const fileName of runtimeFiles) {
    const sourcePath = path.join(whisperBuildRoot, 'bin', 'Release', fileName);
    const destinationPath = path.join(outputDirectory, fileName);
    await fs.copyFile(sourcePath, destinationPath);
  }
}

async function main() {
  await ensurePrerequisites();
  await ensureSourceTree();
  await buildRuntime();
  await copyRuntime();
  console.log(`Vulkan whisper runtime copied to ${outputDirectory}`);
}

await main();
