import {CommunityPage} from '@/features/community/page';
export default async function Page({params,searchParams}:{params:Promise<{homeId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){return <CommunityPage homeId={(await params).homeId} search={await searchParams}/>;}
