import { readFileSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
const env=Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]}));
if(!['http://127.0.0.1:54321','http://localhost:54321'].includes(env.VITE_SUPABASE_URL?.replace(/\/$/,'')))throw new Error('Refusing a nonlocal Supabase target');
const email=`trackr-security-smoke-${randomUUID()}@example.test`;
const password=randomBytes(24).toString('base64url');
const client=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const check=(condition,label)=>{if(!condition)throw new Error(label);console.log('PASS:',label)};
let uid;
try {
 const signup=await client.auth.signUp({email,password});
 check(!signup.error&&signup.data.user,'local signup and profile trigger');uid=signup.data.user.id;
 check(signup.data.session,'local signup returns a usable session');
 const membership=await client.from('profile_members').select('role').eq('profile_id',uid).eq('user_id',uid).single();
 check(!membership.error&&membership.data.role==='owner','signup creates owner membership without a repair RPC');
 const profiles=await client.rpc('get_my_profiles');
 check(!profiles.error&&profiles.data.some(p=>p.id===uid&&p.role==='owner'),'real JWT can call profile RPC');
 const account=await client.from('accounts').insert({user_id:uid,profile_id:uid,name:'Synthetic security smoke',initial_balance:10}).select('id').single();
 check(!account.error,'owner can create account with real PostgREST RLS');
 const tx=await client.rpc('save_financial_transaction',{p_profile_id:uid,p_transaction_id:null,p_payload:{account_id:account.data.id,type:'expense',category:'Smoke',amount:1,date:'2026-10-04'}});
 check(!tx.error&&tx.data.profile_id===uid,'atomic RPC works with real Auth JWT and private helper grants');
 const backup=await client.rpc('export_financial_profile',{p_profile_id:uid});
 check(!backup.error&&backup.data.version===2&&backup.data.data.transactions.length===1,'financial export works through PostgREST');
 const signedOut=await client.auth.signOut({scope:'local'});check(!signedOut.error,'local signout');
} finally {
 if(uid&&/^[0-9a-f-]{36}$/i.test(uid)) {
  // The identifier is from this newly generated local test account; no real users are touched.
  const sql=`BEGIN; DELETE FROM public.transactions WHERE user_id='${uid}'; DELETE FROM public.profile_share_invitations WHERE invited_by='${uid}'; DELETE FROM auth.users WHERE id='${uid}' AND email='${email}'; COMMIT;`;
  execFileSync('docker',['exec','supabase_db_trackr','psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-c',sql],{stdio:'ignore'});
  console.log('Synthetic local user removed.');
 }
}
