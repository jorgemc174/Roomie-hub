import { PageHeader } from '@/components/ui/page-header';
import Link from 'next/link';
import { i18n } from '@/lib/i18n/server';
import { requireUser } from '@/lib/data';
import { homeAction } from '@/app/actions';
import { ActionForm } from '@/components/action-form';
import { Feedback } from '@/components/ui/feedback';

type InvitationPreview = { home_id: string; home_name: string; already_member: boolean };

export default async function Join({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const { t } = await i18n();
  const { code: rawCode } = await searchParams;
  const code = typeof rawCode === 'string' ? rawCode.trim().toLowerCase() : '';
  let preview: InvitationPreview | undefined;
  let readError = false;
  if (/^[a-f0-9]{32}$/.test(code)) {
    const { db } = await requireUser();
    const { data, error } = await db.rpc('preview_invitation', { invite_code: code });
    readError = Boolean(error);
    if (!error) preview = data?.[0];
  }
  return (
    <div className="narrow">
      <Link href="/homes" className="back-link">
        ← {t.homes}
      </Link>
      <PageHeader title={t.joinHome} description={t.joinBody} />
      <section className="panel">
        {preview ? (
          <>
            <p>
              {preview.already_member ? t.invitationAlreadyMember : t.invitationPreview}{' '}
              <strong>{preview.home_name}</strong>
            </p>
            {preview.already_member ? (
              <Link className="button" href={`/homes/${preview.home_id}`}>
                {t.openHome}
              </Link>
            ) : (
              <ActionForm
                action={homeAction.bind(null, 'join')}
                label={t.join}
                pendingLabel={t.saving}
              >
                <input type="hidden" name="code" value={code} />
              </ActionForm>
            )}
            <Link className="back-link" href="/homes">
              {t.cancel}
            </Link>
          </>
        ) : (
          <form action="/homes/join" method="get" className="form">
            {rawCode !== undefined && (
              <Feedback kind="error">{readError ? t.requestError : t.invalidInvitation}</Feedback>
            )}
            <label>
              {t.code}
              <input
                name="code"
                defaultValue={code}
                required
                minLength={32}
                maxLength={32}
                pattern="[a-fA-F0-9]{32}"
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button type="submit" className="button">
              {t.checkInvitation}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
