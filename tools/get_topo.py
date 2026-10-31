import os, subprocess, concurrent.futures as cf
E0,N0,E1,N1=402000,4608000,405000,4610000
step=500; px=1000
jobs=[]
for e in range(E0,E1,step):
  for n in range(N0,N1,step):
    f=f"topo/t_{e}_{n}.png"
    if os.path.exists(f) and os.path.getsize(f)>10000: continue
    u=("https://geoserveis.icgc.cat/servei/catalunya/mapa-base/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap"
       f"&LAYERS=topografic&STYLES=&CRS=EPSG:25831&BBOX={e},{n},{e+step},{n+step}&WIDTH={px}&HEIGHT={px}&FORMAT=image/png")
    jobs.append((u,f))
def get(j):
  u,f=j; r=subprocess.run(["curl","-sS","-m","120","--retry","3","-o",f,u]); return f,r.returncode
with cf.ThreadPoolExecutor(4) as ex:
  for f,rc in ex.map(get,jobs): print(f,rc,os.path.getsize(f) if os.path.exists(f) else 0)
