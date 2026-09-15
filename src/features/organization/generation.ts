type GenerationResult = {data:{created:number;blocked:number}|null;error:{code:string;message:string}|null};
type GenerationClient = {rpc(name:'ensure_current_chores',args:{target:string}):PromiseLike<GenerationResult>};
// Browsing another module (or a distant date) must never enlarge the generation horizon.
export async function ensureOrganizationPeriod(db:GenerationClient,homeId:string,tab:string):Promise<GenerationResult> {
  if(tab!=='tasks')return {data:null,error:null};
  return db.rpc('ensure_current_chores',{target:homeId});
}
