import fs from 'fs';
import path from 'path';

const FILE_REF_PATTERN = /\[File: (attachments\/[^\]]+)\]/g;

export interface ProcessedFile {
  content: string;
  relativePath: string;
}

export interface FileAttachment {
  relativePath: string;
  mimeType: string;
}

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.py': 'text/x-python',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.doc': 'application/msword',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:\0]/g, '_')
    .replace(/\.{2,}/g, '.')
    .slice(0, 200);
}

export async function processFile(
  buffer: Buffer,
  groupDir: string,
  originalName: string,
  mimeType: string,
  caption: string,
): Promise<ProcessedFile | null> {
  if (!buffer || buffer.length === 0) return null;

  const sanitized = sanitizeFilename(originalName);
  const filename = `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${sanitized}`;

  const attachDir = path.join(groupDir, 'attachments');
  fs.mkdirSync(attachDir, { recursive: true });

  const filePath = path.join(attachDir, filename);
  fs.writeFileSync(filePath, buffer);

  const relativePath = `attachments/${filename}`;
  const content = caption
    ? `[File: ${relativePath}] ${caption}`
    : `[File: ${relativePath}]`;

  return { content, relativePath };
}

export function parseFileReferences(
  messages: Array<{ content: string }>,
): FileAttachment[] {
  const refs: FileAttachment[] = [];
  for (const msg of messages) {
    let match: RegExpExecArray | null;
    FILE_REF_PATTERN.lastIndex = 0;
    while ((match = FILE_REF_PATTERN.exec(msg.content)) !== null) {
      const relPath = match[1];
      const ext = path.extname(relPath).toLowerCase();
      refs.push({
        relativePath: relPath,
        mimeType: MIME_BY_EXT[ext] || 'application/octet-stream',
      });
    }
  }
  return refs;
}
