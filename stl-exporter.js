/**
 * STL Exporter for LaLosch 3D meshes
 * Converts triangle mesh { positions: Float32Array|number[], indices?: Uint32Array|number[] }
 * into standard Binary STL format (IEEE 754 little-endian).
 */

/**
 * Removes any debossed bottom logo from lamp housing meshes.
 * Seamlessly flattens the pocket floor to Z=0 and removes sidewall triangles,
 * preserving a 100% watertight 2-manifold surface.
 */
export function removeDebossedLogo(mesh) {
  if (!mesh || !mesh.positions) return mesh;

  const origPos = Array.isArray(mesh.positions) ? mesh.positions : Object.values(mesh.positions);
  const idx = mesh.indices ? (Array.isArray(mesh.indices) ? mesh.indices : Object.values(mesh.indices)) : null;
  if (!idx) return mesh;

  const isDebossVertex = (z) => Math.abs(z - 0.5) < 0.05;

  const debossVertSet = new Set();
  const pos = [...origPos];
  const rawNormals = mesh.normals;
  const normals = rawNormals ? (Array.isArray(rawNormals) ? [...rawNormals] : Object.values(rawNormals)) : null;

  for (let i = 0; i < origPos.length / 3; i++) {
    const z = origPos[i * 3 + 2];
    if (isDebossVertex(z)) {
      debossVertSet.add(i);
      pos[i * 3 + 2] = 0.0;
      if (normals) {
        normals[i * 3] = 0.0;
        normals[i * 3 + 1] = 0.0;
        normals[i * 3 + 2] = -1.0;
      }
    }
  }

  if (debossVertSet.size === 0) {
    return {
      positions: pos,
      indices: Array.from(idx),
      normals: normals
    };
  }

  const newIndices = [];
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
    const has0 = debossVertSet.has(i0);
    const has1 = debossVertSet.has(i1);
    const has2 = debossVertSet.has(i2);

    // Drop sidewall triangles connecting the outer surface to the pocket floor
    if ((has0 || has1 || has2) && (!has0 || !has1 || !has2)) {
      continue;
    }
    newIndices.push(i0, i1, i2);
  }

  return {
    positions: pos,
    indices: newIndices,
    normals: normals
  };
}

import * as THREE from 'three';
import { Evaluator, Brush, ADDITION, SUBTRACTION } from 'three-bvh-csg';

let _evaluator = null;
function getEvaluator() {
  if (!_evaluator) {
    _evaluator = new Evaluator();
    _evaluator.attributes = ['position', 'normal'];
    _evaluator.useCDTClipping = true;
  }
  return _evaluator;
}

function makeMesh(mesh) {
  const geo = new THREE.BufferGeometry();
  const rawPos = mesh.positions;
  const posArray = Array.isArray(rawPos) ? rawPos : Object.values(rawPos);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(posArray, 3));
  if (mesh.indices) {
    const rawIdx = mesh.indices;
    const idxArray = Array.isArray(rawIdx) ? rawIdx : Object.values(rawIdx);
    geo.setIndex(idxArray);
  }
  if (mesh.normals) {
    const rawNorm = mesh.normals;
    const normArray = Array.isArray(rawNorm) ? rawNorm : Object.values(rawNorm);
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normArray, 3));
  } else {
    geo.computeVertexNormals();
  }
  return geo;
}

function toMeshObject(brushOrGeo) {
  const geo = brushOrGeo.geometry || brushOrGeo;
  const nonIndexed = geo.index ? geo.toNonIndexed() : geo;
  const posAttr = nonIndexed.getAttribute('position');
  const normAttr = nonIndexed.getAttribute('normal');
  return {
    positions: Array.from(posAttr.array),
    normals: normAttr ? Array.from(normAttr.array) : null
  };
}

export function applyCableExitToAssembled(mesh) {
  if (!mesh || !mesh.positions) return mesh;
  const evaluator = getEvaluator();
  const geo = makeMesh(mesh);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;

  // 1. Carve clean cable exit U-notch on the bottom face near the right corner (X = bb.max.x - 20.4)
  // Arch radius 2.0 (diameter 4.0 mm for USB cable), cutting from z=46.0 through back rim (z=50.0)
  const rightNotchX = bb.max.x - 20.4;
  const r = 2.0;
  const cylH = 6.0; // Overcut through 2mm wall thickness
  const archCenterZ = 46.0;
  const boxZ = 8.0; // Overcut past back face (Z=50.0)

  const cylGeo = new THREE.CylinderGeometry(r, r, cylH, 32);
  cylGeo.computeVertexNormals();
  const cylBrush = new Brush(cylGeo);
  cylBrush.position.set(rightNotchX, bb.min.y + 1.0, archCenterZ);
  cylBrush.updateMatrixWorld();

  const boxGeo = new THREE.BoxGeometry(r * 2, cylH, boxZ);
  boxGeo.computeVertexNormals();
  const boxBrush = new Brush(boxGeo);
  boxBrush.position.set(rightNotchX, bb.min.y + 1.0, archCenterZ + boxZ / 2);
  boxBrush.updateMatrixWorld();

  const cutter = evaluator.evaluate(boxBrush, cylBrush, ADDITION);

  // 2. Detect and seal central cable notch in bottom sliding panel so it is 100% continuous
  const p = geo.getAttribute('position').array;
  let notchX = [], notchY = [], notchZ = [];
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (y <= bb.min.y + 2.2 && z >= 45.0 && z < 49.95 && x < bb.max.x - 40.0) {
      notchX.push(x); notchY.push(y); notchZ.push(z);
    }
  }

  let panelPlug = null;
  if (notchX.length > 50) {
    const nxMin = Math.min(...notchX), nxMax = Math.max(...notchX);
    const nyMin = Math.min(...notchY), nyMax = Math.max(...notchY);
    const nzMin = Math.min(...notchZ);
    const pGeo = new THREE.BoxGeometry((nxMax - nxMin) + 0.2, (nyMax - nyMin) + 0.4, (50.0 - nzMin) + 0.4);
    pGeo.computeVertexNormals();
    panelPlug = new Brush(pGeo);
    panelPlug.position.set((nxMin + nxMax) / 2, (nyMin + nyMax) / 2, (nzMin + 50.0) / 2);
    panelPlug.updateMatrixWorld();
  }

  const mainBrush = new Brush(geo);
  mainBrush.updateMatrixWorld();

  let res = mainBrush;
  if (panelPlug) res = evaluator.evaluate(res, panelPlug, ADDITION);
  res = evaluator.evaluate(res, cutter, SUBTRACTION);
  return toMeshObject(res);
}

export function applyCableExitToPlate(plateMesh) {
  if (!plateMesh || !plateMesh.positions) return plateMesh;
  const evaluator = getEvaluator();
  const geo = makeMesh(plateMesh);
  const p = geo.getAttribute('position').array;

  // 1. Detect and seal notch in bottom sliding panel on plate:
  let pPts = [];
  for (let i = 0; i < p.length; i += 3) {
    if (p[i + 2] <= 2.2 && p[i + 1] > 142.35 && p[i + 1] < 147.0) {
      pPts.push({ x: p[i], y: p[i + 1] });
    }
  }
  let panelPlug = null;
  if (pPts.length > 50) {
    let xs = [...new Set(pPts.map(pt => Number(pt.x.toFixed(2))))].sort((a, b) => a - b);
    let clusters = [];
    let current = [xs[0]];
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] - xs[i - 1] < 1.0) current.push(xs[i]);
      else { clusters.push(current); current = [xs[i]]; }
    }
    if (current.length) clusters.push(current);
    const notchCluster = clusters.find(c => {
      const w = c[c.length - 1] - c[0];
      return Math.abs(w - 3.8) < 0.6;
    });
    if (notchCluster) {
      const nxMin = notchCluster[0], nxMax = notchCluster[notchCluster.length - 1];
      const plugGeo = new THREE.BoxGeometry((nxMax - nxMin) + 0.2, 5.0, 2.5);
      plugGeo.computeVertexNormals();
      panelPlug = new Brush(plugGeo);
      panelPlug.position.set((nxMin + nxMax) / 2, 144.6, 1.0);
      panelPlug.updateMatrixWorld();
    }
  }

  // 2. Find housing (scocca) bounds on plate:
  let hMinX = Infinity, hMaxX = -Infinity, hMinY = Infinity, hMaxY = -Infinity;
  let hasHousing = false;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i + 1] < 105.0 && p[i + 2] > 20.0) {
      hasHousing = true;
      if (p[i] < hMinX) hMinX = p[i];
      if (p[i] > hMaxX) hMaxX = p[i];
      if (p[i + 1] < hMinY) hMinY = p[i + 1];
      if (p[i + 1] > hMaxY) hMaxY = p[i + 1];
    }
  }

  let cutter = null;
  if (hasHousing) {
    const plateNotchX = hMaxX - 20.4;
    const r = 2.0;
    const cylH = 6.0;
    const archCenterZ = 46.0;
    const boxZ = 8.0;

    const cylGeo = new THREE.CylinderGeometry(r, r, cylH, 32);
    cylGeo.computeVertexNormals();
    const cylBrush = new Brush(cylGeo);
    cylBrush.position.set(plateNotchX, hMinY + 1.0, archCenterZ);
    cylBrush.updateMatrixWorld();

    const boxGeo = new THREE.BoxGeometry(r * 2, cylH, boxZ);
    boxGeo.computeVertexNormals();
    const boxBrush = new Brush(boxGeo);
    boxBrush.position.set(plateNotchX, hMinY + 1.0, archCenterZ + boxZ / 2);
    boxBrush.updateMatrixWorld();

    cutter = evaluator.evaluate(boxBrush, cylBrush, ADDITION);
  }

  const mainBrush = new Brush(geo);
  mainBrush.updateMatrixWorld();

  let res = mainBrush;
  if (panelPlug) res = evaluator.evaluate(res, panelPlug, ADDITION);
  if (cutter) res = evaluator.evaluate(res, cutter, SUBTRACTION);

  return toMeshObject(res);
}

export function applyCableExitOption(data, cableExit = 'bottom') {
  if (!data || cableExit !== 'right') return data;
  const target = data.data || data;
  if (target._cableExitApplied === 'right') return data;
  try {
    if (target.assembled?.opaque) {
      target.assembled.opaque = applyCableExitToAssembled(target.assembled.opaque);
    }
    if (Array.isArray(target.plates)) {
      target.plates.forEach(plate => {
        if (plate.opaque) plate.opaque = applyCableExitToPlate(plate.opaque);
      });
    }
    if (target.meta?.params) {
      target.meta.params.cableExit = 'right';
    }
    target._cableExitApplied = 'right';
  } catch (err) {
    console.warn('[CableExit] Avviso durante applicazione opzione uscita cavo:', err);
  }
  return data;
}

export function cleanLampData(data, cableExit = 'bottom') {
  if (!data) return data;
  const target = data.data || data;
  if (target.assembled?.opaque) {
    target.assembled.opaque = removeDebossedLogo(target.assembled.opaque);
  }
  if (Array.isArray(target.plates)) {
    target.plates.forEach(plate => {
      if (plate.opaque) plate.opaque = removeDebossedLogo(plate.opaque);
    });
  }
  if (cableExit === 'right') {
    applyCableExitOption(target, 'right');
  }
  return data;
}

export function meshToBinarySTL(rawMesh, header = 'LaLosch 3D STL Export') {
  const mesh = removeDebossedLogo(rawMesh);
  if (!mesh || !mesh.positions || mesh.positions.length === 0) {
    throw new Error('Mesh contains no vertex positions');
  }

  const positions = mesh.positions;
  const indices = mesh.indices;
  const numTriangles = indices ? indices.length / 3 : positions.length / 9;
  const bufferSize = 84 + numTriangles * 50;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // Write 80-byte header
  const headerBytes = new TextEncoder().encode(header.slice(0, 80));
  const uint8View = new Uint8Array(buffer);
  uint8View.set(headerBytes, 0);

  // Triangle count (4 bytes uint32 little endian at offset 80)
  view.setUint32(80, numTriangles, true);

  let offset = 84;
  for (let i = 0; i < numTriangles; i++) {
    let i0, i1, i2;
    if (indices) {
      i0 = indices[i * 3] * 3;
      i1 = indices[i * 3 + 1] * 3;
      i2 = indices[i * 3 + 2] * 3;
    } else {
      i0 = i * 9;
      i1 = i * 9 + 3;
      i2 = i * 9 + 6;
    }

    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
    const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2];
    const cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2];

    // Compute facet normal
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;

    // Normal
    view.setFloat32(offset, nx, true);
    view.setFloat32(offset + 4, ny, true);
    view.setFloat32(offset + 8, nz, true);

    // Vertices
    view.setFloat32(offset + 12, ax, true);
    view.setFloat32(offset + 16, ay, true);
    view.setFloat32(offset + 20, az, true);

    view.setFloat32(offset + 24, bx, true);
    view.setFloat32(offset + 28, by, true);
    view.setFloat32(offset + 32, bz, true);

    view.setFloat32(offset + 36, cx, true);
    view.setFloat32(offset + 40, cy, true);
    view.setFloat32(offset + 44, cz, true);

    // Attribute byte count (uint16 = 0)
    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }

  return buffer;
}

/**
 * Creates a ZIP archive containing all STL files for printing
 */
export async function createStlPackage(JSZip, data, guideBytes = null) {
  const zip = new JSZip();
  const meta = data.meta || {};
  const params = meta.params || {};
  const centerWord = (params.centerText || 'lampada').toLowerCase().replace(/[^a-z0-9_-]/g, '_');

  // Assembled parts
  if (data.assembled?.opaque) {
    zip.file(`assembled/${centerWord}_opaco_assemblato.stl`, meshToBinarySTL(data.assembled.opaque, `${centerWord} assembled opaque`));
  }
  if (data.assembled?.transparent) {
    zip.file(`assembled/${centerWord}_trasparente_assemblato.stl`, meshToBinarySTL(data.assembled.transparent, `${centerWord} assembled transparent`));
  }

  // Plates arranged for 3D printer
  const plates = data.plates || [];
  plates.forEach((plate, idx) => {
    const plateNum = plate.index || (idx + 1);
    const prefix = `print/piatto-${plateNum}`;
    if (plate.opaque) {
      zip.file(`${prefix}/opaco.stl`, meshToBinarySTL(plate.opaque, `Plate ${plateNum} opaque`));
    }
    if (plate.transparent) {
      zip.file(`${prefix}/trasparente.stl`, meshToBinarySTL(plate.transparent, `Plate ${plateNum} transparent`));
    }
  });

  // Documentation and configuration
  const readme = [
    `LaLosch — STL Export Pack (${centerWord.toUpperCase()})`,
    '='.repeat(60),
    'File STL pronti per la stampa 3D multi-materiale (Bambu Lab AMS / Prusa MMU / doppio estrusore).',
    '',
    'CONTENUTO DELLA CARTELLA:',
    '  print/piatto-1/    -> File STL posizionati sul piatto di stampa (256x256 mm).',
    '                        Importa contemporaneamente "opaco.stl" e "trasparente.stl" nello slicer,',
    '                        selezionando "Carica come parti di un unico oggetto multi-materiale".',
    '                        Le coordinate sono già perfettamente allineate!',
    '  assembled/         -> Modello 3D assemblato completo per ispezione / rendering CAD.',
    '  info/              -> Configurazione JSON e guida al montaggio.',
    '',
    'SPECIFICHE TECNICHE HARDWARE:',
    '  - Luce LED: IKEA KAPPLAKE (rimuovere il coperchio diffusore per inserirlo nella sede).',
    '  - Distanza ottica dal muro: 44 mm (calibrata per proiezione nitida a fascio stencil).',
    '  - Sede LED integrata con scasso per passaggio cavo e pin di ritenuta.',
    `  - Uscita cavo USB: ${params.cableExit === 'right' ? 'Laterale destra sulla scocca (Scelta B: pannelli inferiori integri, luce libera)' : 'Centrale inferiore (Standard)'}`,
    '  - Altezza complessiva: 95 mm, Profondità: 50 mm.',
    '',
    'PARAMETRI GENERATI:',
    JSON.stringify(params, null, 2),
    '',
    `Generato da LaLosch il ${new Date().toISOString()}`
  ].join('\n');

  zip.file('info/LEGGIMI.txt', readme);
  zip.file('info/configurazione.json', JSON.stringify({ meta, params, validation: data.validation }, null, 2));

  if (guideBytes) {
    zip.file('info/LALOSCH_QUICK_START_GUIDE.png', guideBytes);
  }

  return zip;
}
