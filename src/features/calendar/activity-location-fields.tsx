'use client';
import { useId, useState } from 'react';
import type { Locale } from '@/lib/i18n/dictionaries';
import { calendarMessages } from './messages';

export function ActivityLocationFields({
  locale,
  initialKind,
  initialPlace,
}: {
  locale: Locale;
  initialKind: string;
  initialPlace: string;
}) {
  const t = calendarMessages(locale);
  const [kind, setKind] = useState(initialKind);
  const [place, setPlace] = useState(initialPlace);
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  const outside = kind === 'outside';
  return (
    <>
      <label>
        {t.locationKind}
        <select
          name="location_kind"
          required
          value={kind}
          onChange={(event) => {
            setKind(event.target.value);
            setInvalid(false);
          }}
        >
          <option value="" disabled>
            {t.chooseLocation}
          </option>
          <option value="home">{t.atHome}</option>
          <option value="outside">{t.outsideHome}</option>
        </select>
      </label>
      <label>
        {t.location}
        <input
          name="location"
          maxLength={300}
          required={outside}
          pattern={outside ? '.*\\S.*' : undefined}
          value={place}
          aria-invalid={invalid || undefined}
          aria-describedby={outside ? errorId : undefined}
          onChange={(event) => {
            setPlace(event.target.value);
            setInvalid(false);
          }}
          onInvalid={() => setInvalid(true)}
        />
      </label>
      {outside && (
        <p id={errorId} role={invalid ? 'alert' : undefined}>
          {t.activityLocationRequired}
        </p>
      )}
    </>
  );
}
