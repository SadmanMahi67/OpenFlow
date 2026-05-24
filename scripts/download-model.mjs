import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execFileSync } from 'node:child_process';

const rootDirectory = process.cwd();
const whisperBaseDirectory = path.join(rootDirectory, 'resources', 'whispercpp');
const binaryDirectory = path.join(whisperBaseDirectory, 'bin');
const runtimeArchives = [
  {
    label: 'x64',
    zipPath: path.join(binaryDirectory, 'whisper-bin-x64.zip'),
    destinationPath: binaryDirectory,
    whisperCliPath: path.join(binaryDirectory, 'Release', 'whisper-cli.exe'),
    downloadUrl: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.4/whisper-bin-x64.zip'
  },
  {
    label: 'Win32',
    zipPath: path.join(binaryDirectory, 'whisper-bin-Win32.zip'),
    destinationPath: path.join(binaryDirectory, 'Win32'),
    whisperCliPath: path.join(binaryDirectory, 'Win32', 'Release', 'whisper-cli.exe'),
    downloadUrl: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.4/whisper-bin-Win32.zip'
  }
];

function downloadFile(url, destinationPath, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(destinationPath);

    https
      .get(url, (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          fileStream.close();
          fs.unlink(destinationPath, () => undefined);

          if (redirectCount >= 5) {
            reject(new Error(`Too many redirects while downloading ${url}`));
            return;
          }

          const redirectedUrl = new URL(response.headers.location, url).toString();
          resolve(downloadFile(redirectedUrl, destinationPath, redirectCount + 1));
          return;
        }

        if (response.statusCode && response.statusCode >= 400) {
          reject(new Error(`Download failed with status ${response.statusCode} for ${url}`));
          return;
        }

        response.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close();
          resolve(undefined);
        });
      })
      .on('error', (error) => {
        fs.unlink(destinationPath, () => undefined);
        reject(error);
      });
  });
}

fs.mkdirSync(binaryDirectory, { recursive: true });

for (const runtimeArchive of runtimeArchives) {
  fs.mkdirSync(runtimeArchive.destinationPath, { recursive: true });

  if (fs.existsSync(runtimeArchive.whisperCliPath)) {
    continue;
  }

  console.log(`Downloading whisper.cpp ${runtimeArchive.label} runtime from ${runtimeArchive.downloadUrl}`);
  await downloadFile(runtimeArchive.downloadUrl, runtimeArchive.zipPath);
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Expand-Archive -Path '${runtimeArchive.zipPath}' -DestinationPath '${runtimeArchive.destinationPath}' -Force`
    ],
    { stdio: 'inherit' }
  );
}

console.log('Whisper CPU runtimes are ready. Download Whisper models from inside Openflow.');
