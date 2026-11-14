import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionProfile, sectionMetrics, resampleSection, corridorTriangles, clipWetTriangle, profileWaterPolygons } from '../web/engineering.js';

const v = { id: 'A', points: [[0, 0, 2], [2, 0, 0], [4, 0, 2]] };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
test('V-shaped measured section integrates partial wet segments exactly', () => {
  const m = sectionMetrics(v, 1);
  near(m.area, 1); near(m.wetWidth, 2); near(m.perimeter, 2 * Math.sqrt(2)); near(m.hydraulicRadius, 1 / (2 * Math.sqrt(2)));
  assert.equal(m.openBanks, false);
});
test('water above measured bank remains bounded to the measured section', () => {
  const m = sectionMetrics(v, 3);
  near(m.area, 8); near(m.wetWidth, 4); assert.equal(m.openBanks, true);
});
test('dry section has zero area, width, wetted perimeter and radius', () => {
  const m = sectionMetrics(v, -1);
  for (const key of ['area', 'wetWidth', 'perimeter', 'hydraulicRadius']) near(m[key], 0);
  assert.equal(profileWaterPolygons(m.profile, -1).length, 0);
});
test('disconnected wet pockets do not fill across a dry island', () => {
  const s = { points: [[0, 0, 0], [1, 0, 2], [2, 0, 0]] }, m = sectionMetrics(s, 1);
  near(m.area, .5); near(m.wetWidth, 1);
  const polygons = profileWaterPolygons(m.profile, 1);
  assert.equal(polygons.length, 2);
  assert.ok(polygons[0].every(p => p.distance <= .5));
  assert.ok(polygons[1].every(p => p.distance >= 1.5));
});
test('vertical bank walls contribute wetted perimeter without invented horizontal width', () => {
  const s = { points: [[0, 0, 3], [0, 0, 0], [4, 0, 0], [4, 0, 3]] };
  const m = sectionMetrics(s, 2);
  near(m.area, 8); near(m.wetWidth, 4); near(m.perimeter, 8); near(m.hydraulicRadius, 1);
  assert.ok(resampleSection(s).flat().every(Number.isFinite));
});
test('duplicate and invalid points do not introduce NaN into profile distances', () => {
  const s = { points: [[0, 0, 1], [0, 0, 1], [NaN, 0, 0], [3, 4, 2]] };
  const p = sectionProfile(s); assert.equal(p.length, 2); near(p.at(-1).distance, 5);
  assert.throws(() => sectionMetrics(s, NaN));
});
test('resampling preserves measured endpoints and linearly interpolates distance', () => {
  const p = resampleSection(v, 5);
  assert.deepEqual(p[0], v.points[0]); assert.deepEqual(p.at(-1), v.points.at(-1));
  assert.deepEqual(p[2], [2, 0, 0]);
});
test('corridor alignment avoids reversed bank order and never mutates measurements', () => {
  const other = { id: 'B', points: [[4, 10, 2], [2, 10, 0], [0, 10, 2]] };
  const input = [v, other], before = structuredClone(input);
  const triangles = corridorTriangles(input, 5);
  assert.equal(triangles.length, 8); assert.deepEqual(input, before);
  assert.deepEqual(triangles[0][2], [0, 10, 2]);
});
test('water surface is clipped to a wet triangle and stays on the reference plane', () => {
  const t = [[0, 0, 0], [2, 0, 2], [0, 2, 2]];
  const wet = clipWetTriangle(t, 1);
  assert.equal(wet.length, 1);
  assert.ok(wet.flat().every(p => p[2] === 1 && p[0] >= 0 && p[1] >= 0 && p[0] + p[1] <= 1));
  assert.equal(clipWetTriangle(t, -1).length, 0); assert.equal(clipWetTriangle(t, 3).length, 1);
});
test('hydraulic metrics always use original measurements independently of display resampling', () => {
  const before = sectionMetrics(v, 1); corridorTriangles([v, { points: v.points.map(p => [p[0], p[1] + 10, p[2]]) }], 20);
  assert.deepEqual(sectionMetrics(v, 1), before);
});
