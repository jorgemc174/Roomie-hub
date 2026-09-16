import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { organizationDatabase } from './helpers/database';

test('Community SQL: ratings, anonymity, reversible allocations, punishments and overdue history', async (t) => {
 const {db,as,users,home,scalar}=await organizationDatabase(); const [a,b,c,out]=users;
 const reasons=async(h:string)=>{await as(a);await db.query('select public.initialize_rating_reasons($1)',[h]);return {pos:(await db.query<{id:string}>("select id from public.rating_reasons where home_id=$1 and seed_key='default-1'",[h])).rows[0].id,neg:(await db.query<{id:string}>("select id from public.rating_reasons where home_id=$1 and seed_key='default-6'",[h])).rows[0].id};};
 const rate=async(h:string,reason:string,person=b,id:string=randomUUID(),v=0,anonymous=false,notes='')=>scalar<string>('select public.save_rating($1,$2,$3,$4,$5,$6,$7) v',[h,id,v,person,reason,notes,anonymous]);
 const balance=async(h:string,person=b)=>(await db.query<{positive_available:number;negative_effective:number;positive_consumed:number;credits:number;pending_punishments:number}>('select * from public.community_balances($1) where user_id=$2',[h,person])).rows[0];
 const counts=async(h:string,positive:number,negative:number)=>{const x=await balance(h);assert.equal(Number(x.positive_available),positive);assert.equal(Number(x.negative_effective),negative);};
 try {
 await t.test('seeds idempotent; mandatory context, self-rating, membership and versions',async()=>{
 const h=await home(),r=await reasons(h);await db.query('select public.initialize_rating_reasons($1)',[h]);assert.equal(await scalar<number>('select count(*)::int v from public.rating_reasons where home_id=$1',[h]),10);
 await assert.rejects(rate(h,r.pos,a),/self_rating/);await assert.rejects(rate(h,r.pos,out),/invalid_member/);await assert.rejects(rate(h,randomUUID()),/invalid_reason/);
 const other=await scalar<string>("select id v from public.rating_reasons where home_id=$1 and seed_key='default-5'",[h]);await assert.rejects(rate(h,other),/invalid_reason/);
 const id=await rate(h,r.pos);await rate(h,r.pos,b,id);await counts(h,1,0);await assert.rejects(rate(h,r.neg,b,id,0),/idempotency_conflict/);
 await as(c);await rate(h,r.neg,b,id,1);await counts(h,0,1);await assert.rejects(rate(h,r.pos,b,id,1),/stale_version/);
 await db.query('select public.delete_rating($1,$2,2)',[h,id]);await counts(h,0,0);assert.equal(await scalar<number>('select count(*)::int v from public.ratings where id=$1 and deleted_at is not null',[id]),1);
 });
 await t.test('anonymous identity is absent from table, RPC for receiver/third party, joins and publication',async()=>{
 const h=await home(),r=await reasons(h),id=await rate(h,r.pos,b,randomUUID(),0,true);
 for(const actor of [b,c]){await as(actor);const row=await scalar<object>('select to_jsonb(r) v from public.ratings r where id=$1',[id]);assert.equal(JSON.stringify(row).includes(a),false);
 const label=(await db.query('select * from public.rating_author_labels($1,$2)',[h,[id]])).rows[0];assert.deepEqual(label,{rating_id:id,author_id:null,author_name:null,is_mine:false});
 await assert.rejects(db.query('select * from community_private.rating_authors'),/permission denied/);await assert.rejects(db.query('select * from community_private.rating_audit'),/permission denied/);
 await assert.rejects(rate(h,r.pos,b,id,1,false),/anonymous_locked/);}
 await as(a);assert.equal((await db.query('select * from public.rating_author_labels($1,$2)',[h,[id]])).rows[0].author_id,a);
 await db.exec('reset role');assert.equal(await scalar<number>("select count(*)::int v from pg_publication_tables where schemaname='community_private'"),0);
 });
 for(const [p,n,expectedP,expectedN] of [[3,0,0,0],[3,1,0,0],[6,3,0,1],[8,4,2,2]])await t.test(`${p} positives and ${n} negatives consume deterministically`,async()=>{
 const h=await home(),r=await reasons(h);for(let k=0;k<n;k++)await rate(h,r.neg);for(let k=0;k<p;k++)await rate(h,r.pos);await counts(h,expectedP,expectedN);
 for(let k=0;k<3;k++)await db.query('select public.reconcile_community($1)',[h]);await counts(h,expectedP,expectedN);
 assert.equal(Number((await balance(h)).positive_consumed),Math.floor(p/3)*3);
 if(n===0){assert.equal(Number((await balance(h)).credits),1);await rate(h,r.neg);await counts(h,0,0);}
 });
 await t.test('editing/deleting consumed positives revokes allocations and restores negative; oldest negative first',async()=>{
 const h=await home(),r=await reasons(h),negative=await rate(h,r.neg);const ids=[];for(let k=0;k<3;k++)ids.push(await rate(h,r.pos));
 assert.equal(await scalar<string>('select negative_id v from public.rating_redemptions where home_id=$1 and revoked_at is null',[h]),negative);
 await db.query('select public.delete_rating($1,$2,1)',[h,ids[0]]);await counts(h,2,1);
 await rate(h,r.neg,b,ids[1],1);await counts(h,1,2);
 assert.ok(await scalar<boolean>('select exists(select 1 from public.rating_redemptions where home_id=$1 and revoked_at is not null) v',[h]));
 });
 await t.test('simultaneous submissions queued in PGlite consume once; no duplicate on retry',async()=>{
 const h=await home(),r=await reasons(h);await rate(h,r.neg);await rate(h,r.pos);await rate(h,r.pos);
 await Promise.all([rate(h,r.pos),rate(h,r.pos)]);await counts(h,1,0);
 assert.equal(await scalar<number>('select count(*)::int v from public.rating_redemptions where home_id=$1 and revoked_at is null',[h]),1);
 });
 await t.test('thresholds 5/10/15/20 persist across decrease/reincrease; completion spends no points',async()=>{
 const h=await home(),r=await reasons(h);const ids=[];for(let k=0;k<20;k++)ids.push(await rate(h,r.neg));
 assert.deepEqual((await db.query('select threshold,severity from public.punishments where home_id=$1 order by threshold',[h])).rows,[{threshold:5,severity:'light'},{threshold:10,severity:'heavy'},{threshold:15,severity:'light'},{threshold:20,severity:'heavy'}]);
 await db.query('select public.delete_rating($1,$2,1)',[h,ids[0]]);await rate(h,r.neg);assert.equal(Number((await balance(h)).pending_punishments),4);
 const p=await scalar<string>('select id v from public.punishments where home_id=$1 and threshold=5',[h]);await db.query("select public.save_punishment($1,$2,1,'Limpiar cocina extra',true)",[h,p]);await counts(h,0,20);assert.equal(Number((await balance(h)).pending_punishments),3);
 });
 await t.test('four public RLS tables, RPC cross-home, private helpers and former members',async()=>{
 const h=await home(),r=await reasons(h);await rate(h,r.pos);await as(out);
 for(const table of ['ratings','rating_reasons','rating_redemptions','punishments']){assert.equal(await scalar<number>(`select count(*)::int v from public.${table} where home_id=$1`,[h]),0);await assert.rejects(db.query(`delete from public.${table} where home_id=$1`,[h]),/permission denied/);}
 await assert.rejects(db.query('select public.community_balances($1)',[h]),/unauthorized/);await assert.rejects(db.query('select public.reconcile_community($1)',[h]),/unauthorized/);
 await assert.rejects(db.query('select community_private.issue_overdue($1,now())',[h]),/permission denied/);
 await as(b);await db.query('select public.leave_home($1)',[h]);await assert.rejects(db.query('select public.community_balances($1)',[h]),/unauthorized/);
 await as(a);await assert.rejects(rate(h,r.neg),/invalid_member/);assert.equal((await db.query('select active from public.community_balances($1) where user_id=$2',[h,b])).rows[0].active,false);
 });
 await t.test('photo storage strips owner/custom metadata, permits home and denies outsider',async()=>{
 const h=await home(),r=await reasons(h),id=await rate(h,r.pos,b,randomUUID(),0,true);
 const path=await scalar<string>('select public.prepare_rating_photo($1,$2) v',[h,id]);assert.equal(path.includes(a),false);
 await db.query("insert into storage.objects(bucket_id,name,owner,owner_id,metadata,user_metadata) values('rating-photos',$1,$2,$2,jsonb_build_object('mimetype','image/webp','name','Alice photo','author',$2),jsonb_build_object('author',$2))",[path,a]);
 await db.query('select public.attach_rating_photo($1,$2,1,$3)',[h,id,path]);await as(b);
 const object=(await db.query('select * from storage.objects where name=$1',[path])).rows[0];assert.equal(object.owner,null);assert.equal(object.owner_id,null);assert.deepEqual(object.user_metadata,{});assert.equal(JSON.stringify(object).includes(a),false);
 await as(out);assert.equal(await scalar<number>('select count(*)::int v from storage.objects where name=$1',[path]),0);
 });
 // Controlled timestamps only in an owner-level test fixture, never exposed by the user RPC.
 const overdueFixture=async()=>{const h=await home();await db.exec('reset role');await db.query("update public.home_members set joined_at='2026-01-01' where home_id=$1",[h]);
 const chore=await scalar<string>("insert into public.chores(home_id,name,difficulty,recurrence,anchor_date,assignment_mode) values($1,'Kitchen',2,'daily','2026-01-01','automatic') returning id v",[h]);
 const id=await scalar<string>("insert into public.chore_instances(home_id,chore_id,period_start,period_end,task_name,difficulty,assignee_id,assignee_name,deadline_at) values($1,$2,'2026-03-28','2026-04-05','Kitchen',2,$3,'Alice','2026-03-28T09:00Z') returning id v",[h,chore,a]);
 await db.query("insert into public.chore_assignment_events(home_id,instance_id,assignee_id,assignee_name,reason,created_at) values($1,$2,$3,'Alice','generated','2026-03-28T08:00Z')",[h,id,a]);return{h,id,chore};};
 await t.test('full 24h boundaries across DST, complete late stops forever, ten runs idempotent',async()=>{
 const {h,id}=await overdueFixture();for(const [at,n]of[['2026-03-28T09:00Z',0],['2026-03-29T08:59Z',0],['2026-03-29T09:00Z',1],['2026-03-30T09:00Z',2],['2026-03-31T11:00Z',3]] as const){await db.query('select community_private.issue_overdue($1,$2)',[h,at]);assert.equal(await scalar<number>('select count(*)::int v from public.ratings where source_id=$1',[id]),n);}
 await db.query("update public.chore_instances set completed_at='2026-03-31T11:00Z',completed_by=$2,completed_by_name='Bob' where id=$1",[id,b]);
 for(let k=0;k<10;k++)await db.query("select community_private.issue_overdue($1,'2027-01-01')",[h]);assert.equal(await scalar<number>('select count(*)::int v from public.ratings where source_id=$1',[id]),3);
 await as(a);await assert.rejects(db.query('select public.delete_rating($1,(select id from public.ratings where source_id=$2 limit 1),1)',[h,id]),/locked_rating/);
 });
 await t.test('responsibility at boundary uses assignment history; blocked days exempt; cancellation ignored',async()=>{
 const {h,id}=await overdueFixture();await db.query("insert into public.chore_assignment_events(home_id,instance_id,assignee_id,assignee_name,reason,created_at) values($1,$2,$3,'Bob','reassigned','2026-03-29T08:00Z')",[h,id,b]);
 await db.query("select community_private.issue_overdue($1,'2026-03-29T09:00Z')",[h]);assert.equal(await scalar<string>('select target_user_id v from public.ratings where source_id=$1',[id]),b);
 await db.query("insert into public.chore_assignment_events(home_id,instance_id,assignee_id,assignee_name,reason,blocked,created_at) values($1,$2,$3,'Bob','blocked',true,'2026-03-30T08:00Z')",[h,id,b]);await db.query("select community_private.issue_overdue($1,'2026-03-30T10:00Z')",[h]);assert.equal(await scalar<number>('select count(*)::int v from public.ratings where source_id=$1',[id]),1);
 await db.query("update public.chore_instances set cancelled_at=now(),cancellation_reason='definition_changed' where id=$1",[id]);await db.query("select community_private.issue_overdue($1,'2026-04-01')",[h]);assert.equal(await scalar<number>('select count(*)::int v from public.ratings where source_id=$1',[id]),1);
 });
 } finally {await db.close();}
});
