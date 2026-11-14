import numpy as np, soundfile as sf, subprocess
SR=24000; DUR=115.5; N=int(DUR*SR); t=np.arange(N)/SR; O=31
rs=np.random.RandomState(4)
def load(f,gain=1.0):
    a,sr=sf.read(f); a=a if a.ndim==1 else a.mean(1)
    if sr!=SR: a=np.interp(np.arange(0,len(a),sr/SR),np.arange(len(a)),a)
    return a*gain
def put(buf,a,at):
    i=int(at*SR); j=min(N,i+len(a))
    if i<N: buf[i:j]+=a[:j-i]
def env(a,b,fi,fo): return np.clip((t-a)/fi,0,1)*np.clip((b-t)/fo,0,1)
def thump(buf,bt,g):
    k=int(bt*SR); L=int(.18*SR); tt=np.arange(L)/SR
    if k+L<N: buf[k:k+L]+=np.sin(2*np.pi*(52-18*tt/.18)*tt)*np.exp(-tt*22)*g
vo,_=sf.read("vo3.wav"); vo=np.pad(vo,(0,max(0,N-len(vo))))[:N]
m=np.zeros(N)
for f,g in [(73.4,.5),(110,.35),(146.8,.3),(174.6,.2),(220,.14),(293.7,.07)]:
    m+=g*np.sin(2*np.pi*f*(1+0.0012*np.sin(t*.27+f))*t)*(0.75+0.25*np.sin(2*np.pi*t/8+f))
m*=0.5*env(0,31,3.0,0.05)*(0.6+0.4*np.clip(t/25,0,1))
for bt in np.arange(25.9,30.9,0.6): thump(m,bt,0.4)
m*=np.where((t>30.9)&(t<31.0),0.0,1.0)
tt=t-O; b=np.zeros(N)
for f,g in [(55,.5),(82.4,.35),(110,.3),(130.8,.18),(164.8,.16),(220,.08)]:
    b+=g*np.sin(2*np.pi*f*(1+0.0015*np.sin(tt*.3+f))*np.maximum(tt,0))*(0.75+0.25*np.sin(2*np.pi*tt/9+f))
b*=0.45*np.clip(tt/1.0,0,1)*np.clip((DUR-t)/3.0,0,1)*(0.7+0.3*np.sin(2*np.pi*tt/24)**2)
for bt in np.arange(31.0,111.0,0.5): thump(b,bt,0.12 if bt<80 else 0.16)
for f in (440,554.4,659.3): b+=0.03*np.sin(2*np.pi*f*t)*np.clip((tt-80)/6,0,1)*np.clip((DUR-t)/3,0,1)
m+=b*(t>=O)
sm=np.convolve(np.abs(vo),np.ones(int(.12*SR))/int(.12*SR),'same'); m*=1-0.6*np.clip(sm*14,0,1)
n=rs.randn(N); crowd=np.convolve(n,np.ones(40)/40,'same'); crowd=crowd-np.convolve(crowd,np.ones(2400)/2400,'same')
crowd*=(0.05*env(0,13,2,1.5)+0.5*np.exp(-((t-9.6)/1.6)**2)*(t>7.6)+0.18*np.exp(-((t-11.8)/1.8)**2))
s=np.zeros(N)
put(s,load("whoosh1.wav",.4),12.4); put(s,load("down1.wav",.55),20.2); put(s,load("tick.wav",.7),25.9)
put(s,load("riser1.wav",.9),28.8); put(s,load("whoosh1.wav",.8),30.4)
put(s,load("boom.wav",.9),31.0); put(s,load("hit1.wav",1.0),31.0); put(s,load("sting.wav",.8),O+1.1)
for at in (35.8,45.4,63.2,73.4,91.9,102.2): put(s,load("whoosh1.wav",.55),at-.15)
put(s,load("tick.wav",.9),37.0)                      # click: bowl
for at in (50.5,52.3,54.6,57.2): put(s,load("tick.wav",.9),at)
put(s,load("shut.wav",.5),48.0)
put(s,load("riser1.wav",.7),79.6); put(s,load("hit1.wav",.9),81.5)    # body scan
put(s,load("tick.wav",.8),84.0); put(s,load("down1.wav",.6),85.0)
for at in (92.2,93.4,98.0,102.8,103.6): put(s,load("tick.wav",.6),at)
put(s,load("rswell.wav",.7),109.0); put(s,load("sting.wav",1.0),111.3)
mix=vo*1.25+m*0.55+s*0.7+crowd*0.5
mix=mix/np.max(np.abs(mix))*0.89
sf.write("mix3_raw.wav",np.stack([mix,mix],1),SR)
subprocess.run("ffmpeg -v error -y -i mix3_raw.wav -af loudnorm=I=-16:TP=-1.5:LRA=9 -ar 48000 mix3.wav",shell=True,check=True)
