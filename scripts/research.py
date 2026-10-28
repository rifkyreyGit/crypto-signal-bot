import glob, itertools, numpy as np, pandas as pd
D='/Users/rey/Projects/freqtrade/user_data/data/indodax/'
COST=0.0030*2+0.002   # fee 0.3%/sisi + slippage total 0.2%
SPLIT=pd.Timestamp('2023-01-01')
def load():
    out={}
    for f in sorted(glob.glob(D+'*_IDR-1d.feather')):
        d=pd.read_feather(f)
        if len(d)<300: continue
        d['date']=pd.to_datetime(d['date'],utc=True).dt.tz_localize(None)
        d=d.set_index('date'); out[f.split('/')[-1].split('_')[0]]=d
    return out
def rsi(c,n):
    dl=c.diff(); g=dl.clip(lower=0).ewm(alpha=1/n,adjust=False,min_periods=n).mean()
    l=(-dl.clip(upper=0)).ewm(alpha=1/n,adjust=False,min_periods=n).mean(); return 100-100/(1+g/l)
def atr(d,n=14):
    pc=d.close.shift(); tr=pd.concat([d.high-d.low,(d.high-pc).abs(),(d.low-pc).abs()],axis=1).max(axis=1)
    return tr.ewm(alpha=1/n,adjust=False,min_periods=n).mean()
def prep(d,btc):
    c=d.close; x=pd.DataFrame(index=d.index)
    x['o'],x['h'],x['l'],x['c']=d.open,d.high,d.low,d.close
    x['ma20']=c.rolling(20).mean(); x['ma50']=c.rolling(50).mean(); x['ma200']=c.rolling(200).mean()
    x['rsi14']=rsi(c,14); x['rsi3']=rsi(c,3); x['vr']=d.volume/d.volume.rolling(20).mean()
    x['atr']=atr(d); x['hh20']=d.high.rolling(20).max().shift(1)
    x['ma50up']=x.ma50>x.ma50.shift(5)
    b=btc.close; x['btc_ok']=(b>b.rolling(100).mean()).reindex(x.index).ffill().fillna(False)
    return x
def baseline_sig(x):
    up=x.ma20>x.ma50
    k=(x.c>x.ma20).astype(int)+x.rsi14.between(45,70).astype(int)+(x.vr>=1).astype(int)
    entry=up&(k>=2)
    dn=x.ma20<x.ma50; kx=(x.c<x.ma20).astype(int)+(x.rsi14<45).astype(int)+(x.vr>=1).astype(int)
    return entry,(dn&(kx>=1))
def sim(x,entry,exit_sig,stop_atr=None,tp_atr=None,max_hold=None):
    """sinyal di close t -> masuk di open t+1. Keluar: sinyal exit (open t+1), stop/TP intraday, atau maks hari."""
    o,h,l,c,at=x.o.values,x.h.values,x.l.values,x.c.values,x.atr.values
    en=entry.fillna(False).values; ex=exit_sig.fillna(False).values; idx=x.index; tr=[]; i=0; n=len(x)
    while i<n-1:
        if en[i]:
            j=i+1; p=o[j]; a=at[i]
            stp=p-stop_atr*a if stop_atr else None; tp=p+tp_atr*a if tp_atr else None
            k=j; r=None
            while True:
                if stp is not None and l[k]<=stp: r=(min(stp,o[k]) if k>j else stp)/p-1; break
                if tp is not None and h[k]>=tp: r=tp/p-1; break
                if max_hold and k-j+1>=max_hold: r=c[k]/p-1; break
                if k+1>=n: r=c[k]/p-1; break
                if ex[k]: r=o[k+1]/p-1; k+=1; break
                k+=1
            tr.append((idx[j],r-COST)); i=k+1
        else: i+=1
    return tr
def stats(tr):
    if not tr: return dict(n=0,win=np.nan,exp=np.nan,pf=np.nan,tot=np.nan)
    r=np.array([t[1] for t in tr]); w=r[r>0]; ls=r[r<=0]
    return dict(n=len(r),win=100*len(w)/len(r),exp=100*r.mean(),pf=(w.sum()/-ls.sum()) if ls.sum()<0 else np.inf,tot=100*r.sum())
def strategies():
    S={}
    S['baseline']=lambda x:(*baseline_sig(x),dict())
    for rl,st,mh in itertools.product([10,20,30],[2.0,3.0,4.0],[10,20]):
        S[f'pullback rsi3<{rl} stop{st} hold{mh}']=(lambda rl,st,mh:lambda x:(
            (x.c>x.ma50)&x.ma50up&(x.rsi3<rl)&x.btc_ok, (x.c>x.ma20)|(x.rsi3>70), dict(stop_atr=st,max_hold=mh)))(rl,st,mh)
    for lk,st in itertools.product([2.0,3.0,4.0],[None]):
        pass
    S['donchian20+btc trail-ma20']=lambda x:((x.c>x.hh20)&(x.c>x.ma50)&x.btc_ok&(x.vr>=1.2),(x.c<x.ma20),dict(stop_atr=3.0))
    return S
def run(S,data,btc):
    rows=[]
    P={k:prep(v,btc) for k,v in data.items()}
    for name,f in S.items():
        trs=[]; 
        for k,x in P.items():
            e,xx,kw=f(x); trs+=sim(x,e,xx,**kw)
        tr_=[t for t in trs if t[0]<SPLIT]; te=[t for t in trs if t[0]>=SPLIT]
        a,b=stats(tr_),stats(te); rows.append((name,a,b))
    return rows
if __name__=='__main__':
    data=load(); btc=data['BTC']; rows=run(strategies(),data,btc)
    print(f'{"strategi":42s} | TRAIN n win% exp% pf | TEST n win% exp% pf')
    for n,a,b in sorted(rows,key=lambda r:-(r[1]['exp'] if r[1]['n']>=40 else -99))[:14]+[r for r in rows if r[0]=='baseline' or r[0].startswith('donchian')]:
        print(f'{n:42s} | {a["n"]:4d} {a["win"]:5.1f} {a["exp"]:6.2f} {a["pf"]:4.2f} | {b["n"]:4d} {b["win"]:5.1f} {b["exp"]:6.2f} {b["pf"]:4.2f}')


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
