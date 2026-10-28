"""Compose verified UI captures with narration, camera moves, cursor and captions."""
import hashlib,json,math,os,pathlib,struct,subprocess,textwrap,urllib.request,wave,zlib
from timing import plan_frames
root=pathlib.Path(os.environ['TUTORIAL_OUT']).resolve();os.chdir(root)
plan=json.loads((root/'storyboard.json').read_text())
provenance=json.loads((root/'capture.json').read_text())
for frame in provenance['frames']:
 assert hashlib.sha256((root/(frame['id']+'.png')).read_bytes()).hexdigest()==frame['sha256']
fonts=root/'fonts';fonts.mkdir(exist_ok=True)
for family,name in [('archivo','Archivo[wdth,wght].ttf'),('inter','Inter[opsz,wght].ttf'),('jetbrainsmono','JetBrainsMono[wght].ttf')]:
 for remote,local in [(name,family+'.ttf'),('OFL.txt',family+'-OFL.txt')]:
  file=fonts/local
  if not file.exists():file.write_bytes(urllib.request.urlopen('https://raw.githubusercontent.com/google/fonts/main/ofl/'+family+'/'+urllib.parse.quote(remote),timeout=30).read())
def run(args):
 subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y',*args],check=True)
def ass_time(seconds):
 ticks=round(seconds*100);return f'{ticks//360000}:{ticks//6000%60:02}:{ticks//100%60:02}.{ticks%100:02}'
def captions(shot,duration):
 words=shot['narration'].replace('where-der','wherdr').split();parts=textwrap.wrap(' '.join(words),width=43)
 header='[Script Info]\nPlayResX: 1080\nPlayResY: 1920\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Default,Inter,42,&H00FFFFFF,&H00FFFFFF,&H0012151B,&H0012151B,0,0,0,0,100,100,0,0,1,2,0,2,90,90,68,1\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n'
 elapsed=0;events=[]
 for part in parts:
  start=.55+duration*elapsed/len(words);elapsed+=len(part.split());end=.55+duration*elapsed/len(words)
  events.append(f'Dialogue: 0,{ass_time(start)},{ass_time(end)},Default,,0,0,0,,{part}')
 (root/(shot['id']+'.ass')).write_text(header+'\n'.join(events)+'\n')
 return [{'start':round(.55+duration*sum(len(p.split()) for p in parts[:i])/len(words),3),'text':p} for i,p in enumerate(parts)]
# A small original vector-style cursor, rasterized without external image assets.
def cursor():
 polygon=[(3,2),(3,48),(15,37),(24,58),(34,53),(24,34),(43,33)]
 def inside(x,y):
  hit=False;j=len(polygon)-1
  for i,(xi,yi) in enumerate(polygon):
   xj,yj=polygon[j]
   if (yi>y)!=(yj>y) and x<(xj-xi)*(y-yi)/(yj-yi)+xi:hit=not hit
   j=i
  return hit
 raw=b''.join(b'\0'+b''.join(bytes((255,255,255,255)) if inside(x,y) else bytes((0,0,0,0)) for x in range(48)) for y in range(64))
 def chunk(t,d):return struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
 (root/'cursor.png').write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>2I5B',48,64,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b''))
cursor();shots=plan['segments'];durations=[]
for shot in shots:
 with wave.open(str(root/(shot['id']+'.wav')),'rb') as w:durations.append(w.getnframes()/w.getframerate())
frames=plan_frames(durations)
manifest=[];start=0
for shot,spoken,count in zip(shots,durations,frames):
 id=shot['id'];duration=count/30
 events=captions(shot,spoken)
 (root/(id+'-title.txt')).write_text(shot['title'])
 focus=next(f['focus'] for f in provenance['frames'] if f['id']==id)
 x,y,w,h=[round(focus[k]*2) for k in ['x','y','width','height']]
 zoom=f'1+0.045*(1-cos(PI*on/{max(1,count-1)}))/2'
 highlight='' if id in ['intro','outro','board'] else f'drawbox=x={x}:y={y}:w={w}:h={h}:color=0x34b3eb@0.8:t=3,'
 secondary=next(f for f in provenance['frames'] if f['id']==id).get('secondary')
 if secondary:
  sx,sy,sw,sh=[round(secondary[k]*2) for k in ['x','y','width','height']]
  highlight+=f'drawbox=x={sx}:y={sy}:w={sw}:h={sh}:color=0x34b3eb@0.8:t=3,'
 image=f"[0:v]{highlight}zoompan=z='{zoom}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d={count}:s=880x1440:fps=30[screen]"
 targetx=min(920,100+x+w*.55);targety=min(1590,236+y+h*.55)
 ease='(0.5-0.5*cos(PI*min(max((t-0.35)/1.1,0),1)))'
 cursorx=f'970+({targetx}-970)*{ease}';cursory=f'1590+({targety}-1590)*{ease}'
 overlay=f"[1:v][screen]overlay=100:236[base];[base][2:v]overlay=x='{cursorx}':y='{cursory}':enable='between(t,0.35,2.4)'"
 decoration=",drawbox=x=100:y=235:w=880:h=1442:color=0x52606d:t=1,drawtext=fontfile=fonts/jetbrainsmono.ttf:text='WHERDR / BOARD / 01':fontsize=27:fontcolor=0x9aa8b5:x=100:y=65"
 decoration+=f",drawtext=fontfile=fonts/archivo.ttf:textfile={id}-title.txt:fontsize=52:fontcolor=white:x=100:y=123"
 if id=='outro':
  decoration+=",drawbox=x=100:y=236:w=880:h=1440:color=0x12151b@0.88:t=fill,drawtext=fontfile=fonts/archivo.ttf:text='Know what':fontsize=88:fontcolor=white:x=150:y=790,drawtext=fontfile=fonts/archivo.ttf:text='needs you.':fontsize=88:fontcolor=0x34b3eb:x=150:y=900"
 decoration+=f",ass={id}.ass:fontsdir=fonts,fade=t=in:d=0.18,fade=t=out:st={duration-.18}:d=0.18,format=yuv420p[v]"
 args=['-i',id+'.png','-f','lavfi','-i',f'color=c=0x12151b:s=1080x1920:r=30:d={duration}','-loop','1','-i','cursor.png','-filter_complex_threads','1','-filter_complex',image+';'+overlay+decoration,'-map','[v]','-t',str(duration),'-c:v','libx264','-threads','2','-preset','fast','-crf','21','-an','-movflags','+faststart',id+'.mp4']
 run(args)
 run(['-i',id+'.wav','-af',f'loudnorm=I=-16:LRA=7:TP=-1.5,aresample=48000,adelay=550,apad,atrim=duration={duration}','-c:a','pcm_s16le',id+'-audio.wav'])
 manifest.append({'id':id,'start':round(start,3),'duration':duration,'narration_start':round(start+.55,3),'narration_duration':spoken,'captions':events})
 start+=duration;print(id,'rendered',flush=True)
(root/'concat.txt').write_text(''.join("file '"+s['id']+".mp4'\n" for s in shots))
(root/'audio-concat.txt').write_text(''.join("file '"+s['id']+"-audio.wav'\n" for s in shots))
run(['-f','concat','-safe','0','-i','concat.txt','-f','concat','-safe','0','-i','audio-concat.txt','-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-b:a','128k','-t','60','-movflags','+faststart','wherdr-board-tutorial.mp4'])
(root/'timeline.json').write_text(json.dumps({'duration':60,'fps':30,'width':1080,'height':1920,'shots':manifest},indent=2))
print('Rendered private 60-second tutorial.',flush=True)
