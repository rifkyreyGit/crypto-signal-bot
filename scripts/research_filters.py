import sys,json; sys.path.insert(0,sys.argv[1]); from research import *
data=load(); btc=data['BTC']
fng=pd.Series({pd.Timestamp(int(r['timestamp']),unit='s'):int(r['value']) for r in json.load(open(sys.argv[1]+'/fng.json'))['data']}).sort_index()
P={k:prep(v,btc) for k,v in data.items()}
# fitur tambahan (semua hanya memakai data sampai hari t)
def adx(d,n=14):
    up=d.h.diff(); dn=-d.l.diff()
    pdm=up.where((up>dn)&(up>0),0.0); ndm=dn.where((dn>up)&(dn>0),0.0)
    a=d.atr; pdi=100*pdm.ewm(alpha=1/n,adjust=False).mean()/a; ndi=100*ndm.ewm(alpha=1/n,adjust=False).mean()/a
    dx=100*(pdi-ndi).abs()/(pdi+ndi); return dx.ewm(alpha=1/n,adjust=False,min_periods=n).mean()
btcc=btc.close; btc_r30=btcc.pct_change(30)
above50=pd.concat({k:(x.c>x.ma50).where(x.ma50.notna()) for k,x in P.items()},axis=1)
breadth=above50.mean(axis=1)
for k,x in P.items():
    x['adx']=adx(x); x['ma20up']=x.ma20>x.ma20.shift(5); x['ma50_200']=x.ma50>x.ma200
    x['clv']=(x.c-x.l)/(x.h-x.l).replace(0,np.nan)
    x['ext']=(x.c-x.ma20)/x.atr
    x['atrp']=x.atr/x.c
    x['rs30']=x.c.pct_change(30)-btc_r30.reindex(x.index)
    x['fng']=fng.reindex(x.index).ffill()
    x['breadth']=breadth.reindex(x.index)
    x['btc50']=(btcc>btcc.rolling(50).mean()).reindex(x.index).ffill().fillna(False)
    x['wk']=x.c>x.c.rolling(70).mean()  # ~MA10 mingguan
base=lambda x:(x.c>x.hh20)&(x.c>x.ma50)&x.btc_ok&(x.vr>=1.2)
F={'(base)':lambda x:True,
 'ADX>20':lambda x:x.adx>20,'ADX>25':lambda x:x.adx>25,
 'RSI14<75':lambda x:x.rsi14<75,'RSI14<70':lambda x:x.rsi14<70,
 'MA20 naik':lambda x:x.ma20up,'MA50>MA200':lambda x:x.ma50_200,
 'close di 30% atas range':lambda x:x.clv>=0.7,'close di 50% atas range':lambda x:x.clv>=0.5,
 'tidak terlalu jauh (ext<3ATR)':lambda x:x.ext<3,'ext<2ATR':lambda x:x.ext<2,
 'ATR% < 8%':lambda x:x.atrp<0.08,
 'lebih kuat dari BTC 30h':lambda x:x.rs30>0,
 'BTC > MA50 juga':lambda x:x.btc50,'tren mingguan naik':lambda x:x.wk,
 'F&G < 75 (bukan serakah ekstrem)':lambda x:x.fng<75,'F&G > 25':lambda x:x.fng>25,'F&G 40-75':lambda x:x.fng.between(40,75),
 'breadth > 50%':lambda x:x.breadth>0.5,'breadth > 60%':lambda x:x.breadth>0.6,
}
def evalf(fs):
    trs=[]
    for k,x in P.items():
        e=base(x)
        for f in fs: e=e&F[f](x)
        trs+=sim(x,e.fillna(False) if hasattr(e,'fillna') else e,x.c<x.ma20,stop_atr=3.0)
    return stats([t for t in trs if t[0]<SPLIT]),stats([t for t in trs if t[0]>=SPLIT])
res={f:evalf([f]) for f in F}
bn=res['(base)'][0]['n']
print(f'{"filter":34s} | LATIH n  win%  exp%   pf | UJI n  win%  exp%   pf')
for f,(a,b) in sorted(res.items(),key=lambda r:-r[1][0]['win']):
    flag='*' if a['n']>=0.6*bn and a['pf']>=res['(base)'][0]['pf']*0.9 else ' '
    print(f'{flag}{f:33s} | {a["n"]:4d} {a["win"]:5.1f} {a["exp"]:6.2f} {a["pf"]:5.2f} | {b["n"]:4d} {b["win"]:5.1f} {b["exp"]:6.2f} {b["pf"]:5.2f}')
# kombinasi: ambil 3 filter bertanda * dengan win latih tertinggi, uji kombinasi berpasangan
top=[f for f,(a,b) in sorted(res.items(),key=lambda r:-r[1][0]['win']) if f!='(base)' and a['n']>=0.6*bn and a['pf']>=res['(base)'][0]['pf']*0.9][:4]
print('\nKOMBINASI dari', top)
import itertools
for c in itertools.combinations(top,2):
    a,b=evalf(list(c)); print(f'{" + ".join(c):60s} | {a["n"]:4d} {a["win"]:5.1f} {a["exp"]:6.2f} {a["pf"]:5.2f} | {b["n"]:4d} {b["win"]:5.1f} {b["exp"]:6.2f} {b["pf"]:5.2f}')
