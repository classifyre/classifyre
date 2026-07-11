import { app } from 'electron';
import path from 'path';
import fs from 'fs';

// The Python venv staged into resources/venv is created on the build machine
// and therefore contains absolute paths (pyvenv.cfg "home =", bin/python
// symlinks, script shebangs) that are wrong on the user's machine. A bundled
// standalone CPython lives in resources/python. This module makes the venv
// usable at its installed location:
//
//  1. If the resources directory is writable, patch the venv in place.
//  2. Otherwise (e.g. /Applications owned by admin, /usr/lib on Linux),
//     copy python + venv into userData once and patch the copy.
//
// A marker file records the app version + interpreter path so the work is
// done once per install/update.

interface RelocationMarker {
  version: string;
  pythonHome: string;
  venvPath: string;
}

function findBundledPythonHome(pythonRoot: string): string | null {
  if (!fs.existsSync(pythonRoot)) return null;
  // uv installs standalone pythons as <root>/cpython-<ver>-.../  — but our
  // staging script flattens it so that <root>/bin/python3 (or python.exe)
  // exists directly.
  const direct =
    process.platform === 'win32'
      ? path.join(pythonRoot, 'python.exe')
      : path.join(pythonRoot, 'bin', 'python3');
  if (fs.existsSync(direct)) return pythonRoot;
  return null;
}

function findPythonBinary(pythonHome: string): string {
  return process.platform === 'win32'
    ? path.join(pythonHome, 'python.exe')
    : path.join(pythonHome, 'bin', 'python3');
}

function isWritable(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// Async: the first-launch copy can move gigabytes, and a synchronous copy
// would freeze the (single-threaded) main process — every window and IPC
// call — for its whole duration.
function copyDir(src: string, dest: string): Promise<void> {
  return fs.promises.cp(src, dest, {
    recursive: true,
    // Preserve symlinks inside the tree; we re-point the venv ones below.
    verbatimSymlinks: true,
    force: true,
  });
}

function patchPyvenvCfg(venvPath: string, pythonHome: string): void {
  const cfgPath = path.join(venvPath, 'pyvenv.cfg');
  if (!fs.existsSync(cfgPath)) return;

  const homeDir = process.platform === 'win32' ? pythonHome : path.join(pythonHome, 'bin');
  const lines = fs.readFileSync(cfgPath, 'utf-8').split(/\r?\n/);
  const patched = lines.map((line) => {
    if (/^home\s*=/.test(line)) return `home = ${homeDir}`;
    if (/^base-prefix\s*=/.test(line)) return `base-prefix = ${pythonHome}`;
    if (/^base-exec-prefix\s*=/.test(line)) return `base-exec-prefix = ${pythonHome}`;
    if (/^base-executable\s*=/.test(line)) {
      return `base-executable = ${findPythonBinary(pythonHome)}`;
    }
    return line;
  });
  fs.writeFileSync(cfgPath, patched.join('\n'));
}

function repointVenvSymlinks(venvPath: string, pythonHome: string): void {
  if (process.platform === 'win32') return; // Windows venvs copy python.exe

  const binDir = path.join(venvPath, 'bin');
  if (!fs.existsSync(binDir)) return;

  const target = findPythonBinary(pythonHome);
  for (const name of ['python', 'python3']) {
    const link = path.join(binDir, name);
    try {
      if (!fs.lstatSync(link).isSymbolicLink()) continue;
    } catch {
      continue;
    }
    fs.rmSync(link, { force: true });
    // python3 → real interpreter, python → python3 (standard venv layout).
    fs.symlinkSync(name === 'python' ? 'python3' : target, link);
  }
  // Versioned aliases like python3.12 also point at the interpreter.
  for (const entry of fs.readdirSync(binDir)) {
    if (!/^python3\.\d+$/.test(entry)) continue;
    const link = path.join(binDir, entry);
    if (!fs.lstatSync(link).isSymbolicLink()) continue;
    fs.rmSync(link, { force: true });
    fs.symlinkSync('python3', link);
  }
}

function patchScriptShebangs(venvPath: string): void {
  if (process.platform === 'win32') return; // console scripts are .exe shims

  const binDir = path.join(venvPath, 'bin');
  if (!fs.existsSync(binDir)) return;

  const newShebang = `#!${path.join(binDir, 'python3')}`;
  for (const entry of fs.readdirSync(binDir)) {
    const file = path.join(binDir, entry);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(file);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > 1024 * 1024) continue;

    let content: Buffer;
    try {
      content = fs.readFileSync(file);
    } catch {
      continue;
    }
    if (content[0] !== 0x23 || content[1] !== 0x21) continue; // not "#!"

    const firstNewline = content.indexOf(0x0a);
    if (firstNewline === -1) continue;
    const shebang = content.subarray(0, firstNewline).toString('utf-8');
    if (!shebang.includes('python')) continue;
    if (shebang === newShebang) continue;

    const rest = content.subarray(firstNewline);
    fs.writeFileSync(file, Buffer.concat([Buffer.from(newShebang, 'utf-8'), rest]));
    fs.chmodSync(file, stat.mode);
  }
}

// The baked venv installs classifyre-cli and classifyre-schemas as EDITABLE
// packages, so their site-packages .pth files contain absolute paths into the
// BUILD machine's checkout — dead on a user machine ("import schemas" would
// fail every scan). Re-point them at the bundled pyapp tree. Runtime `uv sync`
// would rewrite them the same way, but imports must work before any sync runs.
function patchEditablePths(venvPath: string): void {
  const pyappRoot = path.join(process.resourcesPath, 'pyapp');
  const targets: Record<string, string> = {
    _editable_impl_classifyre_cli: path.join(pyappRoot, 'apps', 'cli'),
    _editable_impl_classifyre_schemas: path.join(pyappRoot, 'packages', 'schemas', 'src'),
  };

  const sitePackagesDirs: string[] = [];
  const posixLib = path.join(venvPath, 'lib');
  if (fs.existsSync(posixLib)) {
    for (const entry of fs.readdirSync(posixLib)) {
      const sp = path.join(posixLib, entry, 'site-packages');
      if (/^python\d/.test(entry) && fs.existsSync(sp)) sitePackagesDirs.push(sp);
    }
  }
  const winLib = path.join(venvPath, 'Lib', 'site-packages');
  if (fs.existsSync(winLib)) sitePackagesDirs.push(winLib);

  for (const sp of sitePackagesDirs) {
    for (const entry of fs.readdirSync(sp)) {
      if (!entry.endsWith('.pth')) continue;
      const stem = entry.slice(0, -'.pth'.length);
      const target = targets[stem];
      if (!target) continue;
      const file = path.join(sp, entry);
      try {
        fs.writeFileSync(file, `${target}\n`);
        console.log(`[python-env] Re-pointed ${entry} -> ${target}`);
      } catch (err) {
        console.warn(`[python-env] Could not patch ${file}:`, err);
      }
    }
  }
}

function markerPath(): string {
  return path.join(app.getPath('userData'), 'python-runtime.json');
}

function readMarker(): RelocationMarker | null {
  try {
    return JSON.parse(fs.readFileSync(markerPath(), 'utf-8')) as RelocationMarker;
  } catch {
    return null;
  }
}

function writeMarker(marker: RelocationMarker): void {
  fs.writeFileSync(markerPath(), JSON.stringify(marker, null, 2));
}

/**
 * Ensures the bundled Python venv is usable on this machine and returns its
 * path, or null when no venv is bundled (dev mode uses apps/cli/.venv).
 */
export async function ensurePythonRuntime(): Promise<string | null> {
  if (!app.isPackaged) return null;

  const resourcesVenv = path.join(process.resourcesPath, 'venv');
  const resourcesPython = path.join(process.resourcesPath, 'python');
  if (!fs.existsSync(resourcesVenv)) return null;

  const pythonHome = findBundledPythonHome(resourcesPython);

  const marker = readMarker();
  const version = app.getVersion();

  // Already relocated for this version and paths still valid → reuse.
  if (
    marker &&
    marker.version === version &&
    fs.existsSync(marker.venvPath) &&
    (marker.pythonHome === '' || fs.existsSync(marker.pythonHome))
  ) {
    return marker.venvPath;
  }

  // Without a bundled interpreter we cannot rewire the venv; use it as-is and
  // hope the build machine layout matches (legacy behaviour).
  if (!pythonHome) {
    console.warn('[python-env] No bundled Python found; using venv unpatched');
    return resourcesVenv;
  }

  // On macOS never patch inside the .app bundle: modifying sealed resources
  // invalidates the code signature (ad-hoc or Developer ID). Other platforms
  // patch in place when the install dir is writable.
  if (process.platform !== 'darwin' && isWritable(resourcesVenv)) {
    patchPyvenvCfg(resourcesVenv, pythonHome);
    repointVenvSymlinks(resourcesVenv, pythonHome);
    patchScriptShebangs(resourcesVenv);
    patchEditablePths(resourcesVenv);
    writeMarker({ version, pythonHome, venvPath: resourcesVenv });
    console.log(`[python-env] Patched bundled venv in place: ${resourcesVenv}`);
    return resourcesVenv;
  }

  // Read-only install location → copy runtime into userData once.
  const runtimeRoot = path.join(app.getPath('userData'), 'python-runtime');
  const userPython = path.join(runtimeRoot, 'python');
  const userVenv = path.join(runtimeRoot, 'venv');

  console.log(`[python-env] Resources read-only; copying Python runtime to ${runtimeRoot}`);
  await fs.promises.rm(runtimeRoot, { recursive: true, force: true });
  await fs.promises.mkdir(runtimeRoot, { recursive: true });
  await copyDir(resourcesPython, userPython);
  await copyDir(resourcesVenv, userVenv);

  patchPyvenvCfg(userVenv, userPython);
  repointVenvSymlinks(userVenv, userPython);
  patchScriptShebangs(userVenv);
  patchEditablePths(userVenv);
  writeMarker({ version, pythonHome: userPython, venvPath: userVenv });
  return userVenv;
}
