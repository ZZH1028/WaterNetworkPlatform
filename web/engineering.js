// Measured-section calculations. No georeferencing or flow model is inferred.
export function sectionProfile(section) {
  let distance = 0;
  const profile = [];
  for (const raw of section?.points ?? []) {
    if (!Array.isArray(raw) || raw.length < 3 || !raw.slice(0, 3).every(Number.isFinite)) continue;
    const point = raw.slice(0, 3);
    if (profile.length) {
      const previous = profile.at(-1);
      const delta = Math.hypot(point[0] - previous.x, point[1] - previous.y);
      if (delta < 1e-8 && Math.abs(point[2] - previous.elevation) < 1e-8) continue;
      distance += delta;
    }
    profile.push({ distance, elevation: point[2], x: point[0], y: point[1] });
  }
  return profile;
}

export function sectionMetrics(section, level) {
  const profile = sectionProfile(section);
  let area = 0, wetWidth = 0, perimeter = 0;
  if (!Number.isFinite(level)) throw new Error('参考水位必须为有限数值');
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1], b = profile[i];
    const width = b.distance - a.distance;
    const da = level - a.elevation, db = level - b.elevation;
    if (da <= 0 && db <= 0) continue;
    const fraction = da >= 0 && db >= 0 ? 1 : Math.max(da, db) / Math.abs(db - da);
    wetWidth += width * fraction;
    area += da >= 0 && db >= 0 ? width * (da + db) / 2 : width * fraction * Math.max(da, db) / 2;
    perimeter += Math.hypot(width, b.elevation - a.elevation) * fraction;
  }
  return {
    profile, area, wetWidth, perimeter,
    hydraulicRadius: perimeter ? area / perimeter : 0,
    minElevation: profile.length ? Math.min(...profile.map(p => p.elevation)) : null,
    maxElevation: profile.length ? Math.max(...profile.map(p => p.elevation)) : null,
    measuredWidth: profile.at(-1)?.distance ?? 0,
    openBanks: !!profile.length && (level > profile[0].elevation || level > profile.at(-1).elevation),
  };
}

export function resampleSection(section, count = 64) {
  const profile = sectionProfile(section);
  if (profile.length < 2 || count < 2) return [];
  let cursor = 1;
  return Array.from({ length: count }, (_, i) => {
    if (i === 0) return [profile[0].x, profile[0].y, profile[0].elevation];
    if (i === count - 1) return [profile.at(-1).x, profile.at(-1).y, profile.at(-1).elevation];
    const d = profile.at(-1).distance * i / (count - 1);
    while (cursor < profile.length - 1 && (profile[cursor].distance < d || profile[cursor].distance === profile[cursor - 1].distance)) cursor++;
    const a = profile[cursor - 1], b = profile[cursor];
    const t = b.distance === a.distance ? 1 : (d - a.distance) / (b.distance - a.distance);
    return [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.elevation + (b.elevation - a.elevation) * t];
  });
}

export function corridorTriangles(sections, count = 64) {
  const rows = sections.map(s => resampleSection(s, count)).filter(row => row.length === count);
  // Align bank order for display; do not change the original source arrays.
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    const distance = (x, y) => Math.hypot(x[0] - y[0], x[1] - y[1]);
    if (distance(a[0], b[0]) + distance(a.at(-1), b.at(-1)) > distance(a[0], b.at(-1)) + distance(a.at(-1), b[0])) b.reverse();
  }
  const triangles = [];
  for (let i = 1; i < rows.length; i++) for (let j = 1; j < count; j++) {
    const a = rows[i - 1], b = rows[i];
    triangles.push([a[j - 1], a[j], b[j - 1]], [a[j], b[j], b[j - 1]]);
  }
  return triangles;
}

export function clipWetTriangle(triangle, level) {
  let polygon = [];
  for (let i = 0; i < triangle.length; i++) {
    const a = triangle[i], b = triangle[(i + 1) % triangle.length];
    const insideA = a[2] <= level, insideB = b[2] <= level;
    if (insideA) polygon.push([a[0], a[1], level]);
    if (insideA !== insideB) {
      const t = (level - a[2]) / (b[2] - a[2]);
      polygon.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, level]);
    }
  }
  const triangles = [];
  for (let i = 2; i < polygon.length; i++) triangles.push([polygon[0], polygon[i - 1], polygon[i]]);
  return triangles;
}

export function profileWaterPolygons(profile, level) {
  const polygons = [];
  for (let i = 1; i < profile.length; i++) {
    let a = profile[i - 1], b = profile[i];
    if (a.elevation >= level && b.elevation >= level) continue;
    if (a.elevation > level || b.elevation > level) {
      const t = (level - a.elevation) / (b.elevation - a.elevation);
      const cut = { distance: a.distance + (b.distance - a.distance) * t, elevation: level,
        x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (a.elevation > level) a = cut; else b = cut;
    }
    polygons.push([a, b, { ...b, elevation: level }, { ...a, elevation: level }]);
  }
  return polygons;
}
