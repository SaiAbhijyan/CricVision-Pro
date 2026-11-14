import asyncio
from rec import *
from scenes import session
async def card_of(page, heading):
    return page.locator(f"xpath=//h3[starts-with(normalize-space(.),\"{heading}\")]/ancestor::*[self::section or contains(@class,'card')][1]").first
async def main():
    async with async_playwright() as p:
        b, ctx, page, cdp = await launch(p)
        await session(page, 14)
        await page.wait_for_url("**/report/**", timeout=60000) if "report" not in page.url else None
        await page.wait_for_timeout(3000)
        print(page.url)
        await cdp.send("Emulation.setDeviceMetricsOverride", {"width":1920,"height":1080,"deviceScaleFactor":2,"mobile":False}); await page.wait_for_timeout(1500)
        bow = await card_of(page, "Bowling report"); await bow.scroll_into_view_if_needed(); await page.wait_for_timeout(600)
        chips = bow.locator("button", has_text="#"); n = await chips.count(); print("chips", n)
        for name, idx in [("bowl_a", 6), ("bowl_b", 1), ("bowl_c", 4)]:
            if idx < n:
                await chips.nth(idx).click(); await page.wait_for_timeout(1800); await bow.screenshot(path=f"/tmp/rec/stills/{name}.png")
        for name, h in [("action","Bowler's action"),("batswing","Bat swing and weight transfer"),("cog","Centre of gravity"),("chain","Timing chain"),("drs","Decision review"),("reel","Slow-motion highlight reel")]:
            c = await card_of(page, h)
            if await c.count(): await c.scroll_into_view_if_needed(); await page.wait_for_timeout(900); await c.screenshot(path=f"/tmp/rec/stills/{name}.png"); print("still", name)
            else: print("no", name)
        await page.goto("http://localhost:3100/profile"); await page.wait_for_timeout(3000)
        await page.screenshot(path="/tmp/rec/stills/dna_top.png")
        for name, h in [("dna_score","Where you score"),("dna_trend","How your game is changing"),("dna_tech","Technique signature")]:
            c = await card_of(page, h)
            if await c.count(): await c.scroll_into_view_if_needed(); await page.wait_for_timeout(900); await c.screenshot(path=f"/tmp/rec/stills/{name}.png"); print("still", name)
            else: print("no", name)
        await b.close()
asyncio.run(main())
