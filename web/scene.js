import { safeURL } from './store.js';
import { imageryReference } from './scene-fallback.js';

const statusText = {
  imagery: { loading: '卫星影像加载中', ready: '卫星影像已显示', partial: '影像局部缺失', error: '影像未连接' },
  terrain: { loading: '地形加载中', ready: '真实地形已显示', fallback: '椭球参考面' },
};

export async function createGlobe(container, network, options = {}) {
  const C = window.Cesium;
  const fallback = message => {
    container.dataset.engine = 'reference';
    options.onStatus?.(message, 'error', { engine: 'reference', imagery: 'error', terrain: 'fallback', model: 'none' });
    return Object.assign(imageryReference(container, network, options), { setView() {}, setLabels() {}, updateObservations() {}, highlight() {}, orbit() { return false; }, north() {} });
  };
  if (!C) return fallback('三维引擎未就绪，当前显示卫星参考视图；可继续查看资料与断面研判。');
  let viewer, dead = false;
  const flags = { engine: 'ready', imagery: 'loading', terrain: 'loading', model: options.tileset ? 'loading' : 'none' };
  const collections = { stations: [], facilities: [], rivers: [] }, riverEntities = new Map();
  let selected = [], labelsVisible = false, orbiting = false, heading = 0, lastTick = performance.now(), lastEmission = '';
  const emit = () => {
    if (dead) return;
    const fingerprint = JSON.stringify(flags);
    if (fingerprint === lastEmission) return;
    lastEmission = fingerprint;
    const error = ['error', 'partial'].includes(flags.imagery) || flags.terrain === 'fallback' || flags.model === 'error';
    options.onStatus?.([statusText.imagery[flags.imagery], statusText.terrain[flags.terrain]].join(' · '), error ? 'error' : flags.imagery === 'ready' && flags.terrain === 'ready' ? 'ready' : 'loading', { ...flags });
  };
  try {
    C.Ion.defaultAccessToken = '';
    viewer = new C.Viewer(container, { animation: false, baseLayerPicker: false, baseLayer: false, fullscreenButton: false, geocoder: false, homeButton: false, infoBox: false, navigationHelpButton: false, sceneModePicker: false, selectionIndicator: false, timeline: false, requestRenderMode: true, maximumRenderTimeChange: Infinity, sceneMode: C.SceneMode.SCENE3D });
    container.dataset.engine = 'webgl';
    viewer.resolutionScale = Math.min(devicePixelRatio, 1.6);
    viewer.scene.backgroundColor = C.Color.fromCssColorString('#070b11');
    viewer.scene.globe.baseColor = C.Color.fromCssColorString('#14222f');
    viewer.scene.globe.enableLighting = false;
    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewer.scene.globe.maximumScreenSpaceError = 2.3;
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 80;
    viewer.scene.screenSpaceCameraController.maximumZoomDistance = 2500000;
    viewer.camera.percentageChanged = .02;
    viewer.scene.renderError.addEventListener(() => { container.dataset.engine = 'error'; options.onStatus?.('三维渲染中断，请重载场景或检查浏览器图形加速。', 'error', { ...flags, engine: 'error' }); });

    const reference = document.createElement('canvas');reference.width = 2;reference.height = 2;
    const referenceContext = reference.getContext('2d');referenceContext.fillStyle = '#14222f';referenceContext.fillRect(0, 0, 2, 2);
    viewer.imageryLayers.addImageryProvider(await C.SingleTileImageryProvider.fromUrl(reference.toDataURL('image/png')));
    const imagery = new C.UrlTemplateImageryProvider({ url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maximumLevel: 19, credit: new C.Credit('Satellite imagery © Esri, Vantor, Earthstar Geographics and the GIS User Community', true) });
    let successes = 0, failures = 0;
    const requestImage = imagery.requestImage.bind(imagery);
    imagery.requestImage = (...args) => {
      const request = requestImage(...args);
      if (!request) return request;
      return Promise.resolve(request).then(image => { if (!dead && image) { successes++; flags.imagery = failures > 2 ? 'partial' : 'ready'; emit(); } return image; });
    };
    imagery.errorEvent.addEventListener(() => { failures++; if (failures >= 3) { flags.imagery = successes ? 'partial' : 'error'; emit(); } });
    const layer = viewer.imageryLayers.addImageryProvider(imagery);
    layer.brightness = .88; layer.saturation = .8;
    C.ArcGISTiledElevationTerrainProvider.fromUrl('https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer').then(terrain => {
      if (dead) return;
      const requestGeometry = terrain.requestTileGeometry.bind(terrain);
      terrain.requestTileGeometry = (...args) => {
        const request = requestGeometry(...args);
        if (!request) return request;
        return Promise.resolve(request).then(tile => { if (!dead && tile && flags.terrain !== 'fallback') { flags.terrain = 'ready'; emit(); } return tile; });
      };
      terrain.errorEvent.addEventListener(() => { if (!dead) { viewer.terrainProvider = new C.EllipsoidTerrainProvider(); flags.terrain = 'fallback'; emit(); } });
      viewer.terrainProvider = terrain; viewer.scene.requestRender();
    }).catch(() => { if (!dead) { flags.terrain = 'fallback'; emit(); } });
    emit();

    const positions = [];
    for (const feature of network.rivers.features) {
      if (!['LineString', 'MultiLineString'].includes(feature.geometry?.type)) continue;
      const lines = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      const record = { ...feature.properties, id: String(feature.properties.reach_id), coordinates: lines, lng: lines[0]?.[0]?.[0], lat: lines[0]?.[0]?.[1] };
      const entities = [];
      for (const line of lines) {
        if (line.length < 2) continue;
        const points = C.Cartesian3.fromDegreesArray(line.flatMap(p => p.slice(0, 2))); positions.push(...points);
        const entity = viewer.entities.add({ name: record.name, properties: { kind: 'river', record }, polyline: { positions: points, clampToGround: true, width: 2.5, material: C.Color.fromCssColorString('#80b6d9').withAlpha(.72) } });
        entities.push(entity); collections.rivers.push(entity);
      }
      riverEntities.set(record.id, entities);
    }
    const label = name => ({ text: name.split('（')[0], show: false, font: '12px sans-serif', fillColor: C.Color.fromCssColorString('#dceaff'), outlineColor: C.Color.fromCssColorString('#08111c'), outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE, showBackground: true, backgroundColor: C.Color.fromCssColorString('#0b1727dc'), backgroundPadding: new C.Cartesian2(6, 4), pixelOffset: new C.Cartesian2(0, -22), heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Infinity, distanceDisplayCondition: new C.DistanceDisplayCondition(0, 15000) });
    for (const station of network.stations) collections.stations.push(viewer.entities.add({ id: 'station-' + station.id, name: station.name, position: C.Cartesian3.fromDegrees(station.lng, station.lat), properties: { kind: 'station', record: station }, point: { pixelSize: 7, color: C.Color.fromCssColorString('#8b9caf'), outlineColor: C.Color.fromCssColorString('#182a40'), outlineWidth: 2, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Infinity, scaleByDistance: new C.NearFarScalar(500, 1.6, 70000, .7) }, label: label(station.name) }));
    const marker = pump => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="38" height="46" viewBox="0 0 38 46"><path d="M19 44l-6-9H8a7 7 0 0 1-7-7V9a7 7 0 0 1 7-7h22a7 7 0 0 1 7 7v19a7 7 0 0 1-7 7h-5z" fill="#142136" stroke="${pump ? '#acb0df' : '#dec290'}" stroke-width="1.5"/>${pump ? '<circle cx="19" cy="19" r="9" fill="none" stroke="#c0bff0" stroke-width="2"/><path d="M19 11v16m-8-8h16m-13-5l10 10m0-10L14 24" stroke="#c0bff0"/>' : '<path d="M9 27V11h20v16M13 16h12m-12 5h12M19 6v5" fill="none" stroke="#dec290" stroke-width="2"/>'}</svg>`);
    for (const facility of network.facilities) collections.facilities.push(viewer.entities.add({ id: 'facility-' + facility.id, name: facility.name, position: C.Cartesian3.fromDegrees(facility.lng, facility.lat), properties: { kind: 'facility', record: facility }, billboard: { image: marker(/泵/.test(facility.name)), width: 24, height: 29, verticalOrigin: C.VerticalOrigin.BOTTOM, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Infinity, scaleByDistance: new C.NearFarScalar(500, 1.3, 70000, .65) }, label: label(facility.name) }));
    const region = C.BoundingSphere.fromPoints(positions.length ? positions : C.Cartesian3.fromDegreesArray(network.stations.flatMap(p => [p.lng, p.lat])));
    let focus = region;
    function stopOrbit() { orbiting = false; viewer.camera.lookAtTransform(C.Matrix4.IDENTITY); options.onOrbit?.(false); }
    function move(sphere = focus, pitch = -47, duration = 1) {
      stopOrbit(); focus = sphere;
      const offset = new C.HeadingPitchRange(0, C.Math.toRadians(pitch), Math.max(600, sphere.radius * 2.2));
      if (!duration || matchMedia('(prefers-reduced-motion: reduce)').matches) { viewer.camera.lookAt(sphere.center, offset); viewer.camera.lookAtTransform(C.Matrix4.IDENTITY); }
      else viewer.camera.flyToBoundingSphere(sphere, { offset, duration });
      viewer.scene.requestRender();
    }
    function restore(entity) {
      if (entity.polyline) { entity.polyline.width = 2.5; entity.polyline.material = C.Color.fromCssColorString('#80b6d9').withAlpha(.72); }
      if (entity.point) entity.point.pixelSize = 7;
      if (entity.billboard) entity.billboard.scale = 1;
      if (entity.label) entity.label.show = labelsVisible;
    }
    function highlight(kind, record) {
      selected.forEach(restore);
      selected = kind === 'river' ? riverEntities.get(String(record.reach_id ?? record.id)) ?? [] : [viewer.entities.getById((kind === 'station' ? 'station-' : 'facility-') + record.id)].filter(Boolean);
      for (const entity of selected) {
        if (entity.polyline) { entity.polyline.width = 5; entity.polyline.material = new C.PolylineGlowMaterialProperty({ glowPower: .13, color: C.Color.fromCssColorString('#badbff') }); }
        if (entity.point) entity.point.pixelSize = 12;
        if (entity.billboard) entity.billboard.scale = 1.4;
        if (entity.label) entity.label.show = true;
      }
      viewer.scene.requestRender();
    }
    viewer.screenSpaceEventHandler.setInputAction(event => {
      const entity = viewer.scene.pick(event.position)?.id;
      if (!entity?.properties) return;
      const kind = entity.properties.kind.getValue(), record = entity.properties.record.getValue();
      highlight(kind, record); options.onSelect?.(kind, record);
    }, C.ScreenSpaceEventType.LEFT_CLICK);
    viewer.clock.onTick.addEventListener(() => {
      const now = performance.now(), delta = Math.min((now - lastTick) / 1000, .1); lastTick = now;
      if (!orbiting || dead) return;
      heading += delta * .06;
      viewer.camera.lookAt(focus.center, new C.HeadingPitchRange(heading, C.Math.toRadians(-40), Math.max(600, focus.radius * 2.2)));
      viewer.scene.requestRender();
    });
    viewer.screenSpaceEventHandler.setInputAction(stopOrbit, C.ScreenSpaceEventType.LEFT_DOWN);
    const cameraChanged = () => { const position = viewer.camera.positionCartographic; options.onCamera?.({ heading: C.Math.toDegrees(viewer.camera.heading), height: position.height, pitch: C.Math.toDegrees(viewer.camera.pitch) }); };
    viewer.camera.changed.addEventListener(cameraChanged); move(region, -47, 0); cameraChanged();
    if (options.tileset && safeURL(options.tileset)) C.Cesium3DTileset.fromUrl(safeURL(options.tileset), { maximumScreenSpaceError: 16 }).then(tiles => {
      if (dead) { tiles.destroy(); return; }
      viewer.scene.primitives.add(tiles);
      tiles.initialTilesLoaded.addEventListener(() => { flags.model = 'ready'; emit(); });
      tiles.tileFailed.addEventListener(() => { flags.model = 'error'; emit(); });
    }).catch(() => { if (!dead) { flags.model = 'error'; emit(); } });
    return {
      viewer, home() { move(region); },
      fly(record) {
        if (!record || dead) return;
        const entities = riverEntities.get(String(record.reach_id ?? record.id));
        if (record.kind === 'river' || record.coordinates || record.reach_id) {
          const points = entities?.flatMap(e => e.polyline.positions.getValue(C.JulianDate.now()));
          if (points?.length) { move(C.BoundingSphere.fromPoints(points)); return; }
        }
        move(new C.BoundingSphere(C.Cartesian3.fromDegrees(record.lng, record.lat), 600));
      },
      setView(name) { move(focus, name === 'plan' ? -90 : -47); },
      north() { stopOrbit(); viewer.camera.flyTo({ destination: viewer.camera.position, orientation: { heading: 0, pitch: viewer.camera.pitch, roll: 0 }, duration: .7 }); },
      orbit() { orbiting = !orbiting; if (!orbiting) stopOrbit(); else { heading = viewer.camera.heading; viewer.scene.requestRender(); } return orbiting; },
      zoom(direction) { stopOrbit(); const distance = viewer.camera.positionCartographic.height * .3; direction > 0 ? viewer.camera.zoomIn(distance) : viewer.camera.zoomOut(distance); viewer.scene.requestRender(); },
      toggle(layer, visible) { for (const entity of collections[layer] ?? []) entity.show = visible; viewer.scene.requestRender(); },
      setLabels(visible) { labelsVisible = visible; for (const entity of [...collections.stations, ...collections.facilities]) entity.label.show = visible || selected.includes(entity); viewer.scene.requestRender(); },
      highlight,
      updateObservations(records, threshold) { const map = new Map(records.map(r => [r.id, r])); for (const entity of collections.stations) { const record = map.get(entity.properties.record.getValue().id)?.record; entity.point.color = C.Color.fromCssColorString(!record ? '#8b9caf' : Number(record.water_level) >= threshold ? '#e8b47c' : '#79b4e9'); } viewer.scene.requestRender(); },
      destroy() { dead = true; if (!viewer.isDestroyed()) viewer.destroy(); },
    };
  } catch (error) {
    if (viewer && !viewer.isDestroyed()) viewer.destroy();
    return fallback('浏览器未能启动 WebGL，当前是卫星参考视图；断面资料仍可查看。');
  }
}
