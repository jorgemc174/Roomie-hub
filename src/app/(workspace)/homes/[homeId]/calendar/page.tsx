import {CalendarPage} from '@/features/calendar/page';
export default async function Page({params,searchParams}:{params:Promise<{homeId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){return <CalendarPage homeId={(await params).homeId} search={await searchParams}/>;}
