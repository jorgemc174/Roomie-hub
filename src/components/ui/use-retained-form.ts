'use client';
import { useEffect, useRef, type FormEvent } from 'react';

// React resets uncontrolled fields after a completed action, including failed saves.
// Retain only the current form's user-entered values; never persist them to storage.
export function useRetainedForm(error: string | undefined, pending: boolean) {
  const restore = useRef<(() => void)[]>([]);
  function capture(event: FormEvent<HTMLFormElement>) {
    restore.current = Array.from(event.currentTarget.elements).flatMap((element) => {
      if (element instanceof HTMLInputElement) {
        if (element.type === 'hidden') return [];
        const value = element.value,
          checked = element.checked,
          files = element.files;
        return [
          () => {
            if (!element.isConnected) return;
            if (element.type === 'file') {
              if (files) element.files = files;
            } else {
              element.value = value;
              element.checked = checked;
            }
          },
        ];
      }
      if (element instanceof HTMLTextAreaElement) {
        const value = element.value;
        return [
          () => {
            if (element.isConnected) element.value = value;
          },
        ];
      }
      if (element instanceof HTMLSelectElement) {
        const selected = Array.from(element.options).map((option) => option.selected);
        return [
          () => {
            if (element.isConnected)
              Array.from(element.options).forEach((option, i) => {
                option.selected = selected[i];
              });
          },
        ];
      }
      return [];
    });
  }
  useEffect(() => {
    if (!pending) {
      if (error) restore.current.forEach((apply) => apply());
      restore.current = [];
    }
  }, [error, pending]);
  return capture;
}
