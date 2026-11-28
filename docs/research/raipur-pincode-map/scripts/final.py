import sys,csv,json,re,unicodedata,math,os
sys.path.insert(0,'scripts');sys.stdout.reconfigure(encoding='utf8')
import geo
P=geo.load()
bb={}
for p,pl in P.items():
    xs=[c[0] for poly in pl for r in poly for c in r];ys=[c[1] for poly in pl for r in poly for c in r]
    bb[p]=(min(xs),min(ys),max(xs),max(ys))
def norm(s):
    s=unicodedata.normalize('NFKD',s);s=''.join(c for c in s if not unicodedata.combining(c)).lower()
    s=re.sub(r'\(.*?\)','',s);s=re.sub(r'\b(b\.?o|s\.?o|h\.?o)\b','',s);s=re.sub(r'[^a-z]','',s)
    for a,b in(('aa','a'),('ee','i'),('oo','u'),('ii','i'),('kh','k'),('dh','d'),('bh','b'),('v','w'),('y','i'),('h','')):s=s.replace(a,b)
    return s
ip={}
for x in csv.DictReader(open('pinmap/pins.csv',encoding='utf8',errors='replace')):
    if x['pincode'][:3] in('492','493'):
        ip.setdefault(norm(x['officename']),[]).append((x['pincode'],x['officename']))
OLD={ # name-norm -> (old pin, note) from older aggregators
 norm('Telibandha'):('492006/492007','mapsofindia/other aggregators and company addresses give 492006 or 492007; DoP 2025 polygon says 492001; no 492006/492007 polygon exists in DoP 2025 file'),
 norm('Saddu'):('492007','raipurtalks.com lists Saddu 492007; India Post CSV and DoP polygon say 492014'),
 norm('Shankar Nagar'):('492007','raipurtalks.com lists Shanker Nagar 492007; India Post CSV and DoP polygon say 492004'),
 norm('Krishak Nagar'):('492006','raipurtalks/mapsofindia list Krishaknagar 492006; India Post CSV and DoP polygon say 492012'),
 norm('Ravigram'):('492006','raipurtalks lists Ravigram 492006; India Post CSV says 492001'),
 norm('Labhandih'):('492006','search-result evidence (company address Labhandi) suggests 492006; DoP polygon says 492012'),
 norm('Mowa'):('492001','housing.com lists Mowa under 492001 (search snippet); DoP polygon says 492014'),
 norm('Kachna'):('492014','housing.com lists Kachana 492014 (search snippet) - agrees with polygon'),
}
WEB={ # high: independent web evidence
 norm('Sarona'):('492099','https://villageinfo.in/chhattisgarh/raipur/raipur/sarona/ ; https://www.housing.com/in/buy/projects/page/245902-linc-sarona-heights-by-linc-property-developers-ltd-in-sarona ; founder ground truth (lives in Raipur)'),
 norm('Tatibandh'):('492099','https://www.citizennest.com/pincode/chattisgarh/raipur (copy of India Post) ; https://raipur.gov.in/?p=25613 (AIIMS Raipur directory entry, Tatibandh 492099)'),
}
DOP_URL='https://aikosh.indiaai.gov.in/home/datasets/details/all_india_pincode_boundary_geo_json.html (OGD India; copy used: https://geo.bharatviz.org/geojsons/pincodes/chhattisgarh.geojson)'
IP_URL='https://www.indiapost.gov.in/vas/pages/findpincode.aspx (India Post directory CSV, scratchpad pins.csv)'
C0=(21.2381,81.6337)
def dkm(la,lo): return math.hypot((la-C0[0])*111.2,(lo-C0[1])*103.8)
def edge(lo,la,pin):
    best=None
    for p in bb:
        if p==pin: continue
        b=bb[p]
        if b[0]-0.004<=lo<=b[2]+0.004 and b[1]-0.004<=la<=b[3]+0.004:
            d=geo.dist_m(lo,la,P,p)
            if best is None or d<best[0]: best=(d,p)
    return best
cand=[]
for r in json.load(open('rows_gn.json',encoding='utf8')):
    if dkm(r['lat'],r['lon'])>27: continue
    cand.append(dict(en=r['en'],hi=r['hi'],lat=r['lat'],lng=r['lon'],cs='geonames:'+r['gn']+' (https://www.geonames.org/'+r['gn']+')',pin=r['pins'][0],ft=r['ftype']))
gnn={(norm(c['en'])):c for c in cand}
# OSM extras
skip={'residential area','apartment','site plot','osm studio','math','raipur','chhattisgarh','durg','bemetara'}
for e in json.load(open('ov/o1.json',encoding='utf8'))['elements']:
    t=e['tags']
    if e['type']=='relation' or t['name'].lower() in skip: continue
    if t.get('place') in('city',) and 'Atal' not in t['name']: continue
    c=e.get('center') or e;la,lo=c['lat'],c['lon']
    if dkm(la,lo)>27: continue
    pin=geo.find(P,lo,la)
    if not pin: continue
    dup=any(norm(t['name'])==norm(x['en']) and abs(x['lat']-la)<0.02 and abs(x['lng']-lo)<0.02 for x in cand)
    if dup:
        for x in cand:
            if norm(t['name'])==norm(x['en']) and abs(x['lat']-la)<0.02: x['cs']+=f"; osm {e['type']}/{e['id']}"; x['hi']=x['hi'] or t.get('name:hi','')
        continue
    cand.append(dict(en=t['name'],hi=t.get('name:hi',''),lat=la,lng=lo,cs=f"osm {e['type']}/{e['id']} (https://www.openstreetmap.org/{e['type']}/{e['id']})",pin=pin[0],ft=t.get('place') or t.get('landuse')))
out=[];stat={}
for x in cand:
    n=norm(x['en']);pin=x['pin'];notes=[];srcs=[DOP_URL]
    conf='medium'
    ipm=ip.get(n,[])
    samep=[m for m in ipm if m[0]==pin]
    diff=[m for m in ipm if m[0]!=pin]
    if samep:
        srcs.append(IP_URL);notes.append(f'India Post office name "{samep[0][1]}" is in the same PIN (same DoP family, not independent of the polygon)')
    elif diff:
        conf='low';notes.append('name matches India Post office(s) with other PIN: '+', '.join(f'{a} {b}' for a,b in diff[:4])+' (possible same-name village; check)')
    if n in OLD:
        old,msg=OLD[n]
        if old!=pin and msg and 'agrees' not in msg: conf='low'
        notes.append('CONFLICT: '+msg)
    if n in WEB and WEB[n][0]==pin:
        conf='high';srcs.append(WEB[n][1])
    ed=edge(x['lng'],x['lat'],pin)
    if ed and ed[0]<250:
        notes.append(f'within {int(ed[0])} m of PIN {ed[1]} polygon edge (polygons simplified; may be wrong side)')
        if conf=='medium': conf='low'
    notes.append(f'class {x["ft"]}')
    out.append([x['en'],x['hi'],pin,round(x['lat'],5),round(x['lng'],5),x['cs'],' ; '.join(srcs),conf,' | '.join(notes)])
    stat[conf]=stat.get(conf,0)+1
out.sort(key=lambda r:(r[2],r[0]))
os.makedirs('out',exist_ok=True)
with open('out/localities.csv','w',encoding='utf8',newline='') as f:
    w=csv.writer(f);w.writerow(['name_en','name_hi','pin','lat','lng','coord_source','pin_sources','confidence','notes']);w.writerows(out)
print(len(out),stat)
import collections
print(sorted(collections.Counter(r[2] for r in out).items()))
