import asyncio, subprocess, sys
from rec import *

SMOOTH = """async ([y,ms])=>{const y0=window.scrollY;const t0=performance.now();await new Promise(r=>{const f=(t)=>{const u=Math.min(1,(t-t0)/ms);const e=u<.5?2*u*u:1-Math.pow(-2*u+2,2)/2;window.scrollTo(0,y0+(y-y0)*e);u<1?requestAnimationFrame(f):r()};requestAnimationFrame(f)})}"""
async def scroll_to_el(page, text, off=30, ms=1400, exact=False):
    y = await page.evaluate("""(t)=>{const els=[...document.querySelectorAll('h2,h3,.label')].filter(e=>e.textContent.trim().startsWith(t));if(!els.length)return null;return els[0].getBoundingClientRect().top+window.scrollY}""", text)
    if y is None: print("missing", text); return False
    await page.evaluate(SMOOTH, [max(0, y - off), ms]); return True

async def bowl(page, n=1, gap=1300):
    for _ in range(n):
        await page.get_by_role("button", name="Bowl next ball").click(); await page.wait_for_timeout(gap)

async def session(page, balls):
    await page.goto("http://localhost:3100"); await page.get_by_text("Start virtual match simulator").click(); await page.wait_for_timeout(1200)
    await bowl(page, balls, 900)
    await page.get_by_role("button", name="Finish").first.click(); await page.wait_for_url("**/report/**", timeout=60000); await page.wait_for_timeout(2500)

async def main():
    async with async_playwright() as p:
        b, ctx, page, cdp = await launch(p)
        R = Recorder(page, cdp, "/tmp/rec/out")
        for k in range(3):
            await session(page, 16); print("warm", k, flush=True)
        # ---- R0 home
        await page.goto("http://localhost:3100"); await page.wait_for_timeout(900)
        await page.mouse.move(1200, 700)
        await R.start(); await page.wait_for_timeout(700)
        await click_text(page, page.get_by_text("Start virtual match simulator"), 0.6); await page.wait_for_timeout(1800); await R.stop("r0_home")
        # ---- R1 live bowl x3
        await R.start(); await page.wait_for_timeout(500)
        for i in range(3):
            await click_text(page, page.get_by_role("button", name="Bowl next ball"), 0.5 if i == 0 else 0.15)
            await page.wait_for_timeout(2600)
        await R.stop("r1_live")
        # ---- need a ball with a real shot for the body-weight scene
        for _ in range(8):
            txt = await page.locator("text=/^Shot$/").first.evaluate("e=>e.parentElement.textContent") if await page.locator("text=/^Shot$/").count() else ""
            if "Leave" not in txt and "Shot" in txt and "Defend" not in txt: break
            await bowl(page, 1, 1500)
        await page.wait_for_timeout(500)
        # ---- R2 body weight
        await page.mouse.move(900, 600)
        await R.start(); await page.wait_for_timeout(300)
        await page.evaluate(SMOOTH, [10000, 1500]); await page.wait_for_timeout(500)
        await click_text(page, page.get_by_role("button", name="0.5×"), 0.4)
        await click_text(page, page.get_by_role("button", name="Scan body"), 0.7)
        await page.wait_for_timeout(5600)
        await page.wait_for_timeout(9500)
        await R.stop("r2_weight")
        # ---- finish
        await page.evaluate(SMOOTH, [0, 600]); await page.wait_for_timeout(400)
        await click_text(page, page.get_by_role("button", name="Finish"), 0.3)
        await page.wait_for_url("**/report/**", timeout=60000); await page.wait_for_timeout(3500)
        # ---- R3 report top -> bowling report
        await page.mouse.move(1500, 500)
        await R.start(); await page.wait_for_timeout(2500)
        await page.evaluate(SMOOTH, [700, 1800]); await page.wait_for_timeout(500)
        await scroll_to_el(page, "Bowling report", 30, 1800); await page.wait_for_timeout(1500)
        chips = page.locator("button", has_text="#")
        n = await chips.count(); print("chips", n)
        for idx in [2, 6, 10]:
            if idx < n:
                await click_text(page, chips.nth(idx), 0.35); await page.wait_for_timeout(2300)
        await R.stop("r3_bowling")
        # ---- R4 action
        await R.start(); await page.wait_for_timeout(300)
        await scroll_to_el(page, "Bowler's action", 30, 1800); await page.wait_for_timeout(4200); await R.stop("r4_action")
        # ---- R5 bat + CoM
        await R.start(); await page.wait_for_timeout(300)
        if await scroll_to_el(page, "Bat swing and weight transfer", 30, 1800): await page.wait_for_timeout(3000)
        await scroll_to_el(page, "Centre of gravity", 30, 1400); await page.wait_for_timeout(4500); await R.stop("r5_bat")
        # ---- R6 DRS
        if await page.locator("text=Decision review").count():
            await R.start(); await page.wait_for_timeout(300); await scroll_to_el(page, "Decision review", 30, 1600); await page.wait_for_timeout(5000); await R.stop("r6_drs")
        else: print("no DRS this session")
        # ---- R7 DNA
        await page.evaluate(SMOOTH, [0, 400])
        await R.start(); await page.wait_for_timeout(300)
        await click_text(page, page.get_by_text("Player DNA").first, 0.5); await page.wait_for_timeout(2800)
        await page.evaluate(SMOOTH, [650, 2200]); await page.wait_for_timeout(2200)
        await page.evaluate(SMOOTH, [1400, 2200]); await page.wait_for_timeout(1800); await R.stop("r7_dna")
        await b.close()
if __name__=='__main__': asyncio.run(main())
