import { app, BrowserWindow, ipcMain, shell } from 'electron'

console.log("Main process script loaded.");
process.on('uncaughtException', (error) => {
  console.error("Uncaught exception in main process:", error);
});
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { spawn } from 'child_process'
import fs from 'fs'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null
let activeBackendProcess: any = null


function createWindow() {
  console.log("createWindow called");
  // ... existing createWindow code ...
  win = new BrowserWindow({
    width: 1200,
    height: 900,
    icon: path.join(process.env.VITE_PUBLIC, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      webSecurity: false // Allow loading local resources (file://)
    },
  })
  console.log("BrowserWindow created, id:", win.id);

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.whenReady().then(() => {
  console.log("App is ready, creating window...");
  createWindow()

  // IPC Handler for converting path to file URL (robust encoding)
  ipcMain.handle('get-file-url', async (_event, filePath: string) => {
    return pathToFileURL(filePath).href
  })

  // IPC Handler for saving files (used for temp json)
  ipcMain.handle('save-file', async (_event: any, filePath: string, content: string) => {
    return new Promise((resolve, reject) => {
      fs.writeFile(filePath, content, 'utf-8', (err: any) => {
        if (err) reject(err)
        else resolve(true)
      })
    })
  })

  // IPC Handler for directory creation
  ipcMain.handle('ensure-dir', async (_event: any, dirPath: string) => {
    return new Promise((resolve, reject) => {
      fs.mkdir(dirPath, { recursive: true }, (err: any) => {
        if (err) reject(err)
        else resolve(true)
      })
    })
  })

  // IPC Handler to get paths
  ipcMain.handle('get-paths', async () => {
    let projectRoot;
    if (app.isPackaged) {
      // In Prod: resources/backend... -> Root is parent of resources
      projectRoot = path.dirname(process.resourcesPath);
    } else {
      // In Dev: ui/.. -> VideoSync_Master
      projectRoot = path.resolve(process.env.APP_ROOT, '..');
    }
    const outputDir = path.join(projectRoot, 'output');
    return { projectRoot, outputDir };
  })

  // IPC Handler for Python Backend
  ipcMain.handle('run-backend', async (_event: any, args: any[]) => {
    return new Promise((resolve, reject) => {
      console.log('Running backend with args:', args)

      let backendProcess;

      if (app.isPackaged) {
        // In production: resources/python/python.exe running resources/backend/main.py

        // Path to portable python exe (Moved to root level in resources)
        const pythonExe = path.join(process.resourcesPath, 'python', 'python.exe');
        // Path to main script (obfuscated)
        const scriptPath = path.join(process.resourcesPath, 'backend', 'main.py');

        // Models Directory: AppRoot/models/index-tts/hub
        // process.resourcesPath is AppRoot/resources
        const appRoot = path.dirname(process.resourcesPath);
        const modelsDir = path.join(appRoot, 'models', 'index-tts', 'hub');

        console.log('Spawning Packaged Backend with Portable Python:', pythonExe);
        console.log('Target Script:', scriptPath);
        console.log('Models Dir:', modelsDir);

        // Spawn python process
        backendProcess = spawn(pythonExe, [scriptPath, '--json', '--model_dir', modelsDir, ...args], {
          env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
        });
      } else {
        // In Dev: python backend/main.py
        const pythonScript = path.join(process.env.APP_ROOT, '../backend/main.py')

        // Models Directory: ProjectRoot/models/index-tts/hub
        const projectRoot = path.resolve(process.env.APP_ROOT, '..');
        const modelsDir = path.join(projectRoot, 'models', 'index-tts', 'hub');

        const pythonArgs = [pythonScript, '--json', '--model_dir', modelsDir, ...args]

        console.log('Spawning Python Script:', pythonScript);
        console.log('Models Dir:', modelsDir);
        // Force Python to use UTF-8 for IO and arguments
        backendProcess = spawn('python', pythonArgs, {
          env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
        })
      }

      activeBackendProcess = backendProcess


      let outputData = ''
      let errorData = ''

      if (backendProcess) {
        backendProcess.stdout.on('data', (data: any) => {
          const str = data.toString()

          const lines = str.split('\n');
          lines.forEach((line: string) => {
            // Parse progress markers: [PROGRESS] 50
            const progressMatch = line.match(/\[PROGRESS\]\s*(\d+)/);
            if (progressMatch) {
              const p = parseInt(progressMatch[1], 10);
              _event.sender.send('backend-progress', p);
            }

            // Parse partial results: [PARTIAL] json
            const partialMatch = line.match(/\[PARTIAL\]\s*(.*)/);
            if (partialMatch) {
              try {
                const pData = JSON.parse(partialMatch[1].trim());
                _event.sender.send('backend-partial-result', pData);
              } catch (e) {
                console.error("Failed to parse partial:", e);
              }
            }
          });

          console.log('[Py Stdout]:', str)
          outputData += str
        })

        backendProcess.stderr.on('data', (data: any) => {
          const str = data.toString()
          console.error('[Py Stderr]:', str)
          errorData += str
        })

        backendProcess.on('close', (code: number) => {
          if (activeBackendProcess === backendProcess) activeBackendProcess = null;
          if (code !== 0) {
            reject(new Error(`Python process exited with code ${code}. Error: ${errorData}`))
            return
          }

          // Parse JSON output
          try {
            const startMarker = '__JSON_START__'
            const endMarker = '__JSON_END__'
            const startIndex = outputData.indexOf(startMarker)
            const endIndex = outputData.indexOf(endMarker)

            if (startIndex !== -1 && endIndex !== -1) {
              const jsonStr = outputData.substring(startIndex + startMarker.length, endIndex).trim()
              const result = JSON.parse(jsonStr)
              resolve(result)
            } else {
              console.warn('JSON markers not found in output')
              resolve({ rawOutput: outputData, rawError: errorData })
            }
          } catch (e) {
            reject(new Error(`Failed to parse backend output: ${e}`))
          }
        })
      } else {
        reject(new Error("Failed to spawn backend process"));
      }
    })
  })

  ipcMain.handle('cache-video', async (_event, filePath: string) => {
    try {
      // Determine .cache folder path
      let projectRoot;
      if (app.isPackaged) {
        projectRoot = path.dirname(process.resourcesPath);
      } else {
        projectRoot = path.resolve(process.env.APP_ROOT, '..');
      }
      const cacheDir = path.join(projectRoot, '.cache');

      // Ensure .cache exists
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }

      // 1. If input file is already in .cache, assume it's cached and return as is.
      // Normalize paths for comparison
      const normalizedInput = path.normalize(filePath);
      const normalizedCache = path.normalize(cacheDir);

      if (normalizedInput.startsWith(normalizedCache)) {
        return normalizedInput;
      }

      // 2. Compute stable filename based on input path hash
      // This ensures same file path maps to same cached file
      const crypto = require('node:crypto');
      const hash = crypto.createHash('md5').update(normalizedInput).digest('hex');
      const basename = path.basename(filePath);
      // Limit filename length just in case
      const safeBasename = `${hash.substring(0, 12)}_${basename}`;
      const destPath = path.join(cacheDir, safeBasename);

      // 3. Check if we already have it
      if (fs.existsSync(destPath)) {
        console.log(`Using existing cached file for: ${filePath}`);
        return destPath;
      }

      // 4. Copy if new
      console.log(`Caching new file: ${filePath} -> ${destPath}`);
      await fs.promises.copyFile(filePath, destPath);

      return destPath;
    } catch (error) {
      console.error('Failed to cache video:', error);
      throw error;
    }
  })

  // IPC Handler to open folder
  ipcMain.handle('open-folder', async (_event, filePath: string) => {
    try {
      // if filePath is file, show item in folder. If dir, open path.
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          await shell.openPath(filePath);
        } else {
          shell.showItemInFolder(filePath);
        }
        return true;
      }
      return false;
    } catch (e) {
      console.error("Failed to open folder:", e);
      return false;
    }
  })

  // IPC Handler to open file externally (system default player)
  ipcMain.handle('open-external', async (_event, filePath: string) => {
    try {
      await shell.openPath(filePath);
      return true;
    } catch (e) {
      console.error("Failed to open external:", e);
      return false;
    }
  })

  // IPC Handler to kill backend
  ipcMain.handle('kill-backend', async () => {
    if (activeBackendProcess) {
      try {
        const pid = activeBackendProcess.pid;
        console.log(`Killing python process ${pid}...`);

        if (process.platform === 'win32') {
          // Force kill tree
          const { exec } = await import('child_process');
          exec(`taskkill /pid ${pid} /T /F`);
        } else {
          activeBackendProcess.kill('SIGKILL');
        }
        activeBackendProcess = null;
        return true;
      } catch (e) {
        console.error("Failed to kill backend:", e);
        return false;
      }
    }
    return true; // No process running, technically success
  })
})
