import {requireUser} from '@/lib/data';
import {i18n} from '@/lib/i18n/server';
import {Inbox} from '@/features/notifications/inbox';
import {notificationMessages} from '@/features/notifications/messages';
export default async function Notifications(){const {db}=await requireUser(),{locale}=await i18n(),t=notificationMessages(locale);const {data,error}=await db.from('notifications').select('*').order('created_at',{ascending:false}).order('id',{ascending:false}).limit(50);return <section className="narrow"><h1>{t.title}</h1>{error?<p role="alert" className="notice error">{['42P01','PGRST205'].includes(error.code)?t.migration:t.error}</p>:<Inbox initial={data}/>}</section>;}
