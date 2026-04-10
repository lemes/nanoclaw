import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('fs');

import { processFile, parseFileReferences } from './file.js';

describe('file processing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
  });

  describe('processFile', () => {
    it('saves file and returns content string with caption', async () => {
      const buffer = Buffer.from('file-data');
      const result = await processFile(
        buffer,
        '/tmp/groups/test',
        'report.pdf',
        'application/pdf',
        'Check this out',
      );

      expect(result).not.toBeNull();
      expect(result!.content).toMatch(
        /^\[File: attachments\/file-\d+-[a-z0-9]+-report\.pdf\] Check this out$/,
      );
      expect(result!.relativePath).toMatch(
        /^attachments\/file-\d+-[a-z0-9]+-report\.pdf$/,
      );
      expect(fs.mkdirSync).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('returns content without caption when none provided', async () => {
      const buffer = Buffer.from('file-data');
      const result = await processFile(
        buffer,
        '/tmp/groups/test',
        'data.csv',
        'text/csv',
        '',
      );

      expect(result).not.toBeNull();
      expect(result!.content).toMatch(
        /^\[File: attachments\/file-\d+-[a-z0-9]+-data\.csv\]$/,
      );
    });

    it('returns null on empty buffer', async () => {
      const result = await processFile(
        Buffer.alloc(0),
        '/tmp/groups/test',
        'empty.txt',
        'text/plain',
        '',
      );

      expect(result).toBeNull();
    });

    it('sanitizes filenames with path separators', async () => {
      const buffer = Buffer.from('file-data');
      const result = await processFile(
        buffer,
        '/tmp/groups/test',
        '../../../etc/passwd',
        'application/octet-stream',
        '',
      );

      expect(result).not.toBeNull();
      expect(result!.relativePath).not.toContain('..');
      expect(result!.relativePath).not.toContain('/etc');
    });
  });

  describe('parseFileReferences', () => {
    it('extracts file paths from message content', () => {
      const messages = [
        { content: '[File: attachments/file-123-report.pdf] hello' },
        { content: 'plain text' },
        { content: '[File: attachments/file-456-data.csv]' },
      ];
      const refs = parseFileReferences(messages as any);

      expect(refs).toEqual([
        {
          relativePath: 'attachments/file-123-report.pdf',
          mimeType: 'application/pdf',
        },
        {
          relativePath: 'attachments/file-456-data.csv',
          mimeType: 'text/csv',
        },
      ]);
    });

    it('returns application/octet-stream for unknown extensions', () => {
      const messages = [{ content: '[File: attachments/file-123-data.xyz]' }];
      const refs = parseFileReferences(messages as any);

      expect(refs).toEqual([
        {
          relativePath: 'attachments/file-123-data.xyz',
          mimeType: 'application/octet-stream',
        },
      ]);
    });

    it('returns empty array when no files', () => {
      const messages = [{ content: 'just text' }];
      expect(parseFileReferences(messages as any)).toEqual([]);
    });
  });
});
