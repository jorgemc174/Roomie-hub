import {ActivitiesPage} from '@/features/calendar/activities-page';
export default async function Page({params,searchParams}:{params:Promise<{homeId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){return <ActivitiesPage homeId={(await params).homeId} search={await searchParams}/>;}
