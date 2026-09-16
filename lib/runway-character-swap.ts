const base = 'https://api.dev.runwayml.com';
export function runwayConfigured() { return Boolean(process.env.RUNWAYML_API_SECRET?.trim()); }

export async function runwayRequest<T>(path: string, body?: unknown): Promise<T> {
  if (!runwayConfigured()) throw new Error('Runway ist noch nicht verbunden. Bitte RUNWAYML_API_SECRET in der lokalen Konfiguration hinterlegen.');
  // Never retry a paid submission automatically after an uncertain response.
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${process.env.RUNWAYML_API_SECRET}`, 'X-Runway-Version': '2024-11-06', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60000), cache: 'no-store', redirect: 'error',
  });
  if (!response.ok) throw new Error(response.status === 401 ? 'Der Runway-Zugang ist ungültig.' : response.status === 402 ? 'Das Runway-Guthaben reicht nicht aus.' : `Runway-Anfrage fehlgeschlagen (${response.status}).`);
  return response.json() as Promise<T>;
}

export async function uploadRunway(file: File): Promise<string> {
  const upload = await runwayRequest<{uploadUrl:string; fields:Record<string,string>; runwayUri:string}>('/v1/uploads', {filename:file.name,type:'ephemeral'});
  const url = new URL(upload.uploadUrl);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.amazonaws.com')) throw new Error('Unbekannte Runway-Uploadadresse.');
  const form = new FormData();
  for (const [key,value] of Object.entries(upload.fields)) form.append(key,value);
  form.append('file',file);
  const response = await fetch(url,{method:'POST',body:form,signal:AbortSignal.timeout(120000),redirect:'error'});
  if (!response.ok || !upload.runwayUri.startsWith('runway://')) throw new Error('Der Runway-Upload ist fehlgeschlagen.');
  return upload.runwayUri;
}

export type RunwayTask = {status:string; output?:string[]; failureCode?:string};
