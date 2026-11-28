import json,math
def load(path='bv/cg.geojson'):
    d=json.load(open(path,encoding='utf8'))
    polys={}  # pin -> list of (ring list) with bbox
    for f in d['features']:
        p=f['properties']['pincode']
        g=f['geometry']
        mp=g['coordinates'] if g['type']=='MultiPolygon' else [g['coordinates']]
        for poly in mp:
            polys.setdefault(p,[]).append(poly)
    return polys
def inring(x,y,ring):
    c=False;n=len(ring);j=n-1
    for i in range(n):
        xi,yi=ring[i][0],ring[i][1];xj,yj=ring[j][0],ring[j][1]
        if (yi>y)!=(yj>y) and x<(xj-xi)*(y-yi)/(yj-yi)+xi: c=not c
        j=i
    return c
def inpoly(x,y,poly):
    if not inring(x,y,poly[0]): return False
    return not any(inring(x,y,h) for h in poly[1:])
def find(polys,x,y):
    return sorted({p for p,pl in polys.items() if any(inpoly(x,y,q) for q in pl)})
def dist_m(x,y,polys,pin):
    best=1e18
    k=111320.0;kx=k*math.cos(math.radians(y))
    for poly in polys[pin]:
        for ring in poly:
            for i in range(len(ring)-1):
                ax,ay=ring[i][0]*kx,ring[i][1]*k;bx,by=ring[i+1][0]*kx,ring[i+1][1]*k;px,py=x*kx,y*k
                dx,dy=bx-ax,by-ay;L=dx*dx+dy*dy
                t=0 if L==0 else max(0,min(1,((px-ax)*dx+(py-ay)*dy)/L))
                best=min(best,math.hypot(px-ax-t*dx,py-ay-t*dy))
    return best
