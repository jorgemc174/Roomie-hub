'use client';
import { useState } from 'react';
import type { Locale } from '@/lib/i18n/dictionaries';
import { communityMessages } from './messages';
import type { SavedPunishment } from './models';
export function PunishmentDescription({
  locale,
  saved,
  defaultValue = '',
  required = false,
}: {
  locale: Locale;
  saved: SavedPunishment[];
  defaultValue?: string;
  required?: boolean;
}) {
  const t = communityMessages(locale),
    [value, setValue] = useState(defaultValue),
    options = saved.filter((s) => s.text !== value.trim());
  return (
    <>
      {options.length > 0 && (
        <div className="punishment-saved" role="group" aria-label={t.savedPunishments}>
          <span className="muted">{t.savedPunishments}</span>
          <div className="punishment-saved-list">
            {options.map((s) => (
              <button
                key={s.text}
                type="button"
                className="button secondary"
                title={`${s.severity === 'heavy' ? t.heavy : t.light}${s.uses > 1 ? ` · ${t.usedTimes.replace('{n}', String(s.uses))}` : ''}`}
                onClick={() => setValue(s.text)}
              >
                {s.text}
              </button>
            ))}
          </div>
        </div>
      )}
      <label>
        {t.description}
        <textarea
          name="description"
          maxLength={2000}
          required={required}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
    </>
  );
}
