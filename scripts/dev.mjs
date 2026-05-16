import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

const rootDirectory = process.cwd();

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDirectory,
      shell: true,
      stdio: 'inherit'
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve(undefined);
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`));
      }
    });

    child.on('error', reject);
  });
}

await runCommand('npm', ['run', 'build:electron']);

const vite = spawn('npm', ['run', 'dev:renderer'], {
  cwd: rootDirectory,
  shell: true,
  stdio: 'inherit'
});

function stopChildren(exitCode = 0) {
  vite.kill();
  process.exit(exitCode);
}

async function waitForServer(url, attempts = 60) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      await new Promise((resolve, reject) => {
        const request = http.get(url, (response) => {
          response.destroy();
          resolve(undefined);
        });
        request.on('error', reject);
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Vite server was not ready at ${url}`);
}

vite.on('exit', (code) => {
  stopChildren(code ?? 0);
});

process.on('SIGINT', () => stopChildren(0));
process.on('SIGTERM', () => stopChildren(0));

await waitForServer('http://127.0.0.1:5173');

const electron = spawn(
  'npx',
  ['electron', path.join(rootDirectory, 'dist-electron', 'electron', 'main.js')],
  {
    cwd: rootDirectory,
    shell: true,
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173'
    }
  }
);

electron.on('exit', (code) => {
  vite.kill();
  process.exit(code ?? 0);
});
