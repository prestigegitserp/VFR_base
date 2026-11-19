import './style.css';
import { asset, catalog, clamp, cuts, dimensions, fabrics, number, patternData, readPattern, recommendSize, sizes } from './catalog.js';
import { Studio } from './studio.js';
import { Calibration, containRect, PoseSmoother, projectRig, validPose } from './pose.js';
import { getTracker } from './tracker.js';
import { fillIcons, icon } from './icons.js';
import { composite, paintInput } from './compositor.js';

const $ = (id) => document.getElementById(id);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const stage = $('stage');
const video = $('video');
const picture = $('photo');
const overlay = $('overlay').getContext('2d');
const sourceAction = $('source-action');
const freshMotion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
const storeKey = 'vfr-studio:v1';
const load = (key) => {
  try { return JSON.parse(localStorage.getItem(`${storeKey}:${key}`)); } catch { return null; }
};
const save = (key, value) => {
  try {
    if (value == null) localStorage.removeItem(`${storeKey}:${key}`);
    else localStorage.setItem(`${storeKey}:${key}`, JSON.stringify(value));
  } catch { /* Browser storage can be disabled. */ }
};
const state = {
  item: catalog[0], filter: 'all', size: 'M', color: 0, mode: 'studio', quality: 'balanced',
  move: freshMotion, wind: false, near: false, compare: false, split: 50,
  mirror: true, occlusion: true, skeleton: false, gestures: false, body: load('measurements'),
  pose: null, goodAt: 0, cameraReady: false, busy: false, calibration: null,
};
try { state.custom = readPattern(load('pattern')); } catch { state.custom = null; }

let studio;
let generation = 0, stream, tracker, imageCanvas, objectURL;
let taskOptions = Promise.resolve();
let segmenting = false, canInfer = false, videoFrame = -1;
let lastDetect = 0, inferenceMs = 0, timeout = 0, messageAction;
let prevFrame = 0, meterStart = 0, frames = 0, gesture = {};
let size = { width: 1, height: 1 };
const smoother = new PoseSmoother();

fillIcons();
try {
  studio = new Studio($('render'), (lost) => {
    stage.dataset.renderer = lost ? 'fallback' : 'webgl';
    if (lost) chooseMode('studio');
    selectLook(state.item, false);
    updateControls();
  });
  stage.dataset.renderer = 'webgl';
} catch (error) {
  console.info('WebGL2 preview unavailable', error.message);
  stage.dataset.renderer = 'fallback';
}
const gpu = () => studio && !studio.lost;

function press(button, on) {
  button.setAttribute('aria-pressed', String(Boolean(on)));
}
function signal(label, kind = '') {
  if ($('signal').textContent !== label) $('signal').textContent = label;
  const dot = $('signal-dot');
  dot.classList.toggle('is-live', kind === 'live');
  dot.classList.toggle('is-wait', kind === 'wait');
}
function showMessage(config) {
  $('stage-message').hidden = !config;
  if (!config) return;
  $('message-icon').innerHTML = icon(config.icon ?? 'video');
  $('message-title').textContent = config.title;
  $('message-copy').textContent = config.copy;
  $('message-action').hidden = !config.action;
  $('message-action').textContent = config.button ?? 'دوباره تلاش کن';
  messageAction = config.action;
}
$('message-action').addEventListener('click', () => messageAction?.());

function toast(message) {
  const target = $('toast');
  target.textContent = message;
  target.hidden = false;
  clearTimeout(timeout);
  timeout = setTimeout(() => { target.hidden = true; }, 3600);
}

function list() {
  const all = state.custom ? [...catalog, state.custom] : catalog;
  return all.filter((look) => state.filter === 'all' || look.audience === state.filter);
}
function drawList(resetScroll = false) {
  const host = $('garment-list');
  const scroll = resetScroll ? 0 : host.scrollTop;
  const options = list();
  const fragment = document.createDocumentFragment();
  for (const look of options) {
    const el = $('card-template').content.firstElementChild.cloneNode(true);
    const image = el.querySelector('img');
    image.src = asset(`looks/${look.id === 'custom' ? look.cut : look.id}.webp`);
    image.loading = options.indexOf(look) < 4 ? 'eager' : 'lazy';
    el.dataset.look = look.id;
    el.style.setProperty('--tile', look.tile);
    el.title = look.description;
    el.querySelector('strong').textContent = look.name;
    el.querySelector('small').textContent = fabrics[look.fabric].label;
    press(el, state.item.id === look.id);
    fillIcons(el);
    el.addEventListener('click', () => selectLook(look));
    fragment.append(el);
  }
  if (!options.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'قالب سفارشی بساز یا فایل اندازه‌های لباس را باز کن.';
    const button = document.createElement('button');
    button.className = 'secondary';
    button.type = 'button';
    button.textContent = 'ساخت قالب';
    button.addEventListener('click', () => openDialog('pattern-dialog'));
    empty.append(button);
    fragment.append(empty);
  }
  host.replaceChildren(fragment);
  host.scrollTop = scroll;
  $('item-count').textContent = `${number(options.length)} مدل`;
  $$('.filters button').forEach((button) => press(button, button.dataset.filter === state.filter));
}

function fitIndicator() {
  const fit = recommendSize(state.item, state.body ?? {});
  const cm = dimensions(state.item, state.size);
  const compare = fit === 'outside' ? 'سایز مناسب در مجموعهٔ فعلی پیدا نشد.'
    : fit ? `پیشنهاد ${state.body.source === 'camera' ? 'تقریبی' : 'سایز'}: ${fit}`
      : `قد لباس ${number(cm.length)} سانتی‌متر`;
  $('fit-state').textContent = compare;
}

function updateLook() {
  const { item, color, size: selected } = state;
  const cut = cuts[item.cut], fabric = fabrics[item.fabric];
  $('stage-look').textContent = $('look-name').textContent = item.name;
  $('stage-fabric').textContent = `${fabric.label} · ${item.names[color]}`;
  $('look-cut').textContent = `${cut.label} · ${fabric.label}`;
  $$('.look-card').forEach((button) => press(button, button.dataset.look === item.id));
  const swatches = item.colors.map((value, i) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.type = 'button';
    b.style.setProperty('--swatch', value);
    b.title = item.names[i];
    b.setAttribute('aria-label', item.names[i]);
    press(b, color === i);
    b.addEventListener('click', () => changeVariant({ color: i }));
    return b;
  });
  $('swatches').replaceChildren(...swatches);
  const buttons = sizes.map((size) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = size;
    press(b, selected === size);
    b.addEventListener('click', () => changeVariant({ size }));
    return b;
  });
  $('sizes').replaceChildren(...buttons);
  const original = item.id === 'luna';
  const poster = $('poster');
  poster.src = asset(`looks/${original ? 'studio' : item.id === 'custom' ? item.cut : item.id}.webp`);
  poster.dataset.look = original ? 'studio' : 'garment';
  poster.alt = original ? 'مانکن استودیو با پیراهن لونا' : `رندر ${item.name}`;
  fitIndicator();
  updateControls();
}

function selectLook(item, resetVariant = true) {
  state.item = item;
  if (resetVariant) Object.assign(state, { color: 0, size: 'M' });
  studio?.change(state.item, state.size, state.color);
  updateLook();
}

function changeVariant(values) {
  Object.assign(state, values);
  studio?.change(state.item, state.size, state.color);
  updateLook();
  // Keep keyboard focus on the updated size or color button.
  if (values.size) $('sizes').querySelector('[aria-pressed=true]')?.focus({ preventScroll: true });
  else $('swatches').querySelector('[aria-pressed=true]')?.focus({ preventScroll: true });
}
$$('.filters button').forEach((b) => b.addEventListener('click', () => {
  state.filter = b.dataset.filter;
  drawList(true);
}));

function updateControls() {
  const live = state.mode === 'live';
  const photo = state.mode === 'photo';
  const hasImage = live ? state.cameraReady : photo ? Boolean(imageCanvas && picture.src && !picture.hidden) : true;
  const supported = Boolean(gpu());
  $$('.modes button').forEach((button) => press(button, button.dataset.mode === state.mode));
  $('motion').hidden = live || photo;
  $('motion').disabled = !supported;
  $('near').disabled = !supported || live || photo;
  $('wind').disabled = !supported || !['dress', 'coat', 'skirt'].includes(cuts[state.item.cut].family) || !hasImage;
  $('compare').disabled = !supported || !hasImage;
  $('capture').disabled = !hasImage;
  press($('motion'), state.move);
  press($('near'), state.near);
  press($('wind'), state.wind && !$('wind').disabled);
  press($('compare'), state.compare && !$('compare').disabled);
  $('compare-ui').hidden = !state.compare || $('compare').disabled;
  $('compare-ui').style.setProperty('--split', `${state.split}%`);
  sourceAction.disabled = live && state.busy && !stream;
  const key = live ? (state.busy || stream ? 'stop' : 'video') : photo ? 'upload' : 'video';
  const text = key === 'stop' ? 'خاموش‌کردن دوربین' : photo ? 'انتخاب عکس' : 'روشن‌کردن دوربین';
  sourceAction.innerHTML = `<i>${icon(key)}</i> ${text}`;
}

function setMode(mode) {
  state.mode = mode;
  state.pose = null;
  state.cameraReady = false;
  state.busy = false;
  state.calibration = null;
  state.compare = false;
  state.goodAt = 0;
  segmenting = canInfer = false;
  inferenceMs = 0;
  videoFrame = -1;
  gesture = {};
  smoother.clear();
  stage.dataset.mode = mode;
  video.hidden = mode !== 'live' || !stream;
  picture.hidden = mode !== 'photo' || !imageCanvas;
  studio?.setMode(mode);
  showMessage(null);
  hint(null);
  updateControls();
}

function stopStream() {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  video.pause();
  video.srcObject = null;
  video.hidden = true;
}

function chooseMode(mode) {
  const id = ++generation;
  stopStream();
  setMode(mode);
  if (mode === 'studio') {
    signal(gpu() ? 'پیش‌نمایش سه‌بعدی' : 'رندر ثابت', gpu() ? 'live' : '');
    return;
  }
  if (!gpu()) {
    signal('نمایش سه‌بعدی در دسترس نیست', 'wait');
    showMessage({
      icon: 'cube', title: 'مرورگر به WebGL2 دسترسی ندارد',
      copy: 'برای پرو زنده، شتاب‌دهی سخت‌افزاری مرورگر را فعال کن. رندر لباس‌ها در استودیو قابل مشاهده است.',
      action: () => chooseMode('studio'), button: 'نمایش رندرها',
    });
    return;
  }
  if (mode === 'live') {
    startCamera(id);
  } else if (imageCanvas) {
    runPhoto(id);
  } else {
    signal('عکس را انتخاب کن');
    showMessage({
      icon: 'image', title: 'پرو روی عکس',
      copy: 'عکسی روبه‌رو با شانه‌ها و لگن مشخص انتخاب کن.',
      action: pickPhoto, button: 'انتخاب عکس',
    });
  }
}

function enqueueOptions(delegate, mode, masks) {
  const next = taskOptions.then(() => delegate.options(mode, masks));
  taskOptions = next.catch(() => {});
  return next;
}

async function syncCameraOptions(id = generation) {
  if (!tracker || !state.cameraReady || id !== generation || state.mode !== 'live') return;
  const masks = Boolean(state.calibration);
  canInfer = false;
  await enqueueOptions(tracker, 'VIDEO', masks);
  if (id !== generation || state.mode !== 'live' || masks !== Boolean(state.calibration)) return;
  segmenting = masks;
  canInfer = true;
  if (masks && !state.calibration.started) state.calibration.started = performance.now();
}

async function startCamera(id) {
  state.busy = true;
  updateControls();
  signal('در انتظار دوربین', 'wait');
  showMessage({ title: 'دسترسی دوربین را تأیید کن', copy: 'فقط تصویر وب‌کم در مرورگر باز می‌شود.' });
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraFailure(new Error('SecureContext'), id);
    return;
  }
  const model = getTracker();
  model.catch(() => {});
  try {
    const device = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: 'user' },
      audio: false,
    });
    if (id !== generation) {
      device.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = device;
    video.srcObject = device;
    video.classList.toggle('mirrored', state.mirror);
    video.hidden = false;
    updateControls();
    await video.play();
    device.getVideoTracks()[0]?.addEventListener('ended', () => cameraFailure(new Error('CameraEnded'), id), { once: true });
    if (id !== generation) return;
    signal('بارگذاری مدل بدن', 'wait');
    showMessage({ icon: 'scan', title: 'مدل بدن در حال بارگذاری است', copy: 'در این فاصله، کمی از دوربین فاصله بگیر تا شانه و لگن در قاب باشند.' });
    const ready = await model;
    if (id !== generation) return;
    tracker = ready;
    state.cameraReady = true;
    state.busy = false;
    await syncCameraOptions(id);
    if (id !== generation) return;
    signal('منتظر قرار گرفتن در قاب', 'wait');
    showMessage(null);
    updateControls();
  } catch (error) {
    cameraFailure(error, id);
  }
}

function cameraFailure(error, id) {
  if (id !== generation) return;
  console.info('Camera fitting:', error.name, error.message);
  stopStream();
  state.busy = state.cameraReady = canInfer = false;
  state.pose = state.calibration = null;
  hint(null);
  const causes = {
    NotAllowedError: 'دسترسی دوربین در تنظیمات این صفحه محدود شده. بعد از اجازه دادن دوباره امتحان کن.',
    NotFoundError: 'یک وب‌کم به دستگاه وصل کن و دوباره تلاش کن.',
    NotReadableError: 'ممکن است دوربین در برنامهٔ دیگری باز باشد. آن برنامه را ببند و دوباره تلاش کن.',
  };
  signal('اتصال دوربین برقرار نیست', 'wait');
  showMessage({
    title: 'اتاق پرو دوربینی آماده نیست',
    copy: causes[error.name] ?? (error.message === 'SecureContext'
      ? 'حالت دوربین نیاز به صفحهٔ امن HTTPS یا localhost دارد.'
      : 'بارگذاری مدل یا جریان دوربین کامل نشد. دوباره تلاش کن یا از یک عکس استفاده کن.'),
    action: () => chooseMode('live'),
  });
  updateControls();
}

function pickPhoto() {
  if (!gpu()) return;
  $('photo-input').value = '';
  $('photo-input').click();
}
$('photo-input').addEventListener('change', async (event) => {
  const file = event.currentTarget.files[0];
  if (!file) return;
  if (file.size > 24_000_000 || !/^image\//.test(file.type)) {
    toast('یک عکس با حجم کمتر از ۲۴ مگابایت انتخاب کن.');
    return;
  }
  const id = ++generation;
  stopStream();
  setMode('photo');
  state.pose = null;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (generation !== id) { URL.revokeObjectURL(url); return; }
    const scale = Math.min(1, 1440 / Math.max(image.naturalWidth, image.naturalHeight));
    const input = document.createElement('canvas');
    input.width = Math.round(image.naturalWidth * scale);
    input.height = Math.round(image.naturalHeight * scale);
    input.getContext('2d').drawImage(image, 0, 0, input.width, input.height);
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = url;
    picture.src = url;
    picture.hidden = false;
    imageCanvas = input;
    updateControls();
    await runPhoto(id);
  } catch {
    URL.revokeObjectURL(url);
    if (id === generation) toast('این تصویر باز نشد. یک فایل JPEG یا PNG امتحان کن.');
  }
});

function rectFor(mode = state.mode) {
  const width = mode === 'live' ? video.videoWidth : imageCanvas?.width;
  const height = mode === 'live' ? video.videoHeight : imageCanvas?.height;
  if (!width || !height) return null;
  return containRect(width, height, size.width, size.height);
}

async function runPhoto(id) {
  signal('بررسی عکس', 'wait');
  showMessage({ icon: 'scan', title: 'شناسایی وضعیت بدن', copy: 'داریم شانه‌ها، لگن و اندام‌ها را در تصویر پیدا می‌کنیم.' });
  try {
    const ready = await getTracker();
    if (id !== generation) return;
    await enqueueOptions(ready, 'IMAGE', false);
    if (id !== generation) return;
    ready.image(imageCanvas, (result) => {
      const pose = result.landmarks[0];
      if (validPose(pose)) {
        state.pose = pose;
        showMessage(null);
        signal('پرو روی عکس', 'live');
      } else {
        state.pose = null;
        signal('بدن کامل پیدا نشد', 'wait');
        showMessage({ icon: 'image', title: 'شانه‌ها و لگن باید در عکس باشند', copy: 'یک عکس روبه‌رو و با نور یکنواخت انتخاب کن.', action: pickPhoto, button: 'انتخاب عکس دیگر' });
      }
    });
  } catch (error) {
    console.info('Image fitting:', error.message);
    if (id !== generation) return;
    signal('تحلیل عکس متوقف شد', 'wait');
    showMessage({ icon: 'image', title: 'بارگذاری مدل بدن کامل نشد', copy: 'با اتصال پایدار دوباره امتحان کن.', action: () => runPhoto(generation) });
  }
}

function hint(content) {
  const el = $('stage-guidance');
  el.hidden = !content;
  if (content && el.textContent !== content) el.textContent = content;
}

function completeCalibration(measurements) {
  const height = state.calibration?.sensor.height;
  state.calibration = null;
  syncCameraOptions().catch((error) => cameraFailure(error, generation));
  if (measurements) {
    state.body = { ...measurements, height, source: 'camera' };
    save('measurements', state.body);
    fitIndicator();
    toast('برآورد بدن به «اندازه‌های من» اضافه شد.');
  } else {
    toast('برآورد کامل نشد. قد کامل، روبه‌رو و با دست‌های باز دوباره امتحان کن.');
  }
}

function sense(now) {
  const interval = Math.max(state.quality === 'high' ? 42 : 64, inferenceMs * 1.35);
  if (!canInfer || video.readyState < 2 || now - lastDetect < interval || video.currentTime === videoFrame) return;
  videoFrame = video.currentTime;
  lastDetect = now;
  const id = generation;
  const begin = performance.now();
  try {
    tracker.video(video, now, (result) => {
      const current = result.landmarks[0];
      if (!validPose(current)) return;
      state.pose = smoother.update(current, now);
      state.goodAt = now;
      const scan = state.calibration;
      if (scan && segmenting) {
        try {
          scan.sensor.push(current, result.segmentationMasks?.[0], video.videoWidth / video.videoHeight);
          const measured = scan.sensor.result();
          if (measured) completeCalibration(measured);
        } catch (error) {
          console.info('Calibration mask:', error.message);
          completeCalibration(null);
        }
      }
    });
    inferenceMs = inferenceMs * .66 + (performance.now() - begin) * .34;
  } catch (error) {
    cameraFailure(error, id);
  }
}

function shiftLook(delta) {
  const options = list();
  if (!options.length) return;
  const at = options.findIndex((look) => look.id === state.item.id);
  const next = options[(Math.max(0, at) + options.length + delta) % options.length];
  selectLook(next);
  const card = $$('.look-card').find((el) => el.dataset.look === next.id);
  const listHost = $('garment-list');
  if (card) {
    const a = card.getBoundingClientRect(), b = listHost.getBoundingClientRect();
    if (a.top < b.top || a.bottom > b.bottom) listHost.scrollTop += a.top - b.top;
  }
}
function gestureHint(pose, now) {
  if (!state.gestures || !pose) return null;
  const held = [0, 1].filter((i) => pose.armVisibility[i] && pose.wrists[i].y > pose.shoulders[i].y + .17);
  if (held.length !== 1) {
    gesture = {};
    return null;
  }
  const side = held[0];
  if (gesture.side !== side) gesture = { side, begin: now, fired: false };
  if (gesture.fired) return 'برای تعویض دوباره، اول دست را پایین بیاور.';
  const progress = Math.min(100, (now - gesture.begin) / 9.5);
  if (progress >= 100) {
    shiftLook(side ? 1 : -1);
    gesture.fired = true;
  }
  return `دست را نگه دار · ${number(progress)}٪`;
}

function refreshStage() {
  size = { width: Math.round(stage.clientWidth), height: Math.round(stage.clientHeight) };
  if (size.width && size.height) studio?.resize(size.width, size.height, state.quality);
}
new ResizeObserver(refreshStage).observe(stage);
refreshStage();

function animate(now) {
  requestAnimationFrame(animate);
  if (!gpu() || document.hidden || !size.width || !size.height) return;
  const dt = clamp((now - prevFrame) / 1000, 1 / 200, .046);
  prevFrame = now;
  const live = state.mode === 'live', photo = state.mode === 'photo';
  if (live && state.cameraReady) {
    sense(now);
    const scan = state.calibration;
    if (scan?.started && now - scan.started > 21000) completeCalibration(null);
    if (state.pose && now - state.goodAt > 470) {
      state.pose = null;
      smoother.clear();
      gesture = {};
    }
    const found = Boolean(state.pose);
    signal(found ? 'ردیابی فعال' : 'منتظر قرار گرفتن در قاب', found ? 'live' : 'wait');
  }
  const rect = live || photo ? rectFor() : null;
  const activePose = rect && state.pose
    ? projectRig(state.pose, rect, size.width, size.height, live && state.mirror) : null;
  if (live && (state.cameraReady || state.calibration)) {
    const scan = state.calibration;
    hint(scan ? `تمام‌قد روبه‌رو بایست و دست‌ها را کمی باز کن · ${number(scan.sensor.samples.length)} از ${number(Calibration.count)}`
      : gestureHint(activePose, now) ?? (!activePose ? 'برای پرو، شانه‌ها و لگن را در قاب بگذار.' : null));
  }
  studio.update({ dt, activePose, move: state.move, wind: state.wind && !$('wind').disabled, near: state.near, zoom: 1, quality: state.quality });
  studio.draw(state.compare ? state.split / 100 : 0);
  const input = live && video.readyState >= 2 ? video : photo ? imageCanvas : null;
  composite(overlay, studio, {
    showSkeleton: state.skeleton, occlusion: state.occlusion, input, rect,
    mirror: live && state.mirror, sleeve: cuts[state.item.cut].sleeve,
  });
  frames++;
  if (now - meterStart > 950) {
    const fps = Math.round(frames * 1000 / (now - meterStart));
    $('stage-meter').textContent = meterStart && fps
      ? `${live && state.cameraReady && tracker ? tracker.delegate + ' POSE · ' : ''}WEBGL · ${fps} FPS` : '';
    frames = 0;
    meterStart = now;
  }
}
requestAnimationFrame(animate);

function download(payload, filename) {
  const url = URL.createObjectURL(payload);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function capture() {
  const canvas = document.createElement('canvas');
  const w = size.width, h = size.height;
  const ratio = Math.max(1, Math.min(2, devicePixelRatio || 1));
  canvas.width = w * ratio;
  canvas.height = h * ratio;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  const mode = state.mode;
  ctx.fillStyle = '#171a14';
  ctx.fillRect(0, 0, w, h);
  if (mode === 'live') paintInput(ctx, video, rectFor(), state.mirror);
  if (mode === 'photo') paintInput(ctx, imageCanvas, rectFor(), false);
  if (mode === 'studio') {
    if (gpu()) {
      const grad = ctx.createRadialGradient(w * .53, h * .42, 0, w * .53, h * .5, w * .57);
      grad.addColorStop(0, '#66624c');
      grad.addColorStop(.54, '#3b3c30');
      grad.addColorStop(1, '#1a1d16');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    } else {
      const img = $('poster');
      if (img.complete && img.naturalWidth) paintInput(ctx, img, containRect(img.naturalWidth, img.naturalHeight, w, h), false);
    }
  }
  if (gpu() && studio.draw(state.compare ? state.split / 100 : 0)) {
    ctx.drawImage($('render'), 0, 0, w, h);
    ctx.drawImage(overlay.canvas, 0, 0, w, h);
  }
  canvas.toBlob((blob) => {
    if (!blob) return;
    download(blob, `VFR-${state.item.id}-${state.size}.png`);
    toast('عکس آینه آماده شد.');
  }, 'image/png');
}

$$('[data-mode]').filter((el) => el.tagName === 'BUTTON').forEach((button) => button.addEventListener('click', () => {
  if (state.mode !== button.dataset.mode) chooseMode(button.dataset.mode);
  else if (state.mode === 'live' && !stream && !state.busy) chooseMode('live');
}));
sourceAction.addEventListener('click', () => {
  if (state.mode === 'photo') pickPhoto();
  else chooseMode(state.mode === 'live' && (stream || state.busy) ? 'studio' : 'live');
});
for (const [id, key] of [['motion', 'move'], ['wind', 'wind'], ['compare', 'compare'], ['near', 'near']]) {
  $(id).addEventListener('click', () => {
    state[key] = !state[key];
    if (key === 'move' || key === 'near') studio?.setMode(state.mode);
    updateControls();
  });
}
$('compare-range').addEventListener('input', (event) => {
  state.split = Number(event.currentTarget.value);
  updateControls();
});
$('capture').addEventListener('click', capture);
$('full').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (stage.requestFullscreen) await stage.requestFullscreen();
    else toast('تمام‌صفحه در این مرورگر پشتیبانی نمی‌شود.');
  } catch { toast('نمای تمام‌صفحه در این مرورگر باز نشد.'); }
});
$('quality').addEventListener('change', (event) => {
  state.quality = event.currentTarget.value;
  refreshStage();
});
for (const key of ['mirror', 'occlusion', 'skeleton', 'gestures']) {
  $(key).addEventListener('change', (event) => {
    state[key] = event.currentTarget.checked;
    if (key === 'mirror') video.classList.toggle('mirrored', state.mirror);
  });
}

const fitForm = $('fit-form');
const bodyKeys = ['height', 'chest', 'waist', 'hips'];
const fitFields = () => Object.fromEntries(bodyKeys.flatMap((key) => {
  const value = fitForm.elements[key].valueAsNumber;
  return Number.isFinite(value) ? [[key, value]] : [];
}));

function renderFitTable() {
  const el = $('fit-table');
  const rows = sizes.map((size) => {
    const fit = dimensions(state.item, size);
    const values = [size, ...['chest', 'waist', 'hips', 'length'].map((key) => fit[key] ? number(fit[key]) : '–')];
    return `<tr aria-current="${size === state.size}">${values.map((value) => `<td>${value}</td>`).join('')}</tr>`;
  });
  el.innerHTML = `<table aria-label="اندازه‌های لباس انتخابی بر حسب سانتی‌متر"><thead><tr><th>سایز</th><th>سینه</th><th>کمر</th><th>باسن</th><th>قد لباس</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

fitForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const values = fitFields();
  state.body = Object.keys(values).length ? { ...values, source: 'manual' } : null;
  save('measurements', state.body);
  fitIndicator();
  $('fit-dialog').close();
  toast('اندازه‌ها ثبت شدند.');
});
$('clear-fit').addEventListener('click', () => {
  state.body = null;
  save('measurements', null);
  fitForm.reset();
  fitIndicator();
  toast('اندازه‌های ذخیره‌شده پاک شدند.');
});
$('calibrate').addEventListener('click', () => {
  const field = fitForm.elements.height;
  if (!Number.isFinite(field.valueAsNumber) || !field.checkValidity()) {
    field.focus();
    $('fit-hint').textContent = 'برای کالیبراسیون، ابتدا قد را بین ۱۲۰ تا ۲۱۸ سانتی‌متر وارد کن.';
    return;
  }
  if (!gpu()) {
    $('fit-hint').textContent = 'برآورد دوربینی به WebGL2 نیاز دارد. اندازه‌ها را دستی هم می‌توان وارد کرد.';
    return;
  }
  $('fit-dialog').close();
  if (state.mode !== 'live' || (!state.busy && !stream)) chooseMode('live');
  state.calibration = { sensor: new Calibration(field.valueAsNumber), started: 0 };
  syncCameraOptions().catch((error) => cameraFailure(error, generation));
});

const patternForm = $('pattern-form');
const patternField = (name) => patternForm.elements.namedItem(name);
for (const [key, data] of [['cut', cuts], ['fabric', fabrics]]) {
  for (const [value, option] of Object.entries(data)) patternField(key).add(new Option(option.label, value));
}
function patternLabels() {
  const isSkirt = cuts[patternField('cut').value].family === 'skirt';
  $('pattern-chest').hidden = patternField('chest').disabled = isSkirt;
}
function loadPatternForm(data) {
  for (const key of ['name', 'cut', 'fabric', 'color', 'chest', 'waist', 'hips', 'length']) {
    patternField(key).value = data[key] ?? '';
  }
  patternLabels();
  $('pattern-error').textContent = '';
}

function readPatternForm() {
  return readPattern({
    schema: 1, name: patternField('name').value, cut: patternField('cut').value, fabric: patternField('fabric').value, color: patternField('color').value,
    chest: patternField('chest').valueAsNumber, waist: patternField('waist').valueAsNumber, hips: patternField('hips').valueAsNumber, length: patternField('length').valueAsNumber,
  });
}
patternField('cut').addEventListener('change', () => {
  const ref = catalog.find((item) => item.cut === patternField('cut').value);
  patternField('length').value = cuts[ref.cut].length;
  if (!patternField('chest').value) patternField('chest').value = ref.chest ?? 96;
  patternLabels();
});
patternForm.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    state.custom = readPatternForm();
    save('pattern', patternData(state.custom));
    state.filter = 'custom';
    drawList(true);
    selectLook(state.custom);
    $('pattern-dialog').close();
    toast('قالب در کمد لباس آمادهٔ پرو است.');
  } catch (error) { $('pattern-error').textContent = error.message; }
});
$('import-pattern').addEventListener('click', () => {
  $('pattern-input').value = '';
  $('pattern-input').click();
});
$('pattern-input').addEventListener('change', async (event) => {
  const file = event.currentTarget.files[0];
  if (!file) return;
  try {
    if (file.size > 32_768) throw new Error('فایل قالب باید کمتر از ۳۲ کیلوبایت باشد.');
    const payload = JSON.parse(await file.text());
    const item = readPattern(payload);
    loadPatternForm(patternData(item));
    $('pattern-error').textContent = 'قالب بار شد. برای نمایش، «پرو قالب» را انتخاب کن.';
  } catch (error) {
    $('pattern-error').textContent = error instanceof SyntaxError ? 'فایل JSON معتبر نیست.' : error.message;
  }
});
$('export-pattern').addEventListener('click', () => {
  if (!patternForm.reportValidity()) return;
  try {
    const payload = JSON.stringify(patternData(readPatternForm()), null, 2);
    download(new Blob([payload], { type: 'application/json' }), 'vfr-garment.json');
    $('pattern-error').textContent = '';
  } catch (error) { $('pattern-error').textContent = error.message; }
});

function openDialog(id) {
  if (id === 'fit-dialog') {
    bodyKeys.forEach((key) => { fitForm.elements[key].value = state.body?.[key] ?? ''; });
    $('fit-hint').textContent = state.body?.source === 'camera'
      ? 'این اندازه‌ها برآورد دوربین‌اند. برای انتخاب سایز واقعی می‌توانی مقدار مترخورده را جایگزین کنی.'
      : 'برای برآورد دوربینی، قد را وارد کن و با دست‌های کمی باز روبه‌روی دوربین بایست. ضخامت بدن از یک تصویر تخمین زده می‌شود.';
    renderFitTable();
  }
  if (id === 'pattern-dialog') loadPatternForm(patternData(state.custom ?? state.item));
  $(id).showModal();
}
$$('[data-open]').forEach((button) => button.addEventListener('click', () => openDialog(button.dataset.open)));
$$('[data-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
$$('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
}));
window.addEventListener('pagehide', () => {
  if (state.mode === 'live') chooseMode('studio');
});

drawList();
selectLook(state.item);
chooseMode('studio');
