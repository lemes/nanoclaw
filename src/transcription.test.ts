import { describe, it, expect } from 'vitest';

import { extFromMime } from './transcription.js';

describe('extFromMime', () => {
  it('maps the Telegram/WhatsApp voice container to ogg', () => {
    expect(extFromMime('audio/ogg')).toBe('ogg');
  });

  it('maps mpeg to mp3', () => {
    expect(extFromMime('audio/mpeg')).toBe('mp3');
  });

  it('normalizes wave variants to wav', () => {
    expect(extFromMime('audio/x-wav')).toBe('wav');
    expect(extFromMime('audio/wave')).toBe('wav');
  });

  it('strips codec parameters from the subtype', () => {
    expect(extFromMime('audio/ogg; codecs=opus')).toBe('ogg');
  });

  it('passes through other subtypes (e.g. m4a/webm)', () => {
    expect(extFromMime('audio/webm')).toBe('webm');
    expect(extFromMime('audio/mp4')).toBe('mp4');
  });

  it('falls back to ogg for missing or malformed mime types', () => {
    expect(extFromMime(undefined)).toBe('ogg');
    expect(extFromMime('')).toBe('ogg');
    expect(extFromMime('garbage')).toBe('ogg');
  });
});
