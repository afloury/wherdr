"""Compose verified UI captures with narration, camera moves, cursor and captions."""
import array,hashlib,json,math,os,pathlib,struct,subprocess,textwrap,urllib.request,wave,zlib
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
alignment=json.loads((root/'alignment.json').read_text())
def captions(shot,duration):
 header='[Script Info]\nPlayResX: 1920\nPlayResY: 1080\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Default,Inter,34,&H00FFFFFF,&H00FFFFFF,&H001B1512,&H001B1512,0,0,0,0,100,100,0,0,3,16,0,2,180,180,32,1\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n'
 events=alignment[shot['id']]
 lines=[]
 for event in events:
  assert 0 <= event['start'] < event['end'] <= duration+.1
  lines.append(f"Dialogue: 0,{ass_time(.55+event['start'])},{ass_time(.55+event['end'])},Default,,0,0,0,,{event['text']}")
 (root/(shot['id']+'.ass')).write_text(header+'\n'.join(lines)+'\n')
 return events
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
frames=plan_frames(durations, fps=60)
manifest=[];start=0
for shot,spoken,count in zip(shots,durations,frames):
 id=shot['id'];duration=count/60
 events=captions(shot,spoken)
 (root/(id+'-title.txt')).write_text(shot['title'])
 focus=next(f['focus'] for f in provenance['frames'] if f['id']==id)
 # The camera is deliberately locked: the entire desktop stays sharp and stable.
 x,y,w,h=[focus[k] for k in ['x','y','width','height']]
 highlight='' if id in ['intro','outro','board'] else f'drawbox=x={x}:y={y}:w={w}:h={h}:color=0x34b3eb@0.65:t=2,'
 image=f"[0:v]{highlight}scale=1728:972:flags=lanczos[screen]"
 pointer=next(f['focus'] for f in provenance['frames'] if f['id']=='needs')
 px,py,pw,ph=[pointer[k] for k in ['x','y','width','height']]
 targetx=96+(px+min(pw*.55,250))*.9;targety=54+(py+ph*.5)*.9
 # A single curved, minimum-jerk approach. No oscillator, reset or looping input.
 u='min(max((t-0.6)/1.25,0),1)'
 ease=f'(({u})*({u})*({u})*(10-15*({u})+6*({u})*({u})))'
 cursorx=f'1550+({targetx}-1550)*{ease}'
 cursory=f'850+({targety}-850)*{ease}-100*sin(PI*{ease})'
 if id=='details':
  image+=';[3:v]scale=1728:972:flags=lanczos[before];[screen][before]overlay=enable=lt(t\\,2.05)[change];[2:v]scale=26:35,format=rgba,fade=t=in:st=0.6:d=0.15:alpha=1,fade=t=out:st=3:d=0.25:alpha=1[cursor]'
 overlay="[1:v][change]overlay=96:54[base];[base][cursor]overlay=x='"+cursorx+"':y='"+cursory+"':enable='between(t,0.6,3.8)'" if id=='details' else '[1:v][screen]overlay=96:54'
 decoration=(f',drawbox=x={targetx-8}:y={targety-8}:w=16:h=16:color=0x34b3eb:t=2:enable=between(t\\,1.95\\,2.12)' if id=='details' else '')
 decoration+=",drawbox=x=96:y=53:w=1728:h=974:color=0x52606d:t=1,drawbox=x=0:y=0:w=1920:h=54:color=0x12151b:t=fill"
 decoration+=",drawtext=fontfile=fonts/jetbrainsmono.ttf:text='WHERDR / BOARD / 01':fontsize=19:fontcolor=0x9aa8b5:x=96:y=17"
 decoration+=f",drawtext=fontfile=fonts/archivo.ttf:textfile={id}-title.txt:fontsize=23:fontcolor=white:x=w-tw-96:y=14"
 if id=='outro':
  decoration+=",drawbox=x=96:y=54:w=1728:h=972:color=0x12151b@0.94:t=fill,drawtext=fontfile=fonts/archivo.ttf:text='Know what needs you.':fontsize=88:fontcolor=white:x=(w-tw)/2:y=430,drawbox=x=860:y=565:w=200:h=3:color=0x34b3eb:t=fill"
 decoration+=f",ass={id}.ass:fontsdir=fonts,format=yuv420p[v]"
 args=['-loop','1','-framerate','60','-i',id+'.png','-f','lavfi','-i',f'color=c=0x12151b:s=1920x1080:r=60:d={duration}','-loop','1','-framerate','60','-i','cursor.png',*(['-loop','1','-framerate','60','-i','needs.png'] if id=='details' else []),'-filter_complex_threads','1','-filter_complex',image+';'+overlay+decoration,'-map','[v]','-t',str(duration),'-c:v','libx264','-threads','2','-preset','fast','-crf','18','-an','-movflags','+faststart',id+'.mp4']
 if os.environ.get('TUTORIAL_SHOT') in (None,id):
  run(args)
 with wave.open(str(root/(id+'.wav')),'rb') as audio:
  assert audio.getsampwidth()==2 and audio.getnchannels()==1
  samples=array.array('h',audio.readframes(audio.getnframes()))
 gain=min(.84*32768/max(abs(x) for x in samples), 32768*10**(-19/20)/math.sqrt(sum(x*x for x in samples)/len(samples)))
 run(['-i',id+'.wav','-af',f'volume={gain},aresample=48000,adelay=550,apad,atrim=duration={duration}','-c:a','pcm_s16le',id+'-audio.wav'])
 manifest.append({'id':id,'start':round(start,3),'duration':duration,'narration_start':round(start+.55,3),'narration_duration':spoken,'captions':events})
 start+=duration;print(id,'rendered',flush=True)
(root/'concat.txt').write_text(''.join("file '"+s['id']+".mp4'\n" for s in shots))
(root/'audio-concat.txt').write_text(''.join("file '"+s['id']+"-audio.wav'\n" for s in shots))
run(['-f','concat','-safe','0','-i','concat.txt','-f','concat','-safe','0','-i','audio-concat.txt','-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-b:a','128k','-t','60','-movflags','+faststart','wherdr-board-tutorial.mp4'])
(root/'timeline.json').write_text(json.dumps({'duration':60,'fps':60,'width':1920,'height':1080,'shots':manifest},indent=2))
print('Rendered private 60-second tutorial.',flush=True)
