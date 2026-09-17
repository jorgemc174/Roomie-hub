import {createClient} from '@supabase/supabase-js';
process.loadEnvFile('.env.local');
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false}});
const listed=await db.auth.admin.listUsers({perPage:1000});if(listed.error)throw listed.error;
const users=listed.data.users.filter(u=>/^roomiehub-chat-[0-9a-f-]+@example\.com$/.test(u.email??''));const ids=new Set(users.map(u=>u.id));
const homes=await db.from('homes').select('id,name').in('name',['QA Phase6 chat','QA Phase6 separate home']);if(homes.error)throw homes.error;
for(const h of homes.data){
 const members=await db.from('home_members').select('user_id').eq('home_id',h.id);if(members.error)throw members.error;if(!members.data.length||members.data.some(m=>!ids.has(m.user_id)))throw new Error('Fixture ownership verification failed');
 const files=await db.from('chat_attachments').select('path').eq('home_id',h.id);if(files.error)throw files.error;if(files.data.length){const r=await db.storage.from('chat-files').remove(files.data.map(f=>f.path));if(r.error)throw r.error;}
 // Explicit child removal permits cleanup even on the pre-013 development schema.
 for(const table of ['chat_reactions','chat_messages','homes']){const r=await db.from(table).delete().eq(table==='homes'?'id':'home_id',h.id);if(r.error)throw r.error;}
}
for(const u of users){const r=await db.auth.admin.deleteUser(u.id);if(r.error)throw r.error;}
console.log('Removed verified temporary chat fixtures:',homes.data.length,'homes,',users.length,'users.');
