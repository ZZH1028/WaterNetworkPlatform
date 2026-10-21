"""Reproducible static build, including pinned, locally served browser libraries."""
from __future__ import annotations
import argparse, csv, io, json, shutil, tarfile, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIBRARIES = {
    'cesium': ('1.131.0', 'package/Build/Cesium/', 'vendor/cesium/'),
    'three': ('0.160.1', 'package/build/three.module.min.js', 'vendor/three.module.min.js'),
    'pdfjs-dist': ('4.10.38', 'package/build/', 'vendor/pdfjs/'),
    'mammoth': ('1.9.1', 'package/mammoth.browser.min.js', 'vendor/mammoth.browser.min.js'),
}

def generate_data(out: Path):
    gis = ROOT / 'data/gis'
    def rows(name):
        return list(csv.DictReader((gis / name).open(encoding='utf-8-sig')))
    stations = [{'id': r['StationID'], 'name': r['StationName'], 'lat': float(r['Latitude']), 'lng': float(r['Longitude'])} for r in rows('station.txt')]
    facilities = [{'id': r['GatePumpID'], 'name': r['GatePumpName'], 'lat': float(r['Latitude']), 'lng': float(r['Longitude'])} for r in rows('gate_pump.txt')]
    sections = {}
    for r in rows('river.txt'):
        key = r['RiverID'] + ':' + r['SectionID']
        if key not in sections:
            sections[key] = {'id': key, 'river': r['RiverName'], 'section': r['SectionID'], 'points': []}
        sections[key]['points'].append([float(r['PlaneX']), float(r['PlaneY']), float(r['Elevation'])])
    geo = json.loads((gis / 'river_network_full.geojson').read_text(encoding='utf-8-sig'))
    payload = {'stations': stations, 'facilities': facilities, 'rivers': geo,
               'sectionCount': len(sections), 'pointCount': sum(len(s['points']) for s in sections.values()),
               'sources': {'coordinates': '用户上传原项目 station.txt / gate_pump.txt；原项目标注 WGS84，未另行测绘复核',
                           'rivers': '原项目 river_network_full.geojson；断面中心连线，非河岸实测线；投影转换假定 EPSG:4528 待复核',
                           'sections': '用户上传 river.txt；保留原始本地平面坐标及吴淞高程，不与椭球高混用'}}
    (out/'data').mkdir(exist_ok=True)
    (out/'data/network.json').write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    (out/'data/sections.json').write_text(json.dumps(list(sections.values()), ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

def build(out: Path, vendor=True):
    out.mkdir(parents=True, exist_ok=True)
    for p in (ROOT/'web').iterdir():
        if p.is_dir(): shutil.copytree(p, out/p.name, dirs_exist_ok=True)
        else: shutil.copy2(p, out/p.name)
    generate_data(out)
    catalog=json.loads((ROOT/'knowledge/catalog.json').read_text(encoding='utf-8'))
    catalog['noteCount']=len(catalog['documents'])
    manuals=ROOT/'knowledge/manuals.json'
    if manuals.exists():
        corpus=json.loads(manuals.read_text(encoding='utf-8'))
        catalog['sources'].extend(corpus['sources']);catalog['documents'].extend(corpus['documents'])
        catalog['manualCount']=len(corpus['sources']);catalog['manualPages']=corpus['pages']
        catalog['manualChunks']=len(corpus['documents'])
    (out/'data/knowledge.json').write_text(json.dumps(catalog,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    (out/'.nojekyll').touch()
    if vendor:
        cache = ROOT/'.web-cache'
        cache.mkdir(exist_ok=True)
        for name, (version, prefix, dest) in LIBRARIES.items():
            tgz = cache/f'{name}-{version}.tgz'
            if not tgz.exists():
                url = f'https://registry.npmjs.org/{name}/-/{name}-{version}.tgz'
                print(f'Downloading {name} {version}', flush=True)
                with urllib.request.urlopen(url, timeout=120) as response:
                    tgz.write_bytes(response.read())
            with tarfile.open(tgz) as tar:
                for member in tar.getmembers():
                    if not member.isfile(): continue
                    if prefix.endswith('/'):
                        if not member.name.startswith(prefix): continue
                        relative = member.name[len(prefix):]
                        if name == 'pdfjs-dist' and relative not in ('pdf.mjs', 'pdf.worker.mjs'): continue
                        target = out/dest/relative
                    elif member.name == prefix: target = out/dest
                    else: continue
                    if not target.resolve().is_relative_to(out.resolve()): raise ValueError('unsafe member')
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(tar.extractfile(member).read())
                for license_file in ['package/LICENSE', 'package/LICENSE.md', 'package/LICENSE.txt']:
                    try:
                        content=tar.extractfile(license_file).read()
                        p=out/'vendor'/f'LICENSE-{name}.txt'; p.parent.mkdir(exist_ok=True);p.write_bytes(content)
                        break
                    except KeyError: pass
    print(json.dumps({'output': str(out), 'files': sum(1 for p in out.rglob('*') if p.is_file())}), flush=True)

if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--out',default=str(ROOT/'dist'));parser.add_argument('--no-vendor',action='store_true')
    args=parser.parse_args();build(Path(args.out).resolve(),not args.no_vendor)
