"""Index public US government technical manuals by PDF page, without redistributing figures."""
from __future__ import annotations
import concurrent.futures, gzip, hashlib, json, re, sys, urllib.request
from pathlib import Path
from pypdf import PdfReader
ROOT=Path(__file__).resolve().parents[1]
MANUALS=[
 ('M-HEC','USACE HEC-RAS 6.0 Hydraulic Reference Manual','https://www.hec.usace.army.mil/software/hec-ras/documentation/HEC-RAS_6.0_ReferenceManual.pdf'),
 ('M-HEC2D','USACE HEC-RAS 6.0 2D Modeling User Manual','https://www.hec.usace.army.mil/software/hec-ras/documentation/HEC-RAS_6.0_2D_Modeling_Users_Manual.pdf'),
 ('M-NOAA','NOAA Tidal Analysis and Predictions','https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf'),
 ('M-DATUM','NOAA Tidal Datums and Their Applications','https://tidesandcurrents.noaa.gov/publications/tidal_datums_and_their_applications.pdf'),
 ('M-EPA','US EPA SWMM 5.2 User Manual','https://www.epa.gov/system/files/documents/2022-04/swmm-users-manual-version-5.2.pdf'),
 ('M-ADCP','USGS ADCP Discharge Measurement Technical Manual','https://pubs.usgs.gov/tm/3a22/pdf/tm3a22.pdf'),
]
TERMS={'tidal':'感潮 潮汐 潮位','boundary':'边界条件','salinity':'盐度 咸潮','pump':'泵站 能耗','gate':'闸门 调度','manning':'曼宁 糙率','calibration':'率定 校准','uncertainty':'不确定性','continuity':'连续 质量守恒','momentum':'动量 圣维南','datum':'高程 基准','rainfall':'降雨 径流','adcp':'测流 声学 多普勒','stability':'稳定性 数值','sediment':'泥沙 输沙','courant':'CFL 时间步','water quality':'水质 污染','floodplain':'漫滩 洪泛区','mesh':'网格 二维 三维','backwater':'顶托 回水','hydrograph':'水位 流量 过程线'}
def ingest(item):
    sid,title,url=item;cache=ROOT/'.web-cache/manuals';cache.mkdir(parents=True,exist_ok=True);pdf=cache/(sid+'.pdf')
    if not pdf.exists():
        with urllib.request.urlopen(url,timeout=120) as r: data=r.read()
        if not data.startswith(b'%PDF'):raise ValueError('not a PDF')
        pdf.write_bytes(data)
    reader=PdfReader(pdf);docs=[]
    for number,page in enumerate(reader.pages,1):
        text=(page.extract_text() or '').replace('\x00','').strip()
        text=re.sub(r'[ \t]+',' ',text)
        if len(text)<120:continue
        for offset in range(0,len(text),1200):
            chunk=text[offset:offset+1450].strip()
            if len(chunk)<100:continue
            keywords=' '.join(cn for en,cn in TERMS.items() if en in chunk.lower())
            docs.append({'id':sid+f'-P{number}-{offset//1200+1}','title':title+f' · PDF 第 {number} 页','category':'官方手册原文','keywords':keywords,'content':chunk,'steps':'此为官方英文手册原文片段。公式和表格可能受文本抽取影响，请打开对应 PDF 页面核对。','sourceId':sid,'origin':'官方手册 / 英文原文抽取','updated':'2026-10-21','page':number,'sourceUrl':url+f'#page={number}'})
    source={'id':sid,'title':title,'url':url,'type':'官方技术手册','pages':len(reader.pages),'sha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'retrieved':'2026-10-21','note':'US federal government technical publication; text extraction, excluding figures. Review third-party notices in the original for reuse.'}
    print(sid,source['pages'],'pages',len(docs),'chunks',flush=True);return source,docs
def main():
    shipped=ROOT/'knowledge/manuals.json.gz'
    if shipped.exists() and '--refresh' not in sys.argv:
        content=gzip.decompress(shipped.read_bytes());result=json.loads(content)
        if len(result.get('sources',[]))<3 or not result.get('documents'):raise SystemExit('Invalid shipped corpus')
        (ROOT/'knowledge/manuals.json').write_bytes(content)
        print(json.dumps({'shipped':True,'manuals':len(result['sources']),'pages':result['pages'],'chunks':len(result['documents'])}),flush=True)
        return
    sources=[];documents=[];failures=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        pending={pool.submit(ingest,m):m for m in MANUALS}
        for future in concurrent.futures.as_completed(pending):
            try:
                src,docs=future.result();sources.append(src);documents.extend(docs)
            except Exception as e:failures.append({'id':pending[future][0],'error':str(e)});print('FAILED',pending[future][0],str(e),flush=True)
    if len(sources)<3:raise SystemExit('Fewer than three manuals available; do not claim a full corpus build.')
    sources.sort(key=lambda s:s['id']);documents.sort(key=lambda d:d['id'])
    result={'sources':sources,'documents':documents,'failures':failures,'pages':sum(s['pages'] for s in sources)}
    (ROOT/'knowledge/manuals.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print(json.dumps({'manuals':len(sources),'pages':result['pages'],'chunks':len(documents),'failed':len(failures)}),flush=True)
if __name__=='__main__':main()
