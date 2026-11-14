import * as T from './vendor/three.module.min.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { corridorTriangles, clipWetTriangle, sectionProfile, profileWaterPolygons } from './engineering.js';
import { softwareScene } from './charts3d.js';

export function createSectionModel(element, sections, options = {}) {
  const points = sections.flatMap(s => s.points).filter(p => p.slice(0, 3).every(Number.isFinite));
  const min = [0, 1, 2].map(i => Math.min(...points.map(p => p[i])));
  const max = [0, 1, 2].map(i => Math.max(...points.map(p => p[i])));
  const scale = 100 / Math.max(max[0] - min[0], max[1] - min[1], 1);
  const origin = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]];
  const local = p => [(p[0] - origin[0]) * scale, (p[2] - origin[2]) * scale, (p[1] - origin[1]) * scale];
  let level = options.waterLevel ?? 3.5, exaggeration = options.exaggeration ?? 5;
  let renderer;
  try { renderer = new T.WebGLRenderer({ antialias: true, alpha: true }); }
  catch {
    element.dataset.renderer = 'software';
    let fallback;
    const draw = () => {
      fallback?.destroy();
      const transform = p => { const q = local(p); q[1] *= exaggeration; return q; };
      fallback = softwareScene(element, {
        paths: sections.map(s => ({ points: s.points.map(transform), color: '#d3bd8a', width: 1.5 })),
        cloud: points.map(transform),
        labels: [{ text: '兼容投影 · 本地坐标 / 吴淞高程', position: [0, 15, 0] }],
      });
    };
    draw();
    return { setWaterLevel(v) { level = v; draw(); }, setExaggeration(v) { exaggeration = v; draw(); }, setLayer() {}, setView() {}, selectSection() {}, destroy() { fallback.destroy(); } };
  }
  element.dataset.renderer = 'webgl';
  element.dataset.sections = String(sections.length);
  element.dataset.points = String(points.length);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
  renderer.setClearColor(0x080e18, 1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  element.prepend(renderer.domElement);
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(40, 1, .01, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false; controls.minDistance = .2; controls.maxDistance = 450;
  controls.maxPolarAngle = Math.PI * .94;
  const model = new T.Group(); scene.add(model);
  const bed = new T.Group(), water = new T.Group(), lines = new T.Group(), samples = new T.Group();
  model.add(bed, water, lines, samples);
  scene.add(new T.HemisphereLight(0xc6dcf7, 0x152036, 2.3));
  const sun = new T.DirectionalLight(0xe3efff, 2.8); sun.position.set(40, 95, 55); scene.add(sun);
  const grid = new T.GridHelper(140, 14, 0x29405b, 0x172536); grid.position.y = -.2; scene.add(grid);
  const triangles = corridorTriangles(sections);
  function geometry(tris) {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(tris.flatMap(t => t.flatMap(local)), 3));
    g.computeVertexNormals(); return g;
  }
  if (triangles.length) {
    const g = geometry(triangles), colors = [];
    for (const triangle of triangles) for (const p of triangle) {
      const t = (p[2] - min[2]) / Math.max(max[2] - min[2], .01);
      const c = new T.Color('#263f55').lerp(new T.Color('#a79470'), t);
      colors.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    bed.add(new T.Mesh(g, new T.MeshStandardMaterial({ vertexColors: true, side: T.DoubleSide, roughness: .92 })));
  }
  const sectionLines = new Map();
  for (const section of sections) {
    const line = new T.Line(new T.BufferGeometry().setFromPoints(section.points.map(p => new T.Vector3(...local(p)))), new T.LineBasicMaterial({ color: 0xe1c998, transparent: true, opacity: .7 }));
    lines.add(line); sectionLines.set(section.id, line);
  }
  samples.add(new T.Points(new T.BufferGeometry().setFromPoints(points.map(p => new T.Vector3(...local(p)))), new T.PointsMaterial({ color: 0xf5dbad, size: 2.5, sizeAttenuation: false })));
  function disposeChildren(group) {
    for (const child of [...group.children]) { child.geometry?.dispose(); child.material?.dispose(); group.remove(child); }
  }
  function draw() { renderer.render(scene, camera); }
  function drawWater() {
    disposeChildren(water);
    const surface = triangles.flatMap(t => clipWetTriangle(t, level));
    if (surface.length) water.add(new T.Mesh(geometry(surface), new T.MeshPhysicalMaterial({ color: 0x488fc9, metalness: .08, roughness: .23, transparent: true, opacity: .74, side: T.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 })));
    // Vertical wetted cross-section curtains also work for a single measured section.
    const curtains = sections.flatMap(s => profileWaterPolygons(sectionProfile(s), level).flatMap(poly => {
      const p = poly.map(q => [q.x, q.y, q.elevation]); return [[p[0], p[1], p[2]], [p[0], p[2], p[3]]];
    }));
    if (curtains.length) water.add(new T.Mesh(geometry(curtains), new T.MeshBasicMaterial({ color: 0x61afe5, side: T.DoubleSide, transparent: true, opacity: .18, depthWrite: false })));
    element.dataset.waterLevel = level.toFixed(3); draw();
  }
  let focusedId = sections[0]?.id;
  function view(name = 'oblique') {
    model.updateMatrixWorld(true);
    const target = name === 'extent' ? model : sectionLines.get(focusedId) ?? model;
    const bounds = new T.Box3().setFromObject(target), center = bounds.getCenter(new T.Vector3());
    const size = bounds.getSize(new T.Vector3()), distance = Math.max(size.x, size.z, size.y * 1.3, .6) * 1.65;
    controls.target.copy(center);
    const section = sections.find(s => s.id === focusedId) ?? sections[0];
    const first = local(section.points[0]), last = local(section.points.at(-1));
    const across = new T.Vector3(last[0] - first[0], 0, last[2] - first[2]).normalize();
    let normal = new T.Vector3(-across.z, 0, across.x);
    const neighbor = sections[sections.indexOf(section) + 1] ?? sections[sections.indexOf(section) - 1];
    if (neighbor) { const point = local(neighbor.points[Math.floor(neighbor.points.length / 2)]); if (normal.dot(new T.Vector3(point[0] - center.x, 0, point[2] - center.z)) > 0) normal.negate(); }
    const offset = name === 'plan' ? new T.Vector3(.001, distance, .001) : name === 'side' ? normal.clone().multiplyScalar(distance) : name === 'extent' ? new T.Vector3(distance * .65, distance * .6, distance * .8) : normal.multiplyScalar(distance).add(across.multiplyScalar(distance * .18)).add(new T.Vector3(0, distance * .6, 0));
    camera.position.copy(center).add(offset); camera.up.set(0, 1, 0); controls.update(); draw();
  }
  model.scale.y = exaggeration; drawWater(); view();
  const observer = new ResizeObserver(() => {
    if (!element.clientWidth || !element.clientHeight) return;
    renderer.setSize(element.clientWidth, element.clientHeight, false);
    camera.aspect = element.clientWidth / element.clientHeight; camera.updateProjectionMatrix(); draw();
  });
  observer.observe(element); controls.addEventListener('change', draw);
  return {
    setWaterLevel(v) { level = v; drawWater(); },
    setExaggeration(v) { exaggeration = v; model.scale.y = v; view(); },
    setLayer(name, visible) { ({ bed, water, lines, points: samples }[name] ?? bed).visible = visible; draw(); },
    setView: view,
    selectSection(id) { focusedId = id; for (const [key, line] of sectionLines) { line.material.color.set(key === id ? '#ffffff' : '#e1c998'); line.material.opacity = key === id ? 1 : .5; } view(); },
    destroy() { observer.disconnect(); controls.dispose(); scene.traverse(o => { o.geometry?.dispose(); if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose(); }); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); },
  };
}
