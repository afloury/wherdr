"""Check the actual encoded artifact, its provenance and narration timing."""
import array,hashlib,json,math,os,pathlib,subprocess
root=pathlib.Path(os.environ['TUTORIAL_OUT']);movie=root/'wherdr-board-tutorial.mp4'
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(movie)]))
video=next(s for s in probe['streams'] if s['codec_type']=='video')
audio=next(s for s in probe['streams'] if s['codec_type']=='audio')
assert (video['codec_name'],video['width'],video['height'],video['pix_fmt'])==('h264',1080,1920,'yuv420p')
assert video['r_frame_rate']=='30/1' and int(video['nb_frames'])==1800
assert abs(float(probe['format']['duration'])-60)<.1 and audio['codec_name']=='aac'
data=movie.read_bytes();assert data.index(b'moov')<data.index(b'mdat'), 'Missing fast-start metadata'
plan=json.loads((root/'storyboard.json').read_text());assert plan['voice']=='matilda' and plan['pronunciation']=='where-der'
timeline=json.loads((root/'timeline.json').read_text());end=0
for shot in timeline['shots']:
    assert abs(shot['start']-end)<.002
    assert shot['narration_start']+shot['narration_duration']<=shot['start']+shot['duration']
    end=shot['start']+shot['duration']
assert abs(end-60)<.002
capture=json.loads((root/'capture.json').read_text());assert capture['session'].startswith('hwtest')
for frame in capture['frames']:
    assert hashlib.sha256((root/(frame['id']+'.png')).read_bytes()).hexdigest()==frame['sha256']
subprocess.run(['ffmpeg','-v','error','-i',str(movie),'-f','null','-'],check=True)
pcm=subprocess.check_output(['ffmpeg','-v','error','-i',str(movie),'-vn','-ar','16000','-f','s16le','-'])
samples=array.array('h',pcm);rms=math.sqrt(sum(x*x for x in samples)/len(samples))
assert 20*math.log10(rms/32768)>-30, 'Missing or inaudible narration'
assert max(abs(x) for x in samples)<32767, 'Clipped audio'
print(json.dumps({'pass':True,'duration':probe['format']['duration'],'frames':1800,'size':len(data),'codec':'H.264/AAC','capture':'isolated hwtest session','rms_dbfs':round(20*math.log10(rms/32768),1)},indent=2))
