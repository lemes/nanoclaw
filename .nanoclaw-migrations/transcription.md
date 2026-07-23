# Voice transcription via local whisper.cpp

**Intent:** Best-effort local transcription of inbound audio attachments. Returns `null` on any failure or if the model isn't installed — never blocks the message pipeline.

**Files:** `src/transcription.ts` (new), `src/transcription.test.ts` (new)

**How to apply:**

```typescript
const WHISPER_BIN = process.env.WHISPER_BIN || envConfig.WHISPER_BIN || 'whisper-cli';
const FFMPEG_BIN = process.env.FFMPEG_BIN || envConfig.FFMPEG_BIN || 'ffmpeg';
const WHISPER_MODEL =
  process.env.WHISPER_MODEL || envConfig.WHISPER_MODEL || path.join(process.cwd(), 'data', 'models', 'ggml-base.bin');

export function extFromMime(mimeType?: string): string {
  if (!mimeType) return 'ogg';
  const subtype = mimeType.split('/')[1]?.split(';')[0]?.trim();
  if (!subtype) return 'ogg';
  if (subtype === 'mpeg') return 'mp3';
  if (subtype === 'x-wav' || subtype === 'wave') return 'wav';
  return subtype;
}

let availabilityCache: boolean | null = null;
export function transcriptionAvailable(): boolean {
  if (availabilityCache === null) {
    availabilityCache = fs.existsSync(WHISPER_MODEL);
  }
  return availabilityCache;
}

export async function transcribeAudio(audioBuffer: Buffer, inputFormat = 'ogg'): Promise<string | null> {
  if (!transcriptionAvailable()) return null;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-voice-'));
  const inputPath = path.join(tmpDir, `input.${inputFormat}`);
  const wavPath = path.join(tmpDir, 'input.wav');

  try {
    fs.writeFileSync(inputPath, audioBuffer);
    // ffmpeg: convert to 16kHz mono WAV (required by whisper.cpp)
    execFileSync(FFMPEG_BIN, ['-i', inputPath, '-ar', '16000', '-ac', '1', '-f', 'wav', '-y', wavPath], {
      timeout: 30000, stdio: 'pipe', env: SPAWN_ENV,
    });
    const output = execFileSync(WHISPER_BIN, ['-m', WHISPER_MODEL, '-f', wavPath, '--no-timestamps', '-nt'], {
      timeout: 60000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], env: SPAWN_ENV,
    });
    const transcript = output.trim();
    if (!transcript) return null;
    log.info('Transcribed voice message', { chars: transcript.length });
    return transcript;
  } catch (err) {
    log.error('whisper.cpp transcription failed', { err });
    return null;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}
```

`SPAWN_ENV` augments `PATH` with `/opt/homebrew/bin` and `/usr/local/bin` since the service runs under launchd/systemd with a minimal PATH.

Wherever the message pipeline handles inbound audio attachments, call `transcribeAudio()` and attach the result — check the current diff site if unsure (likely `router.ts` or wherever attachments are processed before reaching the container).

**Test file** (`src/transcription.test.ts`) — covers `extFromMime` only:
```typescript
import { extFromMime } from './transcription.js';

describe('extFromMime', () => {
  it('maps the Telegram/WhatsApp voice container to ogg', () => expect(extFromMime('audio/ogg')).toBe('ogg'));
  it('maps mpeg to mp3', () => expect(extFromMime('audio/mpeg')).toBe('mp3'));
  it('normalizes wave variants to wav', () => {
    expect(extFromMime('audio/x-wav')).toBe('wav');
    expect(extFromMime('audio/wave')).toBe('wav');
  });
  it('strips codec parameters from the subtype', () => expect(extFromMime('audio/ogg; codecs=opus')).toBe('ogg'));
  it('passes through other subtypes', () => {
    expect(extFromMime('audio/webm')).toBe('webm');
    expect(extFromMime('audio/mp4')).toBe('mp4');
  });
  it('falls back to ogg for missing/malformed mime types', () => {
    expect(extFromMime(undefined)).toBe('ogg');
    expect(extFromMime('')).toBe('ogg');
    expect(extFromMime('garbage')).toBe('ogg');
  });
});
```

**External dependency, not part of code migration:** `whisper-cli` binary + `ggml-base.bin` model at `data/models/`, `ffmpeg` installed on the host.
