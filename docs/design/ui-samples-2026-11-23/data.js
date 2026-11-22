// Real catalogue items (catalogue-v2) used by every sample page.
window.MD = {
  logo: 'file:///C:/Users/Admin/Desktop/automart/apps/web/public/brand/mechdost-logo.svg',
  logoDark: 'file:///C:/Users/Admin/Desktop/automart/apps/web/public/brand/mechdost-logo-dark.svg',
  items: [
    {
      img: 'img/oil0.webp',
      brand: 'Castrol',
      name: 'Activ 4T 20W-40 engine oil',
      hi: 'Activ 4T 20W-40 इंजन ऑयल',
      pack: '900 ml',
      price: 499,
      mrp: 525,
      fit: '2W',
      rate: 4.6,
      n: 182,
      stock: 'In stock',
    },
    {
      img: 'img/bat0.webp',
      brand: 'Exide',
      name: 'Xplore 12XL2.5L-C bike battery',
      hi: 'Xplore 12XL2.5L-C बाइक बैटरी',
      pack: '2.5 Ah',
      price: 1099,
      mrp: 1175,
      fit: '2W',
      rate: 4.4,
      n: 64,
      stock: 'In stock',
    },
    {
      img: 'img/oil4.webp',
      brand: 'Castrol',
      name: 'Power1 10W-30 engine oil',
      hi: 'Power1 10W-30 इंजन ऑयल',
      pack: '1 L',
      price: 679,
      mrp: 715,
      fit: '2W',
      rate: 4.7,
      n: 95,
      stock: 'Only 3 left',
    },
    {
      img: 'img/car4.webp',
      brand: 'KELVINN',
      name: 'Chain lube spray (golden)',
      hi: 'चेन ल्यूब स्प्रे (गोल्डन)',
      pack: '150 ml',
      price: null,
      mrp: 280,
      fit: '2W',
      rate: null,
      n: 0,
      stock: 'Price on request',
    },
    {
      img: 'img/bat4.webp',
      brand: 'Tata Green',
      name: 'Roadstar 105E41R car battery',
      hi: 'Roadstar 105E41R कार बैटरी',
      pack: '24+24 months',
      price: 10990,
      mrp: 11676,
      fit: '4W',
      rate: 4.5,
      n: 31,
      stock: 'In stock',
    },
    {
      img: 'img/oil1.webp',
      brand: 'Castrol',
      name: 'GTX 20W-50 engine oil',
      hi: 'GTX 20W-50 इंजन ऑयल',
      pack: '3.5 L',
      price: 1949,
      mrp: 2059,
      fit: '4W',
      rate: 4.5,
      n: 77,
      stock: 'In stock',
    },
    {
      img: 'img/car0.webp',
      brand: 'KELVINN',
      name: 'Aircon Klene AC cleaner',
      hi: 'Aircon Klene AC क्लीनर',
      pack: '150 ml',
      price: 329,
      mrp: 355,
      fit: '4W',
      rate: 4.2,
      n: 12,
      stock: 'In stock',
    },
    {
      img: 'img/oil3.webp',
      brand: 'Castrol',
      name: 'CRB Turbomax 15W-40 diesel oil',
      hi: 'CRB Turbomax 15W-40 डीज़ल ऑयल',
      pack: '7.5 L',
      price: 3299,
      mrp: 3480,
      fit: 'CV',
      rate: 4.6,
      n: 41,
      stock: 'In stock',
    },
  ],
};
const rupee = (n) => '₹' + n.toLocaleString('en-IN');
const star =
  '<svg viewBox="0 0 24 24"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>';
const heart =
  '<svg viewBox="0 0 24 24"><path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/></svg>';
window.card = function (it, hi) {
  const off = it.price ? Math.round((1 - it.price / it.mrp) * 100) : 0;
  const priceRow = it.price
    ? `<span class="price">${rupee(it.price)}</span><span class="mrp">${rupee(it.mrp)}</span><span class="off">${off}% ${hi ? 'छूट' : 'off'}</span>`
    : `<span class="price" style="font-size:15px">MRP ${rupee(it.mrp)}</span><span class="ondem">${hi ? 'कीमत पूछें' : 'Price on request'}</span>`;
  const tag =
    it.stock === 'Only 3 left'
      ? `<span class="tag badge warn">${hi ? 'सिर्फ़ 3 बचे' : 'Only 3 left'}</span>`
      : '';
  const meta = it.rate
    ? `<span class="rate">${it.rate}${star}</span><span>(${it.n})</span><span>· ${it.pack}</span>`
    : `<span>${it.pack}</span>`;
  const btn = it.price
    ? `<button class="add">${hi ? 'कार्ट में डालें' : 'Add to cart'}</button>`
    : `<button class="add ask">${hi ? 'WhatsApp पर पूछें' : 'Ask on WhatsApp'}</button>`;
  return `<a class="pc" href="product.html"><div class="ph"><img src="${it.img}" alt="${it.brand} ${it.name}" loading="lazy">${tag}<button class="fav" aria-label="Save">${heart}</button></div>
  <div class="bd"><span class="br">${it.brand}</span><span class="nm${hi ? ' hi' : ''}">${hi ? it.hi : it.name}</span><span class="meta">${meta}</span><span class="row">${priceRow}</span>${btn}</div></a>`;
};
window.fill = function (sel, list, hi) {
  document
    .querySelectorAll(sel)
    .forEach((el) => (el.innerHTML = list.map((i) => card(MD.items[i], hi)).join('')));
};
window.logos = function () {
  document.querySelectorAll('[data-logo]').forEach((el) => {
    el.innerHTML = `<img class="lg-light" src="${MD.logo}" alt="MechDost"><img class="lg-dark" src="${MD.logoDark}" alt="MechDost">`;
  });
};
window.themeToggle = function () {
  const t = document.querySelector('.toggle');
  if (!t) return;
  t.querySelectorAll('button[data-t]').forEach((b) =>
    b.addEventListener('click', () => {
      document
        .querySelectorAll('[data-themeable]')
        .forEach((f) => f.classList.toggle('dark', b.dataset.t === 'dark'));
      t.querySelectorAll('button[data-t]').forEach((x) => x.classList.toggle('on', x === b));
    }),
  );
};
