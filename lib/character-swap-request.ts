export function estimateSwapUsd(seconds:number) {
 if(!Number.isFinite(seconds)||seconds<2||seconds>30)throw new Error('Bitte ein Video mit 2–30 Sekunden auswählen.');
 return Math.ceil(Math.max(56,seconds*28))/100;
}
export function buildRunwaySwapInput(videoUri:string,description:string,imageUri?:string) {
 const target=description.trim();
 if(target.length<5||target.length>1000)throw new Error('Beschreibe die Personenänderung mit 5–1000 Zeichen.');
 return {model:'aleph2',videoUri,outputFormat:'mp4',promptText:`Edit the entire input video, including every shot. Requested character change: ${target}. Preserve every existing cut at its original time, the original camera movement, framing, subject scale, performance, pose timing, background and lighting. Apply the requested character changes consistently across all shots. Do not freeze, repeat or extend the first shot. Do not add cuts, zooms or transitions. Only change the people specified by the user.`,...(imageUri?{keyframes:[{uri:imageUri,seconds:0}]}:{})};
}
export function buildCharacterSwapInput(videoUrl:string, description:string, imageUrl?:string) {
 const target=description.trim();
 if(target.length<5||target.length>1000)throw new Error('Beschreibe die Personenänderung mit 5–1000 Zeichen.');
 return {video_url:videoUrl,...(imageUrl?{image_urls:[imageUrl]}:{}),keep_audio:true,prompt:`Apply only the requested changes to people in the input video. User request: ${target}. ${imageUrl?'Use the character appearance from @Image1.':'Use the user description to determine the new character appearance.'} Preserve the original performance, pose timing, movements, camera movement, framing, subject scale, background, lighting and every existing cut at its original time. Do not add cuts, zooms or transitions. Only change people specified by the user; if the user explicitly requests all people, apply the changes to all people. ${imageUrl?'The reference image supplies identity only; do not copy its background or pose.':''}`};
}
