import json,os,pathlib,re,urllib.request,urllib.error,wave
root=pathlib.Path(os.environ['TUTORIAL_OUT'])
plan=json.loads((root/'storyboard.json').read_text())
for shot in plan['segments']:
 file=root/(shot['id']+'.wav')
 if file.exists():continue
 req=urllib.request.Request('https://openrouter.ai/api/v1/audio/speech',data=json.dumps({'model':plan['model'],'voice':plan['voice'],'input':shot['narration'],'response_format':'pcm'}).encode(),headers={'Authorization':'Bearer '+os.environ['OPENROUTER_API_KEY'],'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req,timeout=120) as r:
   ct=r.headers.get('Content-Type','');pcm=r.read()
 except urllib.error.HTTPError as e:
  print('HTTP',e.code,'stopped without retry');raise SystemExit(1)
 assert 'audio/pcm' in ct and len(pcm)%2==0
 match=re.search(r'rate=(\d+)',ct);rate=int(match.group(1)) if match else 24000
 with wave.open(str(file),'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(rate);w.writeframes(pcm)
 print(shot['id'],round(len(pcm)/rate/2,2),'seconds',flush=True)
