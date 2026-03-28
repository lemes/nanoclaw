import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';

const envConfig = readEnvFile(['WHISPER_BIN', 'WHISPER_MODEL']);

const WHISPER_BIN =
  process.env.WHISPER_BIN || envConfig.WHISPER_BIN || 'whisper-cli';
const WHISPER_MODEL =
  process.env.WHISPER_MODEL ||
  envConfig.WHISPER_MODEL ||
  path.join(process.cwd(), 'data', 'models', 'ggml-base.bin');

/**
 * Transcribe an audio buffer using local whisper.cpp.
 * Converts the input to 16kHz mono WAV via ffmpeg, then runs whisper-cli.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  inputFormat = 'ogg',
): Promise<string | null> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-voice-'));
  const inputPath = path.join(tmpDir, `input.${inputFormat}`);
  const wavPath = path.join(tmpDir, 'input.wav');

  try {
    fs.writeFileSync(inputPath, audioBuffer);

    // Convert to 16kHz mono WAV (required by whisper.cpp)
    execFileSync('ffmpeg', [
      '-i', inputPath,
      '-ar', '16000',
      '-ac', '1',
      '-f', 'wav',
      '-y',
      wavPath,
    ], { timeout: 30000, stdio: 'pipe' });

    // Run whisper-cli
    const output = execFileSync(WHISPER_BIN, [
      '-m', WHISPER_MODEL,
      '-f', wavPath,
      '--no-timestamps',
      '-nt',
    ], { timeout: 60000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });

    const transcript = output.trim();
    if (!transcript) return null;

    logger.info(
      { chars: transcript.length },
      'Transcribed voice message',
    );
    return transcript;
  } catch (err) {
    logger.error({ err }, 'whisper.cpp transcription failed');
    return null;
  } finally {
    // Cleanup temp files
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}
