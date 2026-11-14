import numpy as np, soundfile as sf, json
from kokoro_onnx import Kokoro
k=Kokoro("/tmp/tts/kokoro.onnx","/tmp/tts/voices.bin")
O=31
intro=[(1.0,"We all had those days. Running in to bowl like the players we admired."),
(7.0,"Dreaming of that first ball. That first wicket."),
(13.6,"And batting, with the grace and elegance of the legends."),
(21.2,"We copied their styles. We learned. We chased the pros."),
(25.9,"And now, it's just a click away. In your palm."),
(O+0.9,"Introducing, CricVision Pro.")]
app=[("B","Bowl a ball. The app follows it frame by frame, and reads the swing, the turn, the bounce, and the shot that was played.",O+5.2),
("C","Every delivery is compared with a normal ball, released the same way. The grey line is that ball. The green line is what this one really did. Sixteen centimetres of swing in the air. Twenty more off the pitch. Thirty-six at the stumps.",None),
("D","It reads the bowler's arm too. Arm slot, release height, how fast the arm turns, and whether the elbow straightens past the legal limit.",None),
("E","Now the batter. The app scans the body, head to toe, and weighs every segment. Head, trunk, arms, thighs, shanks, feet. That gives the true centre of gravity, and exactly how much weight is going forward, or falling back, as the ball arrives.",None),
("F","Plot it through the shot, and you see the transfer onto the front foot, the bat speed, and the timing chain. Hips, then shoulders, then hands.",None),
("G","And it learns you. Session after session, your style, your strengths, and what bowlers will target. All on your device.",None),
("H","CricVision Pro. Know your game.",None)]
SR=24000; out=np.zeros(int(125*SR)); sc={}
def put(t,txt):
    a,_=k.create(txt,voice="am_michael",speed=0.92,lang="en-us"); a=np.asarray(a); i=int(t*SR); out[i:i+len(a)]+=a; return t+len(a)/SR
for t,txt in intro: put(t,txt)
t=O+5.2
for key,txt,_ in app:
    sc[key]=[round(t,2)]; e=put(t,txt); sc[key].append(round(e,2)); t=e+0.9
print(sc); json.dump(sc,open("sc.json","w"))
sf.write("vo3.wav",out[:int((t+1)*SR)],SR)
