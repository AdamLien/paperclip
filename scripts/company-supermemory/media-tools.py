#!/opt/crew-media/venv/bin/python
"""Download, transcribe and narrate media inside the existing Crew sandbox."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
from urllib.parse import urlparse
import zipfile

PYTHON = '/opt/crew-media/venv/bin/python'
MODEL = '/opt/crew-media/models/whisper-small'


def contained(path, root=None):
    root = (root or Path.cwd()).resolve()
    path = Path(path).resolve()
    if path != root and root not in path.parents:
        raise ValueError('Media paths must stay inside the current workspace')
    return path


def youtube_url(url):
    parsed = urlparse(url)
    if (parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port
            or parsed.hostname not in {'youtube.com','www.youtube.com','m.youtube.com','youtu.be'}):
        raise ValueError('Download accepts only a public HTTPS YouTube URL')
    return url


def run(args):
    subprocess.run(args, check=True, timeout=1800)


def probe(path):
    return json.loads(subprocess.check_output([
        'ffprobe','-v','error','-show_entries','format=duration,size:stream=codec_type,codec_name,width,height',
        '-of','json',str(path)], text=True, timeout=30))


def timestamp(seconds, separator=','):
    millis = round(seconds*1000)
    seconds,millis = divmod(millis,1000)
    minutes,seconds = divmod(seconds,60)
    hours,minutes = divmod(minutes,60)
    return f'{hours:02}:{minutes:02}:{seconds:02}{separator}{millis:03}'


def validate_cues(cues, duration):
    end = 0.
    if not cues: raise ValueError('No speech was recognized')
    for cue in cues:
        if not cue['text'].strip() or not end <= cue['start'] < cue['end'] <= duration:
            raise ValueError('Invalid or overlapping subtitle timing')
        end = cue['end']


def download(url, output):
    youtube_url(url)
    run([PYTHON,'-m','yt_dlp','--no-playlist','--no-progress',
         '--js-runtimes','node:/usr/local/bin/node','--max-filesize','512M',
         '-f','bv*[vcodec^=avc1][height<=1280]+ba/b[height<=1280]/bv*[height<=1280]+ba',
         '--merge-output-format','mp4','--write-info-json',
         '-o',str(output/'source.%(ext)s'),url])
    original = next((f for f in output.glob('source.*') if f.suffix in {'.mp4','.webm','.mkv'}),None)
    if original is None: raise ValueError('Download produced no video')
    run(['ffmpeg','-hide_banner','-loglevel','error','-n','-i',str(original),
         '-vf','scale=640:640:force_original_aspect_ratio=decrease:force_divisible_by=2',
         '-c:v','libx264','-preset','fast','-crf','26','-maxrate','500k','-bufsize','1000k',
         '-c:a','aac','-b:a','64k',
         '-movflags','+faststart',str(output/'video.mp4')])
    data = json.loads((output/'source.info.json').read_text())
    (output/'source-info.json').write_text(json.dumps({k:data.get(k) for k in
        ['id','title','channel','duration','webpage_url','upload_date']},ensure_ascii=False,indent=2)+'\n')
    return output/'video.mp4'


def transcribe(source, output, language):
    from faster_whisper import WhisperModel
    from opencc import OpenCC
    duration = float(probe(source)['format']['duration'])
    if not any(s['codec_type']=='audio' for s in probe(source)['streams']):
        raise ValueError('Input has no audio stream')
    model = WhisperModel(MODEL,device='cpu',compute_type='int8',cpu_threads=2,local_files_only=True)
    segments,info = model.transcribe(str(source),language=None if language=='auto' else language,
        beam_size=5,vad_filter=True,initial_prompt='以下是繁體中文口語逐字稿。' if language=='zh' else None)
    raw = [{'start':s.start,'end':s.end,'text':s.text.strip()} for s in segments]
    (output/'transcript-raw.json').write_text(json.dumps(raw,ensure_ascii=False,indent=2)+'\n')
    converter = OpenCC('s2twp')
    cues=[]
    for s in raw:
        start=max(cues[-1]['end'] if cues else 0.,s['start'])
        end=min(s['end'],duration)
        if end>start and s['text']:
            cues.append({'start':start,'end':end,'text':converter.convert(s['text'])})
    validate_cues(cues,duration)
    (output/'transcript.txt').write_text('\n'.join(c['text'] for c in cues)+'\n')
    (output/'transcript.srt').write_text('\n\n'.join(f'{i}\n{timestamp(c["start"])} --> {timestamp(c["end"])}\n{c["text"]}' for i,c in enumerate(cues,1))+'\n')
    (output/'transcript.vtt').write_text('WEBVTT\n\n'+'\n\n'.join(f'{timestamp(c["start"],".")} --> {timestamp(c["end"],".")}\n{c["text"]}' for c in cues)+'\n')
    return {'language':info.language,'cues':len(cues),'duration':duration,'last_cue_end':cues[-1]['end']}


def speak(source, output, allow_online):
    if not allow_online:
        raise ValueError('Online TTS sends text to Microsoft; explicit --allow-online-tts is required')
    run([PYTHON,'-m','edge_tts','--voice','zh-TW-HsiaoChenNeural','--file',str(source),
         '--write-media',str(output/'narration.mp3')])
    return probe(output/'narration.mp3')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['download','transcribe','speak','process'])
    parser.add_argument('source')
    parser.add_argument('--output',required=True,help='New output directory inside current workspace')
    parser.add_argument('--language',default='zh')
    parser.add_argument('--allow-online-tts',action='store_true')
    args=parser.parse_args()
    if args.command in {'process','speak'} and not args.allow_online_tts:
        parser.error('--allow-online-tts is required for speech generation')
    output=contained(args.output)
    source=args.source if args.command in {'download','process'} else contained(args.source)
    if args.command in {'download','process'}: youtube_url(source)
    output.mkdir(parents=True,exist_ok=False)
    result={'company':os.getenv('PAPERCLIP_COMPANY_ID'),'agent':os.getenv('PAPERCLIP_AGENT_ID'),
            'execution_host':'mCrew .71 Linux','transcript_review':'ASR draft; human review recommended',
            'tts':'Microsoft Edge online; generic zh-TW voice, not speaker cloning'}
    if args.command in {'download','process'}:
        source=download(source,output)
        result['video']=probe(source)
    if args.command in {'transcribe','process'}:
        result['transcription']=transcribe(source,output,args.language)
        source=output/'transcript.txt'
    if args.command in {'speak','process'}:
        result['audio']=speak(source,output,args.allow_online_tts)
    deliverables=[f for f in output.iterdir() if f.name in {
        'video.mp4','transcript.txt','transcript.srt','transcript.vtt','narration.mp3','source-info.json'}]
    result['files']={}
    for f in deliverables:
        with f.open('rb') as stream:
            digest=hashlib.file_digest(stream,'sha256').hexdigest()
        result['files'][f.name]={'bytes':f.stat().st_size,'sha256':digest}
    (output/'manifest.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    with zipfile.ZipFile(output/'deliverables.zip','w',zipfile.ZIP_DEFLATED) as archive:
        for f in deliverables+[output/'manifest.json']: archive.write(f,f.name)
    print(json.dumps({'output':str(output),'manifest':result},ensure_ascii=False))


if __name__=='__main__': main()
