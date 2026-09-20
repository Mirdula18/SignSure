import { LIMITS } from '@shared/limits';
import type { SourceKind } from '@shared/types';

/**
 * Checks a file before any parser touches it.
 *
 * A filename extension is a claim, not a fact, so the first bytes are read and compared against
 * the format's magic number. This stops an executable renamed to `.pdf` from reaching pdf.js,
 * and it stops a 200 MB file from freezing the tab before anything useful happens.
 */

export type FileRejectionReason = 'TOO_LARGE' | 'EMPTY' | 'UNSUPPORTED_TYPE' | 'CONTENT_MISMATCH';

export interface FileAccepted {
  ok: true;
  kind: Extract<SourceKind, 'pdf' | 'docx' | 'txt'>;
}

export interface FileRejected {
  ok: false;
  reason: FileRejectionReason;
  /** Values the UI needs to write a message that says how to fix it. */
  detail?: Readonly<Record<string, string | number>>;
}

export type FileCheck = FileAccepted | FileRejected;

export const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.txt'] as const;

/** `accept` attribute for the file input, kept next to the checks it mirrors. */
export const ACCEPT_ATTRIBUTE =
  '.pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain';

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF
const ZIP_MAGIC = [0x50, 0x4b]; // PK - DOCX is a zip container

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((byte, index) => bytes[index] === byte);
}

/** A byte that no plain-text document should contain; C0 controls other than tab/CR/LF. */
function looksBinary(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    if (byte === 0) return true;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) return true;
  }
  return false;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

/**
 * Validates size, declared type and actual content.
 *
 * Reads only the first 512 bytes, so a huge file is rejected without being loaded into memory.
 */
export async function checkFile(file: File): Promise<FileCheck> {
  if (file.size === 0) return { ok: false, reason: 'EMPTY' };
  if (file.size > LIMITS.maxFileBytes) {
    return {
      ok: false,
      reason: 'TOO_LARGE',
      detail: {
        sizeMb: (file.size / 1024 / 1024).toFixed(1),
        limitMb: LIMITS.maxFileBytes / 1024 / 1024,
      },
    };
  }

  const extension = extensionOf(file.name);
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(extension)) {
    return { ok: false, reason: 'UNSUPPORTED_TYPE', detail: { extension: extension || 'none' } };
  }

  const header = new Uint8Array(await file.slice(0, 512).arrayBuffer());

  if (extension === '.pdf') {
    return startsWith(header, PDF_MAGIC)
      ? { ok: true, kind: 'pdf' }
      : { ok: false, reason: 'CONTENT_MISMATCH', detail: { claimed: 'PDF' } };
  }

  if (extension === '.docx') {
    return startsWith(header, ZIP_MAGIC)
      ? { ok: true, kind: 'docx' }
      : { ok: false, reason: 'CONTENT_MISMATCH', detail: { claimed: 'Word document' } };
  }

  return looksBinary(header)
    ? { ok: false, reason: 'CONTENT_MISMATCH', detail: { claimed: 'text file' } }
    : { ok: true, kind: 'txt' };
}
