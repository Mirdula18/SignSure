import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { ACCEPT_ATTRIBUTE } from '@/features/parsing/fileGuards';
import { useT } from '@/state/preferences';

/**
 * File picker with optional drag and drop.
 *
 * Drag and drop is an *addition*, never the only route: WCAG 2.2 2.5.7 requires a
 * single-pointer alternative to any dragging action, and a keyboard user has no way to drag at
 * all. The real `<input type="file">` is the primary control; the drop target is decoration
 * around it.
 *
 * The drop zone itself is not given a button role. It is a region that happens to accept a
 * drop, and announcing it as a button to a screen-reader user would promise an interaction that
 * does not work for them.
 */
export interface DropzoneProps {
  onFile: (file: File) => void;
  disabled?: boolean;
}

export function Dropzone({ onFile, disabled = false }: DropzoneProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOver, setIsOver] = useState(false);
  const hintId = useId();
  const inputId = useId();

  // The native listeners are attached once, so they read the current props through refs rather
  // than capturing the values they were created with.
  const onFileRef = useRef(onFile);
  const disabledRef = useRef(disabled);
  useEffect(() => {
    onFileRef.current = onFile;
    disabledRef.current = disabled;
  }, [onFile, disabled]);

  /**
   * Drag handlers are attached natively rather than as JSX props.
   *
   * A `<div>` carrying interaction props reads as an interactive element to tooling and to
   * anyone auditing the markup, but this one is not: it cannot be focused or operated by
   * keyboard, and it is not meant to be. The real control is the button inside it.
   */
  const zoneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const zone = zoneRef.current;
    if (zone === null) return;

    const onDragOver = (event: globalThis.DragEvent): void => {
      event.preventDefault();
      if (!disabledRef.current) setIsOver(true);
    };
    const onDragLeave = (): void => {
      setIsOver(false);
    };
    const onDrop = (event: globalThis.DragEvent): void => {
      event.preventDefault();
      setIsOver(false);
      if (disabledRef.current) return;
      const file = event.dataTransfer?.files.item(0);
      if (file) onFileRef.current(file);
    };

    zone.addEventListener('dragover', onDragOver);
    zone.addEventListener('dragleave', onDragLeave);
    zone.addEventListener('drop', onDrop);
    return () => {
      zone.removeEventListener('dragover', onDragOver);
      zone.removeEventListener('dragleave', onDragLeave);
      zone.removeEventListener('drop', onDrop);
    };
  }, []);

  return (
    <div
      ref={zoneRef}
      className={[
        'flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center',
        isOver ? 'border-primary bg-primary-soft' : 'border-line-strong bg-raised',
      ].join(' ')}
    >
      <p className="text-sm text-muted" aria-hidden="true">
        {t('upload.dropHere')}
      </p>

      <label htmlFor={inputId} className="sr-only">
        {t('upload.chooseFile')}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        disabled={disabled}
        aria-describedby={hintId}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.item(0);
          if (file) onFile(file);
          // Clearing lets the same file be chosen twice in a row, which otherwise silently
          // does nothing because `change` never fires.
          event.target.value = '';
        }}
      />
      <Button
        variant="primary"
        disabled={disabled}
        onClick={() => {
          inputRef.current?.click();
        }}
      >
        {t('upload.chooseFile')}
      </Button>

      <p id={hintId} className="text-xs text-muted">
        {t('upload.dropzoneHint')}
      </p>
    </div>
  );
}
