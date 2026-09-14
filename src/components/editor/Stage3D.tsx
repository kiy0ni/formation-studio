import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { samplePath } from '../../lib/geometry';
import { computeFrame, timeline } from '../../lib/model';
import type { Choreo, StageSettings } from '../../lib/types';
import { useEditor } from '../../store/editor';
import { Segmented } from '../common/ui';

type CamPreset = 'public' | 'top' | 'side' | 'back';

function floorTexture(stage: StageSettings): THREE.CanvasTexture {
  const ppm = 96;
  const c = document.createElement('canvas');
  c.width = Math.round(stage.width * ppm);
  c.height = Math.round(stage.depth * ppm);
  const g = c.getContext('2d')!;
  g.fillStyle = stage.floorColor;
  g.fillRect(0, 0, c.width, c.height);
  const X = (x: number) => (x + stage.width / 2) * ppm;
  const Y = (y: number) => (y + stage.depth / 2) * ppm;
  if (stage.showGrid && stage.gridStep > 0) {
    for (let x = -stage.width / 2; x <= stage.width / 2 + 1e-6; x += stage.gridStep) {
      const major = Math.abs(x - Math.round(x)) < 1e-6;
      g.strokeStyle = major ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)';
      g.lineWidth = major ? 2 : 1;
      g.beginPath();
      g.moveTo(X(x), 0);
      g.lineTo(X(x), c.height);
      g.stroke();
    }
    for (let y = -stage.depth / 2; y <= stage.depth / 2 + 1e-6; y += stage.gridStep) {
      const major = Math.abs(y - Math.round(y)) < 1e-6;
      g.strokeStyle = major ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)';
      g.lineWidth = major ? 2 : 1;
      g.beginPath();
      g.moveTo(0, Y(y));
      g.lineTo(c.width, Y(y));
      g.stroke();
    }
  }
  g.strokeStyle = 'rgba(255,77,141,0.55)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(X(0), 0);
  g.lineTo(X(0), c.height);
  g.stroke();
  if (stage.showNumbers) {
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.font = `bold ${ppm * 0.28}px system-ui, sans-serif`;
    g.textAlign = 'center';
    for (let k = -Math.floor(stage.width / 2); k <= Math.floor(stage.width / 2); k++) {
      g.fillText(String(Math.abs(k)), X(k), c.height - ppm * 0.15);
      g.fillRect(X(k) - 1.5, c.height - ppm * 0.08, 3, ppm * 0.08);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function labelSprite(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.font = 'bold 56px system-ui, sans-serif';
  const w = Math.min(500, g.measureText(text).width + 56);
  g.fillStyle = 'rgba(15,13,23,0.82)';
  g.beginPath();
  g.roundRect((512 - w) / 2, 24, w, 80, 40);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.stroke();
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(1.2, 0.3, 1);
  sprite.renderOrder = 10;
  return sprite;
}

interface DancerObj {
  group: THREE.Group;
  mat: THREE.MeshStandardMaterial;
  ring: THREE.Mesh;
  label: THREE.Sprite;
  key: string;
}

export default function Stage3D() {
  const mount = useRef<HTMLDivElement>(null);
  const [preset, setPreset] = useState<CamPreset>('public');
  const camApi = useRef<(p: CamPreset) => void>(() => {});

  useEffect(() => {
    const el = mount.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b0911');
    scene.fog = new THREE.Fog('#0b0911', 18, 45);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2 - 0.03;
    controls.minDistance = 2;
    controls.maxDistance = 60;

    scene.add(new THREE.HemisphereLight('#bcb4ff', '#1a1020', 0.9));
    const key = new THREE.DirectionalLight('#ffffff', 1.6);
    key.position.set(4, 10, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -12;
    key.shadow.camera.right = 12;
    key.shadow.camera.top = 12;
    key.shadow.camera.bottom = -12;
    scene.add(key);
    const spotA = new THREE.SpotLight('#ff4d8d', 40, 30, 0.5, 0.6);
    spotA.position.set(-6, 8, 6);
    const spotB = new THREE.SpotLight('#7c5cff', 40, 30, 0.5, 0.6);
    spotB.position.set(6, 8, 6);
    scene.add(spotA, spotB, spotA.target, spotB.target);

    const stageGroup = new THREE.Group();
    const dancerGroup = new THREE.Group();
    const propGroup = new THREE.Group();
    const pathGroup = new THREE.Group();
    scene.add(stageGroup, dancerGroup, propGroup, pathGroup);

    const bodyGeo = new THREE.CapsuleGeometry(0.2, 0.9, 6, 16);
    const headGeo = new THREE.SphereGeometry(0.16, 20, 16);
    const faceGeo = new THREE.BoxGeometry(0.16, 0.05, 0.06);
    const ringGeo = new THREE.RingGeometry(0.3, 0.36, 40);

    let stageKey = '';
    let pathKey = '';
    const dancers = new Map<string, DancerObj>();
    const props = new Map<string, { mesh: THREE.Mesh; shape: string; mat: THREE.MeshStandardMaterial }>();
    let currentStage: StageSettings | null = null;

    const disposeGroup = (g: THREE.Group) => {
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry && m.geometry !== bodyGeo && m.geometry !== headGeo && m.geometry !== faceGeo && m.geometry !== ringGeo) m.geometry.dispose();
        const mat = (m as any).material;
        if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((x: THREE.Material & { map?: THREE.Texture }) => (x.map?.dispose(), x.dispose()));
      });
      g.clear();
    };

    const buildStage = (stage: StageSettings) => {
      disposeGroup(stageGroup);
      currentStage = stage;
      const floor = new THREE.Mesh(new THREE.BoxGeometry(stage.width, 0.3, stage.depth), [
        new THREE.MeshStandardMaterial({ color: '#15121d' }),
        new THREE.MeshStandardMaterial({ color: '#15121d' }),
        new THREE.MeshStandardMaterial({ map: floorTexture(stage), roughness: 0.55, metalness: 0.1 }),
        new THREE.MeshStandardMaterial({ color: '#15121d' }),
        new THREE.MeshStandardMaterial({ color: '#241d33' }),
        new THREE.MeshStandardMaterial({ color: '#15121d' }),
      ]);
      floor.position.y = -0.15;
      floor.receiveShadow = true;
      stageGroup.add(floor);
      const wingMat = new THREE.MeshStandardMaterial({ color: '#100d17', roughness: 0.9 });
      const totalDepth = stage.depth + stage.backstageDepth;
      for (const side of [-1, 1]) {
        if (stage.wingWidth <= 0) break;
        const wing = new THREE.Mesh(new THREE.BoxGeometry(stage.wingWidth, 0.28, totalDepth), wingMat);
        wing.position.set(side * (stage.width / 2 + stage.wingWidth / 2), -0.16, -stage.backstageDepth / 2);
        wing.receiveShadow = true;
        stageGroup.add(wing);
        const curtain = new THREE.Mesh(new THREE.PlaneGeometry(0.05 + stage.wingWidth * 0.2, 4), new THREE.MeshStandardMaterial({ color: '#2a0f1e', side: THREE.DoubleSide }));
        curtain.position.set(side * (stage.width / 2 + 0.05), 2, stage.depth / 2 - 0.3);
        curtain.rotation.y = Math.PI / 2;
        stageGroup.add(curtain);
      }
      if (stage.backstageDepth > 0) {
        const back = new THREE.Mesh(new THREE.BoxGeometry(stage.width, 0.28, stage.backstageDepth), wingMat);
        back.position.set(0, -0.16, -stage.depth / 2 - stage.backstageDepth / 2);
        stageGroup.add(back);
      }
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(stage.width + stage.wingWidth * 2 + 4, 6), new THREE.MeshStandardMaterial({ color: '#130f1c' }));
      wall.position.set(0, 3, -stage.depth / 2 - stage.backstageDepth - 0.01);
      stageGroup.add(wall);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: '#08070c' }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.3;
      stageGroup.add(ground);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(stage.width, 0.02, 0.04), new THREE.MeshBasicMaterial({ color: '#ff4d8d' }));
      edge.position.set(0, 0.01, stage.depth / 2);
      stageGroup.add(edge);
      spotA.target.position.set(-1, 0, 0);
      spotB.target.position.set(1, 0, 0);
    };

    const setCamera = (p: CamPreset) => {
      const st = currentStage ?? useEditor.getState().doc!.stage;
      const span = Math.max(st.width, st.depth);
      const target = new THREE.Vector3(0, 0.8, 0);
      if (p === 'public') camera.position.set(0, span * 0.38 + 1.2, st.depth / 2 + span * 0.62);
      if (p === 'top') camera.position.set(0, span * 1.35, 0.01);
      if (p === 'side') camera.position.set(st.width / 2 + span * 0.8, span * 0.35 + 1, 0);
      if (p === 'back') camera.position.set(0, span * 0.38 + 1.2, -st.depth / 2 - span * 0.62);
      if (p === 'top') target.set(0, 0, 0);
      controls.target.copy(target);
      controls.update();
    };
    camApi.current = setCamera;

    const makeDancer = (color: string, name: string): DancerObj => {
      const group = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.05, transparent: true });
      const body = new THREE.Mesh(bodyGeo, mat);
      body.position.y = 0.65;
      body.castShadow = true;
      const head = new THREE.Mesh(headGeo, mat);
      head.position.y = 1.42;
      head.castShadow = true;
      const face = new THREE.Mesh(faceGeo, new THREE.MeshStandardMaterial({ color: '#111' }));
      face.position.set(0, 1.45, 0.14);
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide, transparent: true }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.015;
      ring.visible = false;
      const label = labelSprite(name, color);
      label.position.y = 1.95;
      group.add(body, head, face, ring, label);
      dancerGroup.add(group);
      return { group, mat, ring, label, key: `${color}|${name}` };
    };

    const sync = () => {
      const s = useEditor.getState();
      const doc = s.doc as Choreo | null;
      if (!doc) return;
      const sk = JSON.stringify(doc.stage);
      if (sk !== stageKey) {
        const first = !stageKey;
        stageKey = sk;
        buildStage(doc.stage);
        if (first) setCamera('public');
      }
      const frame = computeFrame(doc, s.time);
      const sel = new Set(s.selected);

      for (const [id, obj] of dancers)
        if (!doc.dancers[id]) {
          dancerGroup.remove(obj.group);
          obj.label.material.map?.dispose();
          obj.label.material.dispose();
          obj.mat.dispose();
          dancers.delete(id);
        }
      for (const d of Object.values(doc.dancers)) {
        let obj = dancers.get(d.id);
        const k = `${d.color}|${d.name}`;
        if (obj && obj.key !== k) {
          dancerGroup.remove(obj.group);
          obj.label.material.map?.dispose();
          obj.mat.dispose();
          obj = undefined;
        }
        if (!obj) {
          obj = makeDancer(d.color, d.name);
          dancers.set(d.id, obj);
        }
        const p = frame.dancers[d.id];
        if (p) obj.group.position.set(p.x, 0, p.y);
        obj.ring.visible = sel.has(d.id);
        const dim = s.focusDancer && s.focusDancer !== d.id;
        obj.mat.opacity = dim ? 0.25 : 1;
        obj.label.visible = s.showNames && !dim;
      }

      for (const [id, obj] of props)
        if (!doc.props[id]) {
          propGroup.remove(obj.mesh);
          obj.mat.dispose();
          props.delete(id);
        }
      for (const p of Object.values(doc.props)) {
        let obj = props.get(p.id);
        if (obj && obj.shape !== p.shape) {
          propGroup.remove(obj.mesh);
          obj = undefined;
        }
        if (!obj) {
          const mat = new THREE.MeshStandardMaterial({ color: '#888', roughness: 0.6, transparent: true });
          const geo = p.shape === 'rect' ? new THREE.BoxGeometry(1, 1, 1) : new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
          const mesh = new THREE.Mesh(geo, mat);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          propGroup.add(mesh);
          obj = { mesh, shape: p.shape, mat };
          props.set(p.id, obj);
        }
        const st = frame.props[p.id];
        obj.mesh.visible = !!st?.visible;
        if (st) {
          const height = 0.6;
          obj.mesh.scale.set(st.w, height, st.h);
          obj.mesh.position.set(st.x, height / 2, st.y);
          obj.mesh.rotation.y = (-st.rotation * Math.PI) / 180;
          obj.mat.color.set(st.color);
          obj.mat.emissive.set(p.id === s.selectedProp ? '#331122' : '#000000');
        }
      }

      const items = timeline(doc);
      const holding = frame.progress === 0;
      const from = holding ? items[frame.index - 1]?.f : items[frame.index]?.f;
      const to = holding ? items[frame.index]?.f : items[frame.index + 1]?.f;
      const pk = s.showPaths && !s.playing && from && to ? `${from.id}|${to.id}|${JSON.stringify([from.positions, to.positions])}|${s.focusDancer}` : '';
      if (pk !== pathKey) {
        pathKey = pk;
        disposeGroup(pathGroup);
        if (pk && from && to) {
          for (const d of Object.values(doc.dancers)) {
            const a = from.positions[d.id];
            const b = to.positions[d.id];
            if (!a || !b) continue;
            const pts = samplePath(a, b, b.path, 40).map((p) => new THREE.Vector3(p.x, 0.03, p.y));
            const line = new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(pts),
              new THREE.LineBasicMaterial({ color: d.color, transparent: true, opacity: s.focusDancer && s.focusDancer !== d.id ? 0.1 : 0.8 }),
            );
            pathGroup.add(line);
          }
        }
      }
    };

    let dirty = true;
    const unsub = useEditor.subscribe(() => (dirty = true));
    let raf = 0;
    const loop = () => {
      if (dirty) {
        dirty = false;
        sync();
      }
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    loop();

    return () => {
      cancelAnimationFrame(raf);
      unsub();
      ro.disconnect();
      controls.dispose();
      disposeGroup(stageGroup);
      disposeGroup(pathGroup);
      disposeGroup(dancerGroup);
      disposeGroup(propGroup);
      bodyGeo.dispose();
      headGeo.dispose();
      faceGeo.dispose();
      ringGeo.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div className="stage3d">
      <div ref={mount} className="stage3d-canvas" />
      <div className="stage-overlay top-right">
        <Segmented
          value={preset}
          onChange={(p) => {
            setPreset(p);
            camApi.current(p);
          }}
          options={[
            { value: 'public', label: 'Public' },
            { value: 'top', label: 'Dessus' },
            { value: 'side', label: 'Côté' },
            { value: 'back', label: 'Danseurs' },
          ]}
        />
      </div>
      <div className="stage-overlay bottom-left hint-chip hide-sm">Glisser pour tourner · clic droit pour déplacer · molette pour zoomer</div>
    </div>
  );
}
