"""Exercise actual 3D rendering and linked engineering interactions.

CI runs this against the published Pages URL. Local runs may select a system
Chromium. TLS verification remains enabled; online basemap status is reported
separately from the locally hosted engineering models.
"""
import argparse,json,os,re,time,urllib.error,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser()
parser.add_argument('--url',required=True)
parser.add_argument('--revision')
parser.add_argument('--out',default='browser-results')
parser.add_argument('--browser-executable')
args=parser.parse_args()
out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
base=args.url.rstrip('/')+'/'
build=None
readiness=[]
for attempt in range(8):
    try:
        with urllib.request.urlopen(base+'build.json?smoke='+str(time.time_ns()),timeout=30) as response:
            build=json.load(response)
        readiness.append({'attempt':attempt+1,'revision':build['revision']})
    except (urllib.error.URLError,ValueError) as error:
        readiness.append({'attempt':attempt+1,'error':str(error)})
        (out/'readiness.json').write_text(json.dumps(readiness,indent=2))
        if attempt==7:raise
        time.sleep(5)
        continue
    if not args.revision or build['revision']==args.revision:break
    time.sleep(5)
else:raise AssertionError('Published build revision did not match expected revision')
url=base+'?v='+build['revision']
checks={};errors=[]
with sync_playwright() as p:
    options={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']}
    if args.browser_executable:options['executable_path']=args.browser_executable
    proxy=os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
    if proxy:options['proxy']={'server':proxy,'bypass':'localhost,127.0.0.1'}
    browser=p.chromium.launch(**options)
    page=browser.new_page(viewport={'width':1512,'height':1100})
    page.on('pageerror',lambda error:errors.append(str(error)))
    failures=[]
    page.on('response',lambda response:failures.append(response.url) if response.status>=400 and response.url.startswith(base) else None)
    try:
        page.goto(url+'#scene',wait_until='domcontentloaded',timeout=45000)
        page.locator('#globe[data-engine="webgl"] canvas').first.wait_for(state='visible',timeout=45000)
        checks['cesium_webgl_canvas']=True
        page.locator('#station-search').fill('伯渎港')
        page.locator('#station-results button').filter(has_text='河道').first.click()
        page.locator('#record-section').click()
        page.locator('#section-scene[data-renderer="webgl"] canvas').wait_for(state='visible',timeout=30000)
        three_urls=page.evaluate("performance.getEntriesByType('resource').map(r=>r.name).filter(u=>new URL(u).pathname.endsWith('/three.module.min.js'))")
        assert len(set(three_urls))==1,three_urls
        checks['one_shared_three_module']=True
        assert page.locator('#river-select').input_value()=='伯渎港'
        checks['river_selection_links_to_matching_sections']=True
        page.locator('#river-select').select_option(label='九曲河')
        page.wait_for_function("document.querySelector('#section-scene').dataset.points === '216'")
        canvas=page.locator('#section-scene canvas').element_handle()
        for value in ['2.6','4.0']:
            page.locator('#section-water').evaluate('(el,v)=>{el.value=v;el.dispatchEvent(new Event("input",{bubbles:true}));}',value)
            if value=='2.6':lower=float(page.locator('#section-measures').get_attribute('data-area'))
            else:upper=float(page.locator('#section-measures').get_attribute('data-area'))
        assert upper>lower>=0
        assert page.evaluate('(canvas)=>canvas===document.querySelector("#section-scene canvas")',canvas)
        checks['water_level_updates_geometry_and_metrics_without_recreating_canvas']=True
        page.locator('[data-model-view="extent"]').click()
        page.locator('[data-model-view="oblique"]').click()
        layer=page.locator('[data-model-layer="water"]');layer.uncheck();layer.check()
        checks['model_views_and_layer_controls']=True
        page.locator('#section-play').click()
        page.wait_for_function("Number(document.querySelector('#section-time').value)>0",timeout=10000)
        page.locator('#section-play').click()
        frame=page.locator('#section-time').input_value();page.wait_for_timeout(1000)
        assert page.locator('#section-time').input_value()==frame
        assert page.locator('#playback-badge').inner_text()=='演示过程'
        checks['reference_playback_pause_and_demo_label']=True
        page.screenshot(path=str(out/'sections-desktop.png'),full_page=True)
        page.locator('#section-ask').click()
        page.wait_for_url(re.compile(r'.*#assistant'))
        page.locator('#messages .chat-message:not(.user)').first.wait_for(timeout=30000)
        checks['context_question_reaches_assistant']=True
        page.goto(url+'#overview',wait_until='domcontentloaded')
        page.locator('#globe[data-engine="webgl"] canvas').first.wait_for(timeout=30000)
        page.screenshot(path=str(out/'overview-desktop.png'),full_page=True)
        checks['basemap_status']={'imagery':page.locator('#imagery-health').get_attribute('data-status'),'terrain':page.locator('#terrain-health').get_attribute('data-status')}
        page.set_viewport_size({'width':390,'height':844})
        page.goto(url+'#sections',wait_until='domcontentloaded')
        page.locator('#section-scene[data-renderer="webgl"] canvas').wait_for(timeout=30000)
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        page.screenshot(path=str(out/'sections-mobile.png'),full_page=True)
        page.locator('#menu-toggle').click();page.locator('#navigation a[data-route="scene"]').click()
        page.locator('#globe[data-engine="webgl"] canvas').first.wait_for(timeout=30000)
        checks['mobile_no_page_overflow_and_navigation']=True
        assert not errors,errors
        assert not failures,failures
        checks['uncaught_javascript_errors']=errors
        checks['failed_local_asset_requests']=failures
    except Exception as error:
        page.screenshot(path=str(out/'failure.png'),full_page=True)
        (out/'failure.json').write_text(json.dumps({'build':build,'checks':checks,'error':str(error),'page_errors':errors,'failed_assets':failures,'page_url':page.url},ensure_ascii=False,indent=2))
        if os.environ.get('GITHUB_ACTIONS'):
            print('::error::'+str(error).replace('%','%25').replace('\r','%0D').replace('\n','%0A'))
        raise
    finally:
        browser.close()
result={'base_url':base,'build':build,'checks':checks}
(out/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps(result,ensure_ascii=False,indent=2))
if os.environ.get('GITHUB_ACTIONS'):
    health=checks['basemap_status']
    print('::notice title=Published website verified::revision='+build['revision']+'; Cesium and measured section WebGL passed; imagery='+str(health['imagery'])+'; terrain='+str(health['terrain'])+'; desktop and mobile interactions passed')
if os.environ.get('GITHUB_STEP_SUMMARY'):
    with open(os.environ['GITHUB_STEP_SUMMARY'],'a') as summary:
        summary.write('Published-site browser checks passed.\n\n```json\n'+json.dumps(result,ensure_ascii=False,indent=2)+'\n```\n')
