import {validWorkerToken} from '@/features/notifications/delivery';
import {deliverNotifications} from '@/features/notifications/worker';
export const runtime='nodejs';
export const maxDuration=120;
export async function POST(request:Request){
 const headers={'Cache-Control':'no-store'};
 if(!validWorkerToken(request.headers.get('authorization'),process.env.ROOMIEHUB_JOB_SECRET))return Response.json({error:'unauthorized'},{status:401,headers});
 try{return Response.json(await deliverNotifications(),{headers});}catch{return Response.json({error:'job_failed'},{status:503,headers});}
}
