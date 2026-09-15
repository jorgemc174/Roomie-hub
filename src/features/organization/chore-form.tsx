'use client';
import { useState } from 'react';
import type { Member } from '@/lib/models';
import type { Chore, RotationMember } from './models';
import type { OrganizationMessages } from './messages';
import { ActionForm } from '@/components/action-form';
import { organizationAction } from './actions';
export function ChoreForm({
  homeId,
  chore,
  rotations,
  members,
  t,
  today,
  homeTimezone,
}: {
  homeId: string;
  chore?: Chore;
  rotations: RotationMember[];
  members: Member[];
  t: OrganizationMessages;
  today: string;
  homeTimezone: string;
}) {
  const [kind, setKind] = useState(chore?.recurrence ?? 'weekly');
  const [mode, setMode] = useState(chore?.assignment_mode ?? 'automatic');
  const [deadline, setDeadline] = useState(chore?.deadline_days != null);
  const [rotation, setRotation] = useState(
    rotations
      .filter((r) => r.chore_id === chore?.id)
      .sort((a, b) => a.position - b.position)
      .map((r) => r.user_id)
      .filter((id) => members.some((m) => m.user_id === id)),
  );
  const [person, setPerson] = useState('');
  const move = (i: number, delta: number) =>
    setRotation((old) => {
      const next = [...old];
      [next[i], next[i + delta]] = [next[i + delta], next[i]];
      return next;
    });
  return (
    <ActionForm
      action={organizationAction.bind(null, homeId, 'save_chore')}
      label={t.save}
      pendingLabel={t.saving}
    >
      <input type="hidden" name="id" value={chore?.id ?? ''} />
      <label>
        {t.name}
        <input name="name" required maxLength={100} defaultValue={chore?.name} />
      </label>
      <label>
        {t.description}
        <textarea name="description" maxLength={2000} defaultValue={chore?.description} />
      </label>
      <div className="form-row">
        <label>
          {t.difficulty}
          <input
            name="difficulty"
            type="number"
            min={1}
            max={5}
            required
            defaultValue={chore?.difficulty ?? 3}
          />
        </label>
        <label>
          {t.recurrence}
          <select
            name="recurrence"
            value={kind}
            onChange={(e) => setKind(e.target.value as Chore['recurrence'])}
          >
            {(['daily', 'days', 'weekly', 'weeks', 'monthly'] as const).map((k) => (
              <option key={k} value={k}>
                {t[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {['days', 'weeks'].includes(kind) ? (
        <label>
          {t.every}
          <input
            name="interval_count"
            type="number"
            min={1}
            max={365}
            required
            defaultValue={chore?.interval_count ?? 1}
          />
        </label>
      ) : (
        <input type="hidden" name="interval_count" value="1" />
      )}
      <label>
        {t.anchor}
        <input name="anchor_date" type="date" required defaultValue={chore?.anchor_date ?? today} />
      </label>
      <p>{t.recurrenceHelp}</p>
      <label>
        {t.mode}
        <select
          name="assignment_mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as Chore['assignment_mode'])}
        >
          <option value="automatic">{t.automatic}</option>
          <option value="manual">{t.manual}</option>
        </select>
      </label>
      {mode === 'manual' && (
        <section className="rotation-editor">
          <h3>{t.rotation}</h3>
          <p>{t.rotationHelp}</p>
          <ol>
            {rotation.map((id, i) => (
              <li key={id}>
                <input type="hidden" name="rotation" value={id} />
                <span>{members.find((m) => m.user_id === id)?.profiles?.name}</span>
                <div className="inline-actions">
                  <button
                    type="button"
                    className="button secondary"
                    disabled={i === 0}
                    aria-label={`${t.up}: ${members.find((m) => m.user_id === id)?.profiles?.name}`}
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={i === rotation.length - 1}
                    aria-label={`${t.down}: ${members.find((m) => m.user_id === id)?.profiles?.name}`}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setRotation(rotation.filter((u) => u !== id))}
                  >
                    {t.remove}
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <label>
            {t.person}
            <select value={person} onChange={(e) => setPerson(e.target.value)}>
              <option value="">{t.choose}</option>
              {members
                .filter((m) => !rotation.includes(m.user_id))
                .map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.profiles?.name}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            className="button secondary"
            disabled={!person}
            onClick={() => {
              setRotation([...rotation, person]);
              setPerson('');
            }}
          >
            {t.add}
          </button>
        </section>
      )}
      <label className="checkbox">
        <input
          name="deadline"
          type="checkbox"
          checked={deadline}
          onChange={(e) => setDeadline(e.target.checked)}
        />
        {t.deadline}
      </label>
      {deadline && (
        <>
          <div className="form-row">
            <label>
              {t.dueDays}
              <input
                type="number"
                name="deadline_days"
                min={0}
                max={365}
                required
                defaultValue={chore?.deadline_days ?? 6}
              />
            </label>
            <label>
              {t.dueTime}
              <input
                type="time"
                name="deadline_time"
                required
                defaultValue={chore?.deadline_time?.slice(0, 5) ?? '20:00'}
              />
            </label>
          </div>
          <label>
            {t.timezone}
            <input
              name="deadline_timezone"
              required
              defaultValue={
                chore?.deadline_timezone ?? homeTimezone
              }
            />
          </label>
          <p>{t.timezoneHelp}</p>
        </>
      )}
      <label className="checkbox">
        <input type="checkbox" name="active" defaultChecked={chore?.active ?? true} />
        {t.active}
      </label>
    </ActionForm>
  );
}
