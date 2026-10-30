import { EmptyState } from '@/components/ui/empty-state';
import Link from 'next/link';
import { House, Plus, KeyRound, ArrowUpRight } from 'lucide-react';
import { requireUser, signedImage } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import type { Home } from '@/lib/models';
export default async function Homes() {
  const { db } = await requireUser();
  const { t } = await i18n();
  const { data, error } = await db.from('homes').select('*').order('created_at');
  if (error) throw new Error('homes_read_failed');
  const homes = data as Home[];
  return (
    <>
      <header className="page-head">
        <div>
          <h1>{t.homes}</h1>
          <p>{t.homesBody}</p>
        </div>
        <div className="actions">
          <Link className="button secondary" href="/homes/join">
            <KeyRound size={18} />
            {t.joinHome}
          </Link>
          <Link className="button" href="/homes/new">
            <Plus size={18} />
            {t.createHome}
          </Link>
        </div>
      </header>
      {homes.length === 0 ? (
        <EmptyState
          title={t.emptyHomes}
          description={t.emptyHomesBody}
          icon={<House size={28} />}
          action={
            <Link className="button" href="/homes/new">
              <Plus size={18} aria-hidden="true" />
              {t.createHome}
            </Link>
          }
        />
      ) : (
        <div className="home-grid">
          {await Promise.all(
            homes.map(async (home) => {
              const image = await signedImage('home-images', home.image_path);
              return (
                <Link key={home.id} href={`/homes/${home.id}`} className="home-card">
                  {image ? (
                    <img
                      src={image}
                      alt=""
                      className="home-cover"
                      width={360}
                      height={170}
                      loading="lazy"
                    />
                  ) : (
                    <div className="home-cover">
                      <House size={52} strokeWidth={1.2} aria-hidden="true" />
                    </div>
                  )}
                  <div className="home-card-body">
                    <h2>{home.name}</h2>
                    <small>{home.currency}</small>
                    <div className="home-card-footer">
                      <span>{t.openHome}</span>
                      <ArrowUpRight size={20} />
                    </div>
                  </div>
                </Link>
              );
            }),
          )}
        </div>
      )}
    </>
  );
}
