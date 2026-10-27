import * as THREE from 'three';
import { LAMP_HEIGHT_MM, LAMP_DEPTH_MM, SIGN_TRANSPARENT_BORDER_MM, SIGN_TRANSPARENT_SUPPORT_DEPTH_MM, SIGN_TEXT_OPAQUE_CLEARANCE_MM } from './rules.js';

// Decorative startup sample only. These are the public Archivo Black # outlines,
// with no printable geometry, mechanical details, or generation parameters.
const HASH_CONTOURS = [
  [[54.6,50.2],[63.9,50.2],[63.9,39.1],[52.6,39.1],[50,26.8],[60.6,26.8],[60.6,15.9],[47.2,15.9],[43.5,-1.1],[31.8,-1.1],[35.5,15.9],[24,15.9],[20.4,-1.1],[8.4,-1.1],[12,15.9],[2,15.9],[2,26.8],[14.6,26.8],[17.4,39.1],[6.6,39.1],[6.6,50.2],[19.6,50.2],[24,70],[36.2,70],[31.7,50.2],[42.8,50.2],[47.2,70],[59.2,70]],
  [[29.2,39],[26.5,26.7],[37.9,26.7],[40.8,39]],
];
const HASH_ADVANCE = 66;
const ROW_MIN_X = 2;
const ROW_MAX_X = HASH_ADVANCE * 3 + 63.9;
const GLYPH_MIN_Y = -1.1;
const GLYPH_MAX_Y = 70;

function polygonPath(points, path) {
  path.moveTo(...points[0]);
  for (const point of points.slice(1)) path.lineTo(...point);
  return path.closePath();
}

function roundedShape(points, radius) {
  const corners = points.map((point, index) => {
    const previous = points[(index + points.length - 1) % points.length];
    const next = points[(index + 1) % points.length];
    const beforeLength = Math.hypot(previous[0] - point[0], previous[1] - point[1]);
    const afterLength = Math.hypot(next[0] - point[0], next[1] - point[1]);
    const before = [(previous[0] - point[0]) / beforeLength, (previous[1] - point[1]) / beforeLength];
    const after = [(next[0] - point[0]) / afterLength, (next[1] - point[1]) / afterLength];
    const angle = Math.acos(THREE.MathUtils.clamp(before[0] * after[0] + before[1] * after[1], -1, 1));
    const trim = Math.min(radius / Math.tan(angle / 2), beforeLength / 3, afterLength / 3);
    const actualRadius = trim * Math.tan(angle / 2);
    const bisector = [before[0] + after[0], before[1] + after[1]];
    const distance = actualRadius / Math.sin(angle / 2) / Math.hypot(...bisector);
    const center = [point[0] + bisector[0] * distance, point[1] + bisector[1] * distance];
    const start = [point[0] + before[0] * trim, point[1] + before[1] * trim];
    const end = [point[0] + after[0] * trim, point[1] + after[1] * trim];
    const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0]);
    let endAngle = Math.atan2(end[1] - center[1], end[0] - center[0]);
    while (endAngle <= startAngle) endAngle += Math.PI * 2;
    return { center, start, end, startAngle, endAngle, radius: actualRadius };
  });
  const path = new THREE.Shape();
  path.moveTo(...corners.at(-1).end);
  for (const corner of corners) {
    path.lineTo(...corner.start);
    path.absarc(...corner.center, corner.radius, corner.startAngle, corner.endAngle, false);
  }
  return path.closePath();
}

// The decorative sign is convex. Intersecting its inward half planes keeps the
// illuminated rim inside the same silhouette, including its rounded corners.
function insetSilhouette(shape, distance) {
  const points = shape.getPoints(32).map(point => [point.x, point.y])
    .filter((point, index, all) => !index || Math.hypot(point[0] - all[index - 1][0], point[1] - all[index - 1][1]) > 1e-8);
  if (Math.hypot(points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1]) < 1e-8) points.pop();
  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);
  const orientation = Math.sign(area);
  let inset = points.slice();
  for (const [index, start] of points.entries()) {
    const end = points[(index + 1) % points.length];
    const dx = end[0] - start[0], dy = end[1] - start[1];
    const signedDistance = point => orientation * (dx * (point[1] - start[1]) - dy * (point[0] - start[0])) / Math.hypot(dx, dy) - distance;
    const clipped = [];
    for (const [pointIndex, point] of inset.entries()) {
      const next = inset[(pointIndex + 1) % inset.length];
      const a = signedDistance(point), b = signedDistance(next);
      if (a >= -1e-9) clipped.push(point);
      if ((a >= 0) !== (b >= 0)) {
        const fraction = a / (a - b);
        clipped.push([point[0] + (next[0] - point[0]) * fraction, point[1] + (next[1] - point[1]) * fraction]);
      }
    }
    inset = clipped;
  }
  return inset;
}

function rowContours(scale, centerX, centerY) {
  const midX = (ROW_MIN_X + ROW_MAX_X) / 2;
  const midY = (GLYPH_MIN_Y + GLYPH_MAX_Y) / 2;
  return Array.from({ length: 4 }, (_, index) => HASH_CONTOURS.map(contour => contour.map(([x, y]) => [
    centerX - (x + HASH_ADVANCE * index - midX) * scale,
    centerY + (y - midY) * scale,
  ])));
}

function rowShapes(contours) {
  return contours.map(([outer, hole]) => {
    const shape = polygonPath(outer, new THREE.Shape());
    shape.holes.push(polygonPath(hole, new THREE.Path()));
    return shape;
  });
}

function projectionBridges(contours, scale) {
  return contours.map(([, hole]) => {
    const minX = Math.min(...hole.map(point => point[0])), maxX = Math.max(...hole.map(point => point[0]));
    const top = Math.max(...hole.map(point => point[1]));
    const center = (minX + maxX) / 2;
    const halfWidth = Math.min(11.05 * scale, (maxX - minX) * .48) / 2;
    // A finite vertical slit joins the counter to the space above the upper bar.
    // The white front glyph remains the original, uninterrupted Archivo Black #.
    return [[center - halfWidth, top - scale], [center + halfWidth, top - scale],
      [center + halfWidth, top + 11.4 * scale], [center - halfWidth, top + 11.4 * scale]];
  });
}

function clipHalfPlane(polygon, axis, limit, lower) {
  const clipped = [], inside = point => lower ? point[axis] <= limit : point[axis] >= limit;
  for (let i = 0; i < polygon.length; i++) {
    const start = polygon[i], end = polygon[(i + 1) % polygon.length];
    const startInside = inside(start), endInside = inside(end);
    if (startInside) clipped.push(start);
    if (startInside !== endInside) {
      const fraction = (limit - start[axis]) / (end[axis] - start[axis]);
      clipped.push([start[0] + (end[0] - start[0]) * fraction, start[1] + (end[1] - start[1]) * fraction]);
    }
  }
  return clipped;
}

function stencilProjectionGeometry(shape, bridge) {
  const original = new THREE.ShapeGeometry(shape);
  const positions = original.getAttribute('position'), indices = original.index;
  const minX = Math.min(...bridge.map(point => point[0])), maxX = Math.max(...bridge.map(point => point[0]));
  const minY = Math.min(...bridge.map(point => point[1])), maxY = Math.max(...bridge.map(point => point[1]));
  const borders = [[0, minX, false], [0, maxX, true], [1, minY, false], [1, maxY, true]];
  const vertices = [];
  for (let i = 0; i < (indices?.count ?? positions.count); i += 3) {
    let remaining = [0, 1, 2].map(offset => {
      const index = indices ? indices.getX(i + offset) : i + offset;
      return [positions.getX(index), positions.getY(index)];
    });
    for (const [axis, limit, lower] of borders) {
      const outside = clipHalfPlane(remaining, axis, limit, !lower);
      for (let j = 1; j < outside.length - 1; j++) {
        for (const point of [outside[0], outside[j], outside[j + 1]]) vertices.push(point[0], point[1], 0);
      }
      remaining = clipHalfPlane(remaining, axis, limit, lower);
      if (remaining.length < 3) break;
    }
  }
  original.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return geometry;
}

function add(group, mesh, materialName, projection = false) {
  mesh.userData.startupDemo = true;
  mesh.userData.materialName = materialName;
  if (projection) mesh.userData.isProjection = true;
  group.add(mesh);
  return mesh;
}

function projectionGlow(group, contours, bridges, wallZ) {
  if (typeof document === 'undefined') return;
  const points = contours.flat(2);
  const padding = 12;
  const minX = Math.min(...points.map(point => point[0])) - padding;
  const maxX = Math.max(...points.map(point => point[0])) + padding;
  const minY = Math.min(...points.map(point => point[1])) - padding;
  const maxY = Math.max(...points.map(point => point[1])) + padding;
  const width = maxX - minX, height = maxY - minY;
  const pixels = Math.min(4, 1536 / Math.max(width, height));
  const mask = document.createElement('canvas');
  mask.width = Math.ceil(width * pixels); mask.height = Math.ceil(height * pixels);
  const context = mask.getContext('2d');
  if (!context) return;
  context.fillStyle = '#fff0dc'; context.beginPath();
  for (const contour of contours.flat()) {
    contour.forEach(([x, y], index) => context[index ? 'lineTo' : 'moveTo']((x - minX) * pixels, (maxY - y) * pixels));
    context.closePath();
  }
  context.fill('evenodd');
  context.globalCompositeOperation = 'destination-out'; context.beginPath();
  for (const bridge of bridges) {
    bridge.forEach(([x, y], index) => context[index ? 'lineTo' : 'moveTo']((x - minX) * pixels, (maxY - y) * pixels));
    context.closePath();
  }
  context.fill();
  const canvas = document.createElement('canvas');
  canvas.width = mask.width; canvas.height = mask.height;
  const glow = canvas.getContext('2d');
  glow.globalAlpha = 0.40; glow.filter = `blur(${8 * pixels}px)`; glow.drawImage(mask, 0, 0);
  glow.globalAlpha = 0.65; glow.filter = `blur(${3.5 * pixels}px)`; glow.drawImage(mask, 0, 0);
  glow.globalAlpha = 0.85; glow.filter = `blur(${1.2 * pixels}px)`; glow.drawImage(mask, 0, 0);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 1,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.position.set((minX + maxX) / 2, (minY + maxY) / 2, wallZ - .04);
  mesh.renderOrder = 0;
  add(group, mesh, 'transparent', true);
}

/** Add a disposable visual sample to an empty viewer group; never creates a CAD result. */
export function populateStartupDemo(group, { shape = 'arrow', direction = 'left', radius = 10, projections = true } = {}) {
  const width = 230, height = LAMP_HEIGHT_MM, depth = LAMP_DEPTH_MM;
  const arrow = shape === 'arrow';
  let outline = arrow
    ? [[-width / 2, -height / 2], [width / 2 - height / 2, -height / 2], [width / 2, 0], [width / 2 - height / 2, height / 2], [-width / 2, height / 2]]
    : [[-width / 2, -height / 2], [width / 2, -height / 2], [width / 2, height / 2], [-width / 2, height / 2]];
  // Front cameras look from -Z: screen-left is positive world X.
  if (arrow && direction === 'right') outline = outline.map(([x, y]) => [-x, y]).reverse();
  const chosenRadius = Number.isFinite(Number(radius)) ? Math.max(0, Math.min(10, Number(radius))) : 10;
  const silhouette = chosenRadius ? roundedShape(outline, chosenRadius) : polygonPath(outline, new THREE.Shape());
  const rimDepth = arrow ? SIGN_TRANSPARENT_SUPPORT_DEPTH_MM : 0;
  const inset = arrow ? insetSilhouette(silhouette, SIGN_TRANSPARENT_BORDER_MM) : null;
  const shell = new THREE.Mesh(new THREE.ExtrudeGeometry(silhouette, {
    depth: depth - rimDepth, bevelEnabled: false, curveSegments: 32, steps: 1,
  }), new THREE.MeshStandardMaterial({ color: 0xff318b, roughness: .58, metalness: 0, side: THREE.DoubleSide }));
  shell.position.z = rimDepth;
  shell.castShadow = true; shell.receiveShadow = true;
  add(group, shell, 'opaque');
  if (inset) {
    const innerFront = new THREE.Mesh(new THREE.ExtrudeGeometry(polygonPath(inset, new THREE.Shape()), {
      depth: rimDepth, bevelEnabled: false, curveSegments: 32, steps: 1,
    }), shell.material.clone());
    innerFront.castShadow = true; innerFront.receiveShadow = true;
    add(group, innerFront, 'opaque');
  }

  const centerX = arrow ? (direction === 'right' ? 1 : -1) * height / 4 : 0;
  const horizontalTextInset = arrow ? SIGN_TRANSPARENT_BORDER_MM + SIGN_TEXT_OPAQUE_CLEARANCE_MM : 8;
  const scale = Math.min((width - (arrow ? height / 2 : 0) - 2 * horizontalTextInset) / (ROW_MAX_X - ROW_MIN_X),
    (height - 16) / (GLYPH_MAX_Y - GLYPH_MIN_Y));
  const fontHeight = (GLYPH_MAX_Y - GLYPH_MIN_Y) * scale;
  const front = new THREE.Mesh(new THREE.ExtrudeGeometry(rowShapes(rowContours(scale, centerX, 0)), {
    depth: .3, bevelEnabled: false, curveSegments: 1, steps: 1,
  }), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .32, metalness: 0,
    emissive: 0xfff6ef, emissiveIntensity: .15, side: THREE.DoubleSide }));
  front.position.z = -.31; front.receiveShadow = true;
  add(group, front, 'transparent');
  if (inset) {
    const rimShape = silhouette.clone();
    rimShape.holes.push(polygonPath(inset.slice().reverse(), new THREE.Path()));
    const rim = new THREE.Mesh(new THREE.ExtrudeGeometry(rimShape, {
      depth: rimDepth + .01, bevelEnabled: false, curveSegments: 32, steps: 1,
    }), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .32, metalness: 0,
      emissive: 0xfff3e2, emissiveIntensity: .24, side: THREE.DoubleSide }));
    rim.position.z = -.01;
    rim.receiveShadow = true;
    rim.userData.isTransparentRim = true;
    rim.userData.borderWidthMm = SIGN_TRANSPARENT_BORDER_MM;
    rim.userData.supportDepthMm = rimDepth;
    add(group, rim, 'transparent');
  }

  if (projections) {
    for (const sign of [1, -1]) {
      const contours = rowContours(scale, centerX, sign * (height / 2 + 5 + fontHeight / 2));
      const bridges = projectionBridges(contours, scale);
      projectionGlow(group, contours, bridges, depth);
      for (const [index, projectedShape] of rowShapes(contours).entries()) {
        const mesh = new THREE.Mesh(stencilProjectionGeometry(projectedShape, bridges[index]), new THREE.MeshBasicMaterial({
          color: 0xfff3e2, side: THREE.DoubleSide, toneMapped: false,
          polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
        }));
        mesh.position.z = depth - .1; mesh.renderOrder = 1;
        add(group, mesh, 'transparent', true);
      }
    }
  }
  return { width, height, depth, wallZ: depth, center: [0, 0, depth / 2], fontHeight,
    transparentBorderMm: arrow ? SIGN_TRANSPARENT_BORDER_MM : 0, transparentSupportDepthMm: rimDepth };
}
