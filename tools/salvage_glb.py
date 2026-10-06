#!/usr/bin/env python3
"""Rebuild a valid GLB from a truncated (.crdownload) glTF-binary file.

Keeps every bufferView that lies fully inside the bytes that actually arrived,
then prunes the accessors / primitives / meshes / nodes that depended on the
missing tail. The BIN chunk is reused verbatim (no repacking) so this stays fast
even on a 130 MB asset. If the input is complete, it is a near no-op.
"""
import json
import os
import struct
import sys

JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


def read_glb(path):
    with open(path, "rb") as f:
        magic, version, declared = struct.unpack("<III", f.read(12))
        if magic != 0x46546C67:
            sys.exit(f"{path}: not a GLB (bad magic)")
        clen, ctype = struct.unpack("<II", f.read(8))
        if ctype != JSON_CHUNK:
            sys.exit(f"{path}: first chunk is not JSON")
        gltf = json.loads(f.read(clen))
        bin_header = f.read(8)
        if len(bin_header) < 8:
            sys.exit(f"{path}: truncated before the BIN chunk — nothing to salvage")
        bin_len, btype = struct.unpack("<II", bin_header)
        if btype != BIN_CHUNK:
            sys.exit(f"{path}: second chunk is not BIN")
        blob = f.read(bin_len)
    return gltf, blob, declared, os.path.getsize(path), bin_len


def salvage(gltf, blob, declared_bin_len):
    avail = (len(blob) // 4) * 4  # keep 4-byte alignment for accessor reads
    stats = {"bin_avail": avail, "bin_declared": declared_bin_len}

    # --- bufferViews: keep the ones fully inside the bytes we have -------------
    bv_map, kept_bv = {}, []
    for i, bv in enumerate(gltf.get("bufferViews", [])):
        if bv.get("byteOffset", 0) + bv["byteLength"] <= avail:
            bv_map[i] = len(kept_bv)
            kept_bv.append(bv)
    stats["bufferViews"] = (len(gltf.get("bufferViews", [])), len(kept_bv))

    # --- accessors ------------------------------------------------------------
    acc_map, kept_acc = {}, []
    for i, a in enumerate(gltf.get("accessors", [])):
        bv = a.get("bufferView")
        if bv is not None and bv not in bv_map:
            continue
        a = dict(a)
        if bv is not None:
            a["bufferView"] = bv_map[bv]
        sparse = a.get("sparse")
        if sparse:  # sparse accessors carry two extra bufferViews
            ids, vals = sparse["indices"]["bufferView"], sparse["values"]["bufferView"]
            if ids not in bv_map or vals not in bv_map:
                continue
            a["sparse"] = json.loads(json.dumps(sparse))
            a["sparse"]["indices"]["bufferView"] = bv_map[ids]
            a["sparse"]["values"]["bufferView"] = bv_map[vals]
        acc_map[i] = len(kept_acc)
        kept_acc.append(a)
    stats["accessors"] = (len(gltf.get("accessors", [])), len(kept_acc))

    # --- images / textures: an image with a lost bufferView is unrecoverable ---
    img_map, kept_img = {}, []
    for i, im in enumerate(gltf.get("images", [])):
        bv = im.get("bufferView")
        if bv is not None and bv not in bv_map:
            continue
        im = dict(im)
        if bv is not None:
            im["bufferView"] = bv_map[bv]
        img_map[i] = len(kept_img)
        kept_img.append(im)

    tex_map, kept_tex = {}, []
    for i, t in enumerate(gltf.get("textures", [])):
        src = t.get("source")
        if src is not None and src not in img_map:
            continue
        t = dict(t)
        if src is not None:
            t["source"] = img_map[src]
        tex_map[i] = len(kept_tex)
        kept_tex.append(t)
    stats["textures"] = (len(gltf.get("textures", [])), len(kept_tex))

    # Strip texture references that no longer resolve, so materials stay valid.
    def fix_tex_refs(obj):
        if isinstance(obj, dict):
            out = {}
            for k, v in obj.items():
                if isinstance(v, dict) and "index" in v and k.endswith("Texture"):
                    if v["index"] in tex_map:
                        v = dict(v)
                        v["index"] = tex_map[v["index"]]
                        out[k] = v
                    continue  # drop the dangling reference
                out[k] = fix_tex_refs(v)
            return out
        if isinstance(obj, list):
            return [fix_tex_refs(v) for v in obj]
        return obj

    materials = fix_tex_refs(gltf.get("materials", []))

    # --- meshes: a primitive needs POSITION and (if used) its indices ----------
    mesh_map, kept_mesh = {}, []
    dropped_prims = 0
    for i, m in enumerate(gltf.get("meshes", [])):
        prims = []
        for pr in m["primitives"]:
            attrs = {k: acc_map[v] for k, v in pr.get("attributes", {}).items() if v in acc_map}
            if "POSITION" not in attrs:
                dropped_prims += 1
                continue
            if "indices" in pr and pr["indices"] not in acc_map:
                dropped_prims += 1
                continue
            pr = dict(pr)
            pr["attributes"] = attrs
            if "indices" in pr:
                pr["indices"] = acc_map[pr["indices"]]
            pr.pop("targets", None)  # morph targets aren't used by this asset
            prims.append(pr)
        if not prims:
            continue
        m = dict(m)
        m["primitives"] = prims
        mesh_map[i] = len(kept_mesh)
        kept_mesh.append(m)
    stats["meshes"] = (len(gltf.get("meshes", [])), len(kept_mesh))
    stats["dropped_primitives"] = dropped_prims

    # --- nodes: drop a node only if it has neither geometry nor descendants ----
    nodes = gltf.get("nodes", [])
    keep = [False] * len(nodes)

    def visit(i):
        n = nodes[i]
        alive = n.get("mesh") in mesh_map
        for c in n.get("children", []):
            if visit(c):
                alive = True
        if n.get("camera") is not None:
            alive = True
        keep[i] = alive
        return alive

    roots = set()
    for s in gltf.get("scenes", []):
        roots.update(s.get("nodes", []))
    for r in roots:
        visit(r)

    node_map, kept_nodes = {}, []
    for i, n in enumerate(nodes):
        if keep[i]:
            node_map[i] = len(kept_nodes)
            kept_nodes.append(n)
    out_nodes = []
    for n in kept_nodes:
        n = dict(n)
        if n.get("mesh") in mesh_map:
            n["mesh"] = mesh_map[n["mesh"]]
        else:
            n.pop("mesh", None)
        kids = [node_map[c] for c in n.get("children", []) if c in node_map]
        if kids:
            n["children"] = kids
        else:
            n.pop("children", None)
        n.pop("skin", None)
        out_nodes.append(n)
    stats["nodes"] = (len(nodes), len(out_nodes))

    scenes = []
    for s in gltf.get("scenes", []):
        s = dict(s)
        s["nodes"] = [node_map[n] for n in s.get("nodes", []) if n in node_map]
        scenes.append(s)

    out = dict(gltf)
    out["bufferViews"] = kept_bv
    out["accessors"] = kept_acc
    out["meshes"] = kept_mesh
    out["nodes"] = out_nodes
    out["scenes"] = scenes
    out["materials"] = materials
    out["buffers"] = [{"byteLength": avail}]
    if kept_img:
        out["images"] = kept_img
    else:
        out.pop("images", None)
    if kept_tex:
        out["textures"] = kept_tex
    else:
        out.pop("textures", None)
        out.pop("samplers", None)
    out.pop("animations", None)
    out.pop("skins", None)
    return out, blob[:avail], stats


def write_glb(path, gltf, blob):
    js = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    js += b" " * (-len(js) % 4)
    bn = blob + b"\x00" * (-len(blob) % 4)
    total = 12 + 8 + len(js) + 8 + len(bn)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), JSON_CHUNK))
        f.write(js)
        f.write(struct.pack("<II", len(bn), BIN_CHUNK))
        f.write(bn)
    return total


if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    gltf, blob, declared_total, actual_size, bin_len = read_glb(src)
    complete = actual_size >= declared_total and len(blob) >= bin_len
    print(f"source      : {src}")
    print(f"             {actual_size:,} bytes on disk / {declared_total:,} declared"
          f"  -> {'COMPLETE' if complete else 'TRUNCATED'}")
    out, kept_blob, st = salvage(gltf, blob, bin_len)
    print(f"BIN payload : {st['bin_avail']:,} of {st['bin_declared']:,} bytes "
          f"({100 * st['bin_avail'] / st['bin_declared']:.1f}%)")
    for key in ("bufferViews", "accessors", "meshes", "nodes", "textures"):
        had, now = st[key]
        print(f"{key:<12}: {now:,} kept of {had:,}  ({had - now:,} dropped)")
    total = write_glb(dst, out, kept_blob)
    print(f"wrote       : {dst}  ({total:,} bytes)")
