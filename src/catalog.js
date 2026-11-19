export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export const asset = (path) => new URL(path, new URL(import.meta.env?.BASE_URL ?? './', document.baseURI)).href;
const fa = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 });
export const show = (value) => fa.format(value);
export const cm = (mm) => show(mm / 10);

export const fabrics = {
  gabardine: { name: 'گاباردین پنبه', roughness: .62, sheen: .26, softness: .37, thickness: .0024, thread: 'diagonal' },
  satin: { name: 'ساتن ابریشم', roughness: .32, sheen: .57, softness: .84, thickness: .0012, thread: 'fine' },
  wool: { name: 'پشم جناغی', roughness: .72, sheen: .39, softness: .34, thickness: .0033, thread: 'diagonal' },
  suede: { name: 'جیر', roughness: .73, sheen: .17, softness: .38, thickness: .0030, thread: 'grain' },
  silk: { name: 'ابریشم پلیسه', roughness: .43, sheen: .60, softness: .89, thickness: .0013, thread: 'fine' },
  knit: { name: 'بافت ریب', roughness: .69, sheen: .48, softness: .64, thickness: .0030, thread: 'rib' },
  optical: { name: 'استات و فلز', roughness: .29, sheen: 0, softness: 0, thickness: .003, thread: 'fine' },
};

export const metrics = {
  chest: { label: 'دور سینه', range: [600, 1700] },
  waist: { label: 'دور کمر', range: [470, 1660] },
  hip: { label: 'دور باسن', range: [610, 1740] },
  shoulder: { label: 'عرض شانه', range: [260, 620] },
  sleeve: { label: 'طول دست', range: [400, 820] },
  height: { label: 'قد', range: [1350, 2180] },
  eye: { label: 'فاصلهٔ مردمک‌ها', range: [48, 81] },
  bridge: { label: 'عرض پل بینی', range: [12, 28] },
};

const body = (height, chest, waist, hip, shoulder, sleeve) => ({ height, chest, waist, hip, shoulder, sleeve });
export const forms = [
  { id: 'f36', label: 'زنانه ۳۶ · قد ۱۶۸', shape: 'female', measure: body(1680, 860, 680, 930, 368, 550) },
  { id: 'f44', label: 'زنانه ۴۴ · قد ۱۷۲', shape: 'female', measure: body(1720, 1010, 850, 1080, 408, 578) },
  { id: 'f50', label: 'زنانه ۵۰ · قد ۱۶۶', shape: 'female', measure: body(1660, 1160, 1040, 1240, 442, 565) },
  { id: 'm48', label: 'مردانه ۴۸ · قد ۱۸۰', shape: 'male', measure: body(1800, 970, 820, 980, 436, 624) },
  { id: 'm56', label: 'مردانه ۵۶ · قد ۱۸۶', shape: 'male', measure: body(1860, 1135, 1000, 1130, 493, 655) },
];
export const form = (id) => forms.find((v) => v.id === id) ?? forms[0];
export const fitModes = {
  full: { label: 'تمام‌قد', title: 'تمام‌قد روبه‌روی دوربین بایست', description: 'شانه‌ها، لگن و مچ پا داخل قاب باشند.' },
  upper: { label: 'از کمر به بالا', title: 'شانه‌ها و صورت را در قاب بگیر', description: 'برای کت، ژاکت و بالاتنه.' },
  face: { label: 'فقط صورت', title: 'صورتت را به‌طور کامل در قاب بگیر', description: 'برای پرو فریم. سرت را آرام به چپ و راست بچرخان.' },
};

const ease = {
  coat: { chest: [105, 244], waist: [87, 255], hip: [95, 240], shoulder: [-10, 38], sleeve: [-12, 50] },
  jacket: { chest: [72, 169], waist: [66, 183], hip: [65, 185], shoulder: [-12, 28], sleeve: [-15, 38] },
  dress: { chest: [30, 110], waist: [28, 117], hip: [38, 158] },
  skirt: { waist: [14, 59], hip: [40, 185] },
  knit: { chest: [-30, 123], waist: [-18, 155], shoulder: [-26, 27], sleeve: [-33, 43] },
  glasses: { eye: [-6, 6], bridge: [-2, 2] },
};

function sizes(prefix, labels, base, grade) {
  const middle = Math.floor(labels.length / 2);
  return labels.map((label, index) => ({
    label, sku: `${prefix}-${label.replace(/[^a-zA-Z0-9.-]+/g, '-')}`,
    garment: Object.fromEntries(Object.entries(base).map(([key, value]) => [key, value + (index - middle) * (grade[key] ?? 0)])),
    toleranceMm: base.eye ? .6 : 5,
  }));
}

const women = ['32', '34', '36', '38', '40', '42', '44', '46', '48', '50', '52'];
const men = ['42', '44', '46', '48', '50', '52', '54', '56', '58', '60', '62'];
const profile = {
  coat: { chest: 42, waist: 44, hip: 41, shoulder: 9, sleeve: 6, length: 8 },
  dress: { chest: 42, waist: 43, hip: 42, shoulder: 9, length: 8 },
  skirt: { waist: 39, hip: 42, length: 6 },
};

const look = (x) => ({ ...x, source: 'atelier', availability: 'demo', ease: ease[x.cut], colors: x.colors.map(([label, value]) => ({ label, value })) });
export const catalog = [
  look({ id: 'terra', title: 'بارانی تِرا', english: 'TERRA', audience: 'women', cut: 'coat', form: 'f36', frame: 'full',
    fabric: 'gabardine', colors: [['کاراملی','#937057'],['زغالی','#343938'],['زیتونی','#555848']],
    description: 'بارانی دوردیفه با یقهٔ برگردان، کمربند چفت‌دار و دامن آزاد.',
    sizes: sizes('TRA', women, { chest: 1138, waist: 989, hip: 1222, shoulder: 420, sleeve: 594, length: 1068 }, profile.coat) }),
  look({ id: 'celeste', title: 'پیراهن سِلِست', english: 'CELESTE', audience: 'women', cut: 'dress', form: 'f36', frame: 'full',
    fabric: 'satin', colors: [['شرابی','#753044'],['یشمی','#305950'],['بنفش دودی','#554660']],
    description: 'ساتن مات با یقهٔ دراپه، بند باریک و دامن اریب.',
    sizes: sizes('CLS', women, { chest: 1006, waist: 864, hip: 1125, shoulder: 392, length: 1150 }, profile.dress) }),
  look({ id: 'meridian', title: 'کت مِریدین', english: 'MERIDIAN', audience: 'men', cut: 'jacket', form: 'm48', frame: 'upper',
    fabric: 'wool', colors: [['گرافیت','#343b43'],['قهوه‌ای دودی','#57443d'],['آبی نفتی','#2b4a53']],
    description: 'کت پشمی با سرشانهٔ ساختارمند، یقهٔ شکاف‌دار و سرآستین دکمه‌خور.',
    sizes: sizes('MER', men, { chest: 1155, waist: 1018, hip: 1108, shoulder: 482, sleeve: 654, length: 741 }, profile.coat) }),
  look({ id: 'orion', title: 'ژاکت اُریون', english: 'ORION', audience: 'men', cut: 'jacket', form: 'm48', frame: 'upper',
    fabric: 'suede', colors: [['دارچینی','#845340'],['خاکی','#6a6b55'],['دودی','#4a4551']],
    description: 'ژاکت جیر با یقهٔ ایستاده، زیپ فلزی و کمر کشباف.',
    sizes: sizes('ORN', men, { chest: 1182, waist: 1035, hip: 1092, shoulder: 474, sleeve: 652, length: 662 }, profile.coat) }),
  look({ id: 'solene', title: 'دامن سولِن', english: 'SOLÈNE', audience: 'women', cut: 'skirt', form: 'f44', frame: 'full',
    fabric: 'silk', colors: [['صدفی','#bbad93'],['لاجوردی','#364b76'],['آجری','#834a3d']],
    description: 'پلیسه‌های تیز با کمربند تخت و لبهٔ متحرک.',
    sizes: sizes('SLN', women, { waist: 859, hip: 1120, length: 762 }, profile.skirt) }),
  look({ id: 'rune', title: 'پلیور رون', english: 'RUNE', audience: 'men', cut: 'knit', form: 'm48', frame: 'upper',
    fabric: 'knit', colors: [['استخوانی','#bcb29f'],['لاجوردی','#354b63'],['بورگاندی','#5a303b']],
    description: 'بافت ریب با یقهٔ گرد، کشباف سرآستین و درز برجستهٔ شانه.',
    sizes: sizes('RUN', men, { chest: 1080, waist: 996, hip: 1050, shoulder: 449, sleeve: 638, length: 645 }, profile.coat) }),
  look({ id: 'linea', title: 'فریم لینئا', english: 'LINEA', audience: 'accessory', cut: 'glasses', form: 'f36', frame: 'face',
    fabric: 'optical', colors: [['لاک‌پشتی','#6b4933'],['مشکی','#20252a'],['شیری','#b9a485']],
    description: 'فریم کشیدهٔ استات با دستهٔ باریک و لولاهای فلزی.',
    sizes: sizes('LIN', ['48/18', '50/19', '52/20'], { eye: 63, bridge: 19, width: 136 }, { eye: 3, bridge: 1, width: 4 }) }),
  look({ id: 'arc', title: 'فریم آرک', english: 'ARC', audience: 'accessory', cut: 'glasses', form: 'm48', frame: 'face',
    fabric: 'optical', colors: [['برنز','#a08663'],['گرافیت','#424850'],['زیتونی','#646753']],
    description: 'فریم گرد با پل دوبل و عدسی شفاف.',
    sizes: sizes('ARC', ['47/18', '49/19', '51/20'], { eye: 64, bridge: 19, width: 137 }, { eye: 3, bridge: 1, width: 4 }) }),
];

export function compatible(item, mode) {
  if (mode === 'face') return item.frame === 'face';
  if (mode === 'upper') return item.frame === 'upper';
  return item.frame !== 'face';
}

export function startingSize(item, reference = form(item.form).measure) {
  const key = Object.keys(item.ease)[0];
  const target = reference[key];
  if (!Number.isFinite(target)) return item.sizes[0];
  const [lo, hi] = item.ease[key];
  const mid = (lo + hi) / 2;
  return item.sizes.reduce((best, size) =>
    Math.abs(size.garment[key] - target - mid) < Math.abs(best.garment[key] - target - mid) ? size : best, item.sizes[0]);
}
