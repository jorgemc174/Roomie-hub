import {NextResponse} from 'next/server';
import {supabase} from '@/lib/supabase/server';
import {validUuid} from '@/features/chat/logic';
import {sanitizeChatFile} from '@/features/chat/files';
export async function GET(_request:Request,{params}:{params:Promise<{homeId:string;attachmentId:string}>}){
 const {homeId,attachmentId}=await params;
 const headers={'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"};
 const denied=()=>new NextResponse(null,{status:404,headers});
 if(!validUuid(homeId)||!validUuid(attachmentId))return denied();
 const db=await supabase();const {data:{user}}=await db.auth.getUser();if(!user)return denied();
 const {data:a}=await db.from('chat_attachments').select('*').eq('id',attachmentId).eq('home_id',homeId).not('message_id','is',null).maybeSingle();if(!a)return denied();
 // An independent RLS read precedes every download; a nonce avoids stale Storage CDN decisions.
 const {data:signed,error}=await db.storage.from('chat-files').createSignedUrl(a.path,15);if(error||!signed)return denied();
 const url=new URL(signed.signedUrl);url.searchParams.set('download_nonce',crypto.randomUUID());
 const response=await fetch(url,{cache:'no-store'});if(!response.ok)return denied();
 const bytes=new Uint8Array(await response.arrayBuffer());
 try{
  // Validate again here: direct authenticated Storage clients cannot bypass safe rendering.
  const safe=await sanitizeChatFile(bytes,a.mime,a.file_name);
  return new NextResponse(new Uint8Array(safe.bytes),{headers:{...headers,'Content-Type':safe.mime,'Content-Disposition':`${safe.mime==='image/webp'?'inline':'attachment'}; filename="file"; filename*=UTF-8''${encodeURIComponent(safe.name)}`}});
 }catch{return denied();}
}
