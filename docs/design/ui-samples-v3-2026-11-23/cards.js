// Product cards for the round 3 samples. Fixed sample data only (the live demo catalogue's products and prices).
const IMG = '../ui-samples-2026-11-23/img/';
const ITEMS = [
  {
    img: 'oil0.webp',
    brand: 'Castrol',
    ref: 'CAS-ACT4T-0900',
    cat: 'Lubricants',
    name: 'Castrol Activ 4T 20W40 900 ml',
    rate: '4.6',
    n: 189,
    price: '₹440',
    unit: '₹488.89 per litre',
    tags: ['Bestseller', '2W'],
  },
  {
    img: 'bat0.webp',
    brand: 'Exide',
    ref: 'EXI-12XL2.5L-C',
    cat: 'Batteries',
    name: 'Exide Xplore 12XL2.5L-C',
    rate: '4.7',
    n: 230,
    price: '₹1,175',
    unit: '12 V · 2.5 Ah',
    tags: ['Bestseller', '2W'],
  },
  {
    img: 'car2.webp',
    brand: 'KELVINN',
    ref: 'KLV-BRAKEKLENE-100',
    cat: 'Car care',
    name: 'KELVINN Brake Klene Plus 100 ml',
    rate: '4.4',
    n: 38,
    price: '₹250',
    unit: '₹2.50 per ml',
    tags: ['2W', '4W'],
  },
  {
    img: 'bat4.webp',
    brand: 'Tata Green',
    ref: 'TGB-105E41R',
    cat: 'Batteries',
    name: 'Tata Green Roadstar 105E41R',
    rate: '4.5',
    n: 31,
    price: '₹11,676',
    unit: '12 V · 80 Ah',
    tags: ['4W'],
  },
  {
    img: 'oil1.webp',
    brand: 'Castrol',
    ref: 'CAS-GTX-2050-3.5L',
    cat: 'Lubricants',
    name: 'Castrol GTX 20W-50 3.5 L',
    rate: '4.5',
    n: 77,
    price: '₹2,059',
    unit: '₹588.29 per litre',
    tags: ['4W'],
  },
  {
    img: 'car0.webp',
    brand: 'KELVINN',
    ref: 'KLV-AIRCON-150',
    cat: 'Car care',
    name: 'KELVINN Aircon Klene 150 ml',
    rate: '4.2',
    n: 12,
    price: '₹355',
    unit: '₹2.37 per ml',
    tags: ['4W'],
  },
  {
    img: 'car4.webp',
    brand: 'KELVINN',
    ref: 'KLV-CHAINLUBE-150',
    cat: 'Car care',
    name: 'KELVINN Chain Lube Spray (Golden) 150 ml',
    rate: null,
    n: 0,
    price: null,
    unit: 'MRP ₹280',
    tags: ['2W'],
  },
  {
    img: 'oil3.webp',
    brand: 'Castrol',
    ref: 'CAS-CRB-1540-7.5L',
    cat: 'Lubricants',
    name: 'Castrol CRB Turbomax 15W-40 7.5 L',
    rate: '4.6',
    n: 41,
    price: '₹3,480',
    unit: '₹464 per litre',
    tags: ['Trucks'],
  },
];
const STAR =
  '<svg viewBox="0 0 24 24"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>';
function cardHtml(it, compact) {
  const tags = it.tags
    .map((t) => `<span class="tag${t === 'Bestseller' ? ' hot' : ''}">${t}</span>`)
    .join('');
  const rating = it.rate ? `<span class="rating">${STAR}${it.rate} <small>(${it.n})</small></span>` : '';
  const price = it.price
    ? `<span><span class="price">${it.price}</span><br><span class="unit">${it.unit}</span></span><span class="stock">In stock</span>`
    : `<span><span class="price" style="font-size:17px">${it.unit}</span><br><span class="unit">Price on request</span></span>`;
  const actions = compact
    ? `<button class="addc">${it.price ? 'Add to cart' : 'Ask for price'}</button>`
    : `<div class="pactions"><span class="cmp"><i></i>Compare</span><button class="addc">${it.price ? 'Add to cart' : 'Ask for price'}</button></div>`;
  return `<article class="pcard"><div class="plate"><span class="brand">${it.brand}</span>${compact ? '' : `<span class="info" aria-label="Product details"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg></span>`}<img src="${IMG}${it.img}" alt="" loading="lazy"><span class="ref">${it.ref}</span></div>
  <div class="pbody"><div class="tags">${tags}</div><a class="pname" href="product.html">${it.name}</a>${rating}<div class="priceline">${price}</div>${actions}</div></article>`;
}
function fillCards(id, idx, compact) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = idx.map((i) => cardHtml(ITEMS[i], compact)).join('');
}
