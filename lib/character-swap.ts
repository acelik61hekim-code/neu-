import { detectSceneChanges } from "./character-swap-scenes";
import { buildRunwaySwapInput, estimateSwapUsd } from "./character-swap-request";
import { runwayConfigured, runwayRequest, uploadRunway, type RunwayTask } from './runway-character-swap';
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import ffmpeg from "ffmpeg-static";
import { createFalClient } from "@fal-ai/client";
import { parseVideoMediaMetadata } from "./video-delivery";
import { get, put } from '@vercel/blob';
import { Redis } from '@upstash/redis';
import { tmpdir } from 'node:os';

export const SWAP_MODEL = "fal-ai/kling-video/o1/video-to-video/edit";
const root = process.env.VERCEL ? join(tmpdir(),'character-swap') : join(process.cwd(), "output", "character-swap");
const exec = promisify(execFile);
export type SwapJob = { id: string; userId?:string; originalUri?:string; resultUri?:string; provider?: 'runway'; estimatedUsd?:number; quotaSeconds?:number; cuts?:number[]; status: "starting" | "processing" | "done" | "error"; requestId?: string; target: string; duration: number; width: number; height: number; hasAudio: boolean; createdAt: number; error?: string; qualityWarning?: string };
const redis=process.env.UPSTASH_REDIS_REST_URL&&process.env.UPSTASH_REDIS_REST_TOKEN?new Redis({url:process.env.UPSTASH_REDIS_REST_URL,token:process.env.UPSTASH_REDIS_REST_TOKEN}):null;
const jobKey=(id:string)=>`character-swap:${id}`;const listKey=(userId:string)=>`character-swap-user:${userId}`;
export function localSwapEnabled() { return process.env.NODE_ENV === "development" && !process.env.VERCEL; }
export function swapPath(id: string, name: "job.json" | "original.mp4" | "character.jpg" | "generated.mp4" | "result.mp4") { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Ungültige Projekt-ID."); return join(root, id, name); }
export async function getSwap(id: string): Promise<SwapJob> { if(redis){const job=await redis.get<SwapJob>(jobKey(id));if(!job)throw new Error('Auftrag nicht gefunden.');return job;}return JSON.parse(await readFile(swapPath(id, "job.json"), "utf8")); }
async function save(job: SwapJob) { if(redis){await redis.set(jobKey(job.id),job,{ex:365*86400});if(job.userId){await redis.lrem(listKey(job.userId),0,job.id);await redis.lpush(listKey(job.userId),job.id);await redis.ltrim(listKey(job.userId),0,49);}return;}await mkdir(join(root,job.id),{recursive:true});await writeFile(swapPath(job.id, "job.json"), JSON.stringify(job)); }
export async function listSwaps(userId?:string) { if(redis&&userId){const ids=await redis.lrange<string>(listKey(userId),0,19);return (await Promise.all(ids.map(id=>getSwap(id).catch(()=>null)))).filter((job):job is SwapJob=>job!==null);}const ids = await readdir(root).catch(() => [] as string[]); return (await Promise.all(ids.map(id => getSwap(id).catch(() => null)))).filter((job): job is SwapJob => job!==null&&(!userId||job.userId===userId)).sort((a,b) => b.createdAt-a.createdAt).slice(0,20); }
async function inspect(path: string) { let log = ""; try { const r = await exec(ffmpeg!, ["-hide_banner", "-i", path], { timeout: 30000 }); log = r.stderr; } catch(error) { log = (error as {stderr?:string}).stderr || ""; } return parseVideoMediaMetadata(log); }
const client = () => createFalClient({ credentials: process.env.FAL_KEY });
export async function startSwap(video: File, reference: File | null, target: string,userId?:string,beforeProvider?:(details:{duration:number;quotaSeconds:number})=>Promise<void>) {
  if (!runwayConfigured()) throw new Error("Runway ist noch nicht verbunden. Bitte RUNWAYML_API_SECRET in der lokalen Konfiguration hinterlegen.");
  if (!ffmpeg) throw new Error("Die Videoverarbeitung ist nicht verfügbar.");
  if (!['video/mp4','video/quicktime'].includes(video.type) || video.size > 40*1024*1024 || !video.size) throw new Error("Bitte ein MP4- oder MOV-Video bis 40 MB wählen.");
  if (reference && (!['image/jpeg','image/png','image/webp'].includes(reference.type) || reference.size > 5*1024*1024 || !reference.size)) throw new Error("Bitte ein JPG-, PNG- oder WebP-Bild bis 5 MB wählen.");
  if(target.length < 5 || target.length > 1000) throw new Error("Beschreibe die zu ersetzende Person und die gewünschte Änderung mit 5–1000 Zeichen.");
  const id = randomUUID(); await mkdir(join(root,id), {recursive:true});
  await writeFile(swapPath(id,'original.mp4'), Buffer.from(await video.arrayBuffer()));
  const media = await inspect(swapPath(id,'original.mp4'));
  const estimatedUsd=estimateSwapUsd(media.durationSeconds);
  if(Math.min(media.width,media.height)<64 || Math.min(media.width,media.height)>1080 || Math.max(media.width,media.height)>1920) throw new Error('Bitte ein Video bis Full HD (1920 × 1080 oder Hochformat) auswählen.');
  const cuts=await detectSceneChanges(swapPath(id,'original.mp4'));
  // Normalize codec and frame rate without changing the framing or cutting shots.
  const prepared=join(root,id,'input.mp4');
  await exec(ffmpeg,['-y','-i',swapPath(id,'original.mp4'),'-map','0:v:0','-an','-vf','fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1','-c:v','libx264','-crf','18','-movflags','+faststart',prepared],{timeout:120000,maxBuffer:4*1024*1024});
  // Decode the reference before uploading; discard metadata and enforce an actual image.
  if(reference) { await writeFile(join(root,id,'reference-input'),Buffer.from(await reference.arrayBuffer()));
  await exec(ffmpeg,["-y","-i",join(root,id,'reference-input'),"-frames:v","1","-vf","scale=1024:1024:force_original_aspect_ratio=decrease","-q:v","2",swapPath(id,'character.jpg')],{timeout:30000,maxBuffer:1024*1024});
  }
  const quotaSeconds=Math.ceil(media.durationSeconds*3);
  let originalUri:string|undefined;if(process.env.BLOB_READ_WRITE_TOKEN||process.env.BLOB_STORE_ID){const stored=await put(`character-swap/${userId||'local'}/${id}/original.mp4`,await readFile(swapPath(id,'original.mp4')),{access:'private',contentType:'video/mp4',addRandomSuffix:false,allowOverwrite:true});originalUri=`blob:${stored.pathname}`;}
  const job: SwapJob={id,userId,originalUri,provider:'runway',estimatedUsd,quotaSeconds,cuts,status:'starting',target,duration:media.durationSeconds,width:media.width,height:media.height,hasAudio:media.hasAudio,createdAt:Date.now()}; await save(job);
  try {
    const videoUrl=await uploadRunway(new File([new Uint8Array(await readFile(prepared))],'input.mp4',{type:'video/mp4'}));
    const imageUrl=reference?await uploadRunway(new File([new Uint8Array(await readFile(swapPath(id,'character.jpg')))],'character.jpg',{type:'image/jpeg'})):undefined;
    await beforeProvider?.({duration:media.durationSeconds,quotaSeconds});
    const task=await runwayRequest<{id:string;estimatedCost?:{credits:number}}>('/v1/video_to_video',buildRunwaySwapInput(videoUrl,target,imageUrl));
    if(!task.id)throw new Error('Runway hat keine Auftragsnummer zurückgegeben.');
    job.requestId=task.id;job.status='processing';if(task.estimatedCost)job.estimatedUsd=task.estimatedCost.credits/100;await save(job); return job;
  } catch(error) {job.status='error';job.error='Die Bearbeitung konnte nicht sicher gestartet werden. Ein unsicherer Start wird nicht automatisch wiederholt.';await save(job);throw error;}
}
const active = new Map<string,Promise<SwapJob>>();
export function checkSwap(id:string):Promise<SwapJob> { const existing=active.get(id);if(existing)return existing; const task=finishSwap(id).finally(()=>active.delete(id));active.set(id,task);return task; }
async function finishSwap(id:string) {
  const job=await getSwap(id); if(job.status!=='processing'||!job.requestId)return job;
  await mkdir(join(root,id),{recursive:true});
  if(job.originalUri?.startsWith('blob:')){const original=await get(job.originalUri.slice(5),{access:'private'});if(!original?.stream)throw new Error('Originalvideo fehlt.');await writeFile(swapPath(id,'original.mp4'),Buffer.from(await new Response(original.stream).arrayBuffer()));}
  let uri:string|undefined;
  if(job.provider==='runway') {
    const task=await runwayRequest<RunwayTask>(`/v1/tasks/${encodeURIComponent(job.requestId)}`);
    if(task.status==='FAILED'||task.status==='CANCELED') {job.status='error';job.error='Runway konnte die Bearbeitung nicht abschließen. Bitte Auftrag und Guthaben im Runway-Konto prüfen.';await save(job);return job;}
    if(task.status!=='SUCCEEDED')return job;
    uri=task.output?.[0];
  } else {
    const fal=client(); const status=await fal.queue.status(SWAP_MODEL,{requestId:job.requestId,logs:false}); if(status.status!=='COMPLETED')return job;
    const response=await fal.queue.result(SWAP_MODEL,{requestId:job.requestId});uri=(response.data as {video?:{url?:string}}).video?.url;
  }
  try {
    if(!uri)throw new Error('Der Anbieter hat kein Video zurückgegeben.');
    const url=new URL(uri);const trusted=job.provider==='runway'?url.hostname.endsWith('.cloudfront.net')||url.hostname.endsWith('.runwayml.com'):url.hostname==='fal.media'||url.hostname.endsWith('.fal.media');if(url.protocol!=='https:'||!trusted)throw new Error('Unbekannte Ergebnisadresse.');
    const result=await fetch(uri,{signal:AbortSignal.timeout(120000),redirect:'error'});if(!result.ok||!result.body)throw new Error('Das Ergebnis konnte nicht geladen werden.');
    const reader=result.body.getReader();const chunks:Uint8Array[]=[];let size=0;while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>100*1024*1024){await reader.cancel();throw new Error('Ergebnisdatei zu groß.');}chunks.push(part.value);}
    await writeFile(swapPath(id,'generated.mp4'),Buffer.concat(chunks));const generated=await inspect(swapPath(id,'generated.mp4'));
    if(Math.abs(generated.durationSeconds-job.duration)>0.25)throw new Error('Die KI hat die Videolänge verändert. Dieses Ergebnis wird nicht als passende Version ausgegeben.');
    if(job.cuts){const actual=await detectSceneChanges(swapPath(id,'generated.mp4'));if(actual.length!==job.cuts.length||job.cuts.some((cut,index)=>Math.abs(cut-actual[index])>0.2))job.qualityWarning='Die automatische Schnittprüfung erkennt Abweichungen vom Original. Bitte beide Videos vergleichen. Es wird keine kostenpflichtige Wiederholung automatisch gestartet.';}
    await exec(ffmpeg!,['-y','-i',swapPath(id,'generated.mp4'),'-i',swapPath(id,'original.mp4'),'-map','0:v:0',...(job.hasAudio?['-map','1:a:0','-c:a','aac','-b:a','192k']:['-an']),'-vf',`scale=${job.width}:${job.height}:force_original_aspect_ratio=decrease,pad=${job.width}:${job.height}:(ow-iw)/2:(oh-ih)/2,setsar=1`,'-t',String(job.duration),'-c:v','libx264','-crf','18','-movflags','+faststart',swapPath(id,'result.mp4')],{timeout:120000,maxBuffer:4*1024*1024});
    if(process.env.BLOB_READ_WRITE_TOKEN||process.env.BLOB_STORE_ID){const stored=await put(`character-swap/${job.userId||'local'}/${id}/result.mp4`,await readFile(swapPath(id,'result.mp4')),{access:'private',contentType:'video/mp4',addRandomSuffix:false,allowOverwrite:true});job.resultUri=`blob:${stored.pathname}`;}
    job.status='done'; await save(job);return job;
  }catch(error){job.status='error';job.error=error instanceof Error?error.message:'Bearbeitung fehlgeschlagen.';await save(job);return job;}
}

export async function fileFromPrivateBlob(uri:string,name:string,type:string,maxBytes:number):Promise<File>{
 if(!uri.startsWith('blob:'))throw new Error('Ungültige Uploadadresse.');const result=await get(uri.slice(5),{access:'private'});if(!result?.stream)throw new Error('Upload wurde nicht gefunden.');const buffer=Buffer.from(await new Response(result.stream).arrayBuffer());if(!buffer.length||buffer.length>maxBytes)throw new Error('Uploadgröße ist ungültig.');return new File([buffer],name,{type});
}

