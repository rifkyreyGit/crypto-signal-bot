import sys; sys.path.insert(0,sys.argv[1]); from research import *
data=load(); btc=data['BTC']; P={k:prep(v,btc) for k,v in data.items()}
def sim2(x,entry,stop_atr=3.0,be_atr=None,trail_atr=None,tp_atr=None,tp_frac=0.5,ma_exit=True):
    """be_atr: stop pindah ke harga masuk(+biaya) setelah high >= masuk+be_atr*ATR.
    trail_atr: stop = high close tertinggi sejak masuk - trail_atr*ATR.
    tp_atr: ambil untung sebagian (tp_frac) di masuk+tp_atr*ATR, sisanya ikut aturan biasa."""
    o,h,l,c,at,m20=x.o.values,x.h.values,x.l.values,x.c.values,x.atr.values,x.ma20.values
    en=entry.fillna(False).values; idx=x.index; n=len(x); tr=[]; i=0
    while i<n-1:
        if not en[i]: i+=1; continue
        j=i+1; p=o[j]; a=at[i]; stop=p-stop_atr*a; hc=p; part=None; k=j
        while True:
            if l[k]<=stop: px=min(stop,o[k]) if k>j else stop; break
            if tp_atr and part is None and h[k]>=p+tp_atr*a: part=(p+tp_atr*a)/p-1
            if k+1>=n: px=c[k]; break
            if ma_exit and c[k]<m20[k]: px=o[k+1]; k+=1; break
            hc=max(hc,c[k])
            if be_atr and h[k]>=p+be_atr*a: stop=max(stop,p*(1+COST+0.002))
            if trail_atr: stop=max(stop,hc-trail_atr*a)
            k+=1
        r=px/p-1
        if part is not None: r=tp_frac*part+(1-tp_frac)*r
        tr.append((idx[j],r-COST)); i=k+1
    return tr
V={'(base) MA20 exit, stop 3ATR':{},
 'breakeven setelah +1 ATR':dict(be_atr=1),'breakeven setelah +1.5 ATR':dict(be_atr=1.5),'breakeven setelah +2 ATR':dict(be_atr=2),
 'trailing 2 ATR':dict(trail_atr=2),'trailing 3 ATR':dict(trail_atr=3),
 'trailing 3 ATR tanpa MA20':dict(trail_atr=3,ma_exit=False),'trailing 4 ATR tanpa MA20':dict(trail_atr=4,ma_exit=False),
 'TP 50% di +1 ATR':dict(tp_atr=1),'TP 50% di +1.5 ATR':dict(tp_atr=1.5),'TP 50% di +2 ATR':dict(tp_atr=2),
 'TP 50% +1.5ATR & breakeven +1.5ATR':dict(tp_atr=1.5,be_atr=1.5),
 'TP 50% +2ATR & breakeven +2ATR':dict(tp_atr=2,be_atr=2),
}
for adxf in [False,True]:
    print('\nENTRY: base' + (' + ADX>20' if adxf else ''))
    print(f'{"exit":36s} | LATIH n  win%  exp%   pf | UJI n  win%  exp%   pf')
    rows=[]
    for name,kw in V.items():
        trs=[]
        for k,x in P.items():
            e=(x.c>x.hh20)&(x.c>x.ma50)&x.btc_ok&(x.vr>=1.2)
            if adxf:
                up=x.h.diff(); dn=-x.l.diff(); pdm=up.where((up>dn)&(up>0),0.0); ndm=dn.where((dn>up)&(dn>0),0.0)
                pdi=pdm.ewm(alpha=1/14,adjust=False).mean(); ndi=ndm.ewm(alpha=1/14,adjust=False).mean()
                adx=(100*(pdi-ndi).abs()/(pdi+ndi)).ewm(alpha=1/14,adjust=False,min_periods=14).mean(); e=e&(adx>20)
            trs+=sim2(x,e,**kw)
        a=stats([t for t in trs if t[0]<SPLIT]); b=stats([t for t in trs if t[0]>=SPLIT]); rows.append((name,a,b))
    for name,a,b in sorted(rows,key=lambda r:-r[1]['win']):
        print(f'{name:36s} | {a["n"]:4d} {a["win"]:5.1f} {a["exp"]:6.2f} {a["pf"]:5.2f} | {b["n"]:4d} {b["win"]:5.1f} {b["exp"]:6.2f} {b["pf"]:5.2f}')

def detail(kw):
    trs=[]
    for k,x in P.items():
        e=(x.c>x.hh20)&(x.c>x.ma50)&x.btc_ok&(x.vr>=1.2); trs+=sim2(x,e,**kw)
    te=np.array([t[1] for t in trs if t[0]>=SPLIT])
    return f'menang besar(>5%) {np.mean(te>0.05)*100:.0f}% | untung kecil(0-1%) {np.mean((te>0)&(te<=0.01))*100:.0f}% | rugi {np.mean(te<=0)*100:.0f}% | rugi rata2 {te[te<=0].mean()*100:.1f}% | untung rata2 {te[te>0].mean()*100:.1f}%'
for name in ['(base) MA20 exit, stop 3ATR','breakeven setelah +1 ATR','breakeven setelah +1.5 ATR','breakeven setelah +2 ATR']:
    print('UJI', name, '->', detail(V[name]))
