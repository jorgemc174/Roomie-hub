import { financeAction } from '@/features/expenses/actions';
import { expenseMessages } from '@/features/expenses/messages';
import { getHome, getMembers, requireUser, signedImage } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import { homeAction } from '@/app/actions';
import { ActionForm } from '@/components/action-form';
import { CurrencySelect } from '@/components/currency-select';
import { COMMON_TIMEZONES } from '@/lib/timezones';
export default async function Settings({ params }: { params: Promise<{ homeId: string }> }) {
  const { homeId } = await params;
  const home = await getHome(homeId);
  const members = await getMembers(homeId);
  const { db } = await requireUser();
  const { data: invite, error } = await db
    .from('invitations')
    .select('code')
    .eq('home_id', homeId)
    .single();
  if (error) throw new Error('invitation_read_failed');
  const { t, locale } = await i18n();
  const financeText = expenseMessages(locale);
  const image = await signedImage('home-images', home.image_path);
  const url = process.env.NEXT_PUBLIC_SITE_URL;
  if (!url) throw new Error('site_url_missing');
  return (
    <div className="narrow stack">
      <header className="page-head">
        <div>
          <h1>{t.homeSettings}</h1>
          <p>{t.homeDetailsBody}</p>
        </div>
      </header>
      <section className="panel">
        <h2>{t.homeDetails}</h2>
        <p>{home.name}</p>
        <ActionForm action={homeAction.bind(null, 'update')} label={t.save} pendingLabel={t.saving}>
          <input type="hidden" name="home_id" value={homeId} />
          {image && <img src={image} alt={t.homeImage} className="image-preview" />}
          <label>
            {t.homeName}
            <input name="name" defaultValue={home.name} required minLength={2} maxLength={80} />
          </label>
          <label>
            {t.homeImage}
            <input name="image" type="file" accept="image/jpeg,image/png,image/webp" />
            <small>{t.imageHint}</small>
          </label>
          {home.image_path && (
            <label className="checkbox">
              <input name="remove_image" type="checkbox" />
              {t.removeImage}
            </label>
          )}
          <div className="form-row">
            <label>
              {t.currency}
              <CurrencySelect locale={locale} current={home.currency} />
            </label>
            <label>
              {t.weekStart}
              <select name="week_starts_on" defaultValue={home.week_starts_on}>
                {t.days.map((day, i) => (
                  <option key={day} value={i}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </ActionForm>
      </section>
      <section className="panel">
        <h2>{t.homeTimezone}</h2>
        <p>{t.homeTimezoneHelp}</p>
        <ActionForm
          action={homeAction.bind(null, 'timezone')}
          label={t.save}
          pendingLabel={t.saving}
        >
          <input type="hidden" name="home_id" value={homeId} />
          <label>
            {t.homeTimezone}
            <input
              name="timezone"
              list="home-timezones"
              defaultValue={home.timezone ?? 'UTC'}
              required
              maxLength={100}
            />
          </label>
          <datalist id="home-timezones">
            {COMMON_TIMEZONES.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </ActionForm>
      </section>
      <section id="invitation" className="panel">
        <h2>{t.invitation}</h2>
        <p>{t.invitationBody}</p>
        <label>
          {t.code}
          <input readOnly value={invite.code} className="invitation-code" />
        </label>
        <label>
          {t.inviteLink}
          <input readOnly value={`${new URL(url).origin}/invite/${invite.code}`} />
        </label>
        <p style={{ marginTop: 22 }}>{t.regenerateWarning}</p>
        <ActionForm
          action={homeAction.bind(null, 'regenerate')}
          label={t.regenerate}
          pendingLabel={t.saving}
        >
          <input type="hidden" name="home_id" value={homeId} />
          <label className="checkbox">
            <input type="checkbox" name="confirm" required />
            {t.confirmRegenerate}
          </label>
        </ActionForm>
      </section>
      <section className="panel">
        <h2>{financeText.leave}</h2>
        <p>{financeText.leaveHelp}</p>
        <ActionForm
          action={financeAction.bind(null, homeId, 'leave')}
          label={financeText.leave}
          pendingLabel={t.saving}
          danger
        >
          <label className="checkbox">
            <input name="confirm" type="checkbox" required />
            {financeText.confirmLeave}
          </label>
        </ActionForm>
      </section>
      <section className="panel">
        <h2>{t.danger}</h2>
        <p>{t.deleteBody}</p>
        {members.length === 1 ? (
          <ActionForm
            action={homeAction.bind(null, 'delete')}
            label={t.danger}
            pendingLabel={t.saving}
            danger
          >
            <input type="hidden" name="home_id" value={homeId} />
            <label className="checkbox">
              <input name="confirm" type="checkbox" required />
              {t.confirmDelete}
            </label>
          </ActionForm>
        ) : (
          <p className="notice">{t.deleteBlocked}</p>
        )}
      </section>
    </div>
  );
}
