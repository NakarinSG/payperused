// PayPerUsed scan proxy — Cloudflare Worker
//
// หน้าเว็บ (GitHub Pages, repo สาธารณะ) เก็บ API key ไม่ได้ จึงให้ Worker นี้ถือ key ไว้เป็น secret แล้วเรียก Gemini แทน
//   POST /scan   { image: <base64>, mimeType } → { ok, result, usage }
//   GET  /usage  → { usage }  (ให้หน้าเว็บแสดงว่าวันนี้ใช้ไปกี่ครั้งแล้ว)
//
// ทุกครั้งที่จะเรียก Gemini ต้องจองโควตาจาก Durable Object ก่อน (ต่อนาที / ต่อวัน / ต่อ IP)
// DO ประมวลผลทีละ request จึงนับแม่นแม้มีคนกดพร้อมกัน

import { DurableObject } from 'cloudflare:workers';
import { limitsFromEnv, reserve, snapshot, cooldown, recordTokens, pacificDay } from './quota.js';
import { SUPPORTED_MIME, buildGeminiRequest, normalizeScan, extractJson, parseRetryDelay, bangkokToday } from './scan.js';

const MAX_IMAGE_B64 = 6 * 1024 * 1024;   // ~4.5 MB รูปจริง — หน้าเว็บย่อรูปก่อนส่งอยู่แล้ว ปกติไม่ถึง 1 MB
const GEMINI_TIMEOUT_MS = 45_000;

export class UsageCounter extends DurableObject {
  async #update(fn) {
    const now = Date.now();
    const { state, result } = fn(await this.ctx.storage.get('state'), now);
    await this.ctx.storage.put('state', state);
    return result;
  }

  reserve(ipKey, limits) {
    return this.#update((s, now) => reserve(s, { now, ipKey, limits }));
  }

  async usage(limits) {
    return snapshot(await this.ctx.storage.get('state'), Date.now(), limits);
  }

  cooldown(seconds) {
    return this.#update((s, now) => ({ state: cooldown(s, now, seconds), result: null }));
  }

  recordTokens(tokens) {
    return this.#update((s, now) => ({ state: recordTokens(s, now, tokens), result: null }));
  }
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
}

// เก็บแค่ hash ของ IP (เปลี่ยน salt ทุกวัน) ไม่เก็บ IP จริง
async function ipKey(request, now) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${pacificDay(now)}:${ip}`));
  return [...new Uint8Array(digest).slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function handleScan(request, env, counter, limits, cors) {
  if (Number(request.headers.get('Content-Length') || 0) > MAX_IMAGE_B64 + 1024) return json({ error: 'too_large' }, 413, cors);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400, cors);
  }
  const { image, mimeType } = body || {};
  if (typeof image !== 'string' || !image || image.length > MAX_IMAGE_B64 || !/^[A-Za-z0-9+/]+=*$/.test(image.slice(0, 1024))) {
    return json({ error: 'bad_image' }, 400, cors);
  }
  if (!SUPPORTED_MIME.includes(mimeType)) return json({ error: 'unsupported' }, 400, cors);

  const now = Date.now();
  const r = await counter.reserve(await ipKey(request, now), limits);
  if (!r.ok) return json({ error: 'quota', reason: r.reason, retryAfter: r.retryAfter, usage: r.usage }, 429, { ...cors, 'Retry-After': String(r.retryAfter) });

  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify(buildGeminiRequest(image, mimeType)),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn('gemini fetch failed', err && err.name);
    return json({ error: 'upstream', usage: r.usage }, 504, cors);
  }

  if (res.status === 429) {
    const retryAfter = parseRetryDelay(await res.json().catch(() => null));
    await counter.cooldown(retryAfter);
    return json({ error: 'quota', reason: 'upstream', retryAfter, usage: r.usage }, 429, { ...cors, 'Retry-After': String(retryAfter) });
  }
  if (!res.ok) {
    // ไม่ log เนื้อหา response — อาจมีข้อมูลจากรูป
    console.warn('gemini error', res.status);
    return json({ error: 'upstream', usage: r.usage }, 502, cors);
  }

  const data = await res.json();
  const tokens = data.usageMetadata && data.usageMetadata.totalTokenCount;
  if (tokens) await counter.recordTokens(tokens);
  const result = normalizeScan(extractJson(data), bangkokToday(now));
  return json({ ok: result.ok, result, usage: { ...r.usage, tokensToday: r.usage.tokensToday + (tokens || 0) } }, 200, cors);
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });
    // ต้องมาจากหน้าเว็บของเราเท่านั้น — ไม่ใช่การยืนยันตัวตน (curl ปลอม Origin ได้) โควตาต่อ IP/ต่อวันคือรั้วชั้นถัดไป
    if (!cors) return json({ error: 'forbidden_origin' }, 403);
    if (!env.GEMINI_API_KEY) return json({ error: 'not_configured' }, 500, cors);

    const url = new URL(request.url);
    const limits = limitsFromEnv(env);
    const counter = env.USAGE.get(env.USAGE.idFromName('global'));
    if (url.pathname === '/usage' && request.method === 'GET') return json({ usage: await counter.usage(limits) }, 200, cors);
    if (url.pathname === '/scan' && request.method === 'POST') return handleScan(request, env, counter, limits, cors);
    return json({ error: 'not_found' }, 404, cors);
  },
};
