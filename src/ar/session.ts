/**
 * WebXR session、hit-test 與螢幕恆亮。
 *
 * 注意：渲染迴圈一律用 renderer.setAnimationLoop()。three 在 XR session
 * 進行中會自動改用 XRSession.requestAnimationFrame——window 的 rAF 在
 * 背景分頁會停掉（handoff §7）。
 */

import * as THREE from 'three'

export interface Capabilities {
  /** 瀏覽器有 navigator.xr */
  hasWebXR: boolean
  /** immersive-ar 可用 */
  arSupported: boolean
  /** 非 secure context——WebXR 根本不會啟動 */
  insecureContext: boolean
  /** 大致判斷是不是 iOS，用來給出正確的說明文字 */
  isIOS: boolean
}

export async function detectCapabilities(): Promise<Capabilities> {
  const ua = navigator.userAgent
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const insecureContext = !window.isSecureContext
  const hasWebXR = 'xr' in navigator && !!navigator.xr

  let arSupported = false
  if (hasWebXR && !insecureContext) {
    try {
      arSupported = (await navigator.xr!.isSessionSupported('immersive-ar')) ?? false
    } catch {
      arSupported = false
    }
  }
  return { hasWebXR, arSupported, insecureContext, isIOS }
}

export interface ArHooks {
  /** hit-test 有命中時，每幀給一次姿態矩陣 */
  onReticle(matrix: THREE.Matrix4 | null): void
  /** 使用者在 AR 裡點擊 */
  onSelect(): void
  onEnd(): void
}

export class ArSession {
  private session: XRSession | null = null
  private hitTestSource: XRHitTestSource | null = null
  private viewerSpace: XRReferenceSpace | null = null
  private wakeLock: WakeLockSentinel | null = null
  private readonly renderer: THREE.WebGLRenderer
  private readonly hooks: ArHooks

  constructor(renderer: THREE.WebGLRenderer, hooks: ArHooks) {
    this.renderer = renderer
    this.hooks = hooks
  }

  get active(): boolean {
    return this.session !== null
  }

  async start(domOverlayRoot: HTMLElement): Promise<void> {
    if (!navigator.xr) throw new Error('WebXR 不可用')

    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test', 'local'],
      optionalFeatures: ['dom-overlay', 'local-floor', 'light-estimation'],
      domOverlay: { root: domOverlayRoot },
    })
    this.session = session

    this.renderer.xr.enabled = true
    await this.renderer.xr.setSession(session)

    this.viewerSpace = await session.requestReferenceSpace('viewer')
    this.hitTestSource = (await session.requestHitTestSource?.({ space: this.viewerSpace })) ?? null

    session.addEventListener('select', this.hooks.onSelect)
    session.addEventListener('end', this.handleEnd)

    void this.requestWakeLock()
    document.addEventListener('visibilitychange', this.handleVisibility)
  }

  /** 每幀從 XRFrame 取 hit-test 結果。 */
  updateHitTest(frame: XRFrame | null): void {
    if (!frame || !this.hitTestSource) return
    const refSpace = this.renderer.xr.getReferenceSpace()
    if (!refSpace) return
    const results = frame.getHitTestResults(this.hitTestSource)
    if (results.length === 0) {
      this.hooks.onReticle(null)
      return
    }
    const pose = results[0].getPose(refSpace)
    if (!pose) {
      this.hooks.onReticle(null)
      return
    }
    this.hooks.onReticle(new THREE.Matrix4().fromArray(pose.transform.matrix))
  }

  async end(): Promise<void> {
    await this.session?.end().catch(() => undefined)
  }

  private handleEnd = (): void => {
    this.session?.removeEventListener('select', this.hooks.onSelect)
    this.session?.removeEventListener('end', this.handleEnd)
    document.removeEventListener('visibilitychange', this.handleVisibility)
    this.hitTestSource?.cancel?.()
    this.hitTestSource = null
    this.viewerSpace = null
    this.session = null
    this.renderer.xr.enabled = false
    void this.releaseWakeLock()
    this.hooks.onEnd()
  }

  private handleVisibility = (): void => {
    // wake lock 在分頁隱藏時會被系統釋放，回來要重新要一次
    if (document.visibilityState === 'visible' && this.session) void this.requestWakeLock()
  }

  private async requestWakeLock(): Promise<void> {
    try {
      this.wakeLock = (await navigator.wakeLock?.request('screen')) ?? null
    } catch {
      this.wakeLock = null // 使用者拒絕或系統不支援，不是致命錯誤
    }
  }

  private async releaseWakeLock(): Promise<void> {
    try {
      await this.wakeLock?.release()
    } catch {
      /* ignore */
    }
    this.wakeLock = null
  }
}
