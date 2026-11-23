import csv, sys, collections, json
rows = csv.DictReader(open(sys.argv[1]))
ph = lambda o: "powerplay" if o < 6 else "middle" if o < 15 else "death"
C = collections.defaultdict(collections.Counter)
for r in rows:
    if r["Innings"] not in ("1", "2"): continue
    p = ph(int(r["Overs"])); c = C[p]; et = r["ExtraType"]
    c["deliveries"] += 1
    if et in ("wides", "noballs"): c["illegal"] += 1
    if et == "wides": c["wide"] += 1
    if et == "noballs": c["noball"] += 1
    if et in ("wides",): continue                     # a wide is not a ball faced
    b = int(r["BatsmanRun"]); c["faced"] += 1; c[f"r{b}"] += 1
    if int(r["TotalRun"]) == 0 and r["IsWicketDelivery"] == "0": c["dot"] += 1
    if r["IsWicketDelivery"] == "1" and r["Kind"] not in ("run out", "retired hurt", "retired out", "obstructing the field"): c["wkt"] += 1
    c["runs"] += int(r["TotalRun"])
out = {}
for p in ("powerplay", "middle", "death"):
    c = C[p]; f = c["faced"]; legal = c["deliveries"] - c["illegal"]
    out[p] = {"deliveries": c["deliveries"], "runRatePerOver": round(6 * c["runs"] / legal, 2), "dotPct": round(100 * c["dot"] / f, 1),
              "onePct": round(100 * c["r1"] / f, 1), "twoPct": round(100 * c["r2"] / f, 1), "fourPct": round(100 * c["r4"] / f, 1),
              "sixPct": round(100 * c["r6"] / f, 1), "wicketPct": round(100 * c["wkt"] / f, 2), "widePct": round(100 * c["wide"] / c["deliveries"], 2),
              "noballPct": round(100 * c["noball"] / c["deliveries"], 2)}
print(json.dumps(out, indent=1))
