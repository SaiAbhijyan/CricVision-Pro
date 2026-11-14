import asyncio, base64, json, os, time, sys
from playwright.async_api import async_playwright

CURSOR_JS = """
(()=>{const c=document.createElement('div');c.id='__cur';c.style.cssText='position:fixed;left:0;top:0;width:34px;height:34px;z-index:2147483647;pointer-events:none;transition:none;transform:translate(-100px,-100px)';
c.innerHTML='<svg width="34" height="34" viewBox="0 0 24 24"><path d="M4 2l15 9-6.5 1.6L9.8 19 4 2z" fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg>';
const r=document.createElement('div');r.id='__rip';r.style.cssText='position:fixed;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid #b6ff3c;z-index:2147483646;pointer-events:none;opacity:0';
const add=()=>{document.body.append(c,r)};if(document.body)add();else addEventListener('DOMContentLoaded',add);
addEventListener('mousemove',e=>{c.style.transform=`translate(${e.clientX-6}px,${e.clientY-3}px)`;window.__mx=e.clientX;window.__my=e.clientY},true);
addEventListener('mousedown',e=>{r.style.left=e.clientX+'px';r.style.top=e.clientY+'px';r.animate([{opacity:.95,transform:'scale(.4)'},{opacity:0,transform:'scale(1.6)'}],{duration:450});},true);
})();
"""

class Recorder:
    def __init__(self, page, cdp, outdir):
        self.page, self.cdp, self.out = page, cdp, outdir
        self.frames = []; self.on = False
        cdp.on("Page.screencastFrame", self._frame)
    def _frame(self, ev):
        asyncio.ensure_future(self.cdp.send("Page.screencastFrameAck", {"sessionId": ev["sessionId"]}))
        if self.on: self.frames.append((ev["metadata"]["timestamp"], base64.b64decode(ev["data"])))
    async def start(self):
        self.frames = []; self.on = True
        await self.cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 92, "maxWidth": 1920, "maxHeight": 1080, "everyNthFrame": 1})
    async def stop(self, name):
        self.on = False
        await self.cdp.send("Page.stopScreencast")
        d = os.path.join(self.out, name); os.makedirs(d, exist_ok=True)
        lst = []
        for i, (ts, b) in enumerate(self.frames):
            open(f"{d}/{i:05d}.jpg", "wb").write(b); lst.append(ts)
        with open(f"{d}/list.txt", "w") as f:
            for i in range(len(lst)):
                dur = (lst[i+1] - lst[i]) if i+1 < len(lst) else 1/30
                f.write(f"file '{i:05d}.jpg'\nduration {max(dur,0.001):.5f}\n")
            f.write(f"file '{len(lst)-1:05d}.jpg'\n")
        print(name, len(lst), "frames", round(lst[-1]-lst[0], 2) if lst else 0, "s")

async def move(page, x, y, steps=28):
    await page.mouse.move(x, y, steps=steps)

async def click_text(page, loc, pause=0.5):
    box = await loc.bounding_box()
    await move(page, box["x"] + box["width"]/2, box["y"] + box["height"]/2)
    await page.wait_for_timeout(int(pause*1000)); await page.mouse.down(); await page.mouse.up()

async def launch(p, w=1920, h=1080):
    b = await p.chromium.launch(args=["--no-sandbox", "--force-device-scale-factor=1", "--hide-scrollbars"])
    ctx = await b.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
    await ctx.add_init_script(CURSOR_JS)
    page = await ctx.new_page()
    cdp = await ctx.new_cdp_session(page)
    return b, ctx, page, cdp
