import { SectionDisclosure } from '@/components/section-disclosure';
import type { Locale } from '@/lib/i18n/dictionaries';
import { CalendarForm } from './form';
import { calendarMessages } from './messages';
import type { Resource } from './models';

// Spaces and resources stay configurable from the calendar options, as in former Reservas.
export function ResourceSettings({
  homeId,
  locale,
  resources,
}: {
  homeId: string;
  locale: Locale;
  resources: Resource[];
}) {
  const t = calendarMessages(locale);
  return (
    <SectionDisclosure
      title={t.manageResources}
      defaultOpen={!resources.some((x) => x.active)}
      id="reservation-settings"
    >
      <p>{t.resourceHelp}</p>
      <CalendarForm
        homeId={homeId}
        operation="initialize"
        id={crypto.randomUUID()}
        locale={locale}
        label={t.initialize}
      />
      <details>
        <summary>{t.newResource}</summary>
        <CalendarForm
          homeId={homeId}
          operation="resource"
          id={crypto.randomUUID()}
          locale={locale}
          label={t.save}
        >
          <label>
            {t.name}
            <input name="name" required maxLength={100} />
          </label>
          <label>
            {t.description}
            <textarea name="description" maxLength={2000} />
          </label>
          <label className="checkbox">
            <input name="active" type="checkbox" defaultChecked />
            {t.active}
          </label>
        </CalendarForm>
      </details>
      {resources.map((x) => (
        <details key={x.id}>
          <summary>
            {x.name} · {x.active ? t.active : t.inactive}
          </summary>
          <CalendarForm
            homeId={homeId}
            operation="resource"
            id={x.id}
            version={x.version}
            locale={locale}
            label={t.save}
          >
            <label>
              {t.name}
              <input name="name" required maxLength={100} defaultValue={x.name} />
            </label>
            <label>
              {t.description}
              <textarea name="description" maxLength={2000} defaultValue={x.description} />
            </label>
            <label className="checkbox">
              <input name="active" type="checkbox" defaultChecked={x.active} />
              {t.active}
            </label>
          </CalendarForm>
        </details>
      ))}
    </SectionDisclosure>
  );
}
