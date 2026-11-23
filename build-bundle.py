from hashlib import sha256
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
D=Path(__file__).resolve().parent
OUT=D.parent/'Hey-ChatGPT-MyGo-0.3.1-Windows-x64.zip'
files={D/'README.md':'README.md',D/'README-中文.md':'README-中文.md'}
for name in ('Hey-ChatGPT.exe','hey-native-host.exe'):
    files[D/'desktop'/'out'/name]=name
for directory,names in {
    'VoiceRoutes-Web':['manifest.json','panel.html','panel.css','panel.js','dark.css','i18n.js','worker.js','core.js','desktop-target.js','official-dictation.js','wake-bridge.js','README.md'],
    'VoiceRoutes-Bridge':['voice_bridge.py','NOTICE.txt'],
    'VoiceRoutes-KWS-Windows':['Prepare-Helper.cmd','prepare_model.py','requirements.txt','probe.py','NOTICE.txt','README.md'],
    'setup':['Register-Chrome-Link.cmd','Unregister-Chrome-Link.cmd','Chrome-Link.exe','NOTICE-golang-x-sys.txt']
}.items():
    for name in names:
        files[D/directory/name]=directory+'/'+name
for n in (D/'desktop'/'licenses').iterdir():
    if n.is_file(): files[n]='licenses/'+n.name
assert sum(x.endswith('.exe') for x in files.values())==3
assert 'nativeMessaging' in json.loads((D/'VoiceRoutes-Web/manifest.json').read_text())['permissions']
assert 'data-i18n' in (D/'VoiceRoutes-Web/panel.html').read_text()
for f in files:
    assert f.is_file() and f.stat().st_size, f
    if f.suffix=='.exe':
        with f.open('rb') as exe: assert exe.read(2)==b'MZ',f
with ZipFile(OUT,'w',ZIP_DEFLATED,compresslevel=7) as z:
    for path,name in files.items(): z.write(path,name)
with ZipFile(OUT) as z:
    assert z.testzip() is None
    assert set(z.namelist())==set(files.values())
    for path,name in files.items(): assert sha256(z.read(name)).digest()==sha256(path.read_bytes()).digest(),name
print(OUT, OUT.stat().st_size, sha256(OUT.read_bytes()).hexdigest())
