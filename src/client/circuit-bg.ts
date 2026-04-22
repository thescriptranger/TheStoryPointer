/**
 * Animated circuit background.
 *
 * Jittered grid of nodes connected by PCB-style right-angle traces.
 * Packets of light travel between nodes; arrival at a node flashes it.
 * Nodes also twinkle ambiently so the field always shows signs of life.
 * Respects prefers-reduced-motion (stops the pulses but keeps the static grid)
 * and pauses when the tab is hidden.
 *
 * Writes diagnostic logs under the prefix "[circuit-bg]" so a stuck install
 * can be diagnosed from the browser console.
 */

interface Point {
  x: number;
  y: number;
}

interface Edge {
  a: number;
  b: number;
  path: Point[];
  length: number;
  seglens: number[];
}

interface Pulse {
  edgeIdx: number;
  progress: number;
  speed: number;
  forward: boolean;
  tone: 'teal' | 'blue';
  trailLen: number;
  endNode: number;
  notifiedEnd: boolean;
}

interface Flash {
  node: number;
  age: number;
  speed: number;
  tone: 'teal' | 'blue';
  size: number;
}

const NODE_SPACING_X = 115;
const NODE_SPACING_Y = 85;
const JITTER = 0.3;
const MAX_PULSES = 130;
const SPAWN_CHANCE = 0.5;
const AMBIENT_TWINKLE_CHANCE = 0.06;
const FLASH_DECAY = 0.035;

const TONE_TEAL = { rgb: '78, 240, 199' };
const TONE_BLUE = { rgb: '90, 170, 255' };

class Circuit {
  private ctx: CanvasRenderingContext2D;
  public width = 0;
  public height = 0;
  private dpr = 1;
  public nodes: Point[] = [];
  public edges: Edge[] = [];
  public pulses: Pulse[] = [];
  public flashes: Flash[] = [];
  private rafId = 0;
  private paused = false;
  private reducedMotion = false;
  private firstTickLogged = false;
  private spawnCounter = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.resize();
    this.build();
    console.log(
      `[circuit-bg] built ${this.nodes.length} nodes, ${this.edges.length} edges (${this.width}x${this.height} @ dpr=${this.dpr})`
    );

    // Startup burst so motion is visible immediately.
    for (let i = 0; i < 12; i++) this.spawn();

    window.addEventListener('resize', this.onResize, { passive: true });
    document.addEventListener('visibilitychange', this.onVisibility);
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    mq.addEventListener?.('change', (e) => {
      this.reducedMotion = e.matches;
      console.log('[circuit-bg] reduced-motion →', this.reducedMotion);
      if (!this.reducedMotion) this.rafId = requestAnimationFrame(this.tick);
      else {
        cancelAnimationFrame(this.rafId);
        this.drawStaticOnly();
      }
    });

    if (this.reducedMotion) {
      console.log('[circuit-bg] reduced-motion active — drawing static grid only');
      this.drawStaticOnly();
    } else {
      this.rafId = requestAnimationFrame(this.tick);
    }
  }

  destroy() {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private onResize = () => {
    this.resize();
    this.build();
    if (this.reducedMotion) this.drawStaticOnly();
  };

  private onVisibility = () => {
    this.paused = document.hidden;
    if (!this.paused && !this.reducedMotion) {
      this.rafId = requestAnimationFrame(this.tick);
    }
  };

  private resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private build() {
    this.nodes = [];
    this.edges = [];
    this.pulses = [];
    this.flashes = [];

    const pad = Math.max(NODE_SPACING_X, NODE_SPACING_Y);
    const indexByGrid = new Map<string, number>();

    let gyRow = -1;
    for (let y = -pad; y < this.height + pad; y += NODE_SPACING_Y, gyRow++) {
      let gx = -1;
      for (let x = -pad; x < this.width + pad; x += NODE_SPACING_X, gx++) {
        const jx = x + (Math.random() - 0.5) * NODE_SPACING_X * JITTER;
        const jy = y + (Math.random() - 0.5) * NODE_SPACING_Y * JITTER;
        this.nodes.push({ x: jx, y: jy });
        indexByGrid.set(`${gx},${gyRow}`, this.nodes.length - 1);
      }
    }

    const seen = new Set<string>();
    gyRow = -1;
    for (let y = -pad; y < this.height + pad; y += NODE_SPACING_Y, gyRow++) {
      let gx = -1;
      for (let x = -pad; x < this.width + pad; x += NODE_SPACING_X, gx++) {
        const idx = indexByGrid.get(`${gx},${gyRow}`);
        if (idx === undefined) continue;
        const me = this.nodes[idx];

        const rightIdx = indexByGrid.get(`${gx + 1},${gyRow}`);
        if (rightIdx !== undefined && Math.random() < 0.82) {
          this.addEdge(seen, idx, rightIdx, me, this.nodes[rightIdx]);
        }
        const downIdx = indexByGrid.get(`${gx},${gyRow + 1}`);
        if (downIdx !== undefined && Math.random() < 0.82) {
          this.addEdge(seen, idx, downIdx, me, this.nodes[downIdx]);
        }
        const diagIdx = indexByGrid.get(`${gx + 1},${gyRow + 1}`);
        if (diagIdx !== undefined && Math.random() < 0.15) {
          this.addEdge(seen, idx, diagIdx, me, this.nodes[diagIdx]);
        }
      }
    }
  }

  private addEdge(
    seen: Set<string>,
    i: number,
    j: number,
    a: Point,
    b: Point
  ) {
    const key = i < j ? `${i}-${j}` : `${j}-${i}`;
    if (seen.has(key)) return;
    seen.add(key);
    const path = pcbPath(a, b);
    const { total, seglens } = pathLengths(path);
    if (total < 4) return;
    this.edges.push({ a: i, b: j, path, length: total, seglens });
  }

  private spawn() {
    if (this.edges.length === 0) return;
    const edgeIdx = Math.floor(Math.random() * this.edges.length);
    const edge = this.edges[edgeIdx];
    const forward = Math.random() < 0.5;
    const speed = 0.005 + Math.random() * 0.008;
    this.pulses.push({
      edgeIdx,
      progress: 0,
      speed,
      forward,
      tone: Math.random() < 0.75 ? 'teal' : 'blue',
      trailLen: 0.12 + Math.random() * 0.22,
      endNode: forward ? edge.b : edge.a,
      notifiedEnd: false,
    });
    this.spawnCounter++;
  }

  private spawnAmbientTwinkle() {
    if (this.nodes.length === 0) return;
    const nodeIdx = Math.floor(Math.random() * this.nodes.length);
    this.flashes.push({
      node: nodeIdx,
      age: 0,
      speed: FLASH_DECAY * 1.6,
      tone: Math.random() < 0.85 ? 'teal' : 'blue',
      size: 1,
    });
  }

  private drawBackdrop() {
    const ctx = this.ctx;

    // Static traces
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(120, 180, 230, 0.18)';
    ctx.beginPath();
    for (const e of this.edges) {
      const p = e.path;
      ctx.moveTo(p[0].x, p[0].y);
      for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
    }
    ctx.stroke();

    // Solder-joint node dots
    ctx.fillStyle = 'rgba(130, 190, 235, 0.36)';
    for (const n of this.nodes) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawStaticOnly() {
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.drawBackdrop();
  }

  private tick = () => {
    if (this.paused || this.reducedMotion) return;
    if (!this.firstTickLogged) {
      console.log('[circuit-bg] first tick fired');
      this.firstTickLogged = true;
    }
    const ctx = this.ctx;

    ctx.clearRect(0, 0, this.width, this.height);
    this.drawBackdrop();

    // Spawn new pulses
    if (this.pulses.length < MAX_PULSES && Math.random() < SPAWN_CHANCE) {
      this.spawn();
      if (Math.random() < 0.3) this.spawn();
    }

    // Ambient twinkle — always something happening on the grid
    if (Math.random() < AMBIENT_TWINKLE_CHANCE) {
      this.spawnAmbientTwinkle();
    }

    // Advance and render pulses
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const pulse = this.pulses[i];
      pulse.progress += pulse.speed;

      const edge = this.edges[pulse.edgeIdx];
      const headT = pulse.forward ? pulse.progress : 1 - pulse.progress;
      const clamped = Math.max(0, Math.min(1, pulse.progress));
      const tailProg = Math.max(0, clamped - pulse.trailLen);
      const tailT = pulse.forward ? tailProg : 1 - tailProg;
      const tone = pulse.tone === 'teal' ? TONE_TEAL : TONE_BLUE;

      drawTrail(ctx, edge, tailT, headT, tone);

      const head = positionAlongPath(
        edge.path,
        edge.seglens,
        edge.length,
        Math.max(0, Math.min(1, headT))
      );
      ctx.save();
      ctx.shadowColor = `rgba(${tone.rgb}, 0.62)`;
      ctx.shadowBlur = 14;
      ctx.fillStyle = `rgba(${tone.rgb}, 0.65)`;
      ctx.beginPath();
      ctx.arc(head.x, head.y, 2.8, 0, Math.PI * 2);
      ctx.fill();
      // Inner core
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.beginPath();
      ctx.arc(head.x, head.y, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      if (pulse.progress >= 1) {
        if (!pulse.notifiedEnd) {
          this.flashes.push({
            node: pulse.endNode,
            age: 0,
            speed: FLASH_DECAY,
            tone: pulse.tone,
            size: 1.6,
          });
          pulse.notifiedEnd = true;
        }
        this.pulses.splice(i, 1);
      }
    }

    // Render flashes
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.age += f.speed;
      if (f.age >= 1) {
        this.flashes.splice(i, 1);
        continue;
      }
      const node = this.nodes[f.node];
      const tone = f.tone === 'teal' ? TONE_TEAL : TONE_BLUE;
      const alpha = 1 - f.age;
      const radius = 2 + (1 - alpha) * 18 * f.size;

      ctx.save();
      const g = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, radius);
      g.addColorStop(0, `rgba(${tone.rgb}, ${alpha * 0.5})`);
      g.addColorStop(1, `rgba(${tone.rgb}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fill();

      if (alpha > 0.5) {
        ctx.fillStyle = `rgba(${tone.rgb}, ${(alpha - 0.5) * 1.3})`;
        ctx.beginPath();
        ctx.arc(node.x, node.y, 2.4 * f.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    this.rafId = requestAnimationFrame(this.tick);
  };
}

function pcbPath(a: Point, b: Point): Point[] {
  if (Math.random() < 0.5) {
    return [a, { x: b.x, y: a.y }, b];
  }
  return [a, { x: a.x, y: b.y }, b];
}

function pathLengths(path: Point[]): { total: number; seglens: number[] } {
  const seglens: number[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const d = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    seglens.push(d);
    total += d;
  }
  return { total, seglens };
}

function positionAlongPath(
  path: Point[],
  seglens: number[],
  total: number,
  t: number
): Point {
  let target = t * total;
  for (let i = 0; i < seglens.length; i++) {
    const seg = seglens[i];
    if (target <= seg || i === seglens.length - 1) {
      const r = seg === 0 ? 0 : Math.max(0, Math.min(1, target / seg));
      const a = path[i];
      const b = path[i + 1];
      return { x: a.x + (b.x - a.x) * r, y: a.y + (b.y - a.y) * r };
    }
    target -= seg;
  }
  return path[path.length - 1];
}

function drawTrail(
  ctx: CanvasRenderingContext2D,
  edge: Edge,
  fromT: number,
  toT: number,
  tone: { rgb: string }
) {
  if (fromT === toT) return;
  const start = Math.min(fromT, toT);
  const end = Math.max(fromT, toT);
  const total = edge.length;

  let consumed = 0;
  for (let i = 0; i < edge.seglens.length; i++) {
    const segLen = edge.seglens[i];
    const segStartT = consumed / total;
    const segEndT = (consumed + segLen) / total;

    if (segEndT < start) {
      consumed += segLen;
      continue;
    }
    if (segStartT > end) break;

    const localFromT = Math.max(start, segStartT);
    const localToT = Math.min(end, segEndT);
    const a = edge.path[i];
    const b = edge.path[i + 1];

    const r1 = segLen === 0 ? 0 : (localFromT * total - consumed) / segLen;
    const r2 = segLen === 0 ? 0 : (localToT * total - consumed) / segLen;

    const p1 = { x: a.x + (b.x - a.x) * r1, y: a.y + (b.y - a.y) * r1 };
    const p2 = { x: a.x + (b.x - a.x) * r2, y: a.y + (b.y - a.y) * r2 };

    const isHeadSide = Math.abs(localToT - toT) < Math.abs(localFromT - toT);
    const gradFrom = isHeadSide ? p1 : p2;
    const gradTo = isHeadSide ? p2 : p1;

    const g = ctx.createLinearGradient(gradFrom.x, gradFrom.y, gradTo.x, gradTo.y);
    g.addColorStop(0, `rgba(${tone.rgb}, 0)`);
    g.addColorStop(1, `rgba(${tone.rgb}, 0.55)`);

    ctx.strokeStyle = g;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();

    consumed += segLen;
  }
}

function init() {
  console.log('[circuit-bg] init() called, readyState=', document.readyState);
  const canvas = document.getElementById('circuit-bg') as HTMLCanvasElement | null;
  if (!canvas) {
    console.warn('[circuit-bg] #circuit-bg canvas not found in DOM');
    return;
  }
  // Visible-only-if-canvas-works marker: a very faint teal wash. If the user
  // can see a slight teal cast over the page, the canvas is properly layered
  // above the body background.
  canvas.style.backgroundColor = 'rgba(78, 240, 199, 0.008)';
  try {
    const c = new Circuit(canvas);
    // Expose for debugging from DevTools console.
    (window as unknown as { __circuit?: Circuit }).__circuit = c;
  } catch (err) {
    console.error('[circuit-bg] init failed:', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
