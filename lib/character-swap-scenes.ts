import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
const exec=promisify(execFile);
/** Heuristic for hard cuts; dissolves and subtle edits may not be detected. */
export function parseSceneChanges(log:string):number[]{
 const times=[...log.matchAll(/\bn:\s*\d+[^\r\n]*?\bpts_time:\s*([\d.]+)/g)].map(match=>Number(match[1])).filter(time=>Number.isFinite(time)&&time>0.15);
 return times.filter((time,index)=>index===0||time-times[index-1]>0.15);
}
export async function detectSceneChanges(path:string):Promise<number[]>{
 if(!ffmpeg)throw new Error('Die Schnittprüfung ist nicht verfügbar. Es wurde kein KI-Auftrag gestartet.');
 const {stderr}=await exec(ffmpeg,['-hide_banner','-i',path,'-vf',"select='gt(scene,0.3)',showinfo",'-an','-f','null','-'],{timeout:45000,maxBuffer:4*1024*1024});
 return parseSceneChanges(stderr);
}
export function assertSingleScene(cuts:number[]){
 if(cuts.length)throw new Error(`Es wurden ${cuts.length} mögliche Schnitte erkannt (bei ${cuts.map(t=>t.toFixed(2)).join(', ')} Sekunden). Die aktuelle Bearbeitung unterstützt nur eine durchgehende Szene. Bitte lade einen einzelnen 3–10 Sekunden langen Abschnitt hoch. Es wurde kein kostenpflichtiger KI-Auftrag gestartet.`);
}
