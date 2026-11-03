'use client';
import { useEffect, useRef, useState } from 'react';
import { ActionForm } from '@/components/action-form';
import { profileAction, type ActionState } from '@/app/actions';
import type { Locale, Messages } from '@/lib/i18n/dictionaries';
import { avatarInitials, validAvatarFile } from '@/lib/profile-validation';

export function ProfileForm({
  name,
  email,
  image,
  hasImage,
  locale,
  theme,
  t,
}: {
  name: string;
  email: string;
  image: string | null;
  hasImage: boolean;
  locale: Locale;
  theme: string;
  t: Messages;
}) {
  const [saved, setSaved] = useState({ name, locale: String(locale), theme, image, hasImage });
  const [draft, setDraft] = useState({ name, locale: String(locale), theme });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [remove, setRemove] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);
  const dirty =
    draft.name !== saved.name ||
    draft.locale !== saved.locale ||
    draft.theme !== saved.theme ||
    !!file ||
    remove;
  useEffect(() => () => urls.current.forEach((url) => URL.revokeObjectURL(url)), []);
  useEffect(() => {
    if (!dirty) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }
    function navigate(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      )
        return;
      const link = event.target.closest('a[href]');
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.target === '_blank' ||
        link.hasAttribute('download')
      )
        return;
      const destination = new URL(link.href);
      if (
        destination.pathname === location.pathname &&
        destination.search === location.search &&
        destination.origin === location.origin
      )
        return;
      if (!window.confirm(t.unsavedChanges)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', navigate, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', navigate, true);
    };
  }, [dirty, t.unsavedChanges]);
  function cancel() {
    setDraft({ name: saved.name, locale: saved.locale, theme: saved.theme });
    setFile(null);
    setPreview(null);
    setRemove(false);
    setError('');
    if (input.current) {
      input.current.value = '';
      input.current.setCustomValidity('');
    }
  }
  async function save(previous: ActionState, form: FormData): Promise<ActionState> {
    // Recheck immediately before transport as well as on selection.
    const selected = form.get('image');
    if (selected instanceof File && selected.size > 0 && !validAvatarFile(selected))
      return { error: t.avatarImageError };
    const result = await profileAction(previous, form);
    if (result.success) {
      setSaved({
        ...draft,
        name: draft.name.trim(),
        image: preview ?? (remove ? null : saved.image),
        hasImage: !!file || (!remove && saved.hasImage),
      });
      setDraft({ ...draft, name: draft.name.trim() });
      setFile(null);
      setPreview(null);
      setRemove(false);
      setError('');
      if (input.current) input.current.value = '';
    }
    return result;
  }
  const visibleImage = preview ?? (remove ? null : saved.image);
  return (
    <ActionForm action={save} label={t.save} pendingLabel={t.saving}>
      {visibleImage ? (
        <img
          src={visibleImage}
          alt={t.photo}
          className="image-preview profile-photo"
          width={90}
          height={90}
        />
      ) : (
        <span className="avatar" role="img" aria-label={t.photo}>
          {avatarInitials(draft.name)}
        </span>
      )}
      <label>
        {t.email}
        <input type="email" value={email} readOnly autoComplete="email" />
      </label>
      <label>
        {t.name}
        <input
          name="name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          required
          minLength={2}
          maxLength={80}
          autoComplete="name"
        />
      </label>
      <label>
        {t.photo}
        <input
          ref={input}
          name="image"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-invalid={!!error}
          aria-describedby="avatar-hint avatar-error"
          onChange={(event) => {
            const selected = event.target.files?.[0] ?? null;
            const invalid = !!selected && !validAvatarFile(selected);
            event.target.setCustomValidity(invalid ? t.avatarImageError : '');
            setError(invalid ? t.avatarImageError : '');
            if (invalid) {
              event.target.value = '';
              setFile(null);
              setPreview(null);
              return;
            }
            setFile(selected);
            if (selected) {
              const url = URL.createObjectURL(selected);
              urls.current.push(url);
              setPreview(url);
              setRemove(false);
            } else setPreview(null);
          }}
        />
        <small id="avatar-hint">{t.avatarImageHint}</small>
      </label>
      <small id="avatar-error" role={error ? 'alert' : undefined}>
        {error}
      </small>
      {saved.hasImage && (
        <label className="checkbox">
          <input
            type="checkbox"
            name="remove_image"
            checked={remove}
            onChange={(e) => {
              setRemove(e.target.checked);
              if (e.target.checked) {
                setFile(null);
                setPreview(null);
                setError('');
                if (input.current) {
                  input.current.value = '';
                  input.current.setCustomValidity('');
                }
              }
            }}
          />
          {t.removeImage}
        </label>
      )}
      <div className="form-row">
        <label>
          {t.language}
          <select
            name="locale"
            value={draft.locale}
            onChange={(e) => setDraft({ ...draft, locale: e.target.value })}
          >
            <option value="es">{t.spanish}</option>
            <option value="en">{t.english}</option>
          </select>
        </label>
        <label>
          {t.theme}
          <select
            name="theme"
            value={draft.theme}
            onChange={(e) => setDraft({ ...draft, theme: e.target.value })}
          >
            <option value="light">{t.light}</option>
            <option value="dark">{t.dark}</option>
          </select>
        </label>
      </div>
      <button type="button" className="button secondary" onClick={cancel}>
        {t.cancel}
      </button>
    </ActionForm>
  );
}
