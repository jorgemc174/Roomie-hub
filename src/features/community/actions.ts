'use server';
import {revalidatePath} from 'next/cache';
import {unstable_rethrow} from 'next/navigation';
import {requireUser,getHome} from '@/lib/data';
import {i18n} from '@/lib/i18n/server';
import type {ActionState} from '@/app/actions';
import {communityMessages} from './messages';
import {sanitizeRatingPhoto} from './photo';
const field=(f:FormData,k:string)=>String(f.get(k)??'').trim();
const uuid=(s:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export async function communityAction(homeId:string,operation:string,_state:ActionState,form:FormData):Promise<ActionState>{
 const {locale}=await i18n(),t=communityMessages(locale);let saved=false;
 try{
 const {db}=await requireUser();await getHome(homeId);
 const id=field(form,'id'),version=Number(field(form,'version'));
 if(!['initialize','reconcile'].includes(operation)&&(!uuid(id)||!Number.isInteger(version)||version<0))return{error:t.invalid};
 let photo:Buffer|undefined;const file=form.get('photo');
 if(file instanceof File&&file.size){if(file.size>5*1024*1024)return{error:t.invalid};photo=await sanitizeRatingPhoto(new Uint8Array(await file.arrayBuffer()),file.type);}
 let result:{error:{message:string;code?:string}|null};
 if(operation==='initialize')result=await db.rpc('initialize_rating_reasons',{target:homeId,language_code:locale});
 else if(operation==='reconcile')result=await db.rpc('reconcile_community',{target:homeId});
 else if(operation==='reason')result=await db.rpc('save_rating_reason',{target:homeId,item:id,expected_version:version,label:field(form,'name'),sign:field(form,'kind'),needs_text:field(form,'requires_text')==='on',enabled:field(form,'active')==='on'});
 else if(operation==='rating'){
 if(!uuid(field(form,'person'))||!uuid(field(form,'reason')))return{error:t.invalid};
 result=await db.rpc('save_rating',{target:homeId,item:id,expected_version:version,person:field(form,'person'),reason:field(form,'reason'),notes:field(form,'notes'),anonymous:field(form,'anonymous')==='on'});
 }else if(operation==='delete'){
 if(field(form,'confirm')!=='on')return{error:t.invalid};result=await db.rpc('delete_rating',{target:homeId,item:id,expected_version:version});
 }else if(operation==='punishment')result=await db.rpc('save_punishment',{target:homeId,item:id,expected_version:version,notes:field(form,'description'),finish:field(form,'finish')==='on'});
 else if(operation==='photo')result={error:null};else return{error:t.invalid};
 if(result.error)throw result.error;saved=operation==='rating';
 if(photo||field(form,'remove_photo')==='on'){
 let path:string|null=null;
 if(photo){const prepared=await db.rpc('prepare_rating_photo',{target:homeId,item:id});if(prepared.error)throw prepared.error;path=prepared.data;
 const uploaded=await db.storage.from('rating-photos').upload(path,photo,{contentType:'image/webp',upsert:false});if(uploaded.error)throw uploaded.error;}
 // After a just-saved rating its version advanced, or an idempotent creation retry reused it.
 let attachmentVersion=version;
 if(operation==='rating'){const row=await db.from('ratings').select('version').eq('home_id',homeId).eq('id',id).single();if(row.error)throw row.error;attachmentVersion=row.data.version;}
 const attached=await db.rpc('attach_rating_photo',{target:homeId,item:id,expected_version:attachmentVersion,object_path:path});
 if(attached.error){if(path)await db.storage.from('rating-photos').remove([path]);throw attached.error;}
 }
 revalidatePath(`/homes/${homeId}`,'layout');return{success:t.saved};
 }catch(e){unstable_rethrow(e);const err=e as{message?:string;code?:string};
 if(saved){revalidatePath(`/homes/${homeId}`,'layout');return{error:t.partial};}
 if(err.code==='PGRST202'||err.code==='42P01')return{error:t.migration};
 if(err.message==='self_rating')return{error:t.self};if(err.message==='locked_rating')return{error:t.locked};if(err.message==='anonymous_locked')return{error:t.anonymousLocked};
 if(['stale_version','idempotency_conflict'].includes(err.message??''))return{error:t.stale};
 if(err.message?.startsWith('invalid_')||['23514','23502','22P02'].includes(err.code??''))return{error:t.invalid};return{error:t.error};}
}
