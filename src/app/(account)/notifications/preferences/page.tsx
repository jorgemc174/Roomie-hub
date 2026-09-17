import {requireUser} from '@/lib/data';
import {i18n} from '@/lib/i18n/server';
import {ActionForm} from '@/components/action-form';
import {notificationMessages} from '@/features/notifications/messages';
import {categories} from '@/features/notifications/models';
import {preferenceAction} from '@/features/notifications/actions';
import {PushDevices} from '@/features/notifications/push';
export default async function Preferences(){
 const {db}=await requireUser(),{locale}=await i18n(),t=notificationMessages(locale);
 const [{data:preferences,error},{data:devices}]=await Promise.all([db.from('notification_preferences').select('*'),db.from('push_subscriptions').select('id,label,endpoint').eq('active',true)]);
 if(error)return <p role="alert" className="notice error">{['42P01','PGRST205'].includes(error.code)?t.migration:t.error}</p>;
 const emailReady=Boolean(process.env.RESEND_API_KEY&&process.env.ROOMIEHUB_EMAIL_FROM),publicKey=process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY??'';
 return <div className="narrow stack"><h1>{t.preferences}</h1><PushDevices devices={devices??[]} publicKey={publicKey}/>{categories.map(category=>{const p=preferences.find(p=>p.category===category);return <section className="panel" key={category}><h2>{t[category]}</h2><ActionForm action={preferenceAction} label={t.save} pendingLabel={t.saving}><input type="hidden" name="category" value={category}/><input type="hidden" name="version" value={p?.version??0}/><label className="checkbox"><input type="checkbox" name="app" defaultChecked={p?.in_app??true}/>{t.app}</label><label className="checkbox"><input type="checkbox" name="email" defaultChecked={p?.email??false} disabled={!emailReady}/>{t.email}{!emailReady&&<small> · {t.unavailable}</small>}</label><label className="checkbox"><input type="checkbox" name="push" defaultChecked={p?.push??false} disabled={!publicKey}/>{t.push}{!publicKey&&<small> · {t.unavailable}</small>}</label>{['tasks','reservations','activities'].includes(category)&&<fieldset><legend>{t.reminders}</legend>{[15,60,1440].map(offset=><label key={offset} className="checkbox"><input type="checkbox" name="offsets" value={offset} defaultChecked={(p?.reminder_minutes??[60]).includes(offset)}/>{new Intl.NumberFormat(locale).format(offset)} {t.minutes}</label>)}</fieldset>}</ActionForm></section>;})}</div>;
}
