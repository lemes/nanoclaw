import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { readEnvFile } from './env.js';
import { log } from './log.js';

const envConfig = readEnvFile(['WHISPER_BIN', 'WHISPER_MODEL', 'FFMPEG_BIN']);

const WHISPER_BIN = process.env.WHISPER_BIN || envConfig.WHISPER_BIN || 'whisper-cli';
const FFMPEG_BIN = process.env.FFMPEG_BIN || envConfig.FFMPEG_BIN || 'ffmpeg';
const WHISPER_MODEL =
  process.env.WHISPER_MODEL || envConfig.WHISPER_MODEL || path.join(process.cwd(), 'data', 'models', 'ggml-base.bin');

// Common locations for Homebrew/system binaries. The host runs under launchd
// (macOS) / systemd (Linux) with a minimal PATH that omits /opt/homebrew/bin
// and /usr/local/bin, so a bare `ffmpeg`/`whisper-cli` spawn fails with ENOENT
// even though both are installed. Augment the child env's PATH so the lookup
// succeeds regardless of how the service was launched. Absolute-path overrides
// via WHISPER_BIN / FFMPEG_BIN bypass this entirely.
const BIN_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
const SPAWN_PATH = [...BIN_DIRS, process.env.PATH || ''].filter(Boolean).join(path.delimiter);
const SPAWN_ENV = { ...process.env, PATH: SPAWN_PATH };

/**
 * Map an audio mime type to a sensible temp-file extension. ffmpeg sniffs the
 * actual container from content, so this only affects the temp filename — but
 * a correct extension keeps logs/debugging legible. Defaults to 'ogg' (the
 * Telegram/WhatsApp voice-note container).
 */
export function extFromMime(mimeType?: string): string {
  if (!mimeType) return 'ogg';
  const subtype = mimeType.split('/')[1]?.split(';')[0]?.trim();
  if (!subtype) return 'ogg';
  if (subtype === 'mpeg') return 'mp3';
  if (subtype === 'x-wav' || subtype === 'wave') return 'wav';
  return subtype;
}

/**
 * Whether local transcription is wired up on this host. Cached after the first
 * check so the inbound path stays cheap. Returns false (and the inbound path
 * keeps the audio attachment unchanged) when the whisper model is absent — the
 * common case for installs that never opted into voice transcription.
 */
let availabilityCache: boolean | null = null;
export function transcriptionAvailable(): boolean {
  if (availabilityCache === null) {
    availabilityCache = fs.existsSync(WHISPER_MODEL);
    if (!availabilityCache) {
      log.debug('Voice transcription disabled: whisper model not found', { model: WHISPER_MODEL });
    }
  }
  return availabilityCache;
}

/**
 * Transcribe an audio buffer using local whisper.cpp.
 * Converts the input to 16kHz mono WAV via ffmpeg, then runs whisper-cli.
 * Best-effort: returns null (caller keeps the raw attachment) on any failure
 * or when transcription isn't configured on this host.
 */
export async function transcribeAudio(audioBuffer: Buffer, inputFormat = 'ogg'): Promise<string | null> {
  if (!transcriptionAvailable()) return null;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-voice-'));
  const inputPath = path.join(tmpDir, `input.${inputFormat}`);
  const wavPath = path.join(tmpDir, 'input.wav');

  try {
    fs.writeFileSync(inputPath, audioBuffer);

    // Convert to 16kHz mono WAV (required by whisper.cpp)
    execFileSync(FFMPEG_BIN, ['-i', inputPath, '-ar', '16000', '-ac', '1', '-f', 'wav', '-y', wavPath], {
      timeout: 30000,
      stdio: 'pipe',
      env: SPAWN_ENV,
    });

    // Run whisper-cli. Backend init noise goes to stderr (ignored); the
    // transcript is the only thing on stdout with --no-timestamps.
    const output = execFileSync(WHISPER_BIN, ['-m', WHISPER_MODEL, '-f', wavPath, '--no-timestamps', '-nt'], {
      timeout: 60000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: SPAWN_ENV,
    });

    const transcript = output.trim();
    if (!transcript) return null;

    log.info('Transcribed voice message', { chars: transcript.length });
    return transcript;
  } catch (err) {
    log.error('whisper.cpp transcription failed', { err });
    return null;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}
