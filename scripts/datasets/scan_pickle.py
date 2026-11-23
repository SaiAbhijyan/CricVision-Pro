"""List every global a PyTorch/pickle file would import; flag anything outside an allowlist. Never unpickles."""
import sys, zipfile, pickletools, io
SAFE = ("torch", "ultralytics", "collections", "numpy", "builtins.set", "builtins.dict", "builtins.list", "builtins.tuple",
        "builtins.slice", "builtins.getattr", "builtins.int", "builtins.float", "builtins.bool", "builtins.frozenset", "_codecs.encode",
        "copyreg._reconstructor", "builtins.object", "pathlib", "argparse.Namespace", "datetime", "types.SimpleNamespace", "copyreg.__newobj__", "__builtin__.set")
def globals_in(data):
    out, strs = set(), []
    for op, arg, _ in pickletools.genops(io.BytesIO(data)):
        if op.name in ("SHORT_BINUNICODE", "BINUNICODE", "UNICODE", "SHORT_BINSTRING", "BINSTRING"): strs.append(arg)
        if op.name == "GLOBAL": out.add(arg.replace(" ", "."))
        if op.name == "STACK_GLOBAL" and len(strs) >= 2: out.add(f"{strs[-2]}.{strs[-1]}")
    return out
for path in sys.argv[1:]:
    try:
        z = zipfile.ZipFile(path); blobs = [z.read(n) for n in z.namelist() if n.endswith(".pkl")]
    except zipfile.BadZipFile:
        blobs = [open(path, "rb").read()]
    g = set().union(*(globals_in(b) for b in blobs))
    bad = sorted(x for x in g if not x.startswith(SAFE))
    print(("UNSAFE " if bad else "ok     ") + path, bad[:12])
