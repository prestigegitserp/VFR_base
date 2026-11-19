import { unzipSync } from 'fflate';
import { fabrics, metrics } from './catalog.js';

const MB = 1024 * 1024;
const text = new TextDecoder('utf-8', { fatal: true });
const skuPattern = /^[A-Za-z0-9._-]{2,46}$/;
const filePattern = /^sizes\/[a-zA-Z0-9._-]+\.glb$/;
const name = (value, limit = 80) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= limit;
const number = (n, lo, hi) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
const point = (p) => Array.isArray(p) && p.length === 3 && p.every((v) => number(v, -2.6, 2.6));
const required = {
  coat: ['chest', 'waist', 'hip', 'shoulder', 'sleeve'],
  jacket: ['chest', 'waist', 'hip', 'shoulder', 'sleeve'],
  knit: ['chest', 'waist', 'shoulder', 'sleeve'],
  dress: ['chest', 'waist', 'hip'],
  skirt: ['waist', 'hip'],
};

function productUrl(value) {
  if (value == null || value === '') return null;
  let url;
  try { url = new URL(value); } catch { throw new Error('آدرس محصول معتبر نیست.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('لینک محصول باید HTTPS باشد.');
  return url.href;
}

export function readGlb(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 24 || bytes.length > 24 * MB) throw new Error('فایل GLB باید کمتر از ۲۴ مگابایت باشد.');
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (d.getUint32(0, true) !== 0x46546c67 || d.getUint32(4, true) !== 2 || d.getUint32(8, true) !== bytes.byteLength) {
    throw new Error('مدل باید GLB 2.0 معتبر باشد.');
  }
  const jsonLength = d.getUint32(12, true);
  if (d.getUint32(16, true) !== 0x4e4f534a || jsonLength < 6 || jsonLength > 2 * MB || 20 + jsonLength > bytes.length) {
    throw new Error('ساختار GLB خوانده نشد.');
  }
  const model = JSON.parse(text.decode(bytes.subarray(20, 20 + jsonLength)));
  if (model.asset?.version !== '2.0' || !Array.isArray(model.meshes) || model.meshes.length === 0 || model.meshes.length > 40) {
    throw new Error('مدل GLB باید مش مثلثی داشته باشد.');
  }
  if ((model.buffers ?? []).some((b) => b.uri !== undefined) || (model.images ?? []).some((i) => i.uri !== undefined)) {
    throw new Error('بافت‌ها و بافرهای GLB باید داخل خود فایل باشند.');
  }
  if ((model.extensionsRequired ?? []).some((key) => !['KHR_materials_unlit', 'KHR_texture_transform', 'KHR_mesh_quantization'].includes(key))) {
    throw new Error('GLB را با هندسهٔ معمولی و عکس JPEG یا PNG صادر کن.');
  }
  if ((model.images ?? []).length > 12 || (model.images ?? []).some((i) => !['image/jpeg', 'image/png', 'image/webp'].includes(i.mimeType))) {
    throw new Error('فرمت یا تعداد بافت‌های GLB پشتیبانی نمی‌شود.');
  }
  let budget = 0;
  for (const mesh of model.meshes) {
    for (const primitive of (mesh.primitives ?? [])) {
      const position = model.accessors?.[primitive.attributes?.POSITION];
      const count = position?.count;
      if (!number(count, 3, 100000) || !Number.isInteger(count) || (primitive.mode ?? 4) !== 4) {
        throw new Error('مش باید مثلثی باشد و هر بخش حداکثر ۱۰۰ هزار رأس داشته باشد.');
      }
      budget += count;
    }
  }
  if (budget > 180000) throw new Error('تعداد رئوس مدل از ۱۸۰ هزار بیشتر است.');
  return model;
}

export function readManifest(m, files) {
  if (m?.protocol !== 'vfr.garment/2' || m.axes !== 'Y_UP_Z_FORWARD_METERS') throw new Error('نسخهٔ پروتکل یا دستگاه مختصات بسته پشتیبانی نمی‌شود.');
  if (!skuPattern.test(m.id ?? '') || !name(m.title) || !name(m.brand) || !Object.hasOwn(required, m.cut)
    || !Object.hasOwn(fabrics, m.fabric) || m.fabric === 'optical' || !['women', 'men', 'unisex'].includes(m.audience)) {
    throw new Error('شناسه، نام، برند، برش، پارچه و گروه محصول را بررسی کن.');
  }
  if (!Array.isArray(m.sizes) || m.sizes.length < 1 || m.sizes.length > 24) throw new Error('بسته باید از یک تا ۲۴ سایز داشته باشد.');
  const keys = required[m.cut];
  const fitEase = {};
  for (const key of keys) {
    const pair = m.easeMm?.[key];
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every((n) => number(n, -65, 400)) || pair[0] >= pair[1]) {
      throw new Error(`بازهٔ آزادی «${metrics[key].label}» معتبر نیست.`);
    }
    fitEase[key] = pair.slice();
  }
  const skuSet = new Set(), nameSet = new Set(), parsed = new Set();
  const sizes = m.sizes.map((s) => {
    if (!name(s.label, 20) || !skuPattern.test(s.sku ?? '') || skuSet.has(s.sku) || nameSet.has(s.label.trim())
      || !filePattern.test(s.model ?? '') || !files[s.model] || !number(s.toleranceMm, 0, 50)) {
      throw new Error('هر سایز باید نام، SKU یکتا، تلرانس و GLB جداگانهٔ مشخص داشته باشد.');
    }
    skuSet.add(s.sku);
    nameSet.add(s.label.trim());
    if (!parsed.has(s.model)) {
      readGlb(files[s.model]);
      parsed.add(s.model);
    }
    const anchors = s.anchors;
    if (!anchors || !['leftShoulder', 'rightShoulder', 'hip'].every((k) => point(anchors[k]))) {
      throw new Error('مختصات شانهٔ چپ، شانهٔ راست و مرکز لگن باید در فایل هر سایز باشد.');
    }
    const span = Math.abs(anchors.leftShoulder[0] - anchors.rightShoulder[0]);
    const shoulderY = (anchors.leftShoulder[1] + anchors.rightShoulder[1]) / 2;
    if (anchors.leftShoulder[0] >= anchors.rightShoulder[0] || !number(span, .25, .65) ||
      !number(shoulderY - anchors.hip[1], .27, .65) || Math.abs(anchors.leftShoulder[1] - anchors.rightShoulder[1]) > .08) {
      throw new Error('جای نقاط مرجع با مقیاس متر و فرم روبه‌رو سازگار نیست.');
    }
    const garment = {};
    for (const key of [...keys, 'length']) {
      const [lo, hi] = key === 'length' ? [190, 1850] : metrics[key].range;
      const n = s.measurementsMm?.[key];
      if (!number(n, lo - 70, hi + 280)) throw new Error(`اندازهٔ «${metrics[key]?.label ?? 'قد لباس'}» در سایز «${s.label}» معتبر نیست.`);
      garment[key] = n;
    }
    return { label: s.label.trim(), sku: s.sku, garment, model: s.model, toleranceMm: s.toleranceMm,
      anchors: { leftShoulder: [...anchors.leftShoulder], rightShoulder: [...anchors.rightShoulder], hip: [...anchors.hip] },
      url: productUrl(s.productUrl ?? m.productUrl) };
  });
  const color = /^#[0-9a-f]{6}$/i.test(m.color ?? '') ? m.color : '#6d645b';
  return {
    id: `scan-${m.id}`, english: m.brand.trim(), title: m.title.trim(), audience: m.audience, cut: m.cut, fabric: m.fabric,
    description: name(m.description, 255) ? m.description.trim() : 'مدل GLB اندازه‌دار',
    frame: ['jacket', 'knit'].includes(m.cut) ? 'upper' : 'full', source: 'scan',
    form: m.audience === 'men' ? 'm48' : 'f36', availability: sizes.some((s) => s.url) ? 'merchant' : 'demo',
    colors: [{ label: 'رنگ فایل', value: color }], ease: fitEase, sizes,
  };
}

export function unpackPackage(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 42 * MB) throw new Error('حجم بسته باید کمتر از ۴۲ مگابایت باشد.');
  let total = 0, count = 0;
  const files = unzipSync(bytes, {
    filter(file) {
      if (file.name.endsWith('/')) return false;
      if (file.name !== 'manifest.json' && file.name !== 'poster.webp' && !filePattern.test(file.name)) {
        throw new Error('نام فایل در بسته مجاز نیست.');
      }
      if (++count > 27 || (total += file.originalSize) > 76 * MB ||
        file.originalSize > (file.name === 'manifest.json' ? 180_000 : file.name === 'poster.webp' ? 2 * MB : 24 * MB)) {
        throw new Error('بسته پس از بازشدن از اندازهٔ مجاز بزرگ‌تر است.');
      }
      return true;
    },
  });
  if (!files['manifest.json']) throw new Error('manifest.json در ریشهٔ بسته نیست.');
  const m = JSON.parse(text.decode(files['manifest.json']));
  const item = readManifest(m, files);
  return { item, files: Object.fromEntries(Object.entries(files).filter(([path]) => path !== 'manifest.json')) };
}

export function readBodyScan(data) {
  if (data?.protocol !== 'vfr.body/1' || data.unit !== 'mm' || !data.measures || typeof data.measures !== 'object') throw new Error('فایل باید از پروتکل vfr.body/1 استفاده کند.');
  const measures = {};
  for (const [key, m] of Object.entries(data.measures)) {
    if (!Object.hasOwn(metrics, key)) continue;
    if (!number(m?.value, ...metrics[key].range) || !number(m?.uncertainty, 1, 150)) throw new Error(`اندازه یا عدم قطعیت «${metrics[key].label}» معتبر نیست.`);
    measures[key] = { value: m.value, uncertainty: m.uncertainty };
  }
  if (Object.keys(measures).length < 2) throw new Error('حداقل دو اندازهٔ قابل استفاده وارد کن.');
  return { method: 'scan', measures };
}

function openGarments(name, create) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onupgradeneeded = () => {
      if(create)request.result.createObjectStore('garments', {keyPath:'id'});
      else request.transaction.abort();
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let database;
function connection() {
  database ??= openGarments('vfr-atelier-3',true).catch(e=>{database=null;throw e;});
  return database;
}

export async function storePackage(record) {
  const db = await connection();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('garments', 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
    tx.objectStore('garments').put({ ...record, id: record.item.id });
  });
}

function readPackages(db) {
  return new Promise((resolve, reject) => {
    const q = db.transaction('garments').objectStore('garments').getAll();
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
  });
}

export async function listPackages() {
  const previous=await openGarments('vfr-atelier-2',false).then(db=>readPackages(db).finally(()=>db.close())).catch(()=>[]);
  const current=await connection().then(readPackages).catch(()=>[]);
  return [...new Map([...previous,...current].map(record=>[record.id,record])).values()];
}
