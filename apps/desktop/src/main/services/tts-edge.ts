import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import type { EdgeTtsArgs, EdgeTtsResult } from "ipc-contract";

/**
 * 调用微软 Edge 在线 TTS 服务（免费，无需 API key）。
 * 使用 msedge-tts 包，已正确实现 Sec-MS-GEC 鉴权令牌。
 *
 * 稳定性处理：
 * 1. 复用同一个 WebSocket 连接（减少握手与频率限制带来的中断）
 * 2. 失败自动重试（服务端偶发主动断开连接）
 * 3. 合成结果做小容量缓存（重复话术无需重复请求）
 */

const MP3_FORMAT = OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;
const MAX_RETRIES = 3;
const CACHE_LIMIT = 60;

/** 复用中的客户端与其绑定的音色 */
let client: MsEdgeTTS | null = null;
let clientVoice = "";

/** 合成结果缓存：key -> base64 mp3（FIFO 淘汰） */
const audioCache = new Map<string, string>();

function closeClient(): void {
  if (client) {
    try {
      client.close();
    } catch {
      /* ignore */
    }
  }
  client = null;
  clientVoice = "";
}

function getCached(key: string): string | undefined {
  const hit = audioCache.get(key);
  if (hit === undefined) return undefined;
  // 命中后移到队尾，保持 LRU 语义
  audioCache.delete(key);
  audioCache.set(key, hit);
  return hit;
}

function setCache(key: string, base64: string): void {
  if (audioCache.size >= CACHE_LIMIT) {
    const oldest = audioCache.keys().next().value;
    if (oldest !== undefined) audioCache.delete(oldest);
  }
  audioCache.set(key, base64);
}

async function getClient(voice: string): Promise<MsEdgeTTS> {
  if (client && clientVoice === voice) return client;
  closeClient();
  const instance = new MsEdgeTTS({
    connectionTimeoutMs: 15000,
    synthesisTimeoutMs: 45000,
  });
  await instance.setMetadata(voice, MP3_FORMAT);
  client = instance;
  clientVoice = voice;
  return instance;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 单次合成，返回 mp3 Buffer */
async function synthesizeOnce(
  text: string,
  voice: string,
  rateStr: string,
  pitchStr: string,
): Promise<Buffer> {
  const instance = await getClient(voice);
  const { audioStream } = instance.toStream(text, { rate: rateStr, pitch: pitchStr });
  const chunks: Buffer[] = [];
  for await (const chunk of audioStream) {
    chunks.push(Buffer.from(chunk));
  }
  const buffer = Buffer.concat(chunks);
  if (buffer.length === 0) {
    throw new Error("edge-tts 未返回音频数据");
  }
  return buffer;
}

export async function edgeTtsSynthesize(args: EdgeTtsArgs): Promise<EdgeTtsResult> {
  const { text, voice, ratePercent, pitchHz } = args;

  if (!text || !text.trim()) {
    throw new Error("文本为空");
  }
  if (!voice) {
    throw new Error("未选择音色");
  }

  const rateStr = `${ratePercent >= 0 ? "+" : ""}${ratePercent}%`;
  const pitchStr = `${pitchHz >= 0 ? "+" : ""}${pitchHz}Hz`;
  const cacheKey = `${voice}|${rateStr}|${pitchStr}|${text}`;

  const cached = getCached(cacheKey);
  if (cached) return { base64: cached };

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const buffer = await synthesizeOnce(text, voice, rateStr, pitchStr);
      const base64 = buffer.toString("base64");
      setCache(cacheKey, base64);
      return { base64 };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // 连接可能已损坏：丢弃复用连接，下次重试会重新建连
      closeClient();
      if (attempt < MAX_RETRIES - 1) {
        await delay(400 + attempt * 600);
      }
    }
  }

  throw new Error(
    `语音合成失败：${lastError?.message ?? "未知错误"}。请检查网络，或尝试更换其他音色。`,
  );
}
