export const fabrics = {
  satin: { label: 'ساتن', roughness: .31, sheen: .67, scale: 3, stiffness: .66, damping: .965, lift: 1.13, folds: 1 },
  silk: { label: 'ابریشم', roughness: .35, sheen: .83, scale: 2, stiffness: .59, damping: .961, lift: 1.28, folds: 1.1 },
  twill: { label: 'گاباردین', roughness: .54, sheen: .27, scale: 3, stiffness: .86, damping: .94, lift: .62, folds: .68 },
  wool: { label: 'پشم', roughness: .72, sheen: .58, scale: 3, stiffness: .89, damping: .929, lift: .52, folds: .61 },
  nylon: { label: 'نایلون', roughness: .43, sheen: .34, scale: 4, stiffness: .73, damping: .95, lift: .85, folds: .85 },
  fleece: { label: 'دورس', roughness: .84, sheen: .39, scale: 4, stiffness: .78, damping: .921, lift: .6, folds: .73 },
};

export const cuts = {
  luna: { label: 'پیراهن تک‌شانه', family: 'dress', length: 122, flare: .64, pleats: 7, sleeve: 0, neck: 'asymmetric' },
  viola: { label: 'پیراهن بنددار', family: 'dress', length: 111, flare: .56, pleats: 6, sleeve: 0, neck: 'slip' },
  siena: { label: 'دامن پلیسه', family: 'skirt', length: 77, flare: .74, pleats: 24, sleeve: 0, neck: 'none' },
  noir: { label: 'کت کمربنددار', family: 'jacket', length: 73, flare: .47, pleats: 5, sleeve: .96, neck: 'lapel' },
  ash: { label: 'بامبر', family: 'jacket', length: 62, flare: .43, pleats: 5, sleeve: .95, neck: 'bomber' },
  cedar: { label: 'بارانی', family: 'coat', length: 113, flare: .57, pleats: 8, sleeve: .96, neck: 'lapel' },
  cobalt: { label: 'هودی', family: 'jacket', length: 67, flare: .46, pleats: 5, sleeve: .98, neck: 'hood' },
  iris: { label: 'کت یقه‌آزاد', family: 'jacket', length: 66, flare: .44, pleats: 5, sleeve: .69, neck: 'lapel' },
};

export const catalog = [
  { id: 'luna', name: 'پیراهن لونا', en: 'Luna', audience: 'women', cut: 'luna', fabric: 'satin',
    colors: ['#882739', '#293952', '#774875'], names: ['زرشکی', 'سرمه‌ای', 'بادمجانی'], tile: '#362226',
    chest: 94, waist: 77, hips: 104, description: 'برش تک‌شانه با دراپهٔ مورب و دامنی که با چرخش باز می‌شود.' },
  { id: 'cedar', name: 'بارانی سِدِر', en: 'Cedar', audience: 'men', cut: 'cedar', fabric: 'twill',
    colors: ['#b28357', '#444d37', '#333335'], names: ['کاراملی', 'زیتونی', 'ذغالی'], tile: '#383128',
    chest: 110, waist: 101, hips: 112, description: 'بارانی کمربنددار با یقهٔ دوبل، سرآستین تسمه‌ای و پایین آزاد.' },
  { id: 'siena', name: 'دامن سیِنا', en: 'Siena', audience: 'women', cut: 'siena', fabric: 'silk',
    colors: ['#ded0b4', '#8f5144', '#426464'], names: ['شامپاینی', 'آجری', 'یشمی'], tile: '#38352e',
    chest: null, waist: 74, hips: 105, description: 'پلیسه‌های ظریف از کمر تا لبه باز می‌شوند و با هر قدم موج می‌گیرند.' },
  { id: 'ash', name: 'بامبر اِش', en: 'Ash', audience: 'men', cut: 'ash', fabric: 'nylon',
    colors: ['#657052', '#344d66', '#783d44'], names: ['خاکی', 'آبی دودی', 'شرابی'], tile: '#28332a',
    chest: 111, waist: 101, hips: 110, description: 'بامبر سبک با جیب آستین، زیپ فلزی و سرآستین کشباف.' },
  { id: 'viola', name: 'پیراهن ویولا', en: 'Viola', audience: 'women', cut: 'viola', fabric: 'silk',
    colors: ['#64428a', '#33534c', '#ad8587'], names: ['بنفش تیره', 'سبز جنگلی', 'رز چرک'], tile: '#362a3a',
    chest: 91, waist: 76, hips: 99, description: 'پیراهن بنددار با یقهٔ نرم، خط کمر محو و حرکت روان ابریشم.' },
  { id: 'noir', name: 'کت نُوآر', en: 'Noir', audience: 'men', cut: 'noir', fabric: 'wool',
    colors: ['#29292e', '#685049', '#39444e'], names: ['مشکی', 'موکا', 'خاکستری آبی'], tile: '#302e34',
    chest: 107, waist: 98, hips: 106, description: 'کت ساختارمند با یقهٔ برگردان، کمربند باریک و دوخت نمایان.' },
  { id: 'iris', name: 'کت آیریس', en: 'Iris', audience: 'women', cut: 'iris', fabric: 'wool',
    colors: ['#d1c5b5', '#888e9b', '#434d3a'], names: ['استخوانی', 'مه‌آلود', 'زیتونی'], tile: '#37332e',
    chest: 100, waist: 86, hips: 103, description: 'کت پشمی روشن با آستین سه‌ربع، یقهٔ آزاد و جیب‌های برش‌دار.' },
  { id: 'cobalt', name: 'هودی کبالت', en: 'Cobalt', audience: 'men', cut: 'cobalt', fabric: 'fleece',
    colors: ['#3e5cbe', '#666776', '#8c5747'], names: ['آبی کبالت', 'خاکستری', 'مسی'], tile: '#272e41',
    chest: 114, waist: 105, hips: 112, description: 'دورس ضخیم با کلاه دولایه، بند و جیب کانگورویی.' },
];

export const sizes = ['XS', 'S', 'M', 'L', 'XL'];
export const sizeSteps = { XS: -8, S: -4, M: 0, L: 4, XL: 8 };
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const asset = (path) => new URL(path, new URL(import.meta.env?.BASE_URL ?? './', document.baseURI)).href;
export const number = (value) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(value);

export function dimensions(item, size = 'M') {
  const step = sizeSteps[size] ?? 0;
  return {
    chest: item.chest == null ? null : item.chest + step,
    waist: item.waist + step,
    hips: item.hips + step,
    length: (item.length ?? cuts[item.cut].length) + step * .35,
  };
}

export function recommendSize(item, body) {
  const targets = item.cut === 'siena' ? ['waist', 'hips'] : ['chest', 'waist', 'hips'];
  if (!targets.every((key) => Number.isFinite(body[key]))) return null;
  const loose = cuts[item.cut].family === 'jacket' || cuts[item.cut].family === 'coat';
  const ease = loose ? { chest: 8, waist: 5, hips: 4 } : { chest: 3, waist: 2, hips: 3 };
  return sizes.find((size) => {
    const fit = dimensions(item, size);
    return targets.every((key) => fit[key] - body[key] >= ease[key]);
  }) ?? 'outside';
}

const numeric = (data, name, min, max) => {
  if (typeof data[name] !== 'number' || !Number.isFinite(data[name]) || data[name] < min || data[name] > max) {
    throw new Error(`مقدار «${name}» باید بین ${min} و ${max} باشد.`);
  }
  return data[name];
};

export function readPattern(data) {
  if (!data || data.schema !== 1 || !Object.hasOwn(cuts, data.cut) || !Object.hasOwn(fabrics, data.fabric)) {
    throw new Error('نسخه، برش یا جنس قالب پشتیبانی نمی‌شود.');
  }
  if (typeof data.name !== 'string' || !data.name.trim() || data.name.trim().length > 48) {
    throw new Error('برای قالب یک نام حداکثر ۴۸ نویسه‌ای وارد کنید.');
  }
  if (typeof data.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(data.color)) {
    throw new Error('رنگ را به شکل #aabbcc وارد کنید.');
  }
  const family = cuts[data.cut].family;
  const lengthRange = { dress: [85, 155], coat: [84, 144], skirt: [38, 112], jacket: [49, 88] };
  return {
    id: 'custom', name: data.name.trim(), en: 'Custom', audience: 'custom',
    cut: data.cut, fabric: data.fabric, colors: [data.color], names: ['سفارشی'], tile: '#33332d',
    chest: family === 'skirt' ? null : numeric(data, 'chest', 65, 170),
    waist: numeric(data, 'waist', 50, 160),
    hips: numeric(data, 'hips', 65, 175),
    length: numeric(data, 'length', ...lengthRange[family]),
    description: 'قالب سفارشی · اندازه‌ها بر حسب سانتی‌متر',
  };
}

export function patternData(item) {
  return {
    schema: 1, name: item.name, cut: item.cut, fabric: item.fabric, color: item.colors[0],
    chest: item.chest, waist: item.waist, hips: item.hips, length: Math.round(dimensions(item).length),
  };
}
