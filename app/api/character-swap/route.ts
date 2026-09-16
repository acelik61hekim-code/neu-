import { NextRequest,NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { get } from '@vercel/blob';
import { startSwap,checkSwap,getSwap,listSwaps,swapPath,fileFromPrivateBlob } from '@/lib/character-swap';
import { runwayConfigured } from '@/lib/runway-character-swap';
import { getCurrentUser } from '@/lib/supabase/server';
import { getActiveVideoSubscription } from '@/lib/video-subscription';
import { reserveVideoSubscriptionUsage,releaseVideoSubscriptionUsage } from '@/lib/video-subscription-usage';
import { hasOwnerAccess } from '@/lib/owner-access';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=300;
async function access(request:NextRequest){const user=await getCurrentUser();const owner=hasOwnerAccess(user);const subscription=user&&!owner?await getActiveVideoSubscription(request).catch(()=>null):null;return {user,owner,subscription};}
async function owned(id:string,userId:string){const job=await getSwap(id);if(job.userId&&job.userId!==userId)throw new Error('Auftrag nicht gefunden.');return job;}
function publicJob(job:Awaited<ReturnType<typeof getSwap>>){const {estimatedUsd,userId,originalUri,resultUri,requestId,cuts,...safe}=job;void estimatedUsd;void userId;void originalUri;void resultUri;void requestId;void cuts;return safe;}
export async function GET(request:NextRequest){
 try{const {user,owner,subscription}=await access(request);if(!user)return NextResponse.json({configured:runwayConfigured(),authenticated:false,jobs:[]});const id=request.nextUrl.searchParams.get('id'),asset=request.nextUrl.searchParams.get('asset');
  if(id&&asset){const job=await owned(id,user.id);const uri=asset==='original'?job.originalUri:asset==='result'&&job.status==='done'?job.resultUri:undefined;if(uri?.startsWith('blob:')){const result=await get(uri.slice(5),{access:'private',headers:request.headers.get('range')?{Range:request.headers.get('range')!}:undefined});if(!result?.stream)return new NextResponse(null,{status:404});return new NextResponse(result.stream,{status:result.headers.get('content-range')?206:200,headers:{'Content-Type':'video/mp4','Cache-Control':'private, no-store','Accept-Ranges':'bytes',...(result.headers.get('content-range')?{'Content-Range':result.headers.get('content-range')!}:{}),...(result.headers.get('content-length')?{'Content-Length':result.headers.get('content-length')!}:{}),...(request.nextUrl.searchParams.has('download')?{'Content-Disposition':'attachment; filename="charakter-video.mp4"'}:{})}});}const bytes=await readFile(swapPath(id,asset==='result'?'result.mp4':'original.mp4'));return new NextResponse(bytes,{headers:{'Content-Type':'video/mp4','Cache-Control':'no-store'}});}
  if(id)return NextResponse.json(publicJob(await checkSwap((await owned(id,user.id)).id)));
  return NextResponse.json({configured:runwayConfigured(),authenticated:true,owner,subscription:Boolean(subscription),provider:'Runway Aleph 2.0',videoSecondsRemaining:owner?null:subscription?Math.max(0,subscription.plan.videoSecondsPerMonth-subscription.usage.videoSeconds):0,studioEditsRemaining:owner?null:subscription?Math.max(0,subscription.plan.studioEditsPerMonth-subscription.usage.studioEdits):0,jobs:(await listSwaps(user.id)).map(publicJob)});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Status konnte nicht gelesen werden.'},{status:503});}
}
let starting=false;
export async function POST(request:NextRequest){
 if(starting)return NextResponse.json({error:'Ein Upload wird gerade verarbeitet.'},{status:409});starting=true;
 try{const {user,owner,subscription}=await access(request);if(!user)return NextResponse.json({error:'Bitte melde dich an.'},{status:401});if(!owner&&!subscription)return NextResponse.json({error:'Für den Charaktertausch benötigst du ein Video-Abo.'},{status:403});
  const type=request.headers.get('content-type')||'';let video:File,reference:File|null,target:string,consent:boolean;
  if(type.includes('application/json')){const body=await request.json() as {videoUri?:unknown;videoType?:unknown;imageUri?:unknown;imageType?:unknown;target?:unknown;consent?:unknown};target=String(body.target||'').trim();consent=body.consent===true;video=await fileFromPrivateBlob(String(body.videoUri||''),'original.mp4',String(body.videoType||'video/mp4'),40*1024*1024);reference=body.imageUri?await fileFromPrivateBlob(String(body.imageUri),'reference.jpg',String(body.imageType||'image/jpeg'),5*1024*1024):null;}
  else{const form=await request.formData();const raw=form.get('video'),image=form.get('image');if(!(raw instanceof File))throw new Error('Video fehlt.');video=raw;reference=image instanceof File&&image.size?image:null;target=String(form.get('target')||'').trim();consent=form.get('consent')==='yes';}
  if(!consent)return NextResponse.json({error:'Bitte bestätige die Rechte und Anbieter-Übertragung.'},{status:400});
  const beforeProvider=owner?undefined:async({quotaSeconds}:{duration:number;quotaSeconds:number})=>{const sub=subscription!;const videoUse=await reserveVideoSubscriptionUsage({subscriptionId:sub.subscriptionId,periodStart:sub.periodStart,periodEnd:sub.periodEnd,kind:'video-seconds',amount:quotaSeconds,limit:sub.plan.videoSecondsPerMonth});if(!videoUse.allowed)throw new Error(`Dein Videokontingent reicht nicht aus. Benötigt werden ${quotaSeconds} Video-Sekunden.`);const editUse=await reserveVideoSubscriptionUsage({subscriptionId:sub.subscriptionId,periodStart:sub.periodStart,periodEnd:sub.periodEnd,kind:'studio-edits',amount:1,limit:sub.plan.studioEditsPerMonth});if(!editUse.allowed){await releaseVideoSubscriptionUsage({subscriptionId:sub.subscriptionId,periodStart:sub.periodStart,kind:'video-seconds',amount:quotaSeconds});throw new Error('Deine Studio-Exporte sind aufgebraucht.');}};
  return NextResponse.json(publicJob(await startSwap(video,reference,target,user.id,beforeProvider)));
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Start fehlgeschlagen.'},{status:400});}finally{starting=false;}
}
