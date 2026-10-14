import bpy
from mathutils import Vector
from pathlib import Path

ROOT = Path("/Users/springchill/Documents/Code/astro-planner")
OBJ = ROOT / "Aston+Martin+DB4+GT+Zagato.obj"
TEX = ROOT / "tex"
OUT = ROOT / "aston_db4_raw.glb"
TARGET_LEN = 4.35  # metres, DB4 GT Zagato overall length

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=str(OBJ))
print("IMPORTED:", [o.name for o in bpy.data.objects])


def make_mat(name, tag):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]

    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = bpy.data.images.load(str(TEX / f"{tag}_basecolor.png"))
    nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])

    o = nt.nodes.new("ShaderNodeTexImage")
    o.image = bpy.data.images.load(str(TEX / f"{tag}_orm.png"))
    o.image.colorspace_settings.name = "Non-Color"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(o.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])

    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = bpy.data.images.load(str(TEX / f"{tag}_normal.png"))
    n.image.colorspace_settings.name = "Non-Color"
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(n.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return m


body = make_mat("Body", "body")
wheels = make_mat("Wheels", "wheels")

for ob in bpy.data.objects:
    if ob.type != "MESH":
        continue
    ob.data.materials.clear()
    ob.data.materials.append(wheels if "WHEEL" in ob.name.upper() else body)

mn = Vector((1e9,) * 3)
mx = Vector((-1e9,) * 3)
for ob in bpy.data.objects:
    if ob.type != "MESH":
        continue
    for c in ob.bound_box:
        w = ob.matrix_world @ Vector(c)
        mn = Vector(map(min, mn, w))
        mx = Vector(map(max, mx, w))
dims = mx - mn
print("DIMS:", tuple(round(d, 2) for d in dims))

s = TARGET_LEN / max(dims) if max(dims) > 50.0 else 1.0
print("SCALE:", s)
for ob in bpy.data.objects:
    ob.scale = (s, s, s)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

bpy.ops.export_scene.gltf(
    filepath=str(OUT),
    export_format="GLB",
    export_apply=True,
    export_animations=False,
    export_skins=False,
    export_morph=False,
)
print("EXPORTED:", OUT)
