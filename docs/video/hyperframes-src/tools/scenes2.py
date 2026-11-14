import asyncio, os
from rec import *
from scenes import SMOOTH, bowl, session  # reuse helpers (scenes.py main is guarded below)

async def dsf(cdp, f):
    await cdp.send("Emulation.setDeviceMetricsOverride", {"width": 1920, "height": 1080, "deviceScaleFactor": f, "mobile": False})

async def card_of(page, heading):
    return page.locator(f"xpath=//h3[starts-with(normalize-space(.),\"{heading}\")]/ancestor::div[contains(@class,'card')][1]").first

async def main():
    os.makedirs("/tmp/rec/stills", exist_ok=True)
    async with async_playwright() as p:
        # ---------- phone: real app on a phone-sized screen ----------
        bp, ctxp, pp, cdpp = await launch(p, 412, 860)
        Rp = Recorder(pp, cdpp, "/tmp/rec/out")
        await pp.goto("http://localhost:3100"); await pp.wait_for_timeout(800)
        await pp.get_by_text("Start virtual match simulator").click(); await pp.wait_for_timeout(1500)
        await pp.mouse.move(250, 600)
        await Rp.start(); await pp.wait_for_timeout(500)
        for i in range(3):
            await click_text(pp, pp.get_by_role("button", name="Bowl next ball"), 0.5 if i == 0 else 0.2); await pp.wait_for_timeout(2400)
        await Rp.stop("r_phone"); await bp.close()

        # ---------- desktop ----------
        b, ctx, page, cdp = await launch(p)
        R = Recorder(page, cdp, "/tmp/rec/out")
        for k in range(3):
            await session(page, 16); print("warm", k, flush=True)
        await page.goto("http://localhost:3100"); await page.wait_for_timeout(900); await page.mouse.move(1200, 700)
        await R.start(); await page.wait_for_timeout(700)
        await click_text(page, page.get_by_text("Start virtual match simulator"), 0.6); await page.wait_for_timeout(1800); await R.stop("r0_home")
        await R.start(); await page.wait_for_timeout(500)
        for i in range(3):
            await click_text(page, page.get_by_role("button", name="Bowl next ball"), 0.5 if i == 0 else 0.15); await page.wait_for_timeout(2600)
        await R.stop("r1_live")
        for _ in range(8):
            loc = page.locator("text=/^Shot$/")
            txt = await loc.first.evaluate("e=>e.parentElement.textContent") if await loc.count() else ""
            if "Leave" not in txt and "Defend" not in txt and "Shot" in txt: break
            await bowl(page, 1, 1500)
        await page.evaluate(SMOOTH, [10000, 10]); await page.wait_for_timeout(1200)      # pre-scroll, not recorded
        await page.mouse.move(700, 300)
        await R.start(); await page.wait_for_timeout(600)
        await click_text(page, page.get_by_role("button", name="0.5×"), 0.4)
        await click_text(page, page.get_by_role("button", name="Scan body"), 0.7)
        await page.wait_for_timeout(5600); await page.wait_for_timeout(9500); await R.stop("r2_weight")
        await page.screenshot(path="/tmp/rec/stills/live_bottom.png")
        await page.evaluate(SMOOTH, [0, 10]); await page.wait_for_timeout(400)
        await click_text(page, page.get_by_role("button", name="Finish"), 0.3)
        await page.wait_for_url("**/report/**", timeout=60000); await page.wait_for_timeout(3500)

        # ---------- hi-res stills at 2x ----------
        await dsf(cdp, 2); await page.mouse.move(1900, 1070); await page.wait_for_timeout(1200)
        await page.evaluate("window.scrollTo(0,0)"); await page.wait_for_timeout(500)
        await page.screenshot(path="/tmp/rec/stills/report_top.png")
        bow = await card_of(page, "Bowling report"); await bow.scroll_into_view_if_needed(); await page.wait_for_timeout(500)
        chips = bow.locator("button", has_text="#"); n = await chips.count(); print("chips", n)
        for name, idx in [("bowl_a", 6), ("bowl_b", 1), ("bowl_c", 4)]:
            if idx < n:
                await chips.nth(idx).click(); await page.wait_for_timeout(1800); await bow.screenshot(path=f"/tmp/rec/stills/{name}.png")
        for name, h in [("action", "Bowler's action"), ("batswing", "Bat swing and weight transfer"), ("cog", "Centre of gravity"), ("chain", "Timing chain"), ("drs", "Decision review")]:
            c = await card_of(page, h)
            if await c.count(): await c.scroll_into_view_if_needed(); await page.wait_for_timeout(900); await c.screenshot(path=f"/tmp/rec/stills/{name}.png"); print("still", name)
            else: print("no", name)
        await page.goto("http://localhost:3100/profile"); await page.wait_for_timeout(3000)
        await page.evaluate("window.scrollTo(0,0)"); await page.wait_for_timeout(500)
        await page.screenshot(path="/tmp/rec/stills/dna_top.png")
        for name, h in [("dna_score", "Where you score"), ("dna_trend", "How your game is changing"), ("dna_tech", "Technique signature")]:
            c = page.locator(f"xpath=//h3[starts-with(normalize-space(.),\"{h}\")]/ancestor::section[1]").first
            if await c.count(): await c.scroll_into_view_if_needed(); await page.wait_for_timeout(900); await c.screenshot(path=f"/tmp/rec/stills/{name}.png"); print("still", name)
            else: print("no", name)
        await b.close()
if __name__ == "__main__": asyncio.run(main())
