/**
 * node-shims.ts — Node.js 运行时对 workerd 平台 API 的兼容垫片
 *
 * worker 核心运行于 workerd 语义之上, 在 Node/沙盒模式下需要补齐:
 *   1. crypto.subtle.digest('MD5', ...) —— workerd 支持而 Node webcrypto 不支持,
 *      核心鉴权(MD5MD5)与 HTTP Digest 代理认证依赖它 → 以 node:crypto 补齐。
 *      (核心文件零改动, 仅扩展全局 subtle 的算法支持)
 *   2. request.fetcher.connect(...) —— workerd 专有 TCP 出口(sockets API),
 *      以 node:net/node:tls 实现同语义(返回 {readable, writable, close})。
 *   3. WebSocketPair —— workerd 全局, 以 ws 包实现(server 端 accept/send)。
 *   4. request.cf —— workerd 请求上的 CF 地理信息, Node 下提供占位。
 *
 * 设计原则: 只垫平台 API, 不触碰核心逻辑 —— 服务端核心服务保持原样。
 */

import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import type { Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import type { TLSSocket } from 'node:tls';
import { Readable, Writable } from 'node:stream';

/* ------------------------------------------------------------------ */
/* 1) crypto.subtle MD5 支持                                           */
/* ------------------------------------------------------------------ */

let md5Patched = false;

/**
 * workerd 允许 Response(101)(WebSocket 握手), undici(Node) 拒绝 ——
 * 仅在需要时以 Proxy 垫片放行 101: 以 200 构造真实例后改写 status 呈现,
 * 并保留 webSocket 附加属性。其余构造完全直通, 零行为差异。
 */
let responsePatched = false;

export function ensureWsResponseSupport(): void {
  if (responsePatched) return;
  responsePatched = true;
  if (typeof Response === 'undefined') return;
  try {
    new Response(null, { status: 101 });
    return; // 原生支持(workerd), 无需垫片
  } catch {
    /* undici: 需要垫片 */
  }
  const RealResponse = Response;
  const PatchedResponse = new Proxy(RealResponse, {
    construct(target, args: ConstructorParameters<typeof Response>) {
      const init = args[1] as (ResponseInit & { webSocket?: unknown }) | undefined;
      if (init && Number(init.status) === 101) {
        const real = new RealResponse(args[0], { ...init, status: 200 });
        Object.defineProperty(real, 'status', { value: 101, configurable: true });
        if ('webSocket' in init) {
          Object.defineProperty(real, 'webSocket', { value: init.webSocket, configurable: true });
        }
        return real as Response;
      }
      return Reflect.construct(target, args as unknown[]);
    },
  });
  Object.defineProperty(globalThis, 'Response', {
    value: PatchedResponse,
    configurable: true,
    writable: true,
  });
}

export function ensureMd5Support(): void {
  if (md5Patched) return;
  md5Patched = true;
  const g = globalThis as unknown as { crypto?: SubtleCryptoHost };
  if (!g.crypto?.subtle?.digest) return;
  const subtle = g.crypto.subtle as SubtleCryptoHost['subtle'];
  const subtleProto = Object.getPrototypeOf(subtle) as {
    digest?: unknown;
    __autotunnelMd5?: boolean;
  };
  if (subtleProto.__autotunnelMd5) return;

  const originalDigest = subtle.digest.bind(subtle);
  const patched = async (algorithm: AlgorithmIdentifier | Ed448Params, data?: BufferSource) => {
    const name =
      typeof algorithm === 'string'
        ? algorithm.toUpperCase()
        : String((algorithm as { name?: string })?.name ?? '').toUpperCase();
    if (name === 'MD5') {
      const buf = data ? Buffer.from(data as ArrayBuffer) : Buffer.alloc(0);
      return createHash('md5').update(buf).digest().buffer;
    }
    return originalDigest(algorithm as string, data!);
  };
  // 在原型上补丁(subtle 实例与原型属性均为只读 getter, 不可直接赋值)
  try {
    Object.defineProperty(subtleProto, 'digest', {
      value: patched,
      writable: true,
      configurable: true,
    });
    subtleProto.__autotunnelMd5 = true;
  } catch (e) {
    console.warn('[autotunnel/shims] MD5 垫片注入失败:', (e as Error).message);
  }
}

interface SubtleCryptoHost {
  subtle: {
    digest(
      algorithm: string | { name: string },
      data: BufferSource,
    ): Promise<ArrayBuffer>;
  } & Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* 2) fetcher.connect — node:net/tls 出口                              */
/* ------------------------------------------------------------------ */

interface WorkerSocket {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  closed: Promise<void>;
  close(): Promise<void>;
}

function toWorkerSocket(socket: Socket | TLSSocket): WorkerSocket {
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      socket.on('data', (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      socket.on('end', () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
      socket.on('error', (err: Error) => {
        try {
          controller.error(err);
        } catch {
          /* already errored */
        }
      });
    },
    cancel() {
      socket.destroy();
    },
  });

  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        const ok = socket.write(chunk as Buffer, (err?: Error | null) =>
          err ? reject(err) : resolve(),
        );
        if (!ok) {
          // 背压: 等待 drain
          const onDrain = () => resolve();
          socket.once('drain', onDrain);
        }
      });
    },
    close() {
      return new Promise<void>((resolve) => {
        socket.end(() => resolve());
      });
    },
    abort() {
      socket.destroy();
    },
  });

  let closedResolve: (() => void) | null = null;
  const closed = new Promise<void>((resolve) => {
    closedResolve = resolve;
  });
  socket.on('close', () => closedResolve?.());

  return {
    readable,
    writable,
    closed,
    async close() {
      await new Promise<void>((resolve) => socket.end(() => resolve()));
    },
  };
}

/**
 * 与 workerd sockets 语义一致的 connect(options):
 * options: { hostname, port } 或 'host:port' 字符串; init: { secureTransport?, allowHalfOpen? }
 * secureTransport: 'starttls' 由核心 TlsClient 自行升级 → 返回裸 TCP;
 * 'on'(默认, 安全传输) → 直接 TLS 连接。
 */
export function nodeSocketConnect(
  options: string | { hostname?: string; host?: string; port: number },
  init?: { secureTransport?: string; allowHalfOpen?: boolean },
): WorkerSocket {
  const host =
    typeof options === 'string'
      ? options.split(':')[0]
      : options.hostname || options.host || '';
  const port = typeof options === 'string' ? Number(options.split(':')[1] || 443) : options.port;
  const secure = init?.secureTransport !== 'starttls';

  const socket = secure
    ? tlsConnect({ host, port, servername: host, rejectUnauthorized: false }) as unknown as TLSSocket
    : createConnection({ host, port, allowHalfOpen: init?.allowHalfOpen ?? true });

  socket.setNoDelay(true);
  return toWorkerSocket(socket);
}

/* ------------------------------------------------------------------ */
/* 3) WebSocketPair(ws 版)                                             */
/* ------------------------------------------------------------------ */

interface WorkerLikeWebSocket {
  accept(opts?: unknown): void;
  send(data: string | ArrayBufferLike | Uint8Array): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: MessageEvent | CloseEvent) => void): void;
  binaryType?: string;
  readyState?: number;
}

/**
 * 构造 workerd 风格 WebSocketPair。
 * client[0] / server[1]; server.accept() 后可 send/addEventListener。
 * 与 Node 'ws' WebSocket 的桥接在 server/node-server.mjs 完成 —— 该入口
 * 负责把真实的 ws 连接包装成本函数返回的 pair, 并在 Response(101) 时绑定。
 */
export function createWebSocketPair(
  bridge: {
    onMessage?: (data: string | Uint8Array) => void;
    onClose?: (code: number, reason: string) => void;
    onError?: (err: Error) => void;
  },
): { 0: WorkerLikeWebSocket; 1: WorkerLikeWebSocket } {
  // 两端均为本地回环代理对象; 真实网络桥接由调用方注入
  type Listener = (event: MessageEvent | CloseEvent) => void;
  const makeEnd = (label: string, peers: Array<{ listeners: Map<string, Listener[]>; push: (t: string, e: MessageEvent | CloseEvent) => void }>): WorkerLikeWebSocket => {
    const listeners = new Map<string, Listener[]>();
    const self = { listeners, push: (t: string, e: MessageEvent | CloseEvent) => {
      for (const l of listeners.get(t) ?? []) l(e as never);
    } };
    peers.push(self);
    return {
      accept: () => {},
      send: (data) => {
        for (const peer of peers) {
          if (peer === self) continue;
          peer.push('message', {
            data,
            type: 'message',
          } as unknown as MessageEvent);
        }
        void label;
      },
      close: (code, reason) => {
        for (const peer of peers) {
          if (peer === self) continue;
          peer.push('close', { code: code ?? 1000, reason: reason ?? '', type: 'close' } as unknown as CloseEvent);
        }
      },
      addEventListener: (type, listener) => {
        const arr = listeners.get(type) ?? [];
        arr.push(listener);
        listeners.set(type, arr);
      },
      binaryType: 'arraybuffer',
    };
  };
  const peers: Array<{ listeners: Map<string, Listener[]>; push: (t: string, e: MessageEvent | CloseEvent) => void }> = [];
  const client = makeEnd('client', peers);
  const server = makeEnd('server', peers);
  void bridge;
  return { 0: client, 1: server };
}

/* ------------------------------------------------------------------ */
/* 4) request.cf 占位                                                  */
/* ------------------------------------------------------------------ */

export function placeholderCf(): Record<string, unknown> {
  return {
    asn: 0,
    asOrganization: 'Unknown',
    country: 'XX',
    city: 'Unknown',
    region: 'Unknown',
    colo: 'UNK',
    timezone: 'UTC',
  };
}
