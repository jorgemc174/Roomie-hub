import {ReservationsPage} from '@/features/calendar/reservations-page';
export default async function Page({params,searchParams}:{params:Promise<{homeId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){return <ReservationsPage homeId={(await params).homeId} search={await searchParams}/>;}
