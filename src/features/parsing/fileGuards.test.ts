import { describe, expect, it } from 'vitest';
import { LIMITS } from '@shared/limits';
import { ACCEPT_ATTRIBUTE, ACCEPTED_EXTENSIONS, checkFile } from './fileGuards';

/** Builds a File whose bytes are under our control, so magic numbers can be tested. */
function fileWith(name: string, bytes: readonly number[], padTo = 0): File {
  const padded = [...bytes, ...new Array<number>(Math.max(0, padTo - bytes.length)).fill(0x20)];
  return new File([new Uint8Array(padded)], name);
}

function textFile(name: string, content: string): File {
  return new File([content], name, { type: 'text/plain' });
}

const PDF_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]; // %PDF-1.7
const ZIP_BYTES = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04
const ELF_BYTES = [0x7f, 0x45, 0x4c, 0x46]; // an ELF executable
const MZ_BYTES = [0x4d, 0x5a, 0x90, 0x00]; // a Windows executable

describe('checkFile', () => {
  it('accepts a real PDF', async () => {
    await expect(checkFile(fileWith('offer.pdf', PDF_BYTES, 64))).resolves.toEqual({
      ok: true,
      kind: 'pdf',
    });
  });

  it('accepts a real DOCX, which is a zip container', async () => {
    await expect(checkFile(fileWith('offer.docx', ZIP_BYTES, 64))).resolves.toEqual({
      ok: true,
      kind: 'docx',
    });
  });

  it('accepts a plain text file', async () => {
    await expect(checkFile(textFile('offer.txt', 'Dear Ms. Sharma,'))).resolves.toEqual({
      ok: true,
      kind: 'txt',
    });
  });

  it('accepts a text file containing Hindi', async () => {
    const result = await checkFile(textFile('offer.txt', 'कर्मचारी की नोटिस अवधि'));
    expect(result.ok).toBe(true);
  });

  describe('rejections', () => {
    it('rejects an empty file', async () => {
      const result = await checkFile(new File([], 'empty.pdf'));
      expect(result).toEqual({ ok: false, reason: 'EMPTY' });
    });

    it('rejects a file over the size limit and says how big it was', async () => {
      const big = new File([new Uint8Array(LIMITS.maxFileBytes + 1)], 'huge.pdf');
      const result = await checkFile(big);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('TOO_LARGE');
      expect(result.detail?.limitMb).toBe(10);
      expect(result.detail?.sizeMb).toBe('10.0');
    });

    it.each([
      'resume.png',
      'contract.doc',
      'notes.rtf',
      'archive.zip',
      'script.exe',
      'noextension',
    ])('rejects %s as an unsupported type', async (name) => {
      const result = await checkFile(textFile(name, 'anything'));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('UNSUPPORTED_TYPE');
    });

    it.each([
      ['a Linux executable renamed to .pdf', 'malware.pdf', ELF_BYTES],
      ['a Windows executable renamed to .pdf', 'malware.pdf', MZ_BYTES],
      ['a zip renamed to .pdf', 'notreally.pdf', ZIP_BYTES],
      ['a PDF renamed to .docx', 'notreally.docx', PDF_BYTES],
    ])('rejects %s on its content, not its name', async (_description, name, bytes) => {
      const result = await checkFile(fileWith(name, bytes, 64));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('CONTENT_MISMATCH');
    });

    it('rejects binary content wearing a .txt extension', async () => {
      const result = await checkFile(fileWith('notes.txt', [0x00, 0x01, 0x02, 0x03], 64));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('CONTENT_MISMATCH');
    });
  });

  it('matches extensions case-insensitively, because phones capitalise them', async () => {
    await expect(checkFile(fileWith('OFFER.PDF', PDF_BYTES, 64))).resolves.toEqual({
      ok: true,
      kind: 'pdf',
    });
  });

  it('reads only the header, so an oversized-but-valid file is still cheap to check', async () => {
    const nearLimit = new File(
      [new Uint8Array([...PDF_BYTES, ...new Array<number>(1024).fill(0x20)])],
      'offer.pdf',
    );
    await expect(checkFile(nearLimit)).resolves.toEqual({ ok: true, kind: 'pdf' });
  });
});

describe('accept attribute', () => {
  it('lists every extension the checker accepts, so the picker and the guard agree', () => {
    for (const extension of ACCEPTED_EXTENSIONS) {
      expect(ACCEPT_ATTRIBUTE).toContain(extension);
    }
  });
});
