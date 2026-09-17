import {getHome,requireUser} from '@/lib/data';
import {i18n} from '@/lib/i18n/server';
import {chatMessages} from '@/features/chat/messages';
import {Chat} from '@/features/chat/chat';
import type {ChatPage} from '@/features/chat/models';
export default async function ChatPageRoute({params}:{params:Promise<{homeId:string}>}){
 const {homeId}=await params;const home=await getHome(homeId),{db,user}=await requireUser(),{locale}=await i18n(),t=chatMessages(locale);
 const {data,error}=await db.rpc('chat_page',{target:homeId});
 return <section><h1>{t.title}</h1><p className="muted">{t.body}</p>{error?<p role="alert" className="notice error">{['PGRST202','42P01'].includes(error.code)?t.migration:t.error}</p>:<Chat key={homeId} homeId={homeId} userId={user.id} timezone={home.timezone} initial={data as unknown as ChatPage}/>}</section>;
}
