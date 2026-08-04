/**
 * 尾焰、塵埃與火花。
 *
 * 效能預算（handoff §6）：additive blending 的圓錐 + 少量 sprite 粒子。
 * 粒子池固定 64 顆，不動態配置，AR 模式下要跟相機貼圖與 SLAM 搶 GPU。
 */

import * as THREE from 'three'
import { BODY_RADIUS } from '../sim/flight'
import { HEX } from '../theme'

const PLUME_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/**
 * vUv.y：0 = 噴嘴出口，1 = 尾端（幾何已翻轉，見 makePlume）。
 * 沿著長度做衰減，再疊一組 shock diamond。
 */
const PLUME_FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3 uCore;
  uniform vec3 uEdge;
  uniform float uIntensity;
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    float along = clamp(vUv.y, 0.0, 1.0);
    float body = pow(1.0 - along, 1.35);
    float diamonds = 0.5 + 0.5 * sin(along * 34.0 - uTime * 6.0);
    float core = smoothstep(0.55, 0.0, along);
    vec3 col = mix(uEdge, uCore, core * (0.65 + 0.35 * diamonds));
    float a = body * uIntensity * (0.55 + 0.45 * diamonds);
    if (a < 0.004) discard;
    gl_FragColor = vec4(col * (0.8 + 0.6 * core), a);
  }
`

export interface Plume {
  object: THREE.Group
  /** 0..1 */
  setIntensity(v: number): void
  update(t: number): void
}

function makePlumeCone(radius: number, length: number, core: number, edge: number): THREE.Mesh {
  const geo = new THREE.ConeGeometry(radius, length, 18, 1, true)
  geo.rotateX(Math.PI) // 尖端朝 -Y
  geo.translate(0, -length / 2, 0) // 底面貼在 y = 0
  const mat = new THREE.ShaderMaterial({
    vertexShader: PLUME_VERT,
    fragmentShader: PLUME_FRAG,
    uniforms: {
      uCore: { value: new THREE.Color(core) },
      uEdge: { value: new THREE.Color(edge) },
      uIntensity: { value: 0 },
      uTime: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  return mesh
}

/** radius/length 都是本體半徑的倍數。 */
export function makePlume(radiusScale: number, lengthScale: number): Plume {
  const R = BODY_RADIUS
  const outer = makePlumeCone(R * radiusScale, R * lengthScale, 0xffd9a0, HEX.plume)
  const inner = makePlumeCone(R * radiusScale * 0.45, R * lengthScale * 0.55, 0xffffff, 0xffc266)
  const group = new THREE.Group()
  group.add(outer, inner)

  let intensity = 0
  return {
    object: group,
    setIntensity(v: number) {
      intensity = Math.max(0, Math.min(1, v))
      group.visible = intensity > 0.002
    },
    update(t: number) {
      if (!group.visible) return
      // 燃燒不穩定的抖動：長度與亮度各自小幅浮動
      const flick = 1 + 0.07 * Math.sin(t * 37.1) + 0.05 * Math.sin(t * 61.7)
      group.scale.set(1, intensity * flick, 1)
      for (const m of [outer, inner]) {
        const u = (m.material as THREE.ShaderMaterial).uniforms
        u.uIntensity.value = intensity
        u.uTime.value = t
      }
    },
  }
}

/** 點火前 0.5 秒吹散的地面塵埃：一圈快速擴張的半透明環。 */
export function makeDustRing(): { object: THREE.Object3D; setProgress(p: number): void } {
  const geo = new THREE.RingGeometry(0.6, 1.0, 48)
  geo.rotateX(-Math.PI / 2)
  const mat = new THREE.MeshBasicMaterial({
    color: 0xb9a894,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.visible = false
  mesh.position.y = 0.004
  return {
    object: mesh,
    setProgress(p: number) {
      if (p < 0) {
        mesh.visible = false
        return
      }
      mesh.visible = true
      const k = Math.min(1, p)
      const s = BODY_RADIUS * (2.2 + 26 * k * k)
      mesh.scale.set(s, 1, s)
      mat.opacity = 0.5 * (1 - k) ** 1.4
    },
  }
}

function sparkTexture(): THREE.Texture {
  const size = 48
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.35, 'rgba(255,190,110,0.75)')
  grad.addColorStop(1, 'rgba(255,122,24,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

const PARTICLE_COUNT = 64

/** 引擎底部的火花／碎屑。位置由呼叫端每幀給定（跟著火箭走）。 */
export function makeSparks(): {
  object: THREE.Points
  emit(origin: THREE.Vector3, strength: number, dt: number): void
  update(dt: number): void
} {
  const positions = new Float32Array(PARTICLE_COUNT * 3)
  const alphas = new Float32Array(PARTICLE_COUNT)
  const vel = new Float32Array(PARTICLE_COUNT * 3)
  const life = new Float32Array(PARTICLE_COUNT)

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1))

  // PointsMaterial 沒有 per-particle alpha，用最小的自訂 shader 換取逐顆淡出
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: sparkTexture() },
      uColor: { value: new THREE.Color(HEX.plume) },
      uSize: { value: BODY_RADIUS * 0.55 },
    },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      uniform float uSize;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * 320.0 / max(0.05, -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision mediump float;
      uniform sampler2D uMap;
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        if (vAlpha <= 0.001) discard;
        vec4 tex = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(uColor * tex.rgb, tex.a * vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false

  let cursor = 0
  let carry = 0

  return {
    object: points,
    emit(origin: THREE.Vector3, strength: number, dt: number) {
      if (strength <= 0.01) return
      carry += strength * 90 * dt
      const n = Math.floor(carry)
      carry -= n
      for (let k = 0; k < n; k++) {
        const i = cursor
        cursor = (cursor + 1) % PARTICLE_COUNT
        positions[i * 3] = origin.x + (Math.random() - 0.5) * BODY_RADIUS
        positions[i * 3 + 1] = origin.y
        positions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * BODY_RADIUS
        const a = Math.random() * Math.PI * 2
        const sp = (0.25 + Math.random() * 0.7) * strength
        vel[i * 3] = Math.cos(a) * sp
        vel[i * 3 + 1] = -0.15 - Math.random() * 0.5
        vel[i * 3 + 2] = Math.sin(a) * sp
        life[i] = 0.35 + Math.random() * 0.4
        alphas[i] = 1
      }
    },
    update(dt: number) {
      let any = false
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        if (life[i] <= 0) {
          alphas[i] = 0
          continue
        }
        any = true
        life[i] -= dt
        positions[i * 3] += vel[i * 3] * dt
        positions[i * 3 + 1] += vel[i * 3 + 1] * dt
        positions[i * 3 + 2] += vel[i * 3 + 2] * dt
        // 撞到地面就沿著地面滑開
        if (positions[i * 3 + 1] < 0.002) {
          positions[i * 3 + 1] = 0.002
          vel[i * 3 + 1] = 0
          vel[i * 3] *= 0.94
          vel[i * 3 + 2] *= 0.94
        }
        alphas[i] = Math.max(0, life[i] / 0.7)
      }
      points.visible = any
      geo.attributes.position.needsUpdate = true
      geo.attributes.aAlpha.needsUpdate = true
    },
  }
}
